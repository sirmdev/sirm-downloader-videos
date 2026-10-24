import test from 'node:test';
import assert from 'node:assert/strict';
import {popupView,TEXT_EMPTY,TEXT_UNSUPPORTED,TEXT_YOUTUBE} from '../extension/view-model.mjs';

const tab={id:1,url:'https://aulas.exemplo.com/curso?classId=1',title:'Aula 1 - Intro'};
const dom=[{url:'https://cdn.exemplo.com/v/a.m3u8',kind:'HLS'}];
const base={tab,sources:{items:[]},domSources:[],course:null,run:{status:'idle'},jobs:[],native:{state:'ready'}};
const course={key:'sirmQueue:A',category:'C',total:10,done:4,pending:6,currentLesson:{url:'u',filename:'03 - Intro',moduleFolder:'M'}};

test('install mode when native missing',()=>{
  const v=popupView({...base,native:{state:'missing'}});
  assert.deepEqual([v.mode,v.lesson,v.course,v.footer],['install',null,null,{connected:false}]);
});
test('unsupported for chrome:// tab',()=>{
  const v=popupView({...base,tab:{id:1,url:'chrome://extensions',title:'x'}});
  assert.deepEqual([v.mode,v.message,v.host],['unsupported',TEXT_UNSUPPORTED,'']);
});
test('youtube notice for youtube.com',()=>{
  const v=popupView({...base,tab:{id:1,url:'https://www.youtube.com/watch?v=1',title:'y'},domSources:dom});
  assert.deepEqual([v.mode,v.lesson],['youtube',null]);
});
test('empty lesson with dê play message when no sources (tab opened before install)',()=>{
  const v=popupView(base);
  assert.deepEqual(v.lesson,{title:'Aula 1 - Intro',state:'empty',message:TEXT_EMPTY});
  assert.equal(v.host,'aulas.exemplo.com');
});
test('ready lesson from dom sources only',()=>{
  const v=popupView({...base,domSources:dom});
  assert.deepEqual([v.mode,v.lesson.state,v.lesson.title],['ready','ready','Aula 1 - Intro']);
});
test('busy lesson shows job percent',()=>{
  const job={id:'j1',title:'t',status:'downloading',percent:42,speed:1,eta:2,message:'',file:''};
  const v=popupView({...base,domSources:dom,jobs:[job],lessonJobId:'j1'});
  assert.deepEqual([v.lesson.state,v.lesson.job.percent],['busy',42]);
});
test('done and error lesson states come from the job',()=>{
  const mk=(status,message='')=>({id:'j',title:'t',status,percent:100,speed:null,eta:null,message,file:''});
  assert.equal(popupView({...base,jobs:[mk('complete')],lessonJobId:'j'}).lesson.state,'done');
  const e=popupView({...base,jobs:[mk('interrupted','Interrompido')],lessonJobId:'j'}).lesson;
  assert.deepEqual([e.state,e.message],['error','Interrompido']);
});
test('course lesson title and readiness without detected sources',()=>{
  const v=popupView({...base,course});
  assert.deepEqual([v.lesson.state,v.lesson.title],['ready','03 - Intro']);
});
test('course card hidden when course is null',()=>{
  assert.equal(popupView(base).course,null);
});
test('course card ready with counts',()=>{
  assert.deepEqual(popupView({...base,course}).course,{total:10,done:4,pending:6,state:'ready'});
});
test('otherRunning when run.key differs from course.key',()=>{
  const c=popupView({...base,course,run:{status:'running',key:'sirmQueue:B'}}).course;
  assert.equal(c.state,'otherRunning');
});
test('running when run.key matches',()=>{
  const run={status:'running',key:'sirmQueue:A',index:1,total:6};
  const c=popupView({...base,course,run}).course;
  assert.deepEqual([c.state,c.run],['running',run]);
});
test('interrupted course offers resume',()=>{
  const run={status:'interrupted',key:'sirmQueue:A',message:'Interrompido — clique em Retomar para continuar.'};
  const c=popupView({...base,course,run}).course;
  assert.deepEqual([c.state,c.message,c.run],['interrupted',run.message,run]);
});
test('blocked course carries reason',()=>{
  const c=popupView({...base,course:{...course,blocked:'Duas aulas têm o mesmo nome.'}}).course;
  assert.deepEqual([c.state,c.message],['blocked','Duas aulas têm o mesmo nome.']);
});
test('complete when pending is 0',()=>{
  assert.equal(popupView({...base,course:{...course,done:10,pending:0}}).course.state,'complete');
});
test('footer connected for ready, or idle with info',()=>{
  assert.equal(popupView(base).footer.connected,true);
  assert.equal(popupView({...base,native:{state:'idle',info:{v:1}}}).footer.connected,true);
  assert.equal(popupView({...base,native:{state:'idle'}}).footer.connected,false);
  assert.equal(popupView({...base,native:{state:'disconnected'}}).footer.connected,false);
});

test('youtube copy is the single shared notice used by popup and panel',()=>{
  const v=popupView({...base,tab:{id:1,url:'https://www.youtube.com/watch?v=1',title:'y'}});
  assert.equal(v.message,TEXT_YOUTUBE);assert.match(TEXT_YOUTUBE,/Chrome Web Store\. Use em sites e cursos/);
});
