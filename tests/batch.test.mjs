import test from 'node:test';
import assert from 'node:assert/strict';
import {installBatch} from '../extension/batch.mjs';

const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){for(const fn of this.listeners)fn(...args);}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await tick();}assert.fail('operation did not settle');}
function setup(options={}){
  const log=[],messages=[];let state={},generation=0;
  const chrome={runtime:{id:'unit',getURL:p=>`chrome-extension://unit/${p}`,onConnect:event()},tabs:{
    async create(o){log.push(['create',o]);return {id:80};},
    async update(id,o){log.push(['update',id,o]);if(o.url)state={url:o.url,generation:++generation,items:[]};},async get(id){return {id,status:'complete',url:state.url};},
    async remove(id){log.push(['remove',id]);}},scripting:{async executeScript(o){log.push(['script',o.target.tabId,o.func.name]);return [];}}};
  const capture={async arm(id,url){log.push(['arm',id,url]);state={url,generation:++generation,items:[]};},async read(){return structuredClone(state);},async release(id){log.push(['release',id]);}};
  installBatch(chrome,capture,{timeoutMs:30,pollMs:2,...options});
  const port={name:'turbovideo-batch',sender:{id:'unit',url:'chrome-extension://unit/dashboard.html'},onMessage:event(),onDisconnect:event(),postMessage(m){messages.push(m);}};
  chrome.runtime.onConnect.emit(port);
  return {chrome,capture,port,log,messages,setItems(items){state.items=items;},setState(s){state=s;}};
}
const manifest={url:'https://cdn.test/master.m3u8',kind:'HLS',referer:'https://player.test/'};

