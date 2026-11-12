// Gerenciador de downloads no service worker. Jobs nunca guardam URL/Referer; a chave de dedupe fica em mapa privado.
const ACTIVE=new Set(['starting','downloading','processing']);
const CANCELLED_TEXT='Cancelado. Arquivos parciais podem ser retomados ao baixar a mesma origem e qualidade.';
export function formatBytes(n){if(!n)return '—';const unit=n>=1048576?'MiB':'KiB';return `${(n/(unit==='MiB'?1048576:1024)).toFixed(1)} ${unit}`;}
export function createDownloadManager({native,limit=3}){
  const jobs=new Map();const keys=new Map();const dones=new Map();const resolvers=new Map();const cancelled=new Set();const listeners=new Set();
  const list=()=>[...jobs.values()].map(j=>({...j}));
  const emit=()=>{for(const fn of [...listeners])try{fn(list());}catch{/* falha isolada */}};
  const isActive=id=>ACTIVE.has(jobs.get(id)?.status);
  function finish(id,status,patch,result){
    if(!isActive(id))return;
    Object.assign(jobs.get(id),{status,speed:null,eta:null},patch);keys.delete(id);cancelled.delete(id);
    native.release('job:'+id);resolvers.get(id)?.(result);resolvers.delete(id);dones.delete(id);
    emit();
  }
  function onMessage(message){
    const job=jobs.get(message?.id);if(!job||!ACTIVE.has(job.status))return;
    if(message.type==='progress'){
      const finished=message.phase==='finished';
      job.status=finished?'processing':'downloading';job.percent=message.total?Math.min(100,message.downloaded/message.total*100):null;
      job.speed=message.speed??null;job.eta=message.eta??null;
      job.message=finished?'Transferência concluída; processando e unindo arquivos…':`${formatBytes(message.downloaded)} / ${formatBytes(message.total)} • ${formatBytes(message.speed)}/s${message.eta!=null?' • '+message.eta+'s restantes':''}`;
      emit();
    }else if(message.type==='processing'){job.status='processing';job.message=message.message;emit();}
    else if(message.type==='complete'){const file=message.file||'arquivo concluído';finish(message.id,'complete',{percent:100,message:`Salvo: ${file}`,file},{type:'complete',file,folder:message.folder});}
    else if(message.type==='error')finish(message.id,'error',{percent:0,message:message.message},{type:'error',code:message.code,retryable:!!message.retryable,message:message.message});
    else if(message.type==='cancelled')finish(message.id,'cancelled',{percent:0,message:CANCELLED_TEXT},{type:'cancelled'});
  }
  function onStatus(status){
    if(status.state!=='disconnected')return;
    for(const job of list())if(ACTIVE.has(job.status))finish(job.id,'interrupted',{message:'Interrompido: conexão com o auxiliar encerrada.'},{type:'error',code:'native_disconnected',retryable:true,message:'A conexão com o auxiliar foi encerrada.'});
  }
  native.onMessage(onMessage);native.onStatus(onStatus);
  function start({url,referer,filename='',quality,connections=8,folder='',module='',title}){
    const key=[url,folder,module,filename,quality].join('|');
    for(const [id,k] of keys)if(k===key&&isActive(id))return {id,done:dones.get(id)};
    if(list().filter(j=>ACTIVE.has(j.status)).length>=limit)throw Object.assign(new Error('Aguarde ou cancele uma das três tarefas em andamento.'),{code:'limit'});
    for(const [old,j] of jobs){if(jobs.size<50)break;if(!ACTIVE.has(j.status))jobs.delete(old);}
    const id=crypto.randomUUID();
    jobs.set(id,{id,title:title||'Download',status:'starting',percent:null,speed:null,eta:null,message:'Conectando ao servidor…',file:''});keys.set(id,key);
    const done=new Promise(r=>resolvers.set(id,r));dones.set(id,done);
    native.hold('job:'+id);emit();
    const fail=(code,message)=>finish(id,'error',{percent:0,message},{type:'error',code,retryable:code==='native_disconnected',message});
    native.ensureReady().then(info=>{
      if(!isActive(id))return;
      if(cancelled.has(id))return finish(id,'cancelled',{percent:0,message:CANCELLED_TEXT},{type:'cancelled'});
      if(folder&&!info?.supportsFolders)return fail('native_outdated','Atualize o auxiliar com suporte a pastas.');
      if(module&&!info?.supportsModules)return fail('native_outdated','Atualize o auxiliar com suporte a módulos.');
      if(!native.send({type:'download',id,url,referer,filename,quality,connections,folder,module}))fail('native_disconnected','Auxiliar desconectado.');
    },error=>fail(error.code||'native_unavailable',error.message));
    return {id,done};
  }
  function cancel(id){
    if(!isActive(id))return;
    cancelled.add(id);jobs.get(id).message='Cancelando…';native.send({type:'cancel',id});emit();
  }
  return {start,cancel,list,onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);}};
}
