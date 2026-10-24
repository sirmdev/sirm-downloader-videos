const cancelled=()=>({type:'cancelled',code:'cancelled',retryable:false,message:'Fila interrompida pelo usuário.'});
export async function runLesson({resolveSource,download,ensureReady=async()=>{},onAttempt=()=>{},onRetry=()=>{},shouldStop=()=>false,wait,maxAttempts=3}){
  const pause=wait || (async ms=>{const end=Date.now()+ms;while(Date.now()<end&&!shouldStop())await new Promise(r=>setTimeout(r,Math.min(100,end-Date.now())));});
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    if(shouldStop())return cancelled();
    try{
      await onAttempt(attempt);await ensureReady();if(shouldStop())return cancelled();
      const source=await resolveSource();if(shouldStop())return cancelled();
      const result=await download(source);
      if(result?.type==='complete')return {...result,attempts:attempt};
      if(result?.type==='cancelled')return {...cancelled(),attempts:attempt};
      throw Object.assign(new Error(result?.message || 'A tarefa terminou sem confirmar o arquivo.'),{code:result?.code || 'download_failed',retryable:result?.retryable===true});
    }catch(error){
      if(shouldStop()||error.code==='cancelled')return cancelled();
      const failure={type:'error',message:String(error.message || 'Falha sem detalhes.'),code:error.code || 'unknown',retryable:error.retryable===true,attempts:attempt};
      if(!failure.retryable||attempt>=maxAttempts)return failure;
      await onRetry(failure,attempt);await pause(attempt*2000);
    }
  }
}

export function queueKey(page){const url=new URL(page);return 'sirmQueue:'+url.origin+url.pathname.replace(/\/$/,'');}
export function queueSnapshot(page,lessons,settings={}){
  const key=queueKey(page);const base=new URL(page);const items=[];
  for(const item of lessons.slice(0,2000)){
    try{
      const url=new URL(item.url);const id=url.searchParams.get('classId');
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.origin!==base.origin||url.pathname.replace(/\/$/,'')!==base.pathname.replace(/\/$/,'')||!id||!/^[\w-]{1,80}$/.test(id))continue;
      url.search='';url.hash='';url.searchParams.set('classId',id);
      items.push({url:url.href,title:String(item.title || '').slice(0,300),filename:String(item.filename || '').slice(0,120),module:String(item.module || '').slice(0,150),moduleIndex:Number.isInteger(item.moduleIndex)?item.moduleIndex:0,moduleFolder:String(item.moduleFolder || '').slice(0,80),selected:item.selected!==false,status:item.status==='done'?'done':item.status==='failed'?'failed':'pending',message:String(item.message || '').replace(/https?:\/\/\S+/gi,'[endereço oculto]').slice(0,500)});
    }catch{/* Ignore entries outside the selected course. */}
  }
  return {version:1,key,folder:String(settings.folder || '').slice(0,80),quality:['best','2160','1440','1080','720','480','audio'].includes(settings.quality)?settings.quality:'best',connections:[1,4,8,16].includes(settings.connections)?settings.connections:8,continueOnError:settings.continueOnError!==false,incomplete:settings.incomplete===true,items};
}
