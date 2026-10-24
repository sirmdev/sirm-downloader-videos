import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeClient} from '../extension/native-client.mjs';
import {createDownloadManager} from '../extension/downloads.mjs';

const READY={type:'ready',folder:'C:/dl',parallel:true,supportsFilename:true,supportsFolders:true,supportsModules:true};
function setup({throws=false,autoReady=true,...options}={}){
  const ports=[];const state={lastError:undefined};
  const chrome={runtime:{get lastError(){return state.lastError;},connectNative(host){
    if(throws)throw new Error('Specified native messaging host not found.');
    const listeners={m:[],d:[]};const sent=[];
    const port={sent,disconnected:false,onMessage:{addListener:fn=>listeners.m.push(fn)},onDisconnect:{addListener:fn=>listeners.d.push(fn)},
      postMessage(msg){sent.push(msg);if(msg.type==='hello'&&autoReady)queueMicrotask(()=>port.emit(READY));},
      disconnect(){port.disconnected=true;},
      emit(msg){for(const fn of listeners.m)fn(msg);},
      drop(error){state.lastError=error?{message:error}:undefined;for(const fn of listeners.d)fn();state.lastError=undefined;}};
    port.host=host;ports.push(port);return port;}}};
  const native=createNativeClient(chrome,{idleMs:15,...options});const manager=createDownloadManager({native});
  return {chrome,ports,native,manager};
}
const req=(over={})=>({url:'https://cdn.test/video.m3u8?sig=secret',referer:'https://player.test/',quality:'best',title:'Aula 1',...over});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const tick=()=>new Promise(r=>setImmediate(r));

