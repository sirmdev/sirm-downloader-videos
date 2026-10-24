import test from 'node:test';import assert from 'node:assert/strict';
import {collectLessonLinks,lessonFilename,orderedLessons} from '../extension/lessons.mjs';

test('module lists preserve display order and restart numbering inside each module',()=>{
  const page='https://school.test/m/lessons/sdr';
  const list=orderedLessons(page,[{href:'?classId=1',title:'Boas vindas',module:'Módulo 1 - Introdução',moduleIndex:0},{href:'?classId=2',title:'Função',module:'Módulo 1 - Introdução',moduleIndex:0},{href:'?classId=3',title:'Agendamento',module:'Módulo 2 - Práticas',moduleIndex:1}]);
  assert.deepEqual(list.map(l=>l.filename),['01 - Boas vindas','02 - Função','01 - Agendamento']);
  assert.deepEqual(list.map(l=>l.moduleFolder),['01 - Módulo 1 - Introdução','01 - Módulo 1 - Introdução','02 - Módulo 2 - Práticas']);
});
test('collects only lessons in the current course, preserving order and dropping duplicate/sidebar links',()=>{
  const page='https://school.test/m/lessons/social-selling?classId=2';
  const result=collectLessonLinks(page,[
    {href:'?classId=1',title:'Introdução'},
    {href:'?classId=2&tracking=sidebar',title:'Follow up'},
    {href:'?classId=1',title:'Duplicate'},
    {href:'/m/lessons/other-course?classId=3',title:'Other course'},
    {href:'https://evil.test/m/lessons/social-selling?classId=4',title:'External'},
    {href:'javascript:alert(1)',title:'Script'},
    {href:'/m/main',title:'Home'}]);
  assert.deepEqual(result,[{url:'https://school.test/m/lessons/social-selling?classId=1',title:'Introdução'},{url:'https://school.test/m/lessons/social-selling?classId=2',title:'Follow up'}]);
});
test('batch filenames are numbered, preserve accents and stay safe within native filename limit',()=>{
  assert.equal(lessonFilename(0,'O que é Social Selling'),'01 - O que é Social Selling');
  assert.equal(lessonFilename(12,'Follow up'),'13 - Follow up');
  assert.doesNotMatch(lessonFilename(1,'../Aula: um/dois\\três?'),/[<>:"/\\|?*]/);
  assert.ok(lessonFilename(99,'á'.repeat(400)).length<=120);
});
