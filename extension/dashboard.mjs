import {mergeCandidates,mediaKind,blockedSite} from './media.mjs';
import {installBatchUI} from './batch-ui.mjs';
const $=id=>document.getElementById(id);
const tabId=Number(new URL(location.href).searchParams.get('tab'));
let sourceTab;let sources=[];let port;let connected=false;let probeId='';let probeUrl='';let blockedUrl='';let chosen=false;let generation;let refreshing=false;
let filenameEdited=false;let folderSupported=false;let modulesSupported=false;
let reconnecting;const readyWaiters=new Set();
const jobs=new Map();
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}
function send(data){if(!connected){notice('Auxiliar indisponível. Execute Instalar.cmd e reabra este painel.',true);return false;}try{port.postMessage(data);return true;}catch{connected=false;notice('A conexão com o auxiliar foi interrompida. A fila tentará reconectar.',true);return false;}}
const YOUTUBE_NOTICE='O YouTube não é suportado, conforme a política da Chrome Web Store. Use em sites e cursos cujo conteúdo você tem direito de baixar.';
function selectedUrl(){return $('manual').value.trim() || $('source').value;}
function selectedReferer(){return $('manual').value.trim()?undefined:(sources.find(s=>s.url===$('source').value)?.referer || sourceTab?.url);}
function renderSources(){
  const previous=$('source').value;$('source').replaceChildren();
  for(const s of sources){const option=document.createElement('option');option.value=s.url;option.textContent=s.kind==='Página'?'Analisar endereço da página':`${s.kind} • ${new URL(s.url).hostname} • ${new URL(s.url).pathname.slice(-75)}`;$('source').append(option);}
  const preferred=sources.find(s=>['HLS','DASH'].includes(s.kind)) || sources.find(s=>s.kind==='Vídeo');
  if(chosen && sources.some(s=>s.url===previous))$('source').value=previous;
  else if(preferred)$('source').value=preferred.url;
  else if(sources.some(s=>s.url===previous))$('source').value=previous;
}
async function refreshNetwork(){
  if(refreshing || $('scan').disabled)return;
  refreshing=true;
  try{
    const state=await chrome.runtime.sendMessage({type:'sources',tabId});
    if(state.generation!==undefined && generation!==state.generation){
      generation=state.generation;sourceTab=await chrome.tabs.get(tabId);$('page').textContent=sourceTab.title || sourceTab.url;
      sources=[{url:sourceTab.url,kind:'Página',source:'Extrator yt-dlp'}];chosen=false;blockedUrl='';renderSources();
      $('capture-status').textContent='Página recarregada. Aguardando a mídia do player; inicie a reprodução na aba original.';
    }
    if(state.items?.length){sources=mergeCandidates(sources,state.items);renderSources();$('capture-status').textContent=`${state.items.length} origem(ns) de mídia detectada(s). Selecione HLS/DASH para players incorporados.`;}
  }catch{/* The panel may be closing or the extension was reloaded. */}
  finally{refreshing=false;}
}
function formatBytes(n){if(!n)return '—';const unit=n>=1048576?'MiB':'KiB';return `${(n/(unit==='MiB'?1048576:1024)).toFixed(1)} ${unit}`;}
function connect(){
  try{
    const opened=chrome.runtime.connectNative('com.turbovideo.downloader');port=opened;
    opened.onMessage.addListener(message=>{if(port===opened)handle(message);});
    opened.onDisconnect.addListener(()=>{
      if(port!==opened)return;
      const reason=chrome.runtime.lastError?.message;
      connected=false;$('connection').textContent='Auxiliar desconectado';$('setup-help').hidden=false;$('download').disabled=true;$('folder').disabled=true;
      notice(reason?'Auxiliar local não encontrado ou encerrado. Execute Instalar.cmd e reabra este painel.':'Auxiliar encerrado. Reabra o painel.',true);
      for(const job of jobs.values()){if(!job.done){job.done=true;job.status.textContent='Interrompido: conexão com o auxiliar encerrada. A fila tentará reconectar.';job.cancel.disabled=true;job.resolve?.({type:'error',code:'native_disconnected',retryable:true,message:'A conexão com o auxiliar foi encerrada.'});}}
      for(const waiter of readyWaiters)waiter(false);
      batch.refresh();
    });
    port.postMessage({type:'hello'});
  }catch{notice('Execute Instalar.cmd para conectar o auxiliar local.',true);$('setup-help').hidden=false;}
}
async function ensureNativeReady(){
  if(connected)return;
  if(reconnecting)return reconnecting;
  reconnecting=new Promise((resolve,reject)=>{
    const finish=ok=>{clearTimeout(timer);readyWaiters.delete(finish);if(ok)resolve();else reject(Object.assign(new Error('Não consegui reconectar o auxiliar. Reabra o painel ou execute Instalar.cmd.'),{code:'native_unavailable',retryable:false}));};
    const timer=setTimeout(()=>finish(false),10000);readyWaiters.add(finish);notice('Reconectando o auxiliar para retomar a fila…');connect();
  }).finally(()=>{reconnecting=undefined;});return reconnecting;
}
function handle(message){
  if(message.type==='ready'){
    connected=true;$('setup-help').hidden=true;$('connection').textContent=message.parallel?'Auxiliar pronto • paralelo':'Auxiliar pronto';
    for(const waiter of readyWaiters)waiter(true);
    $('filename').disabled=!message.supportsFilename;
    folderSupported=!!message.supportsFolders;
    modulesSupported=!!message.supportsModules;
    $('category-folder-hint').textContent=folderSupported&&modulesSupported?'O nome é lido da categoria no site. Você pode corrigir antes de iniciar a fila.':'Feche e abra este painel para carregar o auxiliar com suporte a pastas e módulos.';
    if(!message.supportsFilename)$('filename-hint').textContent='Feche e abra este painel para carregar o auxiliar com a opção de nome.';
    $('destination').textContent=`Destino: ${message.folder}`;$('download').disabled=false;$('folder').disabled=false;batch.refresh();return;
  }
  if(message.id===probeId){
    if(message.type==='info'){
      blockedUrl=message.drmOnly?probeUrl:'';
      if(!filenameEdited && $('filename').disabled===false)$('filename').value=message.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,120);
      $('info').textContent=message.drmOnly?'Este vídeo tem DRM e não pode ser baixado.':`${message.title}${message.live?' • Ao vivo: o download continua até você cancelar.':''}${message.heights.length?' • '+message.heights.map(h=>`${h}p`).join(', '):''}`;
      $('probe').disabled=false;
    }else if(message.type==='error'){$('info').textContent=message.message;$('probe').disabled=false;}
    return;
  }
  const job=jobs.get(message.id);
  if(!job){if(message.type==='error')notice(message.message,true);return;}
  job.lastActivity=Date.now();
  if(message.type==='progress'){
    if(message.total){job.bar.value=Math.min(100,message.downloaded/message.total*100);}else job.bar.removeAttribute('value');
    job.status.textContent=message.phase==='finished'?'Transferência concluída; processando e unindo arquivos…':`${formatBytes(message.downloaded)} / ${formatBytes(message.total)} • ${formatBytes(message.speed)}/s${message.eta!==null?' • '+message.eta+'s restantes':''}`;
  }else if(['complete','error','cancelled'].includes(message.type)){
    job.done=true;job.cancel.disabled=true;job.bar.value=message.type==='complete'?100:0;
    job.status.textContent=message.type==='complete'?`Salvo: ${message.file || 'arquivo concluído'}`:message.type==='error'?message.message:'Cancelado. Arquivos parciais podem ser retomados ao baixar a mesma origem e qualidade.';
    job.resolve?.(message);
  }else if(message.type==='processing'){job.status.textContent=message.message;}
  job.baseStatus=job.status.textContent;
}
async function scan(){
  $('scan').disabled=true;
  try{
    sourceTab=await chrome.tabs.get(tabId);$('page').textContent=sourceTab.title || sourceTab.url;
    if(blockedSite(sourceTab.url))notice(YOUTUBE_NOTICE,true);
    let results=[];
    try{results=await chrome.scripting.executeScript({target:{tabId,allFrames:true},func:()=>{
      const found=[];const visited=new Set();
      function visit(root){if(visited.has(root))return;visited.add(root);for(const v of root.querySelectorAll('video,source')){const url=v.currentSrc||v.src;if(url&&/^https?:/.test(url))found.push({url,kind:'Vídeo',source:'Player',referer:location.origin+'/'});}for(const element of root.querySelectorAll('*'))if(element.shadowRoot)visit(element.shadowRoot);}
      visit(document);
      for(const entry of performance.getEntriesByType('resource'))if(/\.(mp4|webm|m3u8|mpd)(\?|$)/i.test(entry.name))found.push({url:entry.name,source:'Página',referer:location.origin+'/'});
      return found;
    }});}catch{/* Network detection still works when a frame cannot be inspected. */}
    const network=await chrome.runtime.sendMessage({type:'sources',tabId});
    generation=network.generation;
    sources=mergeCandidates([{url:sourceTab.url,kind:'Página',source:'Extrator yt-dlp'}],results.flatMap(r=>r.result||[]).map(s=>({...s,kind:mediaKind(s.url)||s.kind||'Vídeo'})),network.items||[]);
    renderSources();
  }catch{$('page').textContent='Não foi possível acessar a aba original. Cole o endereço abaixo ou abra a extensão novamente na página.';}
  finally{$('scan').disabled=false;}
}
$('scan').addEventListener('click',scan);
$('filename').addEventListener('input',()=>{filenameEdited=true;});
$('source').addEventListener('change',()=>{chosen=true;});
$('capture').addEventListener('click',async()=>{
  $('capture').disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({type:'capture',tabId});
    if(!result.ok)throw new Error(result.message);
    chosen=false;sources=sourceTab?[{url:sourceTab.url,kind:'Página',source:'Extrator yt-dlp'}]:[];renderSources();
    $('info').textContent='';$('capture-status').textContent='A aula foi recarregada. Volte à aba original, dê play e retorne aqui. A detecção será atualizada automaticamente.';
    notice('Captura ativa. Dê play na aula, selecione HLS/DASH quando aparecer e mantenha este painel aberto.');
  }catch{$('capture-status').textContent='Não foi possível recarregar a aula. Abra a extensão novamente pela aba original.';}
  finally{$('capture').disabled=false;}
});
$('probe').addEventListener('click',()=>{
  const url=selectedUrl();if(!/^https?:\/\//i.test(url)){notice('Selecione ou cole um endereço HTTP/HTTPS.',true);return;}
  if(blockedSite(url)){notice(YOUTUBE_NOTICE,true);return;}
  probeId=crypto.randomUUID();probeUrl=url;blockedUrl='';
  if(send({type:'probe',id:probeId,url,referer:selectedReferer()})){$('probe').disabled=true;$('info').textContent='Analisando… Isso pode levar alguns segundos.';}
});
function startDownload({url,referer,filename='',quality,connections,folder='',module=''}){
  if(!connected)throw Object.assign(new Error('Auxiliar desconectado. Reabra o painel.'),{code:'native_disconnected',retryable:true});
  if(folder&&!folderSupported)throw new Error('Reabra o painel para atualizar o auxiliar com suporte a pastas.');
  if(module&&!modulesSupported)throw new Error('Reabra o painel para atualizar o auxiliar com suporte a módulos.');
  if([...jobs.values()].filter(j=>!j.done).length>=3)throw new Error('Aguarde ou cancele uma das três tarefas em andamento.');
  const id=crypto.randomUUID();const card=document.createElement('div');card.className='job';
  const title=document.createElement('strong');title.textContent=`${filename || sourceTab?.title || new URL(url).hostname} • ${quality==='best'?'Melhor disponível':quality==='audio'?'MP3':quality+'p'}`;
  const bar=document.createElement('progress');bar.max=100;const status=document.createElement('p');status.textContent='Conectando ao servidor…';
  const cancel=document.createElement('button');cancel.className='secondary';cancel.textContent='Cancelar';cancel.addEventListener('click',()=>{send({type:'cancel',id});cancel.disabled=true;status.textContent='Cancelando…';});
  let resolve;const done=new Promise(r=>{resolve=r;});
  card.append(title,bar,status,cancel);$('empty')?.remove();$('jobs').prepend(card);jobs.set(id,{bar,status,cancel,done:false,resolve,lastActivity:Date.now(),baseStatus:status.textContent});
  if(!send({type:'download',id,url,referer,filename,quality,connections,folder,module})){jobs.get(id).done=true;status.textContent='Auxiliar desconectado.';cancel.disabled=true;resolve({type:'error',code:'native_disconnected',retryable:true,message:'Auxiliar desconectado.'});}
  return {id,done};
}
$('download').addEventListener('click',()=>{
  const url=selectedUrl();if(!/^https?:\/\//i.test(url)){notice('Selecione ou cole um endereço HTTP/HTTPS.',true);return;}
  if(blockedSite(url)){notice(YOUTUBE_NOTICE,true);return;}
  if(url===blockedUrl){notice('O vídeo analisado tem DRM e não é compatível.',true);return;}
  try{startDownload({url,referer:selectedReferer(),filename:$('filename').disabled?'':$('filename').value.trim(),quality:$('quality').value,connections:Number($('connections').value)});}catch(error){notice(error.message,true);}
});
$('folder').addEventListener('click',()=>send({type:'openFolder'}));
window.addEventListener('beforeunload',event=>{if(batch.isRunning() || [...jobs.values()].some(j=>!j.done)){event.preventDefault();event.returnValue='';}});
const polling=setInterval(refreshNetwork,1500);
const activity=setInterval(()=>{for(const job of jobs.values()){if(!job.done){const seconds=Math.floor((Date.now()-job.lastActivity)/1000);if(seconds>=15)job.status.textContent=`${job.baseStatus} • Aguardando atualização há ${seconds}s…`;}}},1000);
window.addEventListener('unload',()=>{clearInterval(polling);clearInterval(activity);});
const batch=installBatchUI({chrome,document,tabId,canStart:()=>connected&&folderSupported&&modulesSupported&&!$('filename').disabled,startDownload,cancelDownload:id=>send({type:'cancel',id}),ensureReady:ensureNativeReady,applySettings:data=>{$('quality').value=data.quality;$('connections').value=String(data.connections);},getSettings:()=>({quality:$('quality').value,connections:Number($('connections').value)})});
connect();scan();