test('ensureReady connects once and reports ready info',async()=>{
  const {ports,native}=setup();
  const [a,b]=await Promise.all([native.ensureReady(),native.ensureReady()]);
  assert.equal(ports.length,1);assert.equal(ports[0].sent.filter(m=>m.type==='hello').length,1);
  assert.deepEqual(a,{folder:'C:/dl',parallel:true,supportsFilename:true,supportsFolders:true,supportsModules:true});assert.deepEqual(b,a);
  assert.equal(native.status().state,'ready');assert.deepEqual(native.status().info,a);assert.equal(ports[0].host,'com.turbovideo.downloader');
});
test('missing host rejects with native_unavailable',async()=>{
  const thrown=setup({throws:true});
  await assert.rejects(thrown.native.ensureReady(),{code:'native_unavailable',retryable:false});assert.equal(thrown.native.status().state,'missing');
  const dropped=setup({autoReady:false});
  const p=dropped.native.ensureReady();await tick();dropped.ports[0].drop('Native host has exited.');
  await assert.rejects(p,{code:'native_unavailable',retryable:false});assert.equal(dropped.native.status().state,'missing');
});
test('progress, complete and job list never expose the media url',async()=>{
  const {ports,native,manager}=setup();
  const {id,done}=manager.start(req());await tick();
  const sent=ports[0].sent.find(m=>m.type==='download');
  assert.equal(sent.id,id);assert.equal(sent.url,'https://cdn.test/video.m3u8?sig=secret');assert.equal(sent.connections,8);assert.equal(manager.list()[0].status,'starting');
  ports[0].emit({id,type:'progress',downloaded:512*1024,total:1024*1024,speed:262144,eta:2,phase:'downloading'});
  let job=manager.list()[0];
  assert.equal(job.status,'downloading');assert.equal(job.percent,50);assert.equal(job.message,'512.0 KiB / 1.0 MiB • 256.0 KiB/s • 2s restantes');
  ports[0].emit({id,type:'progress',downloaded:1,total:0,speed:0,eta:null,phase:'downloading'});assert.equal(manager.list()[0].percent,null);
  ports[0].emit({id,type:'progress',downloaded:1,total:1,speed:0,eta:null,phase:'finished'});
  assert.equal(manager.list()[0].message,'Transferência concluída; processando e unindo arquivos…');assert.equal(manager.list()[0].status,'processing');
  ports[0].emit({id,type:'processing',message:'Unindo…'});assert.equal(manager.list()[0].message,'Unindo…');
  assert.equal(JSON.stringify(manager.list()).includes('https://cdn'),false);assert.equal(JSON.stringify(manager.list()).includes('player.test'),false);
  ports[0].emit({id,type:'complete',file:'aula.mp4',folder:'C:/dl'});
  assert.deepEqual(await done,{type:'complete',file:'aula.mp4',folder:'C:/dl'});
  job=manager.list()[0];assert.equal(job.status,'complete');assert.equal(job.percent,100);assert.equal(job.message,'Salvo: aula.mp4');assert.equal(job.file,'aula.mp4');
  assert.equal(JSON.stringify(manager.list()).includes('https://cdn'),false);
  await sleep(40);assert.equal(ports[0].disconnected,true);assert.equal(native.status().state,'idle');
});
test('error message resolves with code and retryable',async()=>{
  const {ports,manager}=setup();
  const {id,done}=manager.start(req());await tick();
  ports[0].emit({id,type:'error',code:'http_403',retryable:false,message:'Acesso negado'});
  assert.deepEqual(await done,{type:'error',code:'http_403',retryable:false,message:'Acesso negado'});assert.equal(manager.list()[0].status,'error');assert.equal(manager.list()[0].message,'Acesso negado');
});
test('fourth concurrent start throws limit; duplicate start returns the same job',async()=>{
  const {manager}=setup();
  const a=manager.start(req({url:'https://cdn.test/a'}));const dup=manager.start(req({url:'https://cdn.test/a'}));
  assert.equal(dup.id,a.id);assert.equal(manager.list().length,1);
  manager.start(req({url:'https://cdn.test/b'}));manager.start(req({url:'https://cdn.test/c'}));
  assert.throws(()=>manager.start(req({url:'https://cdn.test/d'})),{code:'limit'});
  assert.equal(manager.start(req({url:'https://cdn.test/b'})).id,manager.list()[1].id);
  await tick();
});
test('native disconnect marks active jobs interrupted with native_disconnected and retryable true',async()=>{
  const {ports,native,manager}=setup();
  const {id,done}=manager.start(req());await tick();
  ports[0].emit({id,type:'progress',downloaded:1,total:10,speed:1,eta:1,phase:'downloading'});
  ports[0].drop();
  assert.deepEqual(await done,{type:'error',code:'native_disconnected',retryable:true,message:'A conexão com o auxiliar foi encerrada.'});
  assert.equal(manager.list()[0].status,'interrupted');assert.equal(manager.list()[0].message,'Interrompido: conexão com o auxiliar encerrada.');
  assert.equal(native.status().state,'disconnected');
});
test('cancel sends cancel and resolves cancelled',async()=>{
  const {ports,manager}=setup();
  const {id,done}=manager.start(req());await tick();
  manager.cancel(id);
  assert.deepEqual(ports[0].sent.at(-1),{type:'cancel',id});assert.equal(manager.list()[0].message,'Cancelando…');
  ports[0].emit({id,type:'cancelled'});
  assert.deepEqual(await done,{type:'cancelled'});assert.equal(manager.list()[0].status,'cancelled');
  assert.equal(manager.list()[0].message,'Cancelado. Arquivos parciais podem ser retomados ao baixar a mesma origem e qualidade.');
});
test('cancel before the helper is ready resolves cancelled without sending a download',async()=>{
  const {ports,manager}=setup();
  const {id,done}=manager.start(req());manager.cancel(id);
  assert.deepEqual(await done,{type:'cancelled'});assert.equal(ports[0].sent.some(m=>m.type==='download'),false);
});
test('start fails with native_unavailable when the helper is missing',async()=>{
  const {manager}=setup({throws:true});
  const {done}=manager.start(req());
  const result=await done;assert.equal(result.type,'error');assert.equal(result.code,'native_unavailable');assert.equal(manager.list()[0].status,'error');
});
test('port closes when no hold remains and no job is active',async()=>{
  const {ports,native}=setup();
  native.hold('panel');await native.ensureReady();
  native.hold('job:x');native.release('panel');await sleep(40);assert.equal(ports[0].disconnected,false);
  native.release('job:x');assert.equal(ports[0].disconnected,false);await sleep(40);
  assert.equal(ports[0].disconnected,true);assert.equal(native.status().state,'idle');
  await native.ensureReady();assert.equal(ports.length,2);
});
test('request matches probe replies by id, generates ids and times out',async()=>{
  const {ports,native}=setup();
  const p=native.request({type:'probe',url:'https://cdn.test/x',referer:'https://player.test/'});await tick();
  const probe=ports[0].sent.find(m=>m.type==='probe');assert.ok(probe.id);
  ports[0].emit({id:'outro',type:'info',title:'nope'});ports[0].emit({id:probe.id,type:'info',title:'Aula',heights:[720]});
  assert.deepEqual(await p,{id:probe.id,type:'info',title:'Aula',heights:[720]});
  await assert.rejects(native.request({type:'probe',id:'p2',url:'u'},{timeoutMs:20}),{code:'timeout'});
});
test('ensureReady timeout disconnects the port, reports missing and allows a clean retry',async()=>{
  const {ports,native}=setup({autoReady:false,readyTimeoutMs:20});
  await assert.rejects(native.ensureReady(),{code:'native_unavailable',retryable:false});
  assert.equal(ports[0].disconnected,true);assert.equal(native.status().state,'missing');assert.match(native.status().reason,/a tempo/);
  const retry=native.ensureReady();assert.equal(ports.length,2);ports[1].emit(READY);await retry;assert.equal(native.status().state,'ready');
});
test('idle grace closes an unheld port, keeps last info and a new hold cancels the timer',async()=>{
  const {ports,native}=setup();
  const info=await native.ensureReady();await sleep(40);
  assert.equal(ports[0].disconnected,true);assert.equal(native.status().state,'idle');assert.deepEqual(native.status().info,info);
  await native.ensureReady();native.hold('panel');await sleep(40);assert.equal(ports[1].disconnected,false);assert.equal(native.status().state,'ready');
  native.release('panel');await sleep(40);assert.equal(ports[1].disconnected,true);
});
test('finishing a job never trims it from the list even with many finished jobs',async()=>{
  const {ports,manager}=setup();
  for(let i=0;i<60;i++){const {id,done}=manager.start(req({url:`https://cdn.test/${i}`}));await tick();ports[ports.length-1].emit({id,type:'complete',file:`f${i}.mp4`,folder:'C:/dl'});await done;assert.ok(manager.list().some(j=>j.id===id));}
  assert.ok(manager.list().length<=51);
});
