// Hub do service worker: único ponto de mensagens do popup/painel ('sirm-ui'). Nada inicia download sem pedido explícito.
import {preferredSource,blockedSite,mergeCandidates,mediaKind} from './media.mjs';
import {popupView,TEXT_EMPTY,TEXT_YOUTUBE} from './view-model.mjs';

const hideUrls=text=>String(text||'').replace(/https?:\/\/\S+/gi,'[endereço oculto]');
const fail=message=>Object.assign(new Error(message),{code:'blocked'});
const http=url=>/^https?:\/\//i.test(String(url||''));
function checkUrl(url){if(!http(url))throw fail('Selecione ou cole um endereço HTTP/HTTPS.');if(blockedSite(url))throw fail(TEXT_YOUTUBE);}

// Roda dentro da aba: players (inclusive shadow DOM) e recursos de mídia já carregados.
// O vídeo tocando vem primeiro; os recursos seguem a ordem natural (mais antigo primeiro), como no resolvedor da fila.
export function collectMedia(){
  const playing=[];const found=[];const visited=new Set();const referer=location.origin+'/';
  function visit(root){if(visited.has(root))return;visited.add(root);for(const v of root.querySelectorAll('video,source')){const url=v.currentSrc||v.src;if(url&&/^https?:/.test(url))(v.tagName==='VIDEO'&&!v.paused&&!v.ended?playing:found).push({url,kind:'Vídeo',referer});}for(const element of root.querySelectorAll('*'))if(element.shadowRoot)visit(element.shadowRoot);}
  visit(document);
  for(const entry of performance.getEntriesByType('resource'))if(/\.(mp4|webm|m3u8|mpd)(\?|$)/i.test(entry.name))found.push({url:entry.name,referer});
  return [...playing,...found];
}
export async function scanTab(chrome,tabId){
  let results=[];try{results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:collectMedia});}catch{/* A detecção por rede continua valendo. */}
  return results.flatMap(r=>Array.isArray(r?.result)?r.result:[]).map(s=>({url:s.url,kind:mediaKind(s.url)||s.kind||'Vídeo',referer:s.referer}));
}

