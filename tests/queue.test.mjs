import test from 'node:test';import assert from 'node:assert/strict';
import {runLesson,queueSnapshot,queueKey} from '../extension/queue.mjs';

test('temporary errors recapture a fresh source and stop after three attempts',async()=>{
  let captures=0,downloads=0;const retries=[];
  const result=await runLesson({resolveSource:async()=>({url:'https://cdn.test/video?signature='+ ++captures}),download:async source=>{downloads++;assert.ok(source.url.endsWith(String(captures)));return downloads<3?{type:'error',message:'HTTP 403',code:'http_403',retryable:true}:{type:'complete',file:'Aula.mp4'};},onRetry:(error,attempt)=>retries.push(attempt),wait:async()=>{}});
  assert.equal(result.type,'complete');assert.equal(captures,3);assert.deepEqual(retries,[1,2]);
  captures=0;const failed=await runLesson({resolveSource:async()=>{captures++;throw Object.assign(new Error('Sem mídia'),{code:'capture_timeout',retryable:true});},download:async()=>assert.fail(),wait:async()=>{}});
  assert.equal(failed.type,'error');assert.equal(failed.attempts,3);assert.equal(captures,3);
});

test('permanent errors and user cancellation never retry',async()=>{
  let captures=0;const permanent=await runLesson({resolveSource:async()=>{captures++;return {};},download:async()=>({type:'error',code:'file_exists',retryable:false,message:'Já existe.'}),wait:async()=>assert.fail()});
  assert.equal(permanent.code,'file_exists');assert.equal(captures,1);
  let stopped=false;const cancelled=await runLesson({resolveSource:async()=>{stopped=true;return {};},download:async()=>assert.fail(),shouldStop:()=>stopped});
  assert.equal(cancelled.type,'cancelled');
});

test('persisted queue stores lesson metadata, never signed media, referer or arbitrary fields',()=>{
  const course='https://school.test/m/lessons/sdr?classId=2&token=secret';
  const items=[{url:'https://school.test/m/lessons/sdr?classId=2&token=secret',title:'Tema',filename:'01 - Tema',module:'Comece',moduleIndex:0,moduleFolder:'01 - Comece',selected:true,status:'downloading',source:{url:'https://cdn.test/master?signature=secret'},referer:'https://player.test/?key=secret',message:'Falha https://cdn.test/?secret=one'}];
  const saved=queueSnapshot(course,items,{folder:'SDR',quality:'480',connections:8,continueOnError:true});
  assert.equal(saved.items[0].status,'pending');assert.equal(saved.items[0].url,'https://school.test/m/lessons/sdr?classId=2');assert.doesNotMatch(JSON.stringify(saved),/secret|signature|referer|source/);
  assert.equal(queueKey(course),queueKey('https://school.test/m/lessons/sdr?classId=3'));
  assert.equal(queueSnapshot(course,[...items,{...items[0],url:'https://other.test/m/lessons/sdr?classId=4'}],{}).items.length,1);
  assert.equal(queueSnapshot(course,items,{incomplete:true}).incomplete,true);
});
