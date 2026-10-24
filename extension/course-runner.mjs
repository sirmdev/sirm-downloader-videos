// Fila de curso global no service worker (porta de bulk-start/restore do batch-ui). Uma fila por vez; nada inicia sozinho.
import {orderedLessons} from './lessons.mjs';
import {readCoursePage} from './course.mjs';
import {runLesson,queueSnapshot,queueKey} from './queue.mjs';

const BUSY=new Set(['running','stopping']);
const QUALITIES=['best','2160','1440','1080','720','480','audio'];
const T={category:'Não identifiquei o nome da categoria no site. Revise no painel completo.',other:'Fila de outro curso em andamento.',same:'A fila deste curso já está em andamento.',changed:'A lista de aulas mudou. Confira e clique de novo.',
  duplicate:'Duas aulas têm o mesmo nome. Revise no painel completo.',names:'Preencha o nome de todas as aulas selecionadas.',incomplete:'A lista de aulas está incompleta. Revise no painel completo.',
  none:'Nenhuma lista de aulas compatível encontrada nesta aba.',empty:'Nenhuma aula pendente neste curso.',lost:'Não encontrei o progresso salvo deste curso. Abra a página do curso e inicie de novo.',exists:'Já estava na pasta',queued:'A fila do curso já está baixando esta aula.'};
const blocked=text=>Object.assign(new Error(text),{code:'blocked',blocked:text});
const notCourse=()=>Object.assign(new Error('Esta aba não é uma aula de curso.'),{code:'not_course'});
const hideUrls=text=>String(text||'').replace(/https?:\/\/\S+/gi,'[endereço oculto]');
const count=n=>Number.isInteger(n)&&n>=0?n:0;
export const folderName=value=>String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').trim().replace(/[. ]+$/g,'').slice(0,80);
function classIdOf(url){try{return new URL(url).searchParams.get('classId');}catch{return null;}}
const nameKey=l=>(l.moduleFolder+'\n'+String(l.filename).trim().normalize('NFC')).toLowerCase();
// Mesma regra do batch-ui: nome/estado salvos só valem se a aula continua no mesmo módulo.
function merge(lessons,saved,selected){
  const previous=new Map((saved?.items||[]).map(i=>[i.url,i]));
  return lessons.map(l=>{const old=previous.get(l.url);const same=old?.moduleFolder===l.moduleFolder;return {...l,filename:same&&old.filename||l.filename,selected:selected??old?.selected??true,status:same&&old.status||'pending',message:same&&old.message||''};});
}

