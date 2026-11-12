import test from 'node:test';
import assert from 'node:assert/strict';
import {createCourseRunner} from '../extension/course-runner.mjs';
import {queueSnapshot,queueKey} from '../extension/queue.mjs';

const COURSE='https://school.test/c/curso';
const OTHER='https://school.test/c/outro';
const lesson=id=>`${COURSE}?classId=${id}`;
const EXPANDED=[{href:lesson('a1'),title:'Boas vindas',module:'Comece',moduleIndex:0},{href:lesson('a2'),title:'Tema',module:'Comece',moduleIndex:0},{href:lesson('a3'),title:'Final',module:'Avançado',moduleIndex:1}];
const FLAT=EXPANDED.map(({href,title})=>({href,title}));
const SAVED=[{url:lesson('a1'),title:'Boas vindas',filename:'01 - Boas vindas',module:'Comece',moduleIndex:0,moduleFolder:'01 - Comece',status:'pending'},{url:lesson('a2'),title:'Tema',filename:'02 - Tema',module:'Comece',moduleIndex:0,moduleFolder:'01 - Comece',status:'done'},{url:lesson('a3'),title:'Final',filename:'01 - Final',module:'Avançado',moduleIndex:1,moduleFolder:'02 - Avançado',status:'pending'}];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(check,ms=2000){const end=Date.now()+ms;while(!check()){if(Date.now()>end)throw new Error('timeout');await sleep(2);}}

function setup({tabs={1:lesson('a1')},page=()=>({category:'Curso X',anchors:EXPANDED,incomplete:false,warnings:[]}),outcome=()=>({type:'complete',file:'x.mp4'}),ready=async()=>({supportsFolders:true,supportsModules:true}),resolve,data={},limited=0}={}){
  const store=structuredClone(data);const scripts=[];const starts=[];const cancels=[];const holds=[];const resolvers=[];
  const storage={async get(key){return key in store?{[key]:structuredClone(store[key])}:{};},async set(obj){for(const [k,v] of Object.entries(obj))store[k]=structuredClone(v);},async remove(key){delete store[key];}};
  const chrome={tabs:{async get(id){if(!tabs[id])throw new Error('No tab');return {id,url:tabs[id]};}},scripting:{async executeScript({target,args}){scripts.push({tabId:target.tabId,...args[0]});if(!/^https?:/.test(tabs[target.tabId]))throw new Error('Cannot access');return [{result:page(args[0],target.tabId)}];}}};
  const attempts=[];let changed=()=>{};const downloads={start(req){attempts.push(req);if(attempts.length<=limited)throw Object.assign(new Error('Aguarde.'),{code:'limit'});starts.push(req);const id='job'+starts.length;return {id,done:Promise.resolve(outcome(req))};},cancel(id){cancels.push(id);},list:()=>[],onChange(fn){changed=fn;return()=>{changed=()=>{};};}};
  const native={ensureReady:ready,hold:k=>holds.push('hold:'+k),release:k=>holds.push('release:'+k)};
  const makeResolver=()=>{
    const pending=new Set();const r={closed:0,
      resolve:resolve||(async url=>({url:`https://cdn.test/${new URL(url).searchParams.get('classId')}.m3u8?signature=secret`,kind:'hls',referer:'https://player.test/?token=secret'})),
      stop(){for(const reject of pending)reject(Object.assign(new Error('Operação cancelada.'),{code:'cancelled',retryable:false}));},
      async close(){r.closed++;r.stop();}};
    if(resolve==='hang')r.resolve=()=>new Promise((_,reject)=>pending.add(reject));
    resolvers.push(r);return r;
  };
  const runner=createCourseRunner({chrome,downloads,native,makeResolver,storage,wait:async()=>{}});
  return {runner,store,scripts,starts,cancels,holds,resolvers,attempts,freeSlot:()=>changed()};
}
const saved=(items=SAVED,settings={folder:'Curso X'})=>({[queueKey(COURSE)]:queueSnapshot(COURSE,items,settings)});
const settled=runner=>waitFor(()=>['finished','interrupted'].includes(runner.state().status));

test('inspect returns null outside a course and counts done from snapshot',async()=>{
  const empty=setup({page:()=>({category:'',anchors:[],incomplete:false,warnings:[]}),tabs:{1:'https://school.test/home',2:'chrome://extensions'}});
  assert.equal(await empty.runner.inspect(1),null);assert.equal(await empty.runner.inspect(2),null);assert.equal(await empty.runner.inspect(9),null);
  const {runner,scripts}=setup({page:()=>({category:'Curso X',anchors:FLAT,incomplete:false,warnings:[]}),data:saved()});
  const info=await runner.inspect(1);
  assert.equal(scripts[0].expandModules,false);
  assert.deepEqual(info,{key:queueKey(COURSE),category:'Curso X',total:3,done:1,pending:2,currentLesson:{url:lesson('a1'),filename:'01 - Boas vindas',moduleFolder:'01 - Comece'}});
});

