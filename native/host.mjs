import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {FrameDecoder, encodeFrame, validateRequest, buildArgs, summarize,destinationKey,parseTransferLine,outputDirectory,classifyFailure,watchdogTimeouts} from './core.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
const allowedIds=[config.extensionId,...(Array.isArray(config.extensionIds)?config.extensionIds:[])];
if (!allowedIds.some(id=>process.argv[2] === `chrome-extension://${id}/`)) process.exit(2);
const jobs = new Map();
const deadlines=watchdogTimeouts(config);
let shuttingDown = false;
function send(message) { if (!shuttingDown) process.stdout.write(encodeFrame(message)); }
function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn(path.join(process.env.SystemRoot || 'C:\\Windows','System32','taskkill.exe'),['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    killer.on('error',()=>child.kill());
    killer.on('close',code=>{if(code&&child.exitCode===null)child.kill();});
  } else {try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}
}
function launch(request) {
  if (jobs.size >= 3) throw new Error('Já existem três tarefas em andamento. Aguarde ou cancele uma.');
  if (!request.id || jobs.has(request.id)) throw new Error('Identificador de tarefa inválido ou repetido.');
  const probing = request.type === 'probe';
  const output=outputDirectory(request,config);let expectedOutput='';
  if(!probing){
    fs.mkdirSync(config.output,{recursive:true});
    let parent=fs.realpathSync(config.output);
    for(const name of [request.folder,request.module].filter(Boolean)){
      const level=path.join(parent,name);
      let stat;try{stat=fs.lstatSync(level);}catch(error){if(error.code!=='ENOENT')throw error;}
      if(stat?.isSymbolicLink())throw new Error('A pasta de destino é um link. Escolha outra pasta.');
      if(stat&&!stat.isDirectory())throw new Error('O destino precisa ser uma pasta.');
      if(!stat)fs.mkdirSync(level);
      if(fs.lstatSync(level).isSymbolicLink())throw new Error('A pasta de destino é um link. Escolha outra pasta.');
      const resolved=fs.realpathSync(level);
      if(path.dirname(resolved).toLowerCase()!==parent.toLowerCase())throw new Error('A pasta precisa ficar dentro de SirM Downloader Videos.');
      parent=resolved;
    }
    if(fs.realpathSync(output).toLowerCase()!==parent.toLowerCase())throw new Error('A pasta precisa ficar dentro de SirM Downloader Videos.');
    expectedOutput=parent;
  }
  if(!probing && request.filename){
    const existing=fs.readdirSync(output,{withFileTypes:true}).some(file=>file.isFile() && path.parse(file.name).name.normalize('NFC').toLowerCase()===request.filename.toLowerCase());
    if(existing)throw new Error('Já existe um arquivo com esse nome na pasta de downloads. Escolha outro nome.');
  }
  let lock='';
  if(!probing){
    const directory=path.join(root,'locks');fs.mkdirSync(directory,{recursive:true});
    lock=path.join(directory,destinationKey(request)+'.lock');
    for(let attempt=0;attempt<2;attempt++){
      try{fs.writeFileSync(lock,String(process.pid),{flag:'wx'});break;}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        const pid=Number(fs.readFileSync(lock,'utf8'));
        let active=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')active=false;}
        if(active||attempt)throw new Error('Este vídeo e qualidade já estão sendo baixados em outro painel.',{cause:error});
        fs.unlinkSync(lock);
      }
    }
  }
  let child;
  try{child=spawn(config.ytdlp,buildArgs(request,{...config,temp:path.join(root,'partials')}),{windowsHide:true,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});}
  catch(error){if(lock)fs.unlinkSync(lock);throw error;}
  const job = {child,cancelled:false}; jobs.set(request.id,job);
  let stdout='',stderr='',resultFile='',failure=null,settled=false,phase='transfer',lastActivity=Date.now(),lastBytes=-1;
  const abort=code=>{if(!failure&&!job.cancelled){failure=classifyFailure('',{code});stop(child);}};
  const timer=probing?setTimeout(()=>abort('probe_timeout'),90000):setInterval(()=>{
    if(Date.now()-lastActivity>(phase==='processing'?deadlines.processingMs:deadlines.transferMs))abort(phase==='processing'?'processing_stalled':'transfer_stalled');
  },Math.max(25,Math.min(1000,Math.min(deadlines.transferMs,deadlines.processingMs)/4)));
  job.timer=timer;
  const processing=()=>{if(phase!=='processing'){phase='processing';lastActivity=Date.now();}};
  child.stderr.on('data',data=>{ stderr = (stderr + data.toString('utf8')).slice(-8000); });
  if (probing) child.stdout.on('data',data=>{
    stdout += data.toString('utf8');
    if (stdout.length > 16 * 1024 * 1024)abort('response_too_large');
  });
  const parseLine=line=>{
    try {
      const p=parseTransferLine(line);
      if (p&&!failure&&!job.cancelled) {
        const bytes=Number(p.downloaded_bytes);
        if(p.status==='finished')processing();
        else if(Number.isFinite(bytes)&&bytes!==lastBytes){phase='transfer';lastActivity=Date.now();lastBytes=bytes;}
        send({id:request.id,type:'progress',downloaded:p.downloaded_bytes || 0,total:p.total_bytes || p.total_bytes_estimate || 0,speed:p.speed || 0,eta:p.eta ?? null,phase:p.status});
      } else if (line.startsWith('__FILE__')&&!failure&&!job.cancelled) {
        resultFile=JSON.parse(line.slice(8));
        processing();
        send({id:request.id,type:'processing',message:'Finalizando arquivo…'});
      }else if(/^\[(?:Merger|ffmpeg|Fixup|ExtractAudio|VideoConvertor|VideoRemuxer|Metadata|EmbedThumbnail)/i.test(line))processing();
    } catch { /* Ignore non-protocol tool output. */ }
  };
  if(!probing){
    readline.createInterface({input:child.stdout}).on('line',parseLine);
    readline.createInterface({input:child.stderr}).on('line',parseLine);
  }
  child.on('error',error=>{if(!failure&&!job.cancelled)failure=classifyFailure('',{code:error.code});});
  child.on('close',code=>{
    if(settled)return;settled=true;clearTimeout(timer);clearInterval(timer);
    if(lock){try{fs.unlinkSync(lock);}catch{/* A later attempt can recover a stale lock. */}}
    jobs.delete(request.id);
    if (job.cancelled) {send({id:request.id,type:'cancelled',...classifyFailure('',{code:'cancelled'})});return;}
    if(failure){send({id:request.id,type:'error',...failure});return;}
    if (code !== 0) {
      send({id:request.id,type:'error',...classifyFailure(stderr)});return;
    }
    if (probing) {
      try { send({id:request.id,type:'info',...summarize(JSON.parse(stdout))}); }
      catch { send({id:request.id,type:'error',...classifyFailure('',{code:'invalid_metadata'})}); }
    } else {
      let outputFailure='';
      try{
        if(typeof resultFile!=='string'||!resultFile||!path.isAbsolute(resultFile))outputFailure='output_missing';
        else if(fs.lstatSync(resultFile).isSymbolicLink()||path.dirname(fs.realpathSync(resultFile)).toLowerCase()!==expectedOutput.toLowerCase()||fs.realpathSync(output).toLowerCase()!==expectedOutput.toLowerCase())outputFailure='output_invalid';
        else {const stat=fs.statSync(resultFile);if(!stat.isFile()||stat.size===0)outputFailure='output_missing';}
      }catch{outputFailure='output_missing';}
      if(outputFailure)send({id:request.id,type:'error',...classifyFailure('',{code:outputFailure})});
      else send({id:request.id,type:'complete',file:path.basename(resultFile),folder:output});
    }
  });
  send({id:request.id,type:'started'});
}
function handle(input) {
  let request;
  try{request=validateRequest(input);}catch(error){send({id:typeof input?.id==='string'?input.id.slice(0,80):'',type:'error',...classifyFailure('',{code:error.code==='unsupported_site'?'unsupported_site':'invalid_request'})});return;}
  try {
    if (request.type === 'hello') send({type:'ready',version:'1.1.0',name:'SirM Downloader Videos',folder:config.output,parallel:!!config.aria2,supportsFilename:true,supportsFolders:true,supportsModules:true});
    else if (request.type === 'cancel') {const job=jobs.get(request.id); if(job){job.cancelled=true;stop(job.child);}}
    else if (request.type === 'openFolder') {
      const child=spawn(path.join(process.env.SystemRoot || 'C:\\Windows','explorer.exe'),[config.output],{windowsHide:true,stdio:'ignore'});
      child.on('error',()=>send({type:'error',...classifyFailure('',{code:'permission_denied'})}));child.unref();
    } else launch(request);
  } catch(error) { send({id:request.id,type:'error',...classifyFailure(error,{code:error.code})}); }
}
const decoder=new FrameDecoder();
process.stdin.on('data',chunk=>{try{for(const message of decoder.push(chunk))handle(message);}catch{shutdown();}});
function shutdown(){if(shuttingDown)return;shuttingDown=true;for(const job of jobs.values())stop(job.child);process.stdin.destroy();}
process.stdin.on('end',shutdown);process.stdin.on('error',shutdown);process.stdout.on('error',shutdown);
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
