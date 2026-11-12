import test from 'node:test';
import assert from 'node:assert/strict';
import {installHub,collectMedia} from '../extension/hub.mjs';
import {TEXT_EMPTY} from '../extension/view-model.mjs';

const MEDIA='https://cdn.test/aula.m3u8?signature=secret';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function setup({tabs={1:{id:1,url:'https://site.test/v',title:'Vídeo da página'}},items=[{url:MEDIA,kind:'HLS',source:'Rede',referer:'https://player.test/'}],dom=[],inspect=async()=>null,current,updateMs=0,nativeClient,retryMs}={}){
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){for(const fn of this.listeners)fn(...args);}});
  const created=[];const starts=[];const cancels=[];const currents=[];const sent=[];
  const chrome={runtime:{id:'ext',getURL:p=>`chrome-extension://ext/${p}`,onConnect:event()},
    tabs:{async get(id){if(!tabs[id])throw new Error('No tab');return {...tabs[id]};},async create(o){created.push(o);return {id:99};},async reload(){},onRemoved:event()}};
  const listeners={downloads:new Set(),course:new Set(),native:new Set()};
  const capture={async sources(){return {items:structuredClone(items)};},async arm(){},async read(){return {items:[]};},async release(){}};
  const native=nativeClient||{status:()=>({state:'idle',info:{folder:'C:/x'}}),ensureReady:async()=>({}),send:m=>{sent.push(m);return true;},request:async m=>({type:'info',id:m.id,title:'T',heights:[]}),onStatus(fn){listeners.native.add(fn);return()=>{};},onMessage(){return()=>{};}};
  const jobs=[];
  const downloads={start(req){starts.push(req);const id='job'+starts.length;jobs.push({id,title:req.title,status:'starting'});return {id,done:new Promise(()=>{})};},cancel(id){cancels.push(id);},list:()=>jobs.map(j=>({...j})),onChange(fn){listeners.downloads.add(fn);return()=>{};}};
  const course={inspect,state:()=>({status:'idle'}),async downloadCurrent(tabId,opts){currents.push({tabId,...opts});if(current)return current(tabId,opts);throw Object.assign(new Error('Esta aba não é uma aula de curso.'),{code:'not_course'});},async start(){},stop(){},async resume(){},onChange(fn){listeners.course.add(fn);return()=>{};}};
  installHub(chrome,{capture,native,downloads,course,scanDom:async()=>structuredClone(dom),updateMs,...(retryMs!=null?{retryMs}:{})});
  function connect({name='sirm-ui',sender={id:'ext',url:'chrome-extension://ext/popup.html'}}={}){
    const posted=[];const onMessage=event();const onDisconnect=event();
    const port={name,sender,postMessage:m=>posted.push(m),onMessage,onDisconnect,disconnect(){}};
    chrome.runtime.onConnect.emit(port);
    let rid=0;
    const ask=async msg=>{const id=++rid;onMessage.emit({rid:id,...msg});for(let i=0;i<200;i++){const reply=posted.find(m=>m.type==='reply'&&m.rid===id);if(reply)return reply;await sleep(2);}throw new Error('no reply');};
    return {port,posted,ask,listening:()=>onMessage.listeners.length>0,close:()=>onDisconnect.emit()};
  }
  return {chrome,connect,created,starts,cancels,currents,sent,listeners,jobs};
}

test('rejects ports from web pages or other names',()=>{
  const {connect}=setup();
  assert.equal(connect({sender:{id:'ext',url:'https://evil.test/'}}).listening(),false);
  assert.equal(connect({sender:{id:'other',url:'chrome-extension://ext/popup.html'}}).listening(),false);
  assert.equal(connect({name:'turbovideo-batch'}).listening(),false);
  assert.equal(connect().listening(),true);
});