test('start downloads only pending lessons into category/module with numbered names',async()=>{
  const {runner,starts,holds,resolvers,store,scripts}=setup({data:saved()});
  await runner.start(1,{quality:'720'});await settled(runner);
  assert.equal(scripts.at(-1).expandModules,true);
  assert.deepEqual(starts.map(({url,referer,filename,folder,module,quality})=>({url,referer,filename,folder,module,quality})),[
    {url:'https://cdn.test/a1.m3u8?signature=secret',referer:'https://player.test/?token=secret',filename:'01 - Boas vindas',folder:'Curso X',module:'01 - Comece',quality:'720'},
    {url:'https://cdn.test/a3.m3u8?signature=secret',referer:'https://player.test/?token=secret',filename:'01 - Final',folder:'Curso X',module:'02 - Avançado',quality:'720'}]);
  assert.deepEqual({status:runner.state().status,completed:runner.state().completed,failed:runner.state().failed,total:runner.state().total},{status:'finished',completed:2,failed:0,total:2});
  assert.deepEqual(holds,['hold:course','release:course']);assert.equal(resolvers.length,1);assert.equal(resolvers[0].closed,1);
  assert.deepEqual(store[queueKey(COURSE)].items.map(i=>i.status),['done','done','done']);assert.equal(store.sirmRun.status,'finished');
});

test('destination_exists marks the lesson done labelled "Já estava na pasta"',async()=>{
  const {runner,starts,store}=setup({data:saved(),outcome:req=>req.filename==='01 - Boas vindas'?{type:'error',code:'destination_exists',retryable:false,message:'O arquivo já existe.'}:{type:'complete'}});
  await runner.start(1,{quality:'best'});await settled(runner);
  assert.equal(starts.length,2);
  const item=store[queueKey(COURSE)].items[0];assert.equal(item.status,'done');assert.equal(item.message,'Já estava na pasta');
  assert.equal(runner.state().failed,0);assert.equal(runner.state().completed,2);assert.equal(runner.state().status,'finished');
});

test('blocked reasons: missing category, incomplete, duplicate names, other course running, total changed',async()=>{
  const blocked=async(ctx,text,tabId=1)=>{await assert.rejects(ctx.runner.start(tabId,{quality:'best'}),e=>e.code==='blocked'&&e.message.includes(text));};
  const missing=setup({page:()=>({category:'',anchors:EXPANDED,incomplete:false,warnings:[]})});
  await blocked(missing,'Não identifiquei o nome da categoria no site. Revise no painel completo.');assert.equal(missing.starts.length,0);
  const incomplete=setup({page:()=>({category:'Curso X',anchors:EXPANDED,incomplete:true,warnings:['Não foi possível ler as aulas de “Extra”.']})});
  await blocked(incomplete,'Não foi possível ler as aulas de “Extra”.');assert.equal(incomplete.starts.length,0);
  const duplicate=setup({data:saved(SAVED.map(i=>i.moduleFolder==='01 - Comece'?{...i,status:'pending',filename:'Igual'}:i))});
  await blocked(duplicate,'Duas aulas têm o mesmo nome. Revise no painel completo.');assert.equal(duplicate.starts.length,0);
  const busy=setup({tabs:{1:lesson('a1'),2:`${OTHER}?classId=b1`},resolve:'hang',page:(o,tabId)=>({category:tabId===2?'Outro':'Curso X',anchors:tabId===2?[{href:`${OTHER}?classId=b1`,title:'B'}]:EXPANDED,incomplete:false,warnings:[]})});
  await busy.runner.start(1,{quality:'best'});await waitFor(()=>busy.runner.state().status==='running');
  await blocked(busy,'Fila de outro curso em andamento.',2);assert.equal(busy.starts.length,0);
  assert.equal((await busy.runner.inspect(2)).blocked,'Fila de outro curso em andamento.');
  busy.runner.stop();await settled(busy.runner);assert.equal(busy.runner.state().status,'interrupted');
  const changed=setup({page:o=>({category:'Curso X',anchors:o.expandModules?EXPANDED:FLAT.slice(0,2),incomplete:false,warnings:[]})});
  assert.equal((await changed.runner.inspect(1)).total,2);
  await blocked(changed,'A lista de aulas mudou. Confira e clique de novo.');assert.equal(changed.starts.length,0);
  await changed.runner.start(1,{quality:'best'});await settled(changed.runner);assert.equal(changed.starts.length,3);
});

