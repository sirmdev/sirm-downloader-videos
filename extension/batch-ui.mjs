import {orderedLessons} from './lessons.mjs';
import {readCoursePage} from './course.mjs';
import {runLesson,queueSnapshot,queueKey} from './queue.mjs';

export function installBatchUI({chrome,document,tabId,canStart,startDownload,cancelDownload,getSettings,ensureReady=async()=>{},applySettings=()=>{}}){
  const $=id=>document.getElementById(id);
  let lessons=[];let running=false;let scanning=false;let restoring=true;let clearing=false;let incomplete=false;let stopped=false;let connection;let activeDownload;let requests=new Map();let courseUrl='';let saveChain=Promise.resolve();let editTimer;
  const settings=()=>({...getSettings(),folder:$('category-folder').value.trim(),continueOnError:$('bulk-continue').checked,incomplete});
  function persist(){
    if(scanning||restoring||clearing||!courseUrl||!lessons.length||!chrome.storage?.local)return Promise.resolve();
    const snapshot=queueSnapshot(courseUrl,lessons,settings());
    saveChain=saveChain.catch(()=>{}).then(async()=>{
      try{await chrome.storage.local.set({[snapshot.key]:snapshot});$('bulk-persistence-status').textContent='Progresso salvo neste navegador. Reabra pela mesma categoria para retomar.';}
      catch{$('bulk-persistence-status').textContent='Não foi possível guardar o progresso. Mantenha este painel aberto.';}
    });return saveChain;
  }
  function edit(){if(scanning||restoring||clearing)return;clearTimeout(editTimer);editTimer=setTimeout(()=>{void persist();},250);}
  function message(item,text){item.message=text;item.errorLabel.textContent=text;item.errorLabel.hidden=!text;}
  function refresh(){
    const busy=running||scanning||restoring||clearing;
    $('bulk-start').disabled=busy || incomplete || !canStart() || !lessons.some(l=>l.selected&&l.status!=='done');
    $('bulk-scan').disabled=busy;$('bulk-stop').disabled=!running;$('bulk-select-all').disabled=busy || !lessons.length;
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
      const status=document.createElement('span');status.className='hint';status.textContent=item.status==='done'?'Salvo':item.status==='failed'?'Pendente de nova tentativa':'Na fila';
      const error=document.createElement('p');error.className='lesson-error';error.textContent=item.message || '';error.hidden=!item.message;
      item.checkbox=checkbox;item.input=input;item.label=status;item.errorLabel=error;row.append(checkbox,input,status,error);$('bulk-list').append(row);
    });refresh();
  }
  $('bulk-scan').addEventListener('click',async()=>{
    if(scanning||running||restoring||clearing)return;clearTimeout(editTimer);const saved=persist();scanning=true;$('bulk-status').textContent='Expandindo módulos e buscando as aulas da categoria…';refresh();
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
    if(running||scanning||restoring||clearing)return;
    const key=courseUrl?queueKey(courseUrl):'';clearing=true;clearTimeout(editTimer);refresh();
    try{await saveChain;if(key)await chrome.storage?.local?.remove(key);lessons=[];incomplete=false;render();$('bulk-status').textContent='Histórico desta categoria limpo. Os vídeos no computador foram preservados.';$('bulk-persistence-status').textContent='';}
    catch{$('bulk-persistence-status').textContent='Não foi possível limpar o histórico.';}
    finally{clearing=false;refresh();}
  });
  function openConnection(){
    connection=chrome.runtime.connect({name:'turbovideo-batch'});
    connection.onMessage.addListener(message=>{
      const request=requests.get(message.id);if(!request)return;
      requests.delete(message.id);clearTimeout(request.timer);
      if(message.type==='resolved')request.resolve(message.source);else request.reject(Object.assign(new Error(message.message || 'Não foi possível capturar esta aula.'),{code:message.code || 'capture_failed',retryable:message.retryable!==false}));
    });
    connection.onDisconnect.addListener(()=>{
      void chrome.runtime.lastError;
      for(const request of requests.values()){clearTimeout(request.timer);request.reject(Object.assign(new Error('A conexão da fila foi encerrada.'),{code:'resolver_disconnected',retryable:false}));}requests.clear();
    });
  }
  function resolveLesson(url){
    const id=crypto.randomUUID();
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{requests.delete(id);reject(Object.assign(new Error('A captura da aula demorou demais. Tente novamente.'),{code:'capture_timeout',retryable:true}));},65000);
      requests.set(id,{resolve,reject,timer});
      try{connection.postMessage({type:'resolve',id,url});}catch(error){clearTimeout(timer);requests.delete(id);reject(error);}
    });
  }
  function stop(){
    stopped=true;
    if(activeDownload)cancelDownload(activeDownload);
    try{connection?.postMessage({type:'stop'});}catch{/* Already disconnected. */}
    for(const request of requests.values()){clearTimeout(request.timer);request.reject(new Error('Fila interrompida.'));}requests.clear();
    $('bulk-status').textContent='Interrompendo a fila…';
  }
  $('bulk-stop').addEventListener('click',stop);
  $('bulk-start').addEventListener('click',async()=>{
    if(running || scanning || restoring || clearing || incomplete || !canStart())return;
    const pending=lessons.filter(l=>l.selected&&l.status!=='done');if(!pending.length)return;
    if(!$('category-folder').value.trim()){$('bulk-status').textContent='Não identifiquei o nome da categoria no site. Preencha Pasta da categoria antes de baixar.';return;}
    if(pending.some(l=>!l.filename.trim())){$('bulk-status').textContent='Preencha o nome de todas as aulas selecionadas.';return;}
    const names=pending.map(l=>(l.moduleFolder+'\n'+l.filename.trim().normalize('NFC')).toLowerCase());
    if(new Set(names).size!==names.length){$('bulk-status').textContent='Duas aulas selecionadas têm o mesmo nome. Ajuste os nomes antes de baixar.';return;}
    running=true;stopped=false;requests=new Map();const options=settings();refresh();let completed=0,failed=0;await persist();
    try{
      openConnection();
      for(const item of pending){
        if(stopped)break;
        const result=await runLesson({resolveSource:()=>resolveLesson(item.url),ensureReady,shouldStop:()=>stopped,
          onAttempt:async attempt=>{item.status='pending';message(item,'');item.label.textContent=`Capturando ${attempt}/3…`;$('bulk-status').textContent=`${completed}/${pending.length} salvas • Tentativa ${attempt}/3 • ${item.filename}`;await persist();},
          onRetry:async(error,attempt)=>{message(item,error.message);item.label.textContent='Nova tentativa…';$('bulk-status').textContent=`Tentativa ${attempt}/3 falhou em “${item.filename}”: ${error.message} Vou capturar um link novo e tentar novamente.`;await persist();},
          download:async source=>{item.label.textContent='Baixando…';$('bulk-status').textContent=`${completed}/${pending.length} salvas • Baixando ${item.filename}`;const job=startDownload({...source,filename:item.filename.trim(),module:item.moduleFolder,...options});activeDownload=job.id;try{return await job.done;}finally{activeDownload=undefined;}}
        });
        if(result.type==='complete'){item.status='done';message(item,'');item.label.textContent='Salvo';completed++;await persist();continue;}
        if(result.type==='cancelled'){item.status='pending';item.label.textContent='Interrompido';message(item,'Interrompido pelo usuário. Clique em Baixar selecionadas para retomar.');stopped=true;await persist();break;}
        failed++;item.status='failed';item.label.textContent='Pendente';message(item,result.message);await persist();
        if(!options.continueOnError||['native_unavailable','resolver_disconnected'].includes(result.code))break;
      }
      $('bulk-status').textContent=stopped?`Fila interrompida. ${completed} aula(s) salva(s) nesta execução. Progresso preservado.`:failed?`Fila encerrada: ${completed} aula(s) salva(s), ${lessons.filter(l=>l.selected&&l.status!=='done').length} pendente(s). O motivo aparece abaixo de cada aula; clique em Baixar selecionadas para repetir as pendentes.`:`Concluído: ${completed} aula(s) salva(s) nesta execução.`;
    }catch(error){$('bulk-status').textContent=`Não foi possível iniciar a fila: ${error.message}`;}
    finally{
      try{connection?.postMessage({type:'finish'});connection?.disconnect();}catch{/* Worker may already have closed the port. */}
      connection=undefined;running=false;activeDownload=undefined;refresh();
    }
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
  refresh();void restore();return {refresh,isRunning:()=>running};
}