test('view reply carries popupView and never the raw media url when no job',async()=>{
  const {connect}=setup({dom:[{url:'https://cdn.test/dom.mp4',kind:'Vídeo',referer:'https://site.test/'}]});
  const reply=await connect().ask({type:'view',tabId:1});
  assert.equal(reply.ok,true);assert.equal(reply.data.mode,'ready');assert.equal(reply.data.lesson.state,'ready');
  assert.deepEqual(reply.data.native,{state:'idle',info:{folder:'C:/x'}});assert.deepEqual(reply.data.jobs,[]);assert.deepEqual(reply.data.run,{status:'idle'});
  assert.equal(JSON.stringify(reply).includes('cdn.test'),false);
});

test('downloadLesson outside course starts one job with preferred source and referer',async()=>{
  const {connect,starts,currents}=setup({dom:[{url:'https://cdn.test/dom.mp4',kind:'Vídeo',referer:'https://site.test/'}]});
  const client=connect();
  const reply=await client.ask({type:'downloadLesson',tabId:1,quality:'720'});
  assert.equal(reply.ok,true);assert.equal(currents.length,1);
  assert.deepEqual(starts,[{url:MEDIA,referer:'https://player.test/',quality:'720',title:'Vídeo da página'}]);
  assert.equal(JSON.stringify(reply).includes('cdn.test'),false);
  const view=await client.ask({type:'view',tabId:1});
  assert.equal(view.data.lesson.state,'busy');assert.equal(view.data.lesson.job.id,'job1');
});

test('downloadLesson without any source replies the empty text and blocks YouTube',async()=>{
  const {connect,starts}=setup({items:[],tabs:{1:{id:1,url:'https://site.test/v',title:'x'},2:{id:2,url:'https://www.youtube.com/watch?v=1',title:'y'}}});
  const client=connect();
  assert.deepEqual(await client.ask({type:'downloadLesson',tabId:1,quality:'best'}),{type:'reply',rid:1,ok:false,message:TEXT_EMPTY});
  const yt=await client.ask({type:'downloadLesson',tabId:2,quality:'best'});
  assert.equal(yt.ok,false);assert.match(yt.message,/YouTube/);assert.equal(starts.length,0);
});

test('downloadLesson on course page delegates to course.downloadCurrent',async()=>{
  const {connect,starts,currents}=setup({current:async()=>({id:'courseJob'})});
  const reply=await connect().ask({type:'downloadLesson',tabId:1,quality:'1080'});
  assert.deepEqual(reply,{type:'reply',rid:1,ok:true,data:{id:'courseJob'}});
  assert.deepEqual(currents,[{tabId:1,quality:'1080',source:{url:MEDIA,kind:'HLS',referer:'https://player.test/'}}]);
  assert.equal(starts.length,0);
});

test('course blocked errors reply the user copy',async()=>{
  const {connect}=setup({current:async()=>{throw Object.assign(new Error('Não identifiquei o nome da categoria no site. Revise no painel completo.'),{code:'blocked'});}});
  const reply=await connect().ask({type:'downloadLesson',tabId:1,quality:'best'});
  assert.deepEqual(reply,{type:'reply',rid:1,ok:false,message:'Não identifiquei o nome da categoria no site. Revise no painel completo.'});
});

test('changes broadcast update to every connected port',()=>{
  const {connect,listeners}=setup();
  const a=connect();const b=connect();const gone=connect();gone.close();
  for(const set of Object.values(listeners))for(const fn of set)fn({});
  assert.equal(a.posted.filter(m=>m.type==='update').length,3);assert.equal(b.posted.filter(m=>m.type==='update').length,3);
  assert.equal(gone.posted.length,0);
});

test('reopening (new port + view) never starts a download',async()=>{
  const {connect,starts,currents,sent}=setup({inspect:async()=>({key:'sirmQueue:x',total:3,done:1,pending:2})});
  const first=connect();await first.ask({type:'view',tabId:1});first.close();
  const second=connect();const reply=await second.ask({type:'view',tabId:1});
  assert.equal(reply.data.course.state,'ready');
  assert.equal(starts.length,0);assert.equal(currents.length,0);assert.equal(sent.length,0);
});

