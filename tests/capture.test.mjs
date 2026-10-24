import test from 'node:test';
import assert from 'node:assert/strict';
import {installCapture} from '../extension/capture.mjs';

function setup(){
  const data={};const reloads=[];const opened=[];
  const event=()=>({listeners:[],addListener(fn){this.listeners.push(fn);},emit(...args){return Promise.all(this.listeners.map(fn=>fn(...args)));}});
  const chrome={action:{onClicked:event()},runtime:{id:'test',getURL:p=>`chrome-extension://test/${p}`,onMessage:event()},
    storage:{session:{async get(key){if(key===null)return structuredClone(data);return {[key]:structuredClone(data[key])};},async set(values){Object.assign(data,structuredClone(values));},async remove(key){delete data[key];}}},
    tabs:{async create(options){opened.push(options);},async get(id){return {id,url:'https://course.test/lesson'};},async reload(id){reloads.push(id);},onUpdated:event(),onRemoved:event()},
    webRequest:{onHeadersReceived:event(),onBeforeSendHeaders:event(),onCompleted:event(),onErrorOccurred:event()}};
  installCapture(chrome);
  const message=(msg,sender={id:'test',url:'chrome-extension://test/dashboard.html'})=>new Promise(resolve=>{const handled=chrome.runtime.onMessage.listeners[0](msg,sender,resolve);if(!handled)resolve(null);});
  return {chrome,data,reloads,opened,message};
}
test('capture remains armed after reload and discovers iframe manifest with original Referer',async()=>{
  const {chrome,message,reloads}=setup();
  await chrome.action.onClicked.emit({id:10,url:'https://course.test/lesson'});
  assert.deepEqual(await message({type:'capture',tabId:10}),{ok:true});assert.deepEqual(reloads,[10]);
  await chrome.tabs.onUpdated.emit(10,{status:'loading'},{url:'https://course.test/lesson'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'r1',requestHeaders:[{name:'Referer',value:'https://player.test/'},{name:'Cookie',value:'never-store-this'},{name:'Authorization',value:'never-store-that'}]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,frameId:2,requestId:'r1',url:'https://cdn.test/playlist?signature=abc',responseHeaders:[{name:'Content-Type',value:'application/vnd.apple.mpegurl'}]});
  const state=await message({type:'sources',tabId:10});
  assert.equal(state.items.length,1);assert.equal(state.items[0].kind,'HLS');assert.equal(state.items[0].referer,'https://player.test/');
  assert.equal(JSON.stringify(state).includes('never-store'),false);
});
test('ignores unselected tabs and rejects commands from regular webpages',async()=>{
  const {chrome,message}=setup();
  await chrome.webRequest.onHeadersReceived.emit({tabId:20,requestId:'x',url:'https://cdn.test/a.mp4',responseHeaders:[]});
  assert.deepEqual((await message({type:'sources',tabId:20})).items,[]);
  assert.equal(await message({type:'capture',tabId:20},{id:'test',url:'https://untrusted.test/'}),null);
});
test('removes stale sources on navigation but preserves watching; closing tab removes tracking',async()=>{
  const {chrome,message,data}=setup();
  await chrome.action.onClicked.emit({id:10,url:'https://course.test/lesson'});
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
  await chrome.action.onClicked.emit({id:10,url:'https://course.test/lesson'});
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'old',requestHeaders:[]});
  await chrome.tabs.onUpdated.emit(10,{status:'loading',url:'https://course.test/next'},{url:'https://course.test/next'});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,requestId:'old',url:'https://cdn.test/old.m3u8',responseHeaders:[]});
  assert.deepEqual((await message({type:'sources',tabId:10})).items,[]);
  await chrome.webRequest.onBeforeSendHeaders.emit({tabId:10,requestId:'new',requestHeaders:[]});
  await chrome.webRequest.onHeadersReceived.emit({tabId:10,requestId:'new',url:'https://cdn.test/new.m3u8',responseHeaders:[]});
  assert.equal((await message({type:'sources',tabId:10})).items[0].url,'https://cdn.test/new.m3u8');
});
