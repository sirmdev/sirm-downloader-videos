// Seleção, nomes, pasta e histórico ficam no painel; a fila roda no service worker (hub 'sirm-ui') e o status vem do RunState.
import {orderedLessons} from './lessons.mjs';
import {readCoursePage} from './course.mjs';
import {queueSnapshot,queueKey} from './queue.mjs';
const BUSY=new Set(['running','stopping']);

export function installBatchUI({chrome,document,tabId,canStart,request,getSettings,applySettings=()=>{}}){
  const $=id=>document.getElementById(id);
  let lessons=[];let scanning=false;let restoring=true;let clearing=false;let starting=false;let incomplete=false;let courseUrl='';let saveChain=Promise.resolve();let editTimer;let run={status:'idle'};
  const settings=()=>({...getSettings(),folder:$('category-folder').value.trim(),continueOnError:$('bulk-continue').checked,incomplete});
  const keyOf=()=>{try{return courseUrl?queueKey(courseUrl):'';}catch{return '';}};
  const running=()=>BUSY.has(run.status)&&!!keyOf()&&run.key===keyOf();
  const otherRunning=()=>BUSY.has(run.status)&&!running();
  function persist(){
    // Durante a fila o snapshot pertence ao service worker; o painel não o sobrescreve.
    if(scanning||restoring||clearing||running()||!courseUrl||!lessons.length||!chrome.storage?.local)return Promise.resolve();
    saveChain=saveChain.catch(()=>{}).then(async()=>{
      // O service worker também grava (ex.: aula baixada pelo popup): adota o estado salvo antes de sobrescrever.
      try{await sync();const snapshot=queueSnapshot(courseUrl,lessons,settings());await chrome.storage.local.set({[snapshot.key]:snapshot});$('bulk-persistence-status').textContent='Progresso salvo neste navegador. Reabra pela mesma categoria para retomar.';}
      catch{$('bulk-persistence-status').textContent='Não foi possível guardar o progresso neste navegador.';}
    });return saveChain;
  }
  function edit(){if(scanning||restoring||clearing||running())return;clearTimeout(editTimer);editTimer=setTimeout(()=>{void persist();},250);}
  const statusText=item=>item.status==='done'?'Salvo':item.status==='failed'?'Pendente de nova tentativa':'Na fila';
  function refresh(){
    const busy=running()||starting||scanning||restoring||clearing;
    $('bulk-start').disabled=busy || otherRunning() || incomplete || !canStart() || !lessons.some(l=>l.selected&&l.status!=='done');
    $('bulk-scan').disabled=busy;$('bulk-stop').disabled=!running()||run.status==='stopping';$('bulk-select-all').disabled=busy || !lessons.length;
    $('category-folder').disabled=busy || !canStart();$('bulk-continue').disabled=busy;$('bulk-clear').disabled=busy||!lessons.length;
    for(const item of lessons){if(item.checkbox)item.checkbox.disabled=busy;if(item.input)item.input.disabled=busy;}
  }
  function render(){
    $('bulk-list').replaceChildren();
    let lastModule='';
    lessons.forEach((item,index)=>{
      if(item.module&&item.moduleFolder!==lastModule){const heading=document.createElement('h4');heading.className='module-heading';heading.textContent=item.module;$('bulk-list').append(heading);lastModule=item.moduleFolder;}
      const row=document.createElement('div');row.className='lesson-row';
      const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=item.selected;checkbox.setAttribute('aria-label',`${index+1}. ${item.title}`);
      checkbox.addEventListener('change',()=>{item.selected=checkbox.checked;refresh();edit();});
      const input=document.createElement('input');input.type='text';input.value=item.filename;input.maxLength=120;input.setAttribute('aria-label',`Nome da aula ${index+1}`);
      input.addEventListener('input',()=>{item.filename=input.value;edit();});
      const status=document.createElement('span');status.className='hint';status.textContent=statusText(item);
      const error=document.createElement('p');error.className='lesson-error';error.textContent=item.message || '';error.hidden=!item.message;
      item.checkbox=checkbox;item.input=input;item.label=status;item.errorLabel=error;row.append(checkbox,input,status,error);$('bulk-list').append(row);
    });refresh();
  }
  $('bulk-scan').addEventListener('click',async()=>{
    if(scanning||running()||starting||restoring||clearing)return;clearTimeout(editTimer);const saved=persist();scanning=true;$('bulk-status').textContent='Expandindo módulos e buscando as aulas da categoria…';refresh();
    try{
      await saved;
      const tab=await chrome.tabs.get(tabId);
      courseUrl=tab.url;
      const result=await chrome.scripting.executeScript({target:{tabId},func:readCoursePage,args:[{expandModules:true}]});
      const course=result[0]?.result || {};
      const categoryKey=new URL(tab.url).origin+new URL(tab.url).pathname;
      if($('category-folder').dataset.course!==categoryKey||!$('category-folder').value.trim()){
        $('category-folder').value=String(course.category || '').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().replace(/[. ]+$/g,'').slice(0,80);
        $('category-folder').dataset.course=categoryKey;
      }
      const previous=new Map(lessons.map(l=>[l.url,l]));
      lessons=orderedLessons(tab.url,course.anchors || []).map(l=>{const old=previous.get(l.url);const same=old?.moduleFolder===l.moduleFolder;return {...l,filename:same&&old.filename || l.filename,selected:old?.selected ?? true,status:same&&old.status || 'pending',message:same&&old.message || ''};});
      incomplete=!!course.incomplete;
      $('bulk-select-all').checked=lessons.every(l=>l.selected);
      $('bulk-status').textContent=incomplete?(course.warnings || []).join(' '):lessons.length?`${lessons.length} aulas encontradas${course.modules?.length?' em '+course.modules.length+' módulos':''}. Revise a seleção, a pasta e os nomes antes de baixar.`:'Nenhuma lista de aulas compatível encontrada. Abra pelo menos um módulo no site como referência e tente novamente.';
      render();
    }catch{lessons=[];incomplete=true;render();$('bulk-status').textContent='Não foi possível ler a lista da aba original. Abra o painel pela página da categoria.';}
    finally{scanning=false;refresh();await persist();}
  });
  $('bulk-select-all').addEventListener('change',()=>{for(const item of lessons){item.selected=$('bulk-select-all').checked;item.checkbox.checked=item.selected;}refresh();edit();});
  $('category-folder').addEventListener('input',edit);$('bulk-continue').addEventListener('change',edit);
  $('bulk-clear').addEventListener('click',async()=>{
    if(running()||starting||scanning||restoring||clearing)return;
    const key=keyOf();clearing=true;clearTimeout(editTimer);refresh();
    try{await saveChain;if(key)await chrome.storage?.local?.remove(key);lessons=[];incomplete=false;render();$('bulk-status').textContent='Histórico desta categoria limpo. Os vídeos no computador foram preservados.';$('bulk-persistence-status').textContent='';}
    catch{$('bulk-persistence-status').textContent='Não foi possível limpar o histórico.';}
    finally{clearing=false;refresh();}
  });
  // Estados salvos pelo service worker (Salvo/Pendente e o motivo) voltam para as linhas da lista.
  async function sync(){
    const key=keyOf();if(!key||!chrome.storage?.local)return;
    try{
      const saved=(await chrome.storage.local.get(key))[key];if(saved?.version!==1||!Array.isArray(saved.items))return;
      const byUrl=new Map(saved.items.map(i=>[i.url,i]));
      for(const item of lessons){const next=byUrl.get(item.url);if(!next||next.moduleFolder!==item.moduleFolder)continue;item.status=next.status;item.message=next.message||'';if(item.label){item.label.textContent=statusText(item);item.errorLabel.textContent=item.message;item.errorLabel.hidden=!item.message;}}
      refresh();
    }catch{/* O progresso continua salvo; a lista atualiza no próximo aviso. */}
  }
  function update(next){
    const was=running();run=next&&typeof next==='object'?next:{status:'idle'};const now=running();
    if(now)$('bulk-status').textContent=`${run.completed||0}/${run.total||0} salvas${run.failed?` • ${run.failed} com erro`:''} • ${run.message||'Baixando a fila…'}`;
    else if(was&&run.key===keyOf()&&run.message)$('bulk-status').textContent=run.message;
    else if(otherRunning()&&!scanning)$('bulk-status').textContent='Fila de outro curso em andamento. Aguarde ela terminar para baixar esta categoria.';
    if(now||was)void sync();
    refresh();
  }
  $('bulk-stop').addEventListener('click',async()=>{
    if(!running())return;$('bulk-stop').disabled=true;
    const reply=await request({type:'stopCourse'});if(!reply.ok)$('bulk-status').textContent=reply.message||'Não foi possível parar a fila.';
    refresh();
  });
  $('bulk-start').addEventListener('click',async()=>{
    if(running() || otherRunning() || starting || scanning || restoring || clearing || incomplete || !canStart())return;
    const pending=lessons.filter(l=>l.selected&&l.status!=='done');if(!pending.length)return;
    if(!$('category-folder').value.trim()){$('bulk-status').textContent='Não identifiquei o nome da categoria no site. Preencha Pasta da categoria antes de baixar.';return;}
    if(pending.some(l=>!l.filename.trim())){$('bulk-status').textContent='Preencha o nome de todas as aulas selecionadas.';return;}
    const names=pending.map(l=>(l.moduleFolder+'\n'+l.filename.trim().normalize('NFC')).toLowerCase());
    if(new Set(names).size!==names.length){$('bulk-status').textContent='Duas aulas selecionadas têm o mesmo nome. Ajuste os nomes antes de baixar.';return;}
    clearTimeout(editTimer);await persist();starting=true;refresh();$('bulk-status').textContent='Iniciando a fila…';
    try{
      // Envia a lista inteira com o campo selected: as não selecionadas ficam fora da fila e continuam no histórico.
      const options=settings();
      const reply=await request({type:'downloadCourse',tabId,quality:options.quality,lessons:queueSnapshot(courseUrl,lessons,options).items,folder:options.folder,continueOnError:options.continueOnError});
      if(!reply.ok)$('bulk-status').textContent=reply.message||'Não foi possível iniciar a fila.';
      else if(!running())$('bulk-status').textContent='Fila iniciada. Os downloads continuam mesmo se você fechar este painel.';
    }finally{starting=false;refresh();}
  });
  async function restore(){
    try{
      const tab=await chrome.tabs.get(tabId);courseUrl=tab.url;if(!chrome.storage?.local)return;
      const key=queueKey(courseUrl);const data=await chrome.storage.local.get(key);const saved=data[key];if(saved?.version!==1||saved.key!==key||!Array.isArray(saved.items))return;
      const snapshot=queueSnapshot(courseUrl,saved.items,saved);lessons=snapshot.items;incomplete=snapshot.incomplete;$('category-folder').value=snapshot.folder;$('category-folder').dataset.course=new URL(courseUrl).origin+new URL(courseUrl).pathname;$('bulk-continue').checked=snapshot.continueOnError;applySettings(snapshot);render();
      $('bulk-status').textContent=incomplete?'A busca anterior estava incompleta. Clique em Encontrar aulas desta categoria antes de baixar.':`Fila recuperada: ${lessons.filter(l=>l.status==='done').length} salvas e ${lessons.filter(l=>l.selected&&l.status!=='done').length} pendentes. Clique em Baixar selecionadas para retomar.`;
      $('bulk-persistence-status').textContent='Nenhum download é iniciado automaticamente ao reabrir.';
    }catch{$('bulk-persistence-status').textContent='Não foi possível recuperar o histórico. Busque as aulas novamente.';}
    finally{restoring=false;refresh();}
  }
  refresh();void restore();return {refresh,update};
}
