// View model puro do popup (sem chrome): decide modo, cartão da aula, cartão do curso e rodapé.
import {preferredSource,blockedSite} from './media.mjs';

export const TEXT_EMPTY='Nenhum vídeo detectado ainda — dê play no vídeo';
export const TEXT_UNSUPPORTED='Abra uma página com vídeo para baixar.';
export const TEXT_YOUTUBE='O YouTube não é suportado, conforme a política da Chrome Web Store. Use em sites e cursos cujo conteúdo você tem direito de baixar.';
export const TEXT_INSTALL='Instale o auxiliar local: baixe-o no GitHub Releases e execute Instalar.cmd.';

const ACTIVE=new Set(['starting','downloading','processing']);
const FAILED=new Set(['error','interrupted']);
const BUSY_RUN=new Set(['running','stopping']);
const parse=url=>{try{return new URL(url);}catch{return null;}};

function lessonView({tab,host,sources,domSources,course,jobs,lessonJobId}){
  const job=lessonJobId==null?null:jobs.find(j=>j.id===lessonJobId)||null;
  const current=course?.currentLesson;
  const base={title:current?.filename||tab?.title||host};
  if(job){
    if(ACTIVE.has(job.status))return {...base,state:'busy',job};
    if(job.status==='complete')return {...base,state:'done',job};
    if(FAILED.has(job.status))return {...base,state:'error',job,message:job.message};
  }
  const source=preferredSource([...(sources?.items||[]),...(domSources||[])]);
  if(!source&&!current)return {...base,state:'empty',message:TEXT_EMPTY};
  return {...base,state:'ready'};
}

function courseView(course,run){
  if(!course)return null;
  const {total,done,pending}=course;const base={total,done,pending};
  const busy=BUSY_RUN.has(run?.status);
  if(busy&&run.key!==course.key)return {...base,state:'otherRunning',...(course.blocked?{message:course.blocked}:{})};
  if(busy)return {...base,state:'running',run};
  if(run?.status==='interrupted'&&run.key===course.key)return {...base,state:'interrupted',message:run.message,run};
  if(pending===0)return {...base,state:'complete'};
  if(course.blocked)return {...base,state:'blocked',message:course.blocked};
  return {...base,state:'ready'};
}

export function popupView({tab,sources,domSources=[],course=null,run={status:'idle'},jobs=[],native={state:'idle'},lessonJobId=null}={}){
  const url=parse(tab?.url);const http=!!url&&['http:','https:'].includes(url.protocol);
  const host=http?url.hostname:'';
  const footer={connected:native?.state==='ready'||(native?.state==='idle'&&!!native.info)};
  const mode=native?.state==='missing'?'install':!http?'unsupported':blockedSite(tab.url)?'youtube':'ready';
  const view={mode,host,footer,lesson:null,course:null};
  if(mode==='install')view.message=TEXT_INSTALL;
  else if(mode==='unsupported')view.message=TEXT_UNSUPPORTED;
  else if(mode==='youtube')view.message=TEXT_YOUTUBE;
  else{view.lesson=lessonView({tab,host,sources,domSources,course,jobs,lessonJobId});view.course=courseView(course,run);}
  return view;
}