test('retrying the same lesson reloads without cache to obtain a fresh signed source',async()=>{
  const s=setup();const update=s.chrome.tabs.update;s.chrome.tabs.update=async(id,o)=>{await update(id,o);if(o.url)s.setItems([manifest]);};
  const fresh={...manifest,url:'https://cdn.test/master.m3u8?signature=fresh'};
  s.chrome.tabs.reload=async(id,options)=>{s.log.push(['reload',id,options]);s.setState({url:'https://course.test/a',generation:100,items:[fresh]});};
  s.port.onMessage.emit({type:'resolve',id:'first',url:'https://course.test/a'});await until(()=>s.messages.length===1);
  s.port.onMessage.emit({type:'resolve',id:'retry',url:'https://course.test/a'});await until(()=>s.messages.length===2);
  assert.equal(s.messages[1].source.url,fresh.url);assert.deepEqual(s.log.find(x=>x[0]==='reload'),['reload',80,{bypassCache:true}]);
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('waits for the owned initial document before arming and navigating to the first lesson',async()=>{
  const s=setup({timeoutMs:300,pollMs:2});let ready=false,checks=0;
  s.chrome.tabs.get=async id=>{if(++checks>=3)ready=true;return {id,status:ready?'complete':'loading',url:'about:blank'};};
  const arm=s.capture.arm;s.capture.arm=async(...args)=>{assert.equal(ready,true,'initial document must be ready before arm');return arm(...args);};
  const update=s.chrome.tabs.update;s.chrome.tabs.update=async(id,o)=>{await update(id,o);if(o.url)s.setItems([manifest]);};
  s.port.onMessage.emit({type:'resolve',id:'startup',url:'https://course.test/a'});await until(()=>s.messages.length);
  assert.equal(s.messages[0].type,'resolved');assert.ok(checks>=3);
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('stop while the initial document loads closes the owned tab without arming a lesson',async()=>{
  const s=setup({timeoutMs:300,pollMs:2});let checked=false;
  s.chrome.tabs.get=async id=>{checked=true;return {id,status:'loading'};};
  s.port.onMessage.emit({type:'resolve',id:'stop-startup',url:'https://course.test/a'});await until(()=>checked);
  s.port.onMessage.emit({type:'stop'});await until(()=>s.log.some(x=>x[0]==='remove'));
  assert.equal(s.log.some(x=>x[0]==='arm'),false);assert.equal(s.log.some(x=>x[0]==='update'&&x[2].url),false);
});

test('arms before navigation and resolves original network Referer; pauses and cleans only owned tab',async()=>{
  const s=setup();const update=s.chrome.tabs.update;s.chrome.tabs.update=async(id,o)=>{await update(id,o);if(o.url)s.setItems([manifest]);};
  s.port.onMessage.emit({type:'resolve',id:'a',url:'https://course.test/a'});
  await until(()=>s.messages.length);
  assert.deepEqual(s.messages[0],{type:'resolved',id:'a',source:manifest});
  assert.ok(s.log.findIndex(x=>x[0]==='arm')<s.log.findIndex(x=>x[0]==='update'&&x[2].url));
  const mute=s.log.findIndex(x=>x[0]==='update'&&x[2].muted===true);
  assert.ok(mute>=0&&mute<s.log.findIndex(x=>x[0]==='update'&&x[2].url));
  assert.deepEqual(s.log[mute],['update',80,{muted:true,active:false,autoDiscardable:false}]);
  assert.deepEqual(s.log.find(x=>x[0]==='create')[1],{url:'chrome-extension://unit/batch-tab.html',active:false});
  assert.ok(s.log.some(x=>x[0]==='script'&&x[1]===80&&x[2]==='pauseVideos'));
  s.port.onMessage.emit({type:'finish'});await until(()=>s.messages.some(x=>x.type==='closed'));
  assert.deepEqual(s.log.filter(x=>x[0]==='remove'),[['remove',80]]);
});

test('each lesson is armed anew and stale source state never resolves the next lesson',async()=>{
  const s=setup();const update=s.chrome.tabs.update;let count=0;s.chrome.tabs.update=async(id,o)=>{await update(id,o);if(o.url){if(++count===1)s.setItems([manifest]);else s.setState({url:'https://course.test/a',generation:1,items:[manifest]});}};
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});await until(()=>s.messages.length===1);
  s.port.onMessage.emit({type:'resolve',id:2,url:'https://course.test/b'});await until(()=>s.messages.length===2);
  assert.equal(s.messages[1].type,'error');assert.match(s.messages[1].message,/tempo|vídeo/i);
  assert.equal(s.log.filter(x=>x[0]==='create').length,1);
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('rejects invalid URLs and duplicate work; timeout pauses video and reports authentication restriction',async()=>{
  const s=setup();s.port.onMessage.emit({type:'resolve',id:0,url:'https://name:pass@course.test/a'});await until(()=>s.messages.length);
  assert.equal(s.log.length,0);assert.equal(s.messages[0].type,'error');
  s.chrome.scripting.executeScript=async o=>{s.log.push(['script',o.target.tabId,o.func.name]);throw new Error('Cannot access contents');};
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});
  s.port.onMessage.emit({type:'resolve',id:2,url:'https://course.test/b'});
  await until(()=>s.messages.length===3);
  assert.equal(s.messages.find(m=>m.id===2).type,'error');
  assert.match(s.messages.find(m=>m.id===1).message,/acesso|autentic|permiss/i);
  assert.ok(s.log.some(x=>x[2]==='pauseVideos'));
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

for(const stop of ['stop','disconnect'])test(`${stop} during pending creation removes late-created tab without navigating`,async()=>{
  const s=setup();let complete;s.chrome.tabs.create=()=>new Promise(resolve=>{complete=resolve;});
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});await until(()=>complete);
  if(stop==='disconnect')s.port.onDisconnect.emit();else s.port.onMessage.emit({type:'stop'});
  complete({id:80});await until(()=>s.log.some(x=>x[0]==='remove'));
  assert.equal(s.log.some(x=>x[0]==='update'),false);assert.deepEqual(s.log.filter(x=>x[0]==='remove'),[['remove',80]]);
  assert.equal(s.messages.some(x=>x.type==='resolved'),false);
});

test('rejects untrusted runtime ports',async()=>{
  const s=setup();const p={...s.port,sender:{id:'unit',url:'https://course.test/'},onMessage:event()};
  s.chrome.runtime.onConnect.emit(p);assert.equal(p.onMessage.listeners.length,0);
});

test('DOM fallback selects manifest before direct sources and ignores blob and fragment URLs',async()=>{
  const s=setup();s.chrome.scripting.executeScript=async o=>{
    s.log.push(['script',o.target.tabId,o.func.name]);
    return [{result:[{url:'blob:https://course.test/id'},{url:'https://cdn.test/part.ts',kind:'HLS',referer:'https://frame.test/'},
      {url:'https://cdn.test/video.mp4',referer:'https://frame.test/'},
      {url:'https://cdn.test/index.mpd',referer:'https://frame.test/'}]}];
  };
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});await until(()=>s.messages.length);
  assert.equal(s.messages[0].source.url,'https://cdn.test/index.mpd');
  assert.equal(s.messages[0].source.referer,'https://frame.test/');
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('stop while navigation is pending waits for owned tab pause then removes it',async()=>{
  const s=setup();const update=s.chrome.tabs.update;let navigate;s.chrome.tabs.update=(id,o)=>o.url?new Promise(resolve=>{navigate=resolve;}):update(id,o);
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});await until(()=>navigate);
  s.port.onMessage.emit({type:'stop'});navigate({id:80});
  await until(()=>s.log.some(x=>x[0]==='remove'));
  assert.ok(s.log.findIndex(x=>x[2]==='pauseVideos')<s.log.findIndex(x=>x[0]==='remove'));
  assert.equal(s.messages.some(x=>x.type==='resolved'),false);
});

test('old source arriving after arm is ignored until navigation advances the generation',async()=>{
  const s=setup({timeoutMs:2000});const update=s.chrome.tabs.update;
  const next={...manifest,url:'https://cdn.test/next.m3u8'};
  s.chrome.tabs.update=async(id,o)=>{
    if(!o.url)return update(id,o);
    s.setItems([manifest]);
    setTimeout(async()=>{await update(id,o);s.setItems([next]);},12);
  };
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/next'});
  await until(()=>s.messages.length);
  assert.equal(s.messages[0].source.url,next.url);
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('DOM sources cannot resolve before a navigation generation is observed',async()=>{
  const s=setup();const update=s.chrome.tabs.update;
  s.chrome.tabs.update=async(id,o)=>{if(!o.url)return update(id,o);};
  s.chrome.scripting.executeScript=async()=>[{result:[manifest]}];
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});
  await until(()=>s.messages.length);assert.equal(s.messages[0].type,'error');
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});

test('navigation during DOM inspection cannot leak another lesson source',async()=>{
  const s=setup();s.chrome.scripting.executeScript=async o=>{
    if(o.func.name==='inspectPlayer'){
      s.setState({url:'https://course.test/unrelated',generation:2,items:[]});
      return [{result:[manifest]}];
    }
    return [];
  };
  s.port.onMessage.emit({type:'resolve',id:1,url:'https://course.test/a'});await until(()=>s.messages.length);
  assert.equal(s.messages[0].type,'error');
  s.port.onDisconnect.emit();await until(()=>s.log.some(x=>x[0]==='remove'));
});