export function createCourseRunner({chrome,downloads,native,makeResolver,storage=chrome.storage?.local,wait}){
  let run={status:'idle'};let current=null;let resolver=null;let stopping=false;let starting=null;let quality='best';let continueOnError=false;let chain=Promise.resolve();let wake=null;let halt=null;let active=null;
  // manual: aulas iniciadas por "Baixar esta aula" (url da aula → {id,done}); a fila espera esse job em vez de abrir outro.
  const totals=new Map();const warned=new Map();const manual=new Map();const listeners=new Set();
  const state=()=>({...run});
  const emit=()=>{const snapshot=state();for(const fn of [...listeners])try{fn(snapshot);}catch{/* falha isolada */}};
  const update=patch=>{Object.assign(run,patch);for(const [k,v] of Object.entries(run))if(v===undefined)delete run[k];emit();};
  const write=data=>(chain=chain.catch(()=>{}).then(()=>storage.set(data)).catch(()=>{/* Progresso continua em memória. */}));
  const saveRun=()=>write({sirmRun:{status:run.status,key:run.key,index:count(run.index),total:count(run.total),completed:count(run.completed),failed:count(run.failed),quality}});
  const saveQueue=c=>write({[c.key]:queueSnapshot(c.page,c.items,c.settings)});
  async function loadSnapshot(page){
    try{const key=queueKey(page);const saved=(await storage.get(key))[key];if(saved?.version!==1||saved.key!==key||!Array.isArray(saved.items))return null;return queueSnapshot(page,saved.items,saved);}catch{return null;}
  }
  async function readPage(tabId,expandModules){
    const tab=await chrome.tabs.get(tabId);
    const [frame]=await chrome.scripting.executeScript({target:{tabId},func:readCoursePage,args:[{expandModules}]});
    const course=frame?.result||{};return {tab,course,lessons:orderedLessons(tab.url,course.anchors||[])};
  }
  function reasonFor({key,folder,course={},pending}){
    if(BUSY.has(run.status)&&run.key!==key)return T.other;
    if(!folder)return T.category;
    if(course.incomplete)return (course.warnings||[]).join(' ')||T.incomplete;
    if(pending.some(l=>!String(l.filename).trim()))return T.names;
    if(new Set(pending.map(nameKey)).size!==pending.length)return T.duplicate;
    return '';
  }

  async function inspect(tabId){
    let read;try{read=await readPage(tabId,false);}catch{return null;}
    const {tab,course,lessons}=read;if(!lessons.length)return null;
    const key=queueKey(tab.url);const saved=await loadSnapshot(tab.url);
    // Mesma base do start: só as aulas presentes na página; o snapshot entra apenas com nome e estado.
    const known=new Map((saved?.items||[]).map(i=>[i.url,i]));
    const all=lessons.map(l=>known.get(l.url)||l);totals.set(key,all.length);
    const done=all.filter(i=>i.status==='done').length;const category=saved?.folder||folderName(course.category);
    const id=classIdOf(tab.url);const lesson=id&&all.find(i=>classIdOf(i.url)===id);
    const reason=reasonFor({key,folder:category,course,pending:all.filter(i=>i.status!=='done')});
    return {key,category,total:all.length,done,pending:all.length-done,...(lesson?{currentLesson:{url:lesson.url,filename:lesson.filename,moduleFolder:lesson.moduleFolder}}:{}),...(reason?{blocked:reason}:{})};
  }

  async function startJob(request){
    for(;;){
      // Parar durante a espera nunca pode iniciar um job que stop() não veria.
      if(stopping)throw Object.assign(new Error('Fila interrompida pelo usuário.'),{code:'cancelled',retryable:false});
      try{return downloads.start(request);}catch(error){if(error?.code!=='limit')throw error;}
      update({message:'Aguardando uma vaga: já há 3 downloads em andamento.'});
      await new Promise(resolve=>{let off=()=>{};const done=()=>{clearTimeout(timer);off();wake=null;resolve();};const timer=setTimeout(done,1000);wake=done;off=downloads.onChange(done)||off;});
    }
  }
  function begin(c,pending,options){
    current=c;quality=options.quality;continueOnError=options.continueOnError===true;stopping=false;
    run={status:'running',key:c.key,title:c.settings.folder,index:0,total:pending.length,completed:0,failed:0,message:'Iniciando a fila…'};emit();
    void execute(c,pending);
  }
  async function execute(c,list){
    native.hold('course');let last=null;let fatal=null;
    try{
      await saveQueue(c);await saveRun();resolver=makeResolver();
      for(const [n,item] of list.entries()){
        if(stopping)break;if(item.status==='done')continue;
        const label=`Aula ${n+1} de ${list.length}`;active=item.url;update({index:n+1,message:`${label}: ${item.filename}`});await saveRun();
        const mine=manual.get(item.url);let reused=null;
        if(mine){update({jobId:mine.id,message:`${label} • Baixando: ${item.filename}`});const r=await Promise.race([mine.done,new Promise(resolve=>{if(stopping)resolve('stop');else halt=()=>resolve('stop');})]);halt=null;update({jobId:undefined});if(r==='stop')break;if(r?.type==='complete'||r?.code==='destination_exists')reused=r;else if(stopping)break;}
        const result=reused||await runLesson({resolveSource:()=>resolver.resolve(item.url),ensureReady:()=>native.ensureReady(),shouldStop:()=>stopping,...(wait?{wait}:{}),
          onAttempt:async attempt=>{item.status='pending';item.message='';update({message:`${label} • Capturando (tentativa ${attempt}/3): ${item.filename}`});},
          onRetry:async(error,attempt)=>{item.message=error.message;update({message:`Tentativa ${attempt}/3 falhou em “${item.filename}”: ${hideUrls(error.message)} Vou capturar um link novo e tentar novamente.`});await saveQueue(c);},
          download:async source=>{
            const job=await startJob({url:source.url,referer:source.referer,filename:item.filename.trim(),quality,connections:c.settings.connections,folder:c.settings.folder,module:item.moduleFolder,title:item.title});
            update({jobId:job.id,message:`${label} • Baixando: ${item.filename}`});try{return await job.done;}finally{update({jobId:undefined});}
          }});
        if(result.type==='complete'||result.code==='destination_exists'){item.status='done';item.message=result.type==='complete'?'':T.exists;update({completed:run.completed+1});await saveQueue(c);continue;}
        if(result.type==='cancelled'){item.status='pending';item.message='';stopping=true;await saveQueue(c);break;}
        item.status='failed';item.message=result.message;last=result;update({failed:run.failed+1});await saveQueue(c);
        if(!continueOnError||['native_unavailable','resolver_disconnected'].includes(result.code))break;
      }
    }catch(error){fatal=error;}
    finally{
      try{await resolver?.close();}catch{/* Aba auxiliar já fechada. */}
      resolver=null;active=null;native.release('course');
      const remaining=c.items.filter(i=>i.selected!==false&&i.status!=='done').length;
      const done=`${run.completed} aula(s) salva(s) nesta execução. Progresso preservado.`;
      const end=fatal?{status:'interrupted',message:`Não foi possível continuar a fila: ${hideUrls(fatal.message)} Progresso preservado.`}
        :stopping?{status:'interrupted',message:`Fila interrompida. ${done}`}
        :last?.code==='native_unavailable'?{status:'interrupted',message:`Fila interrompida: ${hideUrls(last.message)} Progresso preservado.`}
        :run.failed?{status:'finished',message:`Fila encerrada: ${run.completed} aula(s) salva(s), ${remaining} pendente(s). ${hideUrls(last?.message)}`.trim()}
        :{status:'finished',message:`Concluído: ${run.completed} aula(s) salva(s) nesta execução.`};
      stopping=false;update({...end,jobId:undefined});await saveRun();
    }
  }

  // continueOnError explícito (painel) vence; sem ele (popup) vale o do snapshot, que por padrão é true.
  async function start(tabId,{quality:q='best',lessons,folder,continueOnError:explicit}={}){
    const tab=await chrome.tabs.get(tabId);const key=queueKey(tab.url);
    const active=starting||(BUSY.has(run.status)?run.key:null);if(active)throw blocked(active===key?T.same:T.other);
    starting=key;
    try{
      const saved=await loadSnapshot(tab.url);let items;let course={};
      if(lessons)items=queueSnapshot(tab.url,lessons).items;
      else{const read=await readPage(tabId,true);course=read.course;if(!read.lessons.length)throw blocked(T.none);items=merge(read.lessons,saved,true);}
      const dir=folderName(folder??(saved?.folder||course.category));
      const pending=items.filter(i=>i.selected!==false&&i.status!=='done');
      const reason=reasonFor({key,folder:dir,course,pending});if(reason)throw blocked(reason);
      // Aviso de lista mudada no máximo uma vez por contagem nova: views entre os cliques não prendem o usuário.
      if(!lessons&&totals.has(key)&&totals.get(key)!==items.length&&warned.get(key)!==items.length){warned.set(key,items.length);totals.set(key,items.length);throw blocked(T.changed);}
      totals.set(key,items.length);if(!pending.length)throw blocked(T.empty);
      const level=QUALITIES.includes(q)?q:'best';const keepGoing=typeof explicit==='boolean'?explicit:saved?.continueOnError!==false;
      begin({key,page:tab.url,items,settings:{folder:dir,quality:level,connections:saved?.connections??8,continueOnError:keepGoing,incomplete:false}},pending,{quality:level,continueOnError:keepGoing});
    }finally{starting=null;}
  }

  async function resume(){
    if(starting||BUSY.has(run.status))throw blocked(T.other);
    if(!run.key)throw blocked(T.lost);
    const key=run.key;const page=key.slice('sirmQueue:'.length);starting=key;
    try{
      const saved=await loadSnapshot(page);if(!saved)throw blocked(T.lost);
      const pending=saved.items.filter(i=>i.selected!==false&&i.status!=='done');
      if(!pending.length){run={status:'finished',key,title:saved.folder,index:0,total:0,completed:0,failed:0,message:T.empty};emit();await saveRun();return;}
      const reason=reasonFor({key,folder:saved.folder,pending});if(reason)throw blocked(reason);
      begin({key,page,items:saved.items,settings:saved},pending,{quality:QUALITIES.includes(quality)?quality:saved.quality,continueOnError:saved.continueOnError});
    }finally{starting=null;}
  }

  function stop(){
    if(run.status!=='running')return;
    stopping=true;update({status:'stopping',message:'Interrompendo a fila…'});
    resolver?.stop();if(run.jobId&&![...manual.values()].some(m=>m.id===run.jobId))downloads.cancel(run.jobId);wake?.();halt?.();
  }

  async function restore(){
    try{
      const record=(await storage.get('sirmRun')).sirmRun;
      if(BUSY.has(run.status)||starting||typeof record?.key!=='string'||!record.key.startsWith('sirmQueue:')||!['running','stopping','interrupted'].includes(record.status))return;
      quality=QUALITIES.includes(record.quality)?record.quality:'best';
      const saved=await loadSnapshot(record.key.slice('sirmQueue:'.length));
      run={status:'interrupted',key:record.key,...(saved?.folder?{title:saved.folder}:{}),index:count(record.index),total:count(record.total),completed:count(record.completed),failed:count(record.failed),message:'Interrompido — clique em Retomar para continuar.'};
      emit();if(record.status!=='interrupted')await saveRun();
    }catch{/* Sem registro legível: continua ocioso. */}
  }

  function markDone(page,url,message,seed){
    chain=chain.catch(()=>{}).then(async()=>{
      const key=queueKey(page);
      if(current?.key===key&&BUSY.has(run.status)){const item=current.items.find(i=>i.url===url);if(item){item.status='done';item.message=message;await storage.set({[key]:queueSnapshot(current.page,current.items,current.settings)});return;}}
      const saved=await loadSnapshot(page);
      const items=saved?.items.some(i=>i.url===url)?saved.items:merge(seed.items,saved);
      const item=items.find(i=>i.url===url);if(!item)return;item.status='done';item.message=message;
      await storage.set({[key]:queueSnapshot(page,items,saved||seed.settings)});
    }).catch(()=>{/* Marcar como baixada é melhor esforço. */});
    return chain;
  }

  async function downloadCurrent(tabId,{quality:q='best',source}={}){
    const tab=await chrome.tabs.get(tabId);const id=classIdOf(tab.url);if(!id)throw notCourse();
    const saved=await loadSnapshot(tab.url);let item=saved?.items.find(i=>classIdOf(i.url)===id);let folder=saved?.folder;let seed={items:saved?.items||[],settings:saved};
    if(!item||!folder){
      let read;try{read=await readPage(tabId,true);}catch{throw notCourse();}
      const items=merge(read.lessons,saved);item=items.find(i=>classIdOf(i.url)===id);if(!item)throw notCourse();
      folder=folder||folderName(read.course.category);if(!folder)throw blocked(T.category);
      seed={items,settings:{...(saved||{}),folder,quality:q}};
    }
    if(BUSY.has(run.status)&&current?.key===queueKey(tab.url)&&active===item.url){if(run.jobId)return {id:run.jobId};throw blocked(T.queued);}
    const mine=manual.get(item.url);if(mine)return {id:mine.id};
    const job=downloads.start({url:source?.url,referer:source?.referer,filename:item.filename.trim(),quality:QUALITIES.includes(q)?q:'best',connections:saved?.connections??8,folder,module:item.moduleFolder,title:item.title});
    const url=item.url;const entry={id:job.id,done:Promise.resolve(job.done).catch(()=>null)};manual.set(url,entry);
    // A entrada só sai depois de marcar a aula: a fila que chegar nela antes disso reaproveita o resultado.
    void entry.done.then(async result=>{try{if(result?.type==='complete'||result?.code==='destination_exists')await markDone(tab.url,url,result.type==='complete'?'':T.exists,seed);}finally{if(manual.get(url)===entry)manual.delete(url);}});
    return {id:job.id};
  }

  return {inspect,start,downloadCurrent,stop,resume,restore,state,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
