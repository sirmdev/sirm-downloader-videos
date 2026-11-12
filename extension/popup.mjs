// Popup compacto: só renderiza o View do hub ('sirm-ui') e envia pedidos explícitos. Abrir o popup nunca inicia download.
const QUALITY_KEY='sirmPopupQuality';
const QUALITIES=[['best','Melhor'],['2160','2160p'],['1440','1440p'],['1080','1080p'],['720','720p'],['480','480p'],['audio','MP3']];
const $=id=>document.getElementById(id);
const el=(tag,props={},...kids)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k.startsWith('on'))node.addEventListener(k.slice(2),v);else if(v===true)node.setAttribute(k,'');else if(v!==false&&v!=null)node.setAttribute(k,v);}for(const kid of kids)if(kid)node.append(kid);return node;};
const plural=(n,one,many)=>`${n} ${n===1?one:many}`;

let port=null,tabId=null,quality='best',rid=0,view=null,sending=false,focused=false,timer=null,flash='';
const waiting=new Map();const notes={lesson:'',course:''};

function connect(){
  port=chrome.runtime.connect({name:'sirm-ui'});
  port.onMessage.addListener(message=>{
    if(message?.type==='update')refresh();
    else if(message?.type==='reply'){const w=waiting.get(message.rid);if(w){waiting.delete(message.rid);w(message);}}
  });
  port.onDisconnect.addListener(()=>{port=null;for(const w of waiting.values())w({ok:false,message:'Conexão com a extensão interrompida.'});waiting.clear();setStatus('Reconectando…');setTimeout(()=>{if(port)return;try{connect();refresh();}catch{/* tenta de novo no próximo ciclo */}},1000);});
}
function request(message){
  return new Promise(resolve=>{
    if(!port)try{connect();}catch{return resolve({ok:false,message:'Extensão indisponível. Feche e reabra o popup.'});}
    const id=++rid;waiting.set(id,resolve);
    try{port.postMessage({...message,rid:id});}catch{waiting.delete(id);resolve({ok:false,message:'Conexão com a extensão interrompida.'});}
  });
}

async function refresh(){
  if(tabId==null)return;
  const reply=await request({type:'view',tabId});
  if(reply.ok){view=reply.data;render();}
  else{view=null;render();setStatus(reply.message||'Não foi possível ler a aba.');}
}
// Envia uma ação; os botões ficam desabilitados até a resposta dela (views de aviso no meio não reabilitam: evita clique duplo).
async function act(card,message){
  if(sending)return;sending=true;notes[card]='';render();
  const reply=await request({...message,tabId});sending=false;
  if(!reply.ok){notes[card]=reply.message||'Não foi possível concluir a ação.';if(message.type==='openPanel'&&$(card).hidden)flash=notes[card];}
  await refresh();
}
const openPanel=card=>act(card,{type:'openPanel'});

function chip(){
  const select=el('select',{class:'pp-chip','aria-label':'Qualidade máxima',onchange:e=>{quality=e.target.value;try{chrome.storage.local.set({[QUALITY_KEY]:quality});}catch{/* preferência é opcional */}}});
  for(const [value,label] of QUALITIES)select.append(el('option',{value,text:label,selected:value===quality}));
  select.disabled=sending;return select;
}
const primary=(text,onclick,disabled)=>el('button',{class:'pp-btn',type:'button',text,onclick,disabled:disabled||sending});
const secondary=(text,onclick)=>el('button',{class:'pp-btn2',type:'button',text,onclick,disabled:sending});
function bar(job){
  const known=job?.percent!=null;
  return el('div',{class:'pp-bar'+(known?'':' pp-wait'),role:'progressbar','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':known?Math.round(job.percent):null},el('i',known?{style:`width:${Math.round(job.percent)}%`}:{}));
}
const fill=(node,...kids)=>node.replaceChildren(...kids.filter(Boolean));
const noteLine=card=>notes[card]?el('p',{class:'pp-msg pp-err',text:notes[card]}):null;
const reviewBtn=card=>notes[card]?secondary('Revisar no painel completo',()=>openPanel(card)):null;

