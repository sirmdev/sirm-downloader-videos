// Painel completo: cliente fino do hub ('sirm-ui'). Downloads e fila vivem no service worker; fechar o painel não interrompe nada.
import {mergeCandidates,blockedSite} from './media.mjs';
import {TEXT_YOUTUBE} from './view-model.mjs';
import {installBatchUI} from './batch-ui.mjs';
const $=id=>document.getElementById(id);
const tabId=Number(new URL(location.href).searchParams.get('tab'));
const ACTIVE=new Set(['starting','downloading','processing']);
const QUALITY={best:'Melhor disponível',audio:'MP3'};
let port=null;let rid=0;let view=null;let sourceTab=null;let sources=[];let generation;let chosen=false;let blockedUrl='';let filenameEdited=false;let rescan=false;
let nativeState='';let folderSupported=false;let modulesSupported=false;let warnedYoutube=false;let loading=null;let again=false;
const waiting=new Map();const cards=new Map();
const NOTICE=$('notice').textContent;
function notice(text,error=false){$('notice').textContent=text;$('notice').classList.toggle('error',error);}

function connect(){
  port=chrome.runtime.connect({name:'sirm-ui'});
  port.onMessage.addListener(message=>{
    if(message?.type==='update')void refresh();
    else if(message?.type==='reply'){const w=waiting.get(message.rid);if(w){waiting.delete(message.rid);w(message);}}
  });
  port.onDisconnect.addListener(()=>{port=null;for(const w of waiting.values())w({ok:false,message:'Conexão com a extensão interrompida.'});waiting.clear();$('connection').textContent='Reconectando…';setTimeout(()=>{if(port)return;try{connect();void refresh();}catch{/* tenta de novo no próximo ciclo */}},1000);});
}
function request(message){
  return new Promise(resolve=>{
    if(!port)try{connect();}catch{return resolve({ok:false,message:'Extensão indisponível. Feche e reabra este painel.'});}
    const id=++rid;waiting.set(id,resolve);
    try{port.postMessage({...message,rid:id});}catch{waiting.delete(id);resolve({ok:false,message:'Conexão com a extensão interrompida.'});}
  });
}
// Um pedido de view por vez; avisos que chegam durante o pedido geram só mais um.
function refresh(){
  if(loading){again=true;return loading;}
  loading=(async()=>{try{do{again=false;await load();}while(again);}finally{loading=null;}})();return loading;
}
async function load(){
  const reply=await request({type:'view',tabId,panel:true});
  if(!reply.ok){$('page').textContent=reply.message||'Não foi possível acessar a aba original.';return;}
  view=reply.data;renderNative();applySources();renderJobs();batch.update(view.run);
}

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
function applySources(){
  const tab=view.tab;
  if(!tab){sourceTab=null;$('page').textContent='Não foi possível acessar a aba original. Cole o endereço abaixo ou abra a extensão novamente na página.';return;}
  sourceTab=tab;$('page').textContent=tab.title || tab.url;
  if(view.mode==='youtube'&&!warnedYoutube){warnedYoutube=true;notice(TEXT_YOUTUBE,true);}
  const {generation:next=null,items=[]}=view.sources||{};const before=sources.map(s=>s.url).join('\n');
  const reloaded=generation!==undefined&&next!==generation;
  if(reloaded||rescan||!sources.length){
    sources=[{url:tab.url,kind:'Página',source:'Extrator yt-dlp'}];
    if(reloaded){chosen=false;blockedUrl='';$('capture-status').textContent='Página recarregada. Aguardando a mídia do player; inicie a reprodução na aba original.';}
  }
  generation=next;rescan=false;
  if(items.length){sources=mergeCandidates(sources,items);$('capture-status').textContent=`${items.length} origem(ns) de mídia detectada(s). Selecione HLS/DASH para players incorporados.`;}
  // Só reconstrói a lista quando ela muda: o select aberto não fecha a cada atualização.
  if(sources.map(s=>s.url).join('\n')!==before)renderSources();
}
function renderNative(){
  const n=view.native||{};const info=n.info;const connected=!!view.footer?.connected;const missing=n.state==='missing';
  $('connection').textContent=connected?(info?.parallel?'Auxiliar pronto • paralelo':'Auxiliar pronto'):n.state==='connecting'?'Conectando…':'Auxiliar desconectado';
  $('setup-help').hidden=!missing;$('download').disabled=missing;$('folder').disabled=missing;
  if(missing&&nativeState!=='missing')notice('Auxiliar local não encontrado. Execute Instalar.cmd e reabra este painel.',true);
  else if(!missing&&nativeState==='missing')notice(NOTICE);
  nativeState=n.state||'';
  if(info){
    $('filename').disabled=!info.supportsFilename;folderSupported=!!info.supportsFolders;modulesSupported=!!info.supportsModules;
    $('category-folder-hint').textContent=folderSupported&&modulesSupported?'O nome é lido da categoria no site. Você pode corrigir antes de iniciar a fila.':'Atualize o auxiliar (Instalar.cmd) para ter suporte a pastas e módulos.';
    if(!info.supportsFilename)$('filename-hint').textContent='Atualize o auxiliar (Instalar.cmd) para ter a opção de nome.';
    $('destination').textContent=info.folder?`Destino: ${info.folder}`:'';
  }
  batch.refresh();
}
// Cartões de tarefa a partir de view.jobs (inclui downloads iniciados pelo popup e pela fila).
function renderJobs(){
  const now=Date.now();
  for(const job of view.jobs||[]){
    let card=cards.get(job.id);
    if(!card){
      const node=document.createElement('div');node.className='job';
      const title=document.createElement('strong');const bar=document.createElement('progress');bar.max=100;const status=document.createElement('p');
      const cancel=document.createElement('button');cancel.className='secondary';cancel.textContent='Cancelar';
      cancel.addEventListener('click',async()=>{cancel.disabled=true;const reply=await request({type:'cancel',id:job.id});if(!reply.ok){notice(reply.message,true);cancel.disabled=false;}});
      node.append(title,bar,status,cancel);$('empty')?.remove();$('jobs').prepend(node);
      card={title,bar,status,cancel,sig:'',since:now};cards.set(job.id,card);
    }
    const sig=`${job.status}|${job.message}|${job.percent}`;if(sig!==card.sig){card.sig=sig;card.since=now;}
    card.job=job;card.title.textContent=job.title||'Download';
    if(job.percent!=null)card.bar.value=job.percent;else if(ACTIVE.has(job.status))card.bar.removeAttribute('value');else card.bar.value=0;
    if(!ACTIVE.has(job.status))card.cancel.disabled=true;
    stale(card,now);
  }
}
function stale(card,now){
  const seconds=Math.floor((now-card.since)/1000);const active=ACTIVE.has(card.job?.status);
  card.status.textContent=`${card.job?.message||''}${active&&seconds>=15?` • Aguardando atualização há ${seconds}s…`:''}`;
}

