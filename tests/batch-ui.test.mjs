import test from 'node:test';
import assert from 'node:assert/strict';
import {installBatchUI} from '../extension/batch-ui.mjs';
import {queueSnapshot,queueKey} from '../extension/queue.mjs';

const PAGE='https://c.test/m/lessons/demo?classId=2';
const lesson=(n,extra={})=>({url:`https://c.test/m/lessons/demo?classId=${n}`,title:`Aula ${n}`,filename:`0${n} - Aula ${n}`,module:'Módulo 1',moduleIndex:0,moduleFolder:'01 - Módulo 1',...extra});
const tick=()=>new Promise(r=>setTimeout(r,2));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await tick();}assert.fail('did not settle');}
function el(){return {disabled:false,hidden:false,checked:false,value:'',textContent:'',dataset:{},children:[],listeners:{},
  addEventListener(t,f){(this.listeners[t]??=[]).push(f);},append(...k){this.children.push(...k);},replaceChildren(...k){this.children=k;},setAttribute(){},
  async fire(t){for(const f of this.listeners[t]||[])await f();}};}
function setup({items=[lesson(1,{status:'done'}),lesson(2),lesson(3,{selected:false})]}={}){
  const nodes={};const document={getElementById:id=>nodes[id]??=el(),createElement:()=>el()};
  const key=queueKey(PAGE);const data={[key]:queueSnapshot(PAGE,items,{folder:'Curso Demo',quality:'720',connections:4,continueOnError:true})};
  const writes=[];const requests=[];let replies=[];
  const chrome={tabs:{async get(){return {id:5,url:PAGE};}},storage:{local:{async get(k){return {[k]:structuredClone(data[k])};},async set(v){writes.push(structuredClone(v));Object.assign(data,structuredClone(v));},async remove(k){delete data[k];}}}};
  const request=async message=>{requests.push(message);return replies.shift()||{ok:true,data:{}};};
  const batch=installBatchUI({chrome,document,tabId:5,request,canStart:()=>true,getSettings:()=>({quality:'720',connections:4})});
  return {$:id=>document.getElementById(id),batch,data,key,writes,requests,reply:r=>replies.push(r)};
}

test('Baixar selecionadas sends downloadCourse with every lesson, folder and continueOnError; nothing starts on open',async()=>{
  const s=setup();await until(()=>!s.$('bulk-start').disabled);
  assert.equal(s.requests.length,0);
  await s.$('bulk-start').fire('click');
  assert.equal(s.requests.length,1);const sent=s.requests[0];
  assert.deepEqual([sent.type,sent.tabId,sent.quality,sent.folder,sent.continueOnError],['downloadCourse',5,'720','Curso Demo',true]);
  assert.deepEqual(sent.lessons,structuredClone(sent.lessons));
  assert.deepEqual(sent.lessons.map(l=>[l.url.slice(-1),l.selected,l.status]),[['1',true,'done'],['2',true,'pending'],['3',false,'pending']]);
  assert.ok(s.writes.length>=1,'local edits are saved before the background takes over');
});

test('blocked start shows the background message',async()=>{
  const s=setup();await until(()=>!s.$('bulk-start').disabled);
  s.reply({ok:false,message:'Fila de outro curso em andamento.'});
  await s.$('bulk-start').fire('click');
  assert.equal(s.$('bulk-status').textContent,'Fila de outro curso em andamento.');
});

test('RunState drives the queue status; Parar fila sends stopCourse; the end reloads lesson status saved by the background',async()=>{
  const s=setup();await until(()=>!s.$('bulk-start').disabled);
  s.batch.update({status:'running',key:s.key,title:'Curso Demo',index:1,total:1,completed:0,failed:0,message:'Aula 1 de 1: 02 - Aula 2'});
  assert.equal(s.$('bulk-start').disabled,true);assert.equal(s.$('bulk-stop').disabled,false);assert.equal(s.$('bulk-clear').disabled,true);
  assert.match(s.$('bulk-status').textContent,/0\/1 salvas • Aula 1 de 1: 02 - Aula 2/);
  const before=s.writes.length;await s.$('category-folder').fire('input');await new Promise(r=>setTimeout(r,300));
  assert.equal(s.writes.length,before,'the panel never overwrites the snapshot while the background runs');
  await s.$('bulk-stop').fire('click');assert.deepEqual(s.requests.at(-1),{type:'stopCourse'});
  const saved=s.data[s.key];saved.items[1].status='done';
  s.batch.update({status:'finished',key:s.key,index:1,total:1,completed:1,failed:0,message:'Concluído: 1 aula(s) salva(s) nesta execução.'});
  assert.equal(s.$('bulk-status').textContent,'Concluído: 1 aula(s) salva(s) nesta execução.');
  const labels=()=>s.$('bulk-list').children.filter(c=>c.className==='lesson-row').map(r=>r.children[2].textContent);
  await until(()=>labels()[1]==='Salvo');assert.equal(s.$('bulk-stop').disabled,true);
});

test('another course queue disables start and stop for this course',async()=>{
  const s=setup();await until(()=>!s.$('bulk-start').disabled);
  s.batch.update({status:'running',key:'sirmQueue:https://other.test/x',index:1,total:3,completed:0,failed:0,message:'x'});
  assert.equal(s.$('bulk-start').disabled,true);assert.equal(s.$('bulk-stop').disabled,true);
  assert.match(s.$('bulk-status').textContent,/outro curso/);
});
