import {preferredSource} from './media.mjs';

function httpUrl(value){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}

// These functions run only inside the background tab owned by the resolver.
function pauseVideos(){for(const video of document.querySelectorAll('video'))video.pause();}
function inspectPlayer(){
  const sources=[];
  for(const video of document.querySelectorAll('video')){
    video.muted=true;
    try{const playing=video.play();if(playing?.catch)playing.catch(()=>{});}catch{/* A gesture may be required. */}
    for(const url of [video.currentSrc,video.src,...[...video.querySelectorAll('source')].map(s=>s.src)])if(url)sources.push(url);
  }
  for(const entry of performance.getEntriesByType('resource'))if(/\.(m3u8|mpd|mp4|webm)(?:[?#]|$)/i.test(entry.name))sources.push(entry.name);
  return sources.map(url=>({url,referer:location.origin+'/'}));
}

export function createLessonResolver(chrome,capture,options={}){
  const timeoutMs=Math.max(1,options.timeoutMs??45000);
  const pollMs=Math.max(1,options.pollMs??300);
  let tabId=null,running=null,stopped=false,closing=null;
  const check=()=>{if(stopped)throw new Error('Operação cancelada.');};
  const pause=async()=>{if(tabId!==null)try{await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:pauseVideos});}catch{/* Tab may already be closed. */}};
  const stop=()=>{stopped=true;};
  const close=()=>{
    stopped=true;
    if(!closing)closing=(async()=>{
      if(running)await running.catch(()=>{});
      if(tabId!==null){
        const owned=tabId;tabId=null;
        try{await capture.release(owned);}catch{/* Still close the owned tab. */}
        try{await chrome.tabs.remove(owned);}catch{/* User may already have closed it. */}
      }
    })();
    return closing;
  };
  async function run(value){
    try{
      const url=httpUrl(value);if(!url)throw new Error('URL da aula inválida. Use HTTP ou HTTPS sem credenciais.');
      check();
      if(tabId===null){
        const tab=await chrome.tabs.create({url:chrome.runtime.getURL('batch-tab.html'),active:false});tabId=tab.id;check();
        await chrome.tabs.update(tabId,{muted:true,active:false,autoDiscardable:false});check();
        // Do not replace the initial document while Chrome is still creating it.
        const readyBy=Date.now()+Math.min(timeoutMs,10000);
        while((await chrome.tabs.get(tabId)).status!=='complete'){
          check();
          if(Date.now()>=readyBy)throw new Error('A aba auxiliar não terminou de abrir. Tente novamente.');
          await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,50)));
        }
        check();
      }
      const previous=await chrome.tabs.get(tabId);check();
      await capture.arm(tabId,url);check();
      const baseline=await capture.read(tabId);check();
      if(httpUrl(previous.url)===url)await chrome.tabs.reload(tabId,{bypassCache:true});
      else await chrome.tabs.update(tabId,{url,active:false});
      check();
      const deadline=Date.now()+timeoutMs;
      let accessFailed=false;
      while(Date.now()<deadline){
        check();
        const state=await capture.read(tabId);check();
        // arm() changes the expected URL before the previous document unloads.
        // Only a navigation event advances generation past this baseline.
        const current=state?.url===url&&Number(state.generation)>Number(baseline?.generation??0);
        let source=current?preferredSource(state.items??[]):null;
        if(!source){
          const tab=await chrome.tabs.get(tabId);check();
          if(tab.status==='complete'&&httpUrl(tab.url)===url){
            try{
              const frames=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:inspectPlayer});check();
              const fresh=await capture.read(tabId);check();
              const freshCurrent=fresh?.url===url&&Number(fresh.generation)>Number(baseline?.generation??0);
              source=freshCurrent?preferredSource(fresh.items??[]):null;
              if(!source&&freshCurrent)source=preferredSource(frames.flatMap(frame=>Array.isArray(frame.result)?frame.result:[]));
            }catch(error){check();accessFailed=true;void error;}
          }
        }
        if(source){check();return source;}
        await new Promise(resolve=>setTimeout(resolve,Math.min(pollMs,Math.max(1,deadline-Date.now()))));
      }
      throw new Error(accessFailed?'Sem acesso ao player. Confira autenticação e permissões do site.':'Tempo esgotado: nenhum vídeo acessível. Confira autenticação, acesso à aula e reprodução automática.');
    }catch(error){
      const detail=error.message||'Não foi possível obter o vídeo.';
      if(stopped)throw Object.assign(new Error(detail),{code:'cancelled',retryable:false});
      const permanent=/inválida|sem acesso|permissões/i.test(detail);
      throw Object.assign(new Error(detail),{code:permanent?'capture_access':'capture_timeout',retryable:!permanent});
    }finally{await pause();}
  }
  return {resolve(url){const job=run(url);running=job;const clear=()=>{if(running===job)running=null;};job.then(clear,clear);return job;},stop,close};
}
