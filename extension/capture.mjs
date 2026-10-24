import {mediaKind,mergeCandidates} from './media.mjs';

export function installCapture(chrome){
  const watching=new Map();const queues=new Map();const references=new Map();
  const ready=chrome.storage.session.get(null).then(data=>{for(const [key,value] of Object.entries(data))if(key.startsWith('watch:'))watching.set(Number(key.slice(6)),value);});
  function queue(id,fn){
    const run=(queues.get(id)||ready).then(fn);
    const tail=run.catch(()=>{});queues.set(id,tail);
    tail.finally(()=>{if(queues.get(id)===tail)queues.delete(id);});return run;
  }
  async function save(id,state){watching.set(id,state);await chrome.storage.session.set({[`watch:${id}`]:state});}
  function clearReferences(id){for(const [key,value] of references)if(value.tabId===id)references.delete(key);}
  // Painel e popup leem as detecções e pedem a captura forçada só pelo hub (arm + reload); sem handler de runtime.onMessage.
  chrome.webRequest.onBeforeSendHeaders.addListener(details=>{
    if(details.tabId<0)return;
    return queue(details.tabId,()=>{
      if(!watching.has(details.tabId))return;
      const referer=details.requestHeaders?.find(h=>h.name.toLowerCase()==='referer')?.value;
      if(references.size>=1000)references.delete(references.keys().next().value);
      references.set(details.requestId,{tabId:details.tabId,generation:watching.get(details.tabId).generation,...(/^https?:\/\//i.test(referer || '')?{referer}:{})});
    });
  },{urls:['http://*/*','https://*/*']},['requestHeaders','extraHeaders']);
  chrome.webRequest.onHeadersReceived.addListener(details=>{
    if(details.tabId<0)return;
    const type=details.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value || '';
    const kind=mediaKind(details.url,type);if(!kind)return;
    return queue(details.tabId,async()=>{
      const state=watching.get(details.tabId);if(!state)return;
      const request=references.get(details.requestId);if(!request || request.generation!==state.generation)return;
      const referer=request.referer;
      const item={url:details.url,kind,source:'Rede',...(referer?{referer}:{})};
      await save(details.tabId,{...state,items:mergeCandidates(state.items,[item])});
    });
  },{urls:['http://*/*','https://*/*']},['responseHeaders']);
  const finished=details=>{if(details.tabId>=0)return queue(details.tabId,()=>{references.delete(details.requestId);});};
  chrome.webRequest.onCompleted.addListener(finished,{urls:['http://*/*','https://*/*']});
  chrome.webRequest.onErrorOccurred.addListener(finished,{urls:['http://*/*','https://*/*']});
  chrome.tabs.onUpdated.addListener((id,change,tab)=>{
    if(change.status!=='loading' && !change.url)return;
    return queue(id,async()=>{
      const state=watching.get(id);
      if(!state){const url=change.url || tab?.url || '';if(/^https?:/.test(url))await save(id,{url,generation:1,items:[]});return;}
      clearReferences(id);
      await save(id,{url:change.url || tab?.url || state.url,generation:(state.generation || 0)+1,items:[]});
    });
  });
  chrome.tabs.onRemoved.addListener(id=>queue(id,async()=>{watching.delete(id);clearReferences(id);await chrome.storage.session.remove(`watch:${id}`);}));
  const read=id=>queue(id,()=>watching.get(id) || {items:[]});
  return {
    arm:(id,url)=>queue(id,async()=>{clearReferences(id);await save(id,{url,generation:(watching.get(id)?.generation || 0)+1,items:[]});}),
    read,sources:read,
    release:id=>queue(id,async()=>{watching.delete(id);clearReferences(id);await chrome.storage.session.remove(`watch:${id}`);})
  };
}