function renderLesson(l){
  const node=$('lesson');node.hidden=!l;if(!l)return;
  const head=el('div',{class:'pp-row'},el('b',{text:'▶ Esta aula'}),chip());
  const title=el('div',{class:'pp-sub',text:l.title||''});
  const go=disabled=>primary('↧ Baixar esta aula',()=>act('lesson',{type:'downloadLesson',quality}),disabled);
  if(l.state==='busy'){
    const job=l.job||{};
    fill(node,head,title,el('div',{class:'pp-row'},el('span',{text:job.status==='processing'?'Processando…':'Baixando…'}),el('span',{class:'pp-sub',style:'margin:0',text:job.percent!=null?Math.round(job.percent)+'%':''})),bar(job),el('div',{class:'pp-sub',style:'margin:0 0 4px',text:job.message||''}),secondary('Cancelar',()=>act('lesson',{type:'cancel',id:job.id})));
  }else if(l.state==='done'){
    fill(node,head,title,el('p',{class:'pp-msg pp-ok',text:'✓ '+(l.job?.message||'Aula salva.')}),noteLine('lesson'),go(false));
  }else if(l.state==='error'){
    fill(node,head,title,el('p',{class:'pp-msg pp-err',text:l.message||'O download falhou.'}),noteLine('lesson'),go(false),reviewBtn('lesson'));
  }else if(l.state==='empty'){
    fill(node,head,title,el('p',{class:'pp-msg',text:l.message}),noteLine('lesson'),go(true));
  }else fill(node,head,title,noteLine('lesson'),go(false),reviewBtn('lesson'));
}
function renderCourse(c){
  const node=$('course');node.hidden=!c;if(!c)return;
  const head=el('div',{class:'pp-row'},el('b',{text:'☰ Curso inteiro'}),el('span',{class:'pp-sub',style:'margin:0',text:plural(c.total,'aula','aulas')}));
  const counts=el('div',{class:'pp-sub',text:`${plural(c.done,'já baixada','já baixadas')} · ${c.pending} faltando`});
  const review=()=>c.state==='blocked'||notes.course?secondary('Revisar no painel completo',()=>openPanel('course')):null;
  if(c.state==='running'){
    const r=c.run||{};const job=r.jobId==null?null:(view?.jobs||[]).find(j=>j.id===r.jobId);
    fill(node,head,el('div',{class:'pp-sub',text:r.message||'Baixando a fila…'}),r.total?el('div',{class:'pp-sub',style:'margin:0',text:`${r.completed} salva(s)${r.failed?` · ${r.failed} com erro`:''}`}):null,bar(job||null),noteLine('course'),secondary('Parar fila',()=>act('course',{type:'stopCourse'})));
  }else if(c.state==='interrupted'){
    fill(node,head,counts,el('p',{class:'pp-msg',text:c.message||'Fila interrompida.'}),noteLine('course'),primary('Retomar',()=>act('course',{type:'resumeCourse'})),review());
  }else if(c.state==='complete'){
    fill(node,head,el('p',{class:'pp-msg pp-ok',text:'✓ Todas as aulas já foram baixadas.'}));
  }else if(c.state==='blocked'||c.state==='otherRunning'){
    fill(node,head,counts,el('p',{class:'pp-msg',text:c.message||(c.state==='otherRunning'?'Outra fila de curso está em andamento.':'')}),noteLine('course'),review());
  }else fill(node,head,counts,noteLine('course'),secondary(`↧ Baixar as ${c.pending} que faltam`,()=>act('course',{type:'downloadCourse',quality})),reviewBtn('course'));
}
function render(){
  const v=view;const message=$('install');
  $('host').textContent=v?.host||'';
  if(!v){$('lesson').hidden=true;$('course').hidden=true;message.hidden=true;return;}
  message.hidden=v.mode==='ready';
  if(v.mode==='ready'){renderLesson(v.lesson);renderCourse(v.course);}
  else{fill(message,el('p',{class:'pp-msg',text:v.message||''}),v.mode==='install'?el('p',{class:'pp-msg',text:'1. Baixe o instalador em GitHub Releases.  2. Execute Instalar.cmd.  3. Reabra este popup.'}):null,v.mode==='install'?el('a',{class:'pp-link',href:'https://github.com/sirmdev/sirm-downloader-videos/releases/latest',target:'_blank',rel:'noopener',text:'Abrir GitHub Releases'}):null);$('lesson').hidden=true;$('course').hidden=true;}
  $('folder').disabled=sending;$('folder-foot').disabled=sending;
  const connected=!!v.footer?.connected;
  $('status').replaceChildren(el('span',{class:connected&&!flash?'pp-ok':'',text:flash||(connected?'● Auxiliar conectado':'○ Auxiliar não conectado')}));flash='';
  // Sem vídeo ou sem auxiliar: consulta de novo (o hub limita as tentativas de conectar o auxiliar).
  clearTimeout(timer);if(v.lesson?.state==='empty'||v.mode==='install')timer=setTimeout(refresh,1500);
  if(!focused){const first=document.querySelector('main button:not(:disabled)');if(first){first.focus();focused=true;}}
}
function setStatus(text){$('status').textContent=text;}

async function init(){
  try{const saved=(await chrome.storage.local.get(QUALITY_KEY))[QUALITY_KEY];if(QUALITIES.some(([q])=>q===saved))quality=saved;}catch{/* usa o padrão */}
  const openFolder=()=>{if(sending)return;sending=true;render();request({type:'openFolder'}).then(r=>{sending=false;if(!r.ok)flash=r.message||'Não foi possível abrir a pasta.';return refresh();});};
  $('folder').addEventListener('click',openFolder);$('folder-foot').addEventListener('click',openFolder);
  $('panel').addEventListener('click',()=>openPanel('lesson'));
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab){setStatus('Não foi possível identificar a aba ativa.');return;}
  tabId=tab.id;connect();await refresh();
}
init();