export function installHub(chrome,{capture,native,downloads,course,scanDom=tabId=>scanTab(chrome,tabId),ready=Promise.resolve(),updateMs=1000,retryMs=5000}){
  const ports=new Set();const lessonJobs=new Map();
  // No máximo um aviso por updateMs (o primeiro sai na hora, o último chega no fim da janela): cada aviso custa um 'view' completo nos clientes.
  let lastUpdate=-Infinity;let updateTimer=null;
  const flush=()=>{updateTimer=null;lastUpdate=Date.now();for(const port of [...ports])try{port.postMessage({type:'update'});}catch{ports.delete(port);}};
  const broadcast=()=>{if(updateTimer)return;const wait=lastUpdate+updateMs-Date.now();if(wait<=0)flush();else updateTimer=setTimeout(flush,wait);};
  downloads.onChange(broadcast);course.onChange(broadcast);native.onStatus(broadcast);
  chrome.tabs.onRemoved?.addListener(id=>lessonJobs.delete(id));
  const getTab=tabId=>chrome.tabs.get(tabId).catch(()=>{throw fail('Não foi possível acessar a aba. Abra a extensão novamente na página.');});
  // Ordem de captura (a captura zera os itens a cada navegação): preferredSource fica com o primeiro de cada tipo, o master HLS, como a fila.
  const candidates=async tabId=>mergeCandidates((await capture.sources(tabId))?.items||[],await scanDom(tabId));
  // Auxiliar ausente/desconectado: nova tentativa em segundo plano a cada view, no máximo uma por retryMs; o aviso de status atualiza os clientes.
  // Enquanto uma nova tentativa conecta, o estado continua 'missing' para os clientes: a ajuda de instalação não pisca.
  let lastTry=-Infinity;let missing=false;
  const track=s=>{if(s.state==='missing')missing=true;else if(s.state!=='connecting')missing=false;return s;};
  const helper=()=>{const s=track(native.status());return missing&&s.state==='connecting'?{...s,state:'missing'}:s;};
  const retryNative=()=>{const {state,info}=track(native.status());if(!(state==='idle'&&!info)&&state!=='missing'&&state!=='disconnected')return;const now=Date.now();if(now-lastTry<retryMs)return;lastTry=now;void native.ensureReady().catch(()=>{/* Ausente é um estado válido. */});};

  // panel:true (só o painel completo) tolera aba fechada e inclui a aba e as origens detectadas; o popup nunca recebe endereços.
  async function view({tabId,panel=false}){
    const tab=panel?await chrome.tabs.get(tabId).catch(()=>null):await getTab(tabId);const open=!!tab&&http(tab.url)&&!blockedSite(tab.url);
    retryNative();
    const [domSources,sources,info]=open?await Promise.all([scanDom(tabId),capture.sources(tabId),course.inspect(tabId)]):[[],{items:[]},null];
    const jobs=downloads.list();const run=course.state();const status=helper();
    const data={...popupView({tab,sources,domSources,course:info,run,jobs,native:status,lessonJobId:lessonJobs.get(tabId)??null}),native:status,jobs,run};
    if(panel)Object.assign(data,{tab:tab?{url:tab.url,title:tab.title||''}:null,sources:{generation:sources?.generation??null,items:mergeCandidates(sources?.items||[],domSources)}});
    return data;
  }
  async function downloadLesson({tabId,quality}){
    const tab=await getTab(tabId);if(blockedSite(tab.url))throw fail(TEXT_YOUTUBE);
    const found=preferredSource(await candidates(tabId));if(!found)throw fail(TEXT_EMPTY);
    const source={...found,referer:found.referer||tab.url};let job;
    try{job=await course.downloadCurrent(tabId,{quality,source});}
    catch(error){if(error?.code!=='not_course')throw error;job=downloads.start({url:source.url,referer:source.referer,quality,title:tab.title});}
    lessonJobs.set(tabId,job.id);return {id:job.id};
  }
  async function capturePlayer({tabId}){
    try{const tab=await chrome.tabs.get(tabId);if(!http(tab.url))throw new Error('not http');await capture.arm(tabId,tab.url);await chrome.tabs.reload(tabId,{bypassCache:true});}
    catch{throw fail('Não foi possível acessar ou recarregar a aba original.');}
    return {};
  }
  async function probe({url,referer}){
    checkUrl(url);const reply=await native.request({type:'probe',url,referer});
    if(reply?.type==='error')throw fail(reply.message||'Não foi possível analisar o endereço.');
    return reply;
  }
  async function openFolder(){await native.ensureReady();if(!native.send({type:'openFolder'}))throw fail('Auxiliar desconectado.');return {};}
  const handlers={view,downloadLesson,capture:capturePlayer,probe,openFolder,
    download:({url,referer,filename,quality,connections,title})=>{checkUrl(url);const {id}=downloads.start({url,referer,filename,quality,connections,...(title?{title:String(title).slice(0,300)}:{})});return {id};},
    downloadCourse:async({tabId,quality,lessons,folder,continueOnError})=>{await course.start(tabId,{quality,lessons,folder,continueOnError});return {};},
    cancel:({id})=>{downloads.cancel(id);return {};},
    stopCourse:()=>{course.stop();return {};},
    resumeCourse:async()=>{await course.resume();return {};},
    openPanel:async({tabId})=>{await chrome.tabs.create({url:'dashboard.html?tab='+tabId});return {};}};
  const TAB=new Set(['view','downloadLesson','downloadCourse','openPanel','capture']);

  chrome.runtime.onConnect.addListener(port=>{
    if(port.name!=='sirm-ui'||port.sender?.id!==chrome.runtime.id||!port.sender?.url?.startsWith(chrome.runtime.getURL('')))return;
    ports.add(port);
    const reply=message=>{try{port.postMessage(message);}catch{ports.delete(port);}};
    port.onMessage.addListener(async message=>{
      const rid=message?.rid;const handler=Object.hasOwn(handlers,message?.type)?handlers[message.type]:null;
      try{
        await ready;
        if(!handler)throw fail('Ação desconhecida.');
        if(TAB.has(message.type)&&!Number.isInteger(message.tabId))throw fail('Aba inválida.');
        reply({type:'reply',rid,ok:true,data:await handler(message)});
      }catch(error){reply({type:'reply',rid,ok:false,message:hideUrls(error?.message)||'Não foi possível concluir a ação.'});}
    });
    port.onDisconnect.addListener(()=>ports.delete(port));
  });
}