test('panel actions: openPanel, cancel, download, probe and openFolder',async()=>{
  const {connect,created,cancels,starts,sent}=setup();
  const client=connect();
  assert.equal((await client.ask({type:'openPanel',tabId:1})).ok,true);assert.deepEqual(created,[{url:'dashboard.html?tab=1'}]);
  assert.equal((await client.ask({type:'cancel',id:'job9'})).ok,true);assert.deepEqual(cancels,['job9']);
  const direct=await client.ask({type:'download',url:'https://cdn.test/v.mp4',referer:'https://site.test/',filename:'aula',quality:'best',connections:4});
  assert.deepEqual(direct.data,{id:'job1'});assert.deepEqual(starts[0],{url:'https://cdn.test/v.mp4',referer:'https://site.test/',filename:'aula',quality:'best',connections:4});
  assert.equal((await client.ask({type:'download',url:'https://www.youtube.com/watch?v=1',quality:'best'})).ok,false);
  const probe=await client.ask({type:'probe',url:'https://cdn.test/v.mp4'});assert.equal(probe.ok,true);assert.equal(probe.data.title,'T');
  assert.equal((await client.ask({type:'openFolder'})).ok,true);assert.deepEqual(sent,[{type:'openFolder'}]);
});

test('panel view adds the tab and merged sources; the popup view never does',async()=>{
  const {connect}=setup({dom:[{url:'https://cdn.test/dom.mp4',kind:'Vídeo',referer:'https://site.test/'}]});
  const client=connect({sender:{id:'ext',url:'chrome-extension://ext/dashboard.html?tab=1'}});
  const panel=await client.ask({type:'view',tabId:1,panel:true});
  assert.equal(panel.ok,true);assert.deepEqual(panel.data.tab,{url:'https://site.test/v',title:'Vídeo da página'});
  assert.deepEqual(panel.data.sources.items.map(s=>s.url),[MEDIA,'https://cdn.test/dom.mp4']);assert.equal(panel.data.sources.items[0].referer,'https://player.test/');
  const popup=await client.ask({type:'view',tabId:1});
  assert.equal('sources' in popup.data,false);assert.equal('tab' in popup.data,false);
});

test('panel view survives a closed tab and still reports native, jobs and run',async()=>{
  const {connect}=setup({tabs:{}});
  const client=connect();
  const panel=await client.ask({type:'view',tabId:7,panel:true});
  assert.equal(panel.ok,true);assert.equal(panel.data.tab,null);assert.deepEqual(panel.data.sources.items,[]);
  assert.deepEqual(panel.data.native,{state:'idle',info:{folder:'C:/x'}});assert.deepEqual(panel.data.run,{status:'idle'});
  assert.equal((await client.ask({type:'view',tabId:7})).ok,false);
});

test('manual download forwards the panel title to the job',async()=>{
  const {connect,starts}=setup();
  await connect().ask({type:'download',url:'https://cdn.test/v.mp4',quality:'720',title:'Aula 1 • 720p'});
  assert.equal(starts[0].title,'Aula 1 • 720p');
});

test('update broadcasts are coalesced: one leading, one trailing per window',async()=>{
  const {connect,listeners}=setup({updateMs:40});
  const client=connect();const fire=()=>{for(const fn of listeners.downloads)fn({});};
  for(let i=0;i<10;i++)fire();
  assert.equal(client.posted.filter(m=>m.type==='update').length,1);
  await sleep(20);assert.ok(client.posted.filter(m=>m.type==='update').length<=2);
  await sleep(40);assert.equal(client.posted.filter(m=>m.type==='update').length,2,'the last change still arrives after the window');
  await sleep(60);assert.equal(client.posted.filter(m=>m.type==='update').length,2,'no extra broadcast without new changes');
});

