import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {FrameDecoder,encodeFrame} from '../native/core.mjs';

const product=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const installed=path.join(process.env.LOCALAPPDATA || os.homedir(),'TurboVideo','native','config.json');
const enabled=fs.existsSync(installed);
test('native host: real probe, ranged download, HLS, audio extraction, cancellation and resumption', {skip:!enabled,timeout:180000}, async t=>{
  const config=JSON.parse(fs.readFileSync(installed,'utf8'));
  const work=path.join(product,'work');fs.mkdirSync(work,{recursive:true});
  const sandbox=fs.mkdtempSync(path.join(work,'integration-'));
  const media=path.join(sandbox,'media');const output=path.join(sandbox,'downloads');const native=path.join(sandbox,'native');
  for(const p of [media,output,native])fs.mkdirSync(p,{recursive:true});
  const sample=path.join(media,'sample.mp4');
  const ff=spawnSync(config.ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=640x360:rate=24','-f','lavfi','-i','sine=frequency=500:sample_rate=44100','-t','12','-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart',sample],{windowsHide:true,encoding:'utf8'});
  assert.equal(ff.status,0,ff.stderr);
  const hls=spawnSync(config.ffmpeg,['-hide_banner','-loglevel','error','-i',sample,'-c','copy','-f','hls','-hls_time','2','-hls_playlist_type','vod',path.join(media,'index.m3u8')],{windowsHide:true,encoding:'utf8'});
  assert.equal(hls.status,0,hls.stderr);
  const dash=spawnSync(config.ffmpeg,['-hide_banner','-loglevel','error','-i',sample,'-map','0:v','-map','0:a','-c','copy','-f','dash','-seg_duration','2','-adaptation_sets','id=0,streams=v id=1,streams=a','manifest.mpd'],{windowsHide:true,encoding:'utf8',cwd:media});
  assert.equal(dash.status,0,dash.stderr);
  let rangeRequests=0;let holdSlow=false;
  const sockets=new Set();
  const server=http.createServer((req,res)=>{
    const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname.slice(1));
    const file=path.join(media,name==='slow.mp4'?'sample.mp4':name);
    if(!file.startsWith(media+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
    const stat=fs.statSync(file);let start=0;let end=stat.size-1;let code=200;
    const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
    if(range){rangeRequests++;start=Number(range[1]);end=range[2]?Math.min(end,Number(range[2])):end;code=206;}
    if(start>end){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
    const headers={'Content-Type':name.endsWith('.m3u8')?'application/vnd.apple.mpegurl':name.endsWith('.mpd')?'application/dash+xml':name.endsWith('.ts')?'video/mp2t':'video/mp4','Content-Length':end-start+1,'Accept-Ranges':'bytes','ETag':'"fixture-v1"'};
    if(code===206)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
    res.writeHead(code,headers);
    if(req.method==='HEAD'){res.end();return;}
    if(name==='slow.mp4'){
      const data=fs.readFileSync(file);let at=start;
      const timer=setInterval(()=>{if(at>end){clearInterval(timer);res.end();}else{if(holdSlow&&at>=start+1048576)return;res.write(data.subarray(at,Math.min(at+65536,end+1)));at+=65536;}},70);
      res.on('close',()=>clearInterval(timer));
    }else{const stream=fs.createReadStream(file,{start,end});stream.pipe(res);res.on('close',()=>stream.destroy());}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const name of ['core.mjs','host.mjs'])fs.copyFileSync(path.join(product,'native',name),path.join(native,name));
  fs.writeFileSync(path.join(native,'config.json'),JSON.stringify({...config,output}));
  const child=spawn(process.execPath,[path.join(native,'host.mjs'),`chrome-extension://${config.extensionId}/`],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  const messages=[];const decoder=new FrameDecoder();let errors='';
  child.stdout.on('data',chunk=>messages.push(...decoder.push(chunk)));child.stderr.on('data',d=>errors+=d.toString());
  async function waitFor(predicate,timeout=45000){const start=Date.now();while(Date.now()-start<timeout){const message=messages.find(predicate);if(message)return message;if(child.exitCode!==null)throw new Error(`Host exited: ${errors}`);await new Promise(r=>setTimeout(r,30));}throw new Error(`Timeout; ${JSON.stringify(messages)}; ${errors}`);}
  function send(value){child.stdin.write(encodeFrame(value));}
  async function download(id,url,quality='best',filename,folder,module){send({type:'download',id,url,quality,filename,folder,module,connections:4});const done=await waitFor(m=>m.id===id&&['complete','error','cancelled'].includes(m.type));assert.equal(done.type,'complete',done.message);assert.ok(fs.existsSync(path.join(done.folder,done.file)));return done;}
  try{
    await t.test('handshake and real metadata extraction',async()=>{send({type:'hello'});const ready=await waitFor(m=>m.type==='ready');assert.equal(ready.parallel,true);assert.equal(ready.version,'1.1.0');assert.equal(ready.name,'SirM Downloader Videos');assert.equal(ready.supportsFolders,true);assert.equal(ready.supportsModules,true);send({type:'probe',id:'probe',url:`${base}/sample.mp4`});const result=await waitFor(m=>m.id==='probe'&&['info','error'].includes(m.type));assert.equal(result.type,'info',result.message);assert.equal(result.drmOnly,false);});
    await t.test('ranged direct file preserves exact bytes',async()=>{const done=await download('direct',`${base}/sample.mp4`);assert.deepEqual(fs.readFileSync(path.join(output,done.file)),fs.readFileSync(sample));assert.ok(rangeRequests>0);assert.ok(messages.some(m=>m.id==='direct'&&m.type==='progress'));});
    await t.test('HLS manifest downloads as playable media',async()=>{const done=await download('hls',`${base}/index.m3u8`);const probe=spawnSync(config.ffmpeg,['-v','error','-i',path.join(output,done.file),'-f','null','-'],{windowsHide:true,encoding:'utf8'});assert.equal(probe.status,0,probe.stderr);});
    await t.test('DASH video and separate audio merge into a playable MKV',async()=>{const done=await download('dash',`${base}/manifest.mpd`);assert.match(done.file,/\.mkv$/);const result=spawnSync(path.join(path.dirname(config.ffmpeg),'ffprobe.exe'),['-v','error','-show_entries','stream=codec_type','-of','json',path.join(output,done.file)],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout).streams.map(s=>s.codec_type).sort(),['audio','video']);});
    await t.test('FFmpeg extracts actual MP3 audio',async()=>{const done=await download('audio',`${base}/sample.mp4`,'audio');assert.match(done.file,/\.mp3$/);const result=spawnSync(config.ffmpeg,['-v','error','-i',path.join(output,done.file),'-f','null','-'],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);});
    await t.test('custom Portuguese name is used exactly and an existing file cannot be overwritten',async()=>{
      const done=await download('named',`${base}/sample.mp4`,'best','Aula 01 - Introdução.mp4');
      assert.equal(done.file,'Aula 01 - Introdução.mp4');
      const bytes=fs.readFileSync(path.join(output,done.file));assert.deepEqual(bytes,fs.readFileSync(sample));
      send({type:'download',id:'exists',url:`${base}/other-source.mp4`,quality:'best',connections:4,filename:'Aula 01 - Introdução'});
      const failed=await waitFor(m=>m.id==='exists'&&m.type==='error');assert.match(failed.message,/Já existe/);
      assert.deepEqual(fs.readFileSync(path.join(output,done.file)),bytes);
      assert.equal(fs.readdirSync(output).some(name=>name==='.turbovideo-partials'),false);
    });
    await t.test('category folders separate identical filenames and refuse folder links or overwrite',async()=>{
      const first=await download('folder-social',`${base}/sample.mp4`,'best','01 - Introdução','Social Selling');
      const second=await download('folder-sdr',`${base}/sample.mp4`,'best','01 - Introdução','SDR');
      assert.equal(first.folder,path.join(output,'Social Selling'));assert.equal(second.folder,path.join(output,'SDR'));
      assert.deepEqual(fs.readFileSync(path.join(first.folder,first.file)),fs.readFileSync(sample));
      assert.deepEqual(fs.readFileSync(path.join(second.folder,second.file)),fs.readFileSync(sample));
      send({type:'download',id:'folder-exists',url:`${base}/sample.mp4`,quality:'best',connections:4,filename:'01 - Introdução',folder:'SDR'});
      assert.match((await waitFor(m=>m.id==='folder-exists'&&m.type==='error')).message,/Já existe/);
      const outside=path.join(sandbox,'outside');fs.mkdirSync(outside);fs.symlinkSync(outside,path.join(output,'Linked'),process.platform==='win32'?'junction':'dir');
      send({type:'download',id:'folder-link',url:`${base}/sample.mp4`,quality:'best',connections:4,filename:'Unsafe',folder:'Linked'});
      assert.match((await waitFor(m=>m.id==='folder-link'&&m.type==='error')).message,/link|dentro/);assert.deepEqual(fs.readdirSync(outside),[]);
    });
    await t.test('modules separate identical lesson names, reject overwrite and refuse category or module junctions before writing',async()=>{
      const first=await download('module-one',`${base}/sample.mp4`,'best','01 - Introdução','SDR','01 - Módulo 1');
      const second=await download('module-two',`${base}/sample.mp4`,'best','01 - Introdução','SDR','02 - Módulo 2');
      assert.equal(first.folder,path.join(output,'SDR','01 - Módulo 1'));
      assert.equal(second.folder,path.join(output,'SDR','02 - Módulo 2'));
      for(const done of [first,second])assert.deepEqual(fs.readFileSync(path.join(done.folder,done.file)),fs.readFileSync(sample));
      send({type:'download',id:'module-exists',url:`${base}/sample.mp4`,quality:'best',connections:4,filename:'01 - Introdução',folder:'SDR',module:'01 - Módulo 1'});
      assert.match((await waitFor(m=>m.id==='module-exists'&&m.type==='error')).message,/Já existe/);
      const outside=path.join(sandbox,'outside-modules');fs.mkdirSync(outside);
      fs.symlinkSync(outside,path.join(output,'Linked Category'),process.platform==='win32'?'junction':'dir');
      fs.symlinkSync(outside,path.join(output,'SDR','Linked Module'),process.platform==='win32'?'junction':'dir');
      for(const [id,folder,module] of [['category-junction','Linked Category','New Module'],['module-junction','SDR','Linked Module']]){
        send({type:'download',id,url:`${base}/sample.mp4`,quality:'best',connections:4,filename:'Never write',folder,module});
        assert.match((await waitFor(m=>m.id===id&&m.type==='error')).message,/link|dentro/);
        assert.deepEqual(fs.readdirSync(outside),[]);
        assert.equal(messages.some(m=>m.id===id&&m.type==='started'),false);
      }
    });
    await t.test('cancel stops transfer; partial file resumes correctly',async()=>{
      // Hold the transfer while the second host starts, even on a busy machine.
      holdSlow=true;
      send({type:'download',id:'cancel',url:`${base}/slow.mp4`,quality:'best',connections:1});
      await waitFor(m=>m.id==='cancel'&&m.type==='progress'&&m.phase==='downloading'&&m.downloaded>0);
      const second=spawn(process.execPath,[path.join(native,'host.mjs'),`chrome-extension://${config.extensionId}/`],{windowsHide:true,stdio:['pipe','pipe','pipe']});
      const secondDecoder=new FrameDecoder();const secondMessages=[];second.stdout.on('data',d=>secondMessages.push(...secondDecoder.push(d)));
      try{second.stdin.write(encodeFrame({type:'download',id:'conflict',url:`${base}/slow.mp4`,quality:'best',connections:1}));const start=Date.now();while(!secondMessages.length&&Date.now()-start<5000)await new Promise(r=>setTimeout(r,25));assert.equal(secondMessages[0]?.type,'error');assert.equal(secondMessages[0]?.code,'busy');assert.equal(secondMessages[0]?.retryable,false);}finally{second.stdin.end();await new Promise(resolve=>second.once('exit',resolve));}
      send({type:'cancel',id:'cancel'});
      const cancelled=await waitFor(m=>m.id==='cancel'&&['cancelled','error','complete'].includes(m.type));
      assert.equal(cancelled.type,'cancelled');assert.equal(cancelled.code,'cancelled');assert.equal(cancelled.retryable,false);
      holdSlow=false;
      assert.ok(fs.readdirSync(output).some(name=>name.includes('slow')&&name.endsWith('.part')));
      const done=await download('resume',`${base}/slow.mp4`);assert.deepEqual(fs.readFileSync(path.join(output,done.file)),fs.readFileSync(sample));
    });
  }finally{
    child.stdin.end();
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));
    console.log(`Integration artifacts: ${sandbox}; host exited=${child.exitCode !== null}`);
  }
});

test('native host structured failures, stalled processes and completion verification', {timeout:90000},async t=>{
  const compiler=path.join(process.env.SystemRoot||'C:\\Windows','Microsoft.NET','Framework64','v4.0.30319','csc.exe');
  if(process.platform!=='win32'||!fs.existsSync(compiler)){t.skip('The isolated fake downloader fixture requires the Windows .NET compiler.');return;}
  const work=path.join(product,'work');fs.mkdirSync(work,{recursive:true});
  const sandbox=fs.mkdtempSync(path.join(work,'host-diagnostics-'));
  const native=path.join(sandbox,'native'),output=path.join(sandbox,'output');fs.mkdirSync(native);fs.mkdirSync(output);
  const executable=path.join(sandbox,'fixture.exe'),source=path.join(sandbox,'fixture.cs');
  // Allow cold .NET startup under parallel-suite load. Keep the progress fixture
  // running longer than the transfer deadline so its watchdog assertion is real.
  const transferTimeoutMs=5000,processingTimeoutMs=6000,progressSteps=36,progressIntervalMs=175;
  const outside=path.join(sandbox,'outside.mp4');fs.writeFileSync(outside,'outside fixture');
  // This synthetic tool never accesses the network; its only writes are inside this sandbox.
  fs.writeFileSync(source,String.raw`
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
class Fixture {
  static string Json(string value) { return "\"" + value.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }
  static void Main(string[] args) {
    if (args.Length == 1 && args[0] == "grandchild") {
      while (true) { File.AppendAllText(Environment.GetEnvironmentVariable("DIAGNOSTIC_HEARTBEAT"),"x"); Thread.Sleep(40); }
    }
    string mode = new Uri(args[args.Length-1]).AbsolutePath.Trim('/');
    if (mode == "http403") { Console.Error.WriteLine("HTTP Error 403: https://private.invalid/a?token=SECRET Cookie: SECRET"); Environment.Exit(1); }
    if (mode == "missing") { return; }
    if (mode == "outside") { Console.WriteLine("__FILE__" + Json(Environment.GetEnvironmentVariable("DIAGNOSTIC_OUTSIDE"))); return; }
    if (mode == "stall" || mode == "processing") {
      if (mode == "stall") {
        var child = Process.Start(new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"grandchild") { UseShellExecute=false,CreateNoWindow=true });
        File.WriteAllText(Environment.GetEnvironmentVariable("DIAGNOSTIC_PID"),child.Id.ToString());
      }
      Console.WriteLine("__PROGRESS__{\"status\":\"" + (mode == "processing" ? "finished" : "downloading") + "\",\"downloaded_bytes\":1}");
      while (true) { Console.Error.WriteLine("retrying without byte progress SECRET"); Thread.Sleep(40); }
    }
    int location=Array.IndexOf(args,"--paths");
    string template=args[Array.IndexOf(args,"-o")+1];
    string file=Path.Combine(args[location+1],template.Replace("%(ext)s","mp4"));
    if (mode == "progress") {
      for (int i=1;i<=${progressSteps};i++) { Console.WriteLine("__PROGRESS__{\"status\":\"downloading\",\"downloaded_bytes\":"+i+"}"); Thread.Sleep(${progressIntervalMs}); }
    }
    File.WriteAllText(file,mode == "empty" ? "" : "synthetic complete file");
    Console.WriteLine("__FILE__"+Json(file));
  }
}`);
  const compiled=spawnSync(compiler,['/nologo','/target:exe',`/out:${executable}`,source],{windowsHide:true,encoding:'utf8',timeout:30000});
  assert.equal(compiled.status,0,compiled.stdout+compiled.stderr);
  for(const name of ['core.mjs','host.mjs'])fs.copyFileSync(path.join(product,'native',name),path.join(native,name));
  const extensionId='diagnostics-only',heartbeat=path.join(sandbox,'heartbeat'),pidFile=path.join(sandbox,'descendant.pid');
  fs.writeFileSync(path.join(native,'config.json'),JSON.stringify({extensionId,output,ytdlp:executable,node:process.execPath,ffmpeg:executable,transferTimeoutMs,processingTimeoutMs}));
  const child=spawn(process.execPath,[path.join(native,'host.mjs'),`chrome-extension://${extensionId}/`],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,DIAGNOSTIC_OUTSIDE:outside,DIAGNOSTIC_HEARTBEAT:heartbeat,DIAGNOSTIC_PID:pidFile}});
  const messages=[],decoder=new FrameDecoder();let stderr='';
  child.stdout.on('data',data=>messages.push(...decoder.push(data)));child.stderr.on('data',data=>stderr+=data.toString());
  const send=data=>child.stdin.write(encodeFrame(data));
  const done=async id=>{
    const deadline=Date.now()+20000;
    while(Date.now()<deadline){const result=messages.find(m=>m.id===id&&['error','complete','cancelled'].includes(m.type));if(result)return result;if(child.exitCode!==null)assert.fail('Host exited unexpectedly: '+stderr);await new Promise(r=>setTimeout(r,20));}
    assert.fail('Diagnostic host did not settle: '+id);
  };
  const download=(id,mode)=>send({id,type:'download',url:'https://fixture.invalid/'+mode,filename:id,folder:'SDR',module:'Fixture',quality:'best',connections:1});
  try{
    await t.test('HTTP failure is classified and validation never returns raw input',async()=>{
      download('forbidden','http403');const failure=await done('forbidden');assert.equal(failure.code,'http_403');assert.equal(failure.retryable,true);
      assert.doesNotMatch(JSON.stringify(failure),/SECRET|private\.invalid|Cookie:/);
      send({type:'download',id:'invalid',url:'file:///SECRET',quality:'best',connections:1});
      const invalid=await done('invalid');assert.equal(invalid.code,'invalid_request');assert.equal(invalid.retryable,false);assert.doesNotMatch(JSON.stringify(invalid),/SECRET/);
    });
    await t.test('watchdog ignores repeated stderr, kills owned process tree and releases locks exactly once',async()=>{
      download('stalled','stall');const failure=await done('stalled');assert.equal(failure.code,'transfer_stalled');assert.equal(failure.retryable,true);
      assert.deepEqual(fs.readdirSync(path.join(native,'locks')),[]);
      assert.ok(fs.existsSync(heartbeat),'The owned descendant ran before cancellation');
      const size=fs.statSync(heartbeat).size;await new Promise(r=>setTimeout(r,250));assert.equal(fs.statSync(heartbeat).size,size);
      assert.equal(messages.filter(m=>m.id==='stalled'&&['error','complete','cancelled'].includes(m.type)).length,1);
    });
    await t.test('processing has its own deadline and real byte progress prevents transfer timeout',async()=>{
      download('processing','processing');assert.equal((await done('processing')).code,'processing_stalled');
      const started=Date.now();download('advancing','progress');assert.equal((await done('advancing')).type,'complete');
      assert.ok(Date.now()-started>transferTimeoutMs,'Transfer made real byte progress beyond its inactivity deadline');
    });
    await t.test('exit zero without a file, empty file and an outside path cannot report complete',async()=>{
      for(const [id,mode,code] of [['missing','missing','output_missing'],['empty','empty','output_missing'],['outside','outside','output_invalid']]){
        download(id,mode);const failure=await done(id);assert.equal(failure.type,'error');assert.equal(failure.code,code);assert.doesNotMatch(JSON.stringify(failure),/outside\.mp4|host-diagnostics-/);
      }
      download('complete','valid');const result=await done('complete');assert.equal(result.type,'complete');assert.equal(result.folder,path.join(output,'SDR','Fixture'));
      assert.ok(fs.statSync(path.join(result.folder,result.file)).size>0);
      download('complete','valid');
      const start=Date.now();while(messages.filter(m=>m.id==='complete'&&m.type==='error').length===0&&Date.now()-start<3000)await new Promise(r=>setTimeout(r,20));
      const collision=messages.find(m=>m.id==='complete'&&m.type==='error');assert.equal(collision.code,'destination_exists');assert.equal(collision.retryable,false);
    });
  }finally{
    child.stdin.end();
    await new Promise(resolve=>{if(child.exitCode!==null)return resolve();const timer=setTimeout(()=>{child.kill();resolve();},5000);child.once('exit',()=>{clearTimeout(timer);resolve();});});
    if(fs.existsSync(pidFile)){
      const pid=Number(fs.readFileSync(pidFile,'utf8'));let live=false;try{process.kill(pid,0);live=true;}catch{/* Owned descendant already stopped. */}
      if(live)spawnSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe'),['/PID',String(pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    }
    console.log(`Diagnostic artifacts: ${sandbox}; host exited=${child.exitCode!==null}`);
  }
});