test('restore turns a running record into interrupted and never starts',async()=>{
  const {runner,store,starts,scripts,resolvers}=setup({data:{...saved(),sirmRun:{status:'running',key:queueKey(COURSE),index:1,total:2,completed:0,failed:0,quality:'480'}}});
  await runner.restore();
  assert.equal(runner.state().status,'interrupted');assert.equal(runner.state().key,queueKey(COURSE));assert.equal(store.sirmRun.status,'interrupted');
  await sleep(20);assert.equal(starts.length,0);assert.equal(scripts.length,0);assert.equal(resolvers.length,0);
});

test('resume continues from the first pending lesson',async()=>{
  const items=SAVED.map((i,n)=>({...i,status:n===0?'done':'pending'}));
  const {runner,starts}=setup({data:{...saved(items),sirmRun:{status:'running',key:queueKey(COURSE),index:2,total:3,completed:1,failed:0,quality:'480'}}});
  await runner.restore();await runner.resume();await settled(runner);
  assert.deepEqual(starts.map(s=>[s.filename,s.module,s.folder,s.quality]),[['02 - Tema','01 - Comece','Curso X','480'],['01 - Final','02 - Avançado','Curso X','480']]);
  assert.equal(runner.state().status,'finished');
});

test('native_unavailable stops the queue and keeps progress',async()=>{
  const {runner,starts,store}=setup({data:saved(),ready:async()=>{throw Object.assign(new Error('Não consegui conectar o auxiliar.'),{code:'native_unavailable',retryable:false});}});
  await runner.start(1,{quality:'best',continueOnError:true});await settled(runner);
  assert.equal(starts.length,0);assert.equal(runner.state().status,'interrupted');assert.match(runner.state().message,/auxiliar/);
  const items=store[queueKey(COURSE)].items;assert.equal(items[1].status,'done');assert.equal(items[2].status,'pending');assert.equal(store.sirmRun.status,'interrupted');
});

test('downloadCurrent saves into the course folder and marks done',async()=>{
  let finish;const {runner,starts,store}=setup({tabs:{1:lesson('a3'),2:'https://school.test/home'},outcome:()=>new Promise(r=>{finish=r;})});
  const {id}=await runner.downloadCurrent(1,{quality:'1080',source:{url:'https://cdn.test/a3.mp4?sig=1',referer:'https://school.test/'}});
  assert.equal(id,'job1');
  assert.deepEqual((({url,referer,filename,folder,module,quality})=>({url,referer,filename,folder,module,quality}))(starts[0]),{url:'https://cdn.test/a3.mp4?sig=1',referer:'https://school.test/',filename:'01 - Final',folder:'Curso X',module:'02 - Avançado',quality:'1080'});
  finish({type:'complete'});await waitFor(()=>store[queueKey(COURSE)]?.items.find(i=>i.url===lesson('a3'))?.status==='done');
  assert.equal(store[queueKey(COURSE)].folder,'Curso X');
  await assert.rejects(runner.downloadCurrent(2,{quality:'best',source:{url:'https://cdn.test/x.mp4'}}),{code:'not_course'});
});

test('persisted sirmRun and sirmQueue never contain media urls or referer',async()=>{
  const {runner,store}=setup({data:saved(),outcome:req=>req.filename==='01 - Final'?{type:'error',code:'http_403',retryable:false,message:`Falha em ${req.url}`}:{type:'complete'}});
  await runner.start(1,{quality:'best',continueOnError:true});await settled(runner);
  assert.deepEqual(Object.keys(store.sirmRun).sort(),['completed','failed','index','key','quality','status','total']);
  assert.doesNotMatch(JSON.stringify(store),/cdn\.test|signature|token|player\.test|referer/i);
  assert.equal(runner.state().failed,1);assert.equal(runner.state().status,'finished');
});

test('stop while waiting for a free slot never starts the lesson',async()=>{
  const {runner,starts,attempts,freeSlot}=setup({data:saved(),limited:1});
  await runner.start(1,{quality:'best'});await waitFor(()=>attempts.length===1&&/vaga/.test(runner.state().message));
  runner.stop();freeSlot();await settled(runner);
  assert.equal(starts.length,0);assert.equal(attempts.length,1);assert.equal(runner.state().status,'interrupted');
});

test('stop with an active job cancels that job',async()=>{
  const {runner,starts,cancels}=setup({data:saved(),outcome:()=>new Promise(()=>{})});
  await runner.start(1,{quality:'best'});await waitFor(()=>runner.state().jobId==='job1');
  runner.stop();assert.deepEqual(cancels,['job1']);assert.equal(runner.state().status,'stopping');assert.equal(starts.length,1);
});