test('missing helper: a later view retries (throttled, non-blocking) and reaches ready',async()=>{
  let state='missing';let tries=0;const status=new Set();
  const nativeClient={status:()=>state==='ready'?{state,info:{folder:'C:/x'}}:{state},ensureReady(){tries++;if(tries<2){state='connecting';setTimeout(()=>{state='missing';for(const fn of status)fn({state});},10);return new Promise(()=>{});}state='ready';for(const fn of status)fn({state});return Promise.resolve({});},send:()=>true,request:async()=>({}),onStatus(fn){status.add(fn);return()=>{};},onMessage(){return()=>{};}};
  const {connect}=setup({nativeClient,retryMs:40});const client=connect();
  const first=await client.ask({type:'view',tabId:1});
  assert.equal(first.ok,true,'view never waits for the helper');assert.equal(first.data.mode,'install');assert.equal(tries,1);
  assert.equal(first.data.native.state,'missing','a retry in progress keeps showing the install help (no flicker)');
  await client.ask({type:'view',tabId:1});assert.equal(tries,1,'throttled inside the window');
  await sleep(50);const later=await client.ask({type:'view',tabId:1});
  assert.equal(tries,2);assert.equal(later.data.mode,'ready');assert.equal(later.data.footer.connected,true);
  assert.ok(client.posted.some(m=>m.type==='update'),'status change is broadcast');
});

test('downloadLesson keeps the capture order: the HLS master wins over later variants',async()=>{
  const item=url=>({url,kind:'HLS',source:'Rede',referer:'https://player.test/'});
  const {connect,starts}=setup({items:[item('https://cdn.test/master.m3u8?sig=1'),item('https://cdn.test/720p.m3u8?sig=1'),item('https://cdn.test/audio.m3u8?sig=1')],dom:[{url:'https://cdn.test/stale.m3u8',kind:'HLS',referer:'https://site.test/'}]});
  assert.equal((await connect().ask({type:'downloadLesson',tabId:1,quality:'best'})).ok,true);
  assert.equal(starts[0].url,'https://cdn.test/master.m3u8?sig=1');
});

test('downloadLesson picks the playing video currentSrc over stale performance entries when the network is empty',async()=>{
  const {connect,starts}=setup({items:[],dom:[{url:'https://cdn.test/playing.mp4',kind:'Vídeo',referer:'https://site.test/'},{url:'https://cdn.test/old.mp4',kind:'Vídeo',referer:'https://site.test/'}]});
  assert.equal((await connect().ask({type:'downloadLesson',tabId:1,quality:'best'})).ok,true);
  assert.equal(starts[0].url,'https://cdn.test/playing.mp4');
});

test('collectMedia lists the playing video first, then resources in natural (oldest-first) order',()=>{
  const video=(currentSrc,paused)=>({tagName:'VIDEO',currentSrc,src:'',paused,ended:false});
  const root={querySelectorAll:sel=>sel==='video,source'?[video('https://cdn.test/paused.mp4',true),video('blob:https://site.test/x',false),video('https://cdn.test/playing.mp4',false)]:[]};
  const saved={document:globalThis.document,location:globalThis.location,performance:globalThis.performance};
  Object.assign(globalThis,{document:root,location:{origin:'https://site.test'},performance:{getEntriesByType:()=>[{name:'https://cdn.test/a1.m3u8'},{name:'https://cdn.test/a2.m3u8'},{name:'https://cdn.test/x.js'}]}});
  try{assert.deepEqual(collectMedia().map(s=>s.url),['https://cdn.test/playing.mp4','https://cdn.test/paused.mp4','https://cdn.test/a1.m3u8','https://cdn.test/a2.m3u8']);}
  finally{for(const [k,v] of Object.entries(saved))if(v===undefined)delete globalThis[k];else globalThis[k]=v;}
});
