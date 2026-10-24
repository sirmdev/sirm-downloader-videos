import test from 'node:test';
import assert from 'node:assert/strict';
import {installCapture} from '../extension/capture.mjs';

function setup(){
  const data={};const reloads=[];const opened=[];
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){return Promise.all(this.listeners.map(fn=>fn(...args)));}});
  const chrome={runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:event()},
    storage:{session:{async get(key){if(key===null)return structuredClone(data);return {[key]:structuredClone(data[key])};},async set(values){Object.assign(data,structuredClone(values));},async remove(key){delete data[key];}}},
    tabs:{async create(options){opened.push(options);},async get(id){return {id,url:'https://course.test/lesson'};},async reload(id){reloads.push(id);},onUpdated:event(),onRemoved:event()},
    webRequest:{onHeadersReceived:event(),onBeforeSendHeaders:event(),onCompleted:event(),onErrorOccurred:event()}};
  const capture=installCapture(chrome);
  const message=msg=>capture.read(msg.tabId);
  return {chrome,capture,data,reloads,opened,message};
}
test('capture remains armed after reload and discovers iframe manifest with original Referer',async()=>{
  const {chrome,capture,message}=setup();
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  const before=await message({tabId:10});await capture.arm(10,'https://course.test/lesson');
  const armed=await message({tabId:10});assert.ok(armed.generation>before.generation);assert.deepEqual(armed.items,[]);
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'r1',requestHeaders:[{name:'Referer',value:'https://player.test/'},{name:'Cookie',value:'never-store-this'},{name:'Authorization',value:'never-store-that'}]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,frameId:2,requestId:'r1',url:'https://cdn.test/playlist?signature=abc',responseHeaders:[{name:'Content-Type',value:'application/vnd.apple.mpegurl'}]});
  const state=await message({type:'sources',tabId:10});
  assert.equal(state.items.length,1);assert.equal(state.items[0].kind,'HLS');assert.equal(state.items[0].referer,'https://player.test/');
  assert.equal(JSON.stringify(state).includes('never-store'),false);
});
test('watches every http tab from navigation and ignores non-http tabs',async()=>{
  const {chrome,message}=setup();
  await chrome.tabs.onUpdated.emit(20,{status:'loading'},{url:'https://site.test/v'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:20,requestId:'x',requestHeaders:[]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:20,requestId:'x',url:'https://cdn.test/a.mp4',responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});
  assert.equal((await message({type:'sources',tabId:20})).items.length,1);
  await chrome.tabs.onUpdated.emit(21,{status:'loading'},{url:'chrome://newtab'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:21,requestId:'y',requestHeaders:[]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:21,requestId:'y',url:'https://cdn.test/b.mp4',responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});
  assert.deepEqual((await message({type:'sources',tabId:21})).items,[]);
});
test('non-media responses are never stored and candidates stay bounded',async()=>{
  const {chrome,message}=setup();
  await chrome.tabs.onUpdated.emit(30,{status:'loading'},{url:'https://site.test/v'});
  for(let i=0;i<200;i++){
    await chrome.webRequest.onBeforeSendHeaders.emit({tabId:30,requestId:`h${i}`,requestHeaders:[]});
    await chrome.webRequest.onHeadersReceived.emit({tabId:30,requestId:`h${i}`,url:`https://cdn.test/page${i}`,responseHeaders:[{name:'Content-Type',value:'text/html'}]});
  }
  assert.equal((await message({type:'sources',tabId:30})).items.length,0);
  for(let i=0;i<200;i++){
    await chrome.webRequest.onBeforeSendHeaders.emit({tabId:30,requestId:`v${i}`,requestHeaders:[]});
    await chrome.webRequest.onHeadersReceived.emit({tabId:30,requestId:`v${i}`,url:`https://cdn.test/v${i}.mp4`,responseHeaders:[{name:'Content-Type',value:'video/mp4'}]});
  }
  assert.equal((await message({type:'sources',tabId:30})).items.length,150);
});
test('public sources() mirrors read(); capture registers no action click nor runtime message handler',async()=>{
  const {chrome,capture}=setup();
  assert.equal(chrome.action,undefined);assert.equal(chrome.runtime.onMessage.listeners.length,0);
  await chrome.tabs.onUpdated.emit(40,{status:'loading'},{url:'https://site.test/v'});
  assert.deepEqual(await capture.sources(40),await capture.read(40));assert.equal((await capture.sources(40)).generation,1);
});
test('removes stale sources on navigation but preserves watching; closing tab removes tracking',async()=>{
  const {chrome,message,data}=setup();
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'a',requestHeaders:[]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,requestId:'a',url:'https://cdn.test/old.m3u8',responseHeaders:[]});
  const before=await message({type:'sources',tabId:10});assert.equal(before.items.length,1);
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  assert.ok((await message({type:'sources',tabId:10})).generation>before.generation);
  await chrome.tabs.onUpdated.emit(10,{url:'https://course.test/next'},{url:'https://course.test/next'});
  assert.deepEqual((await message({type:'sources',tabId:10})).items,[]);
  assert.equal(data['watch:10'].url,'https://course.test/next');
  await chrome.tabs.onRemoved.emit(10);
  await message({type:'sources',tabId:10});assert.equal(data['watch:10'],undefined);
});
test('late media response from the prior document cannot enter a newly armed lesson',async()=>{
  const {chrome,message}=setup();
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'old',requestHeaders:[]});
  await chrome.tabs.onUpdated.emit(10,{status:'loading',url:'https://course.test/next'},{url:'https://course.test/next'});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,requestId:'old',url:'https://cdn.test/old.m3u8',responseHeaders:[]});
  assert.deepEqual((await message({type:'sources',tabId:10})).items,[]);
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'new',requestHeaders:[]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,requestId:'new',url:'https://cdn.test/new.m3u8',responseHeaders:[]});
  assert.equal((await message({type:'sources',tabId:10})).items[0].url,'https://cdn.test/new.m3u8');
});