test('stop while the queue waits on a manual job does not cancel it; the manual job still marks the lesson done',async()=>{
  let finish;const {runner,store,cancels}=setup({data:saved(),outcome:req=>req.url.includes('manual')?new Promise(r=>{finish=r;}):{type:'complete'}});
  const {id}=await runner.downloadCurrent(1,{quality:'best',source:{url:'https://cdn.test/manual.mp4?sig=1',referer:'https://school.test/'}});
  await runner.start(1,{quality:'best'});await waitFor(()=>runner.state().jobId===id);
  runner.stop();await settled(runner);
  assert.deepEqual(cancels,[],'a download the user started separately is not cancelled');assert.equal(runner.state().status,'interrupted');assert.equal(runner.state().jobId,undefined);
  finish({type:'complete'});await waitFor(()=>store[queueKey(COURSE)].items[0].status==='done');
});

test('a saved lesson that left the page never blocks the start with "changed"',async()=>{
  const gone={url:lesson('a9'),title:'Removida',filename:'03 - Removida',module:'Comece',moduleIndex:0,moduleFolder:'01 - Comece',status:'pending'};
  const {runner,starts}=setup({data:saved([...SAVED,gone])});
  const info=await runner.inspect(1);assert.equal(info.total,3);assert.equal(info.pending,2);
  await runner.start(1,{quality:'best'});await settled(runner);
  assert.deepEqual(starts.map(s=>s.filename),['01 - Boas vindas','01 - Final']);
});

test('"changed" is shown at most once per new count, even with views in between',async()=>{
  const {runner,starts}=setup({page:o=>({category:'Curso X',anchors:o.expandModules?EXPANDED:FLAT.slice(0,2),incomplete:false,warnings:[]})});
  await runner.inspect(1);await assert.rejects(runner.start(1,{quality:'best'}),{message:'A lista de aulas mudou. Confira e clique de novo.'});
  await runner.inspect(1);await runner.start(1,{quality:'best'});await settled(runner);assert.equal(starts.length,3);
});

test('the queue reuses a running "Baixar esta aula" job for the same lesson',async()=>{
  let finish;const {runner,starts,store}=setup({data:saved(),outcome:req=>req.url.includes('manual')?new Promise(r=>{finish=r;}):{type:'complete'}});
  const {id}=await runner.downloadCurrent(1,{quality:'best',source:{url:'https://cdn.test/manual.mp4?sig=1',referer:'https://school.test/'}});
  await runner.start(1,{quality:'best'});await waitFor(()=>runner.state().jobId===id);
  assert.equal(starts.length,1,'no second job for the lesson the user is already downloading');
  finish({type:'complete'});await settled(runner);
  assert.deepEqual(starts.map(s=>s.filename),['01 - Boas vindas','01 - Final']);assert.equal(runner.state().completed,2);assert.equal(runner.state().failed,0);
  assert.deepEqual(store[queueKey(COURSE)].items.map(i=>i.status),['done','done','done']);
});

test('"Baixar esta aula" on the lesson the queue is downloading returns the queue job',async()=>{
  const {runner,starts}=setup({data:saved(),outcome:()=>new Promise(()=>{})});
  await runner.start(1,{quality:'best'});await waitFor(()=>runner.state().jobId==='job1');
  assert.deepEqual(await runner.downloadCurrent(1,{quality:'best',source:{url:'https://cdn.test/other.mp4?sig=2'}}),{id:'job1'});
  assert.equal(starts.length,1);
});

test('continueOnError: popup start uses the snapshot value, resume uses the saved value, explicit option wins',async()=>{
  const fail=req=>req.filename==='01 - Boas vindas'?{type:'error',code:'http_403',retryable:false,message:'Proibido.'}:{type:'complete'};
  const keep=setup({data:saved(),outcome:fail});await keep.runner.start(1,{quality:'best'});await settled(keep.runner);
  assert.equal(keep.starts.length,2,'default snapshot keeps going');
  const halt=setup({data:saved(SAVED,{folder:'Curso X',continueOnError:false}),outcome:fail});await halt.runner.start(1,{quality:'best'});await settled(halt.runner);
  assert.equal(halt.starts.length,1,'saved false stops at the first failure');
  const forced=setup({data:saved(SAVED,{folder:'Curso X',continueOnError:false}),outcome:fail});await forced.runner.start(1,{quality:'best',continueOnError:true});await settled(forced.runner);
  assert.equal(forced.starts.length,2,'explicit panel option wins');
  const items=SAVED.map(i=>({...i,status:'pending'}));
  const resumed=setup({data:{...saved(items,{folder:'Curso X',continueOnError:true}),sirmRun:{status:'running',key:queueKey(COURSE),index:1,total:3,completed:0,failed:0,quality:'best'}},outcome:fail});
  await resumed.runner.restore();await resumed.runner.resume();await settled(resumed.runner);
  assert.equal(resumed.starts.length,3,'resume follows the saved continueOnError');
});