async function scan(){$('scan').disabled=true;rescan=true;try{await refresh();}finally{$('scan').disabled=false;}}
$('scan').addEventListener('click',scan);
$('filename').addEventListener('input',()=>{filenameEdited=true;});
$('source').addEventListener('change',()=>{chosen=true;});
$('capture').addEventListener('click',async()=>{
  $('capture').disabled=true;
  try{
    const reply=await request({type:'capture',tabId});
    if(!reply.ok)throw new Error(reply.message);
    chosen=false;sources=sourceTab?[{url:sourceTab.url,kind:'Página',source:'Extrator yt-dlp'}]:[];renderSources();
    $('info').textContent='';$('capture-status').textContent='A aula foi recarregada. Volte à aba original, dê play e retorne aqui. A detecção será atualizada automaticamente.';
    notice('Captura ativa. Dê play na aula e selecione HLS/DASH quando aparecer.');
  }catch{$('capture-status').textContent='Não foi possível recarregar a aula. Abra a extensão novamente pela aba original.';}
  finally{$('capture').disabled=false;}
});
$('probe').addEventListener('click',async()=>{
  const url=selectedUrl();if(!/^https?:\/\//i.test(url)){notice('Selecione ou cole um endereço HTTP/HTTPS.',true);return;}
  if(blockedSite(url)){notice(TEXT_YOUTUBE,true);return;}
  blockedUrl='';$('probe').disabled=true;$('info').textContent='Analisando… Isso pode levar alguns segundos.';
  try{
    const reply=await request({type:'probe',url,referer:selectedReferer()});
    if(!reply.ok){$('info').textContent=reply.message||'Não foi possível analisar o endereço.';return;}
    const info=reply.data||{};const title=String(info.title||'');const heights=Array.isArray(info.heights)?info.heights:[];
    blockedUrl=info.drmOnly?url:'';
    if(!filenameEdited && $('filename').disabled===false)$('filename').value=title.replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().slice(0,120);
    $('info').textContent=info.drmOnly?'Este vídeo tem DRM e não pode ser baixado.':`${title}${info.live?' • Ao vivo: o download continua até você cancelar.':''}${heights.length?' • '+heights.map(h=>`${h}p`).join(', '):''}`;
  }finally{$('probe').disabled=false;}
});
$('download').addEventListener('click',async()=>{
  const url=selectedUrl();if(!/^https?:\/\//i.test(url)){notice('Selecione ou cole um endereço HTTP/HTTPS.',true);return;}
  if(blockedSite(url)){notice(TEXT_YOUTUBE,true);return;}
  if(url===blockedUrl){notice('O vídeo analisado tem DRM e não é compatível.',true);return;}
  const filename=$('filename').disabled?'':$('filename').value.trim();const quality=$('quality').value;
  const title=`${filename || sourceTab?.title || new URL(url).hostname} • ${QUALITY[quality]||quality+'p'}`;
  $('download').disabled=true;
  try{
    const reply=await request({type:'download',url,referer:selectedReferer(),filename,quality,connections:Number($('connections').value),title});
    if(!reply.ok)notice(reply.message||'Não foi possível iniciar o download.',true);
  }finally{$('download').disabled=nativeState==='missing';void refresh();}
});
$('folder').addEventListener('click',async()=>{const reply=await request({type:'openFolder'});if(!reply.ok)notice(reply.message||'Não foi possível abrir a pasta.',true);});
// Detecções por rede não geram aviso do hub: consulta periódica enquanto o painel está visível.
const polling=setInterval(()=>{if(!document.hidden)void refresh();},1500);
const activity=setInterval(()=>{const now=Date.now();for(const card of cards.values())stale(card,now);},1000);
window.addEventListener('pagehide',()=>{clearInterval(polling);clearInterval(activity);});
const batch=installBatchUI({chrome,document,tabId,request,canStart:()=>nativeState!=='missing'&&folderSupported&&modulesSupported&&!$('filename').disabled,applySettings:data=>{$('quality').value=data.quality;$('connections').value=String(data.connections);},getSettings:()=>({quality:$('quality').value,connections:Number($('connections').value)})});
connect();void refresh();
