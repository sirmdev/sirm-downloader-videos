import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import * as nativeCore from '../native/core.mjs';
import { FrameDecoder, encodeFrame, validateRequest, buildArgs, summarize,parseTransferLine,normalizeFilename,destinationKey,downloadKey } from '../native/core.mjs';

test('classifies transfer failures without returning URLs, credentials or raw tool output',()=>{
  assert.equal(typeof nativeCore.classifyFailure,'function');
  const cases=[
    ['HTTP Error 401: Unauthorized','http_401',true],['HTTP Error 403: Forbidden','http_403',true],
    ['HTTP Error 429: Too Many Requests','http_429',true],['HTTP Error 503: Service Unavailable','http_5xx',true],
    ['HTTP/1.1 502 Bad Gateway','http_5xx',true],['Sign in to confirm your access','authentication_required',false],
    ['Read timed out','network_timeout',true],['Connection reset by peer','network_error',true],
    ['This video is DRM protected','drm_unsupported',false],['[Errno 28] No space left on device','disk_full',false],
    ['ffmpeg not found. Please install','tool_missing',false],['Unsupported URL: https://private.test','unsupported_url',false],
    ['Já existe um arquivo com esse nome','destination_exists',false],['unknown tool failure','download_failed',false]
  ];
  for(const [text,code,retryable] of cases){
    const result=nativeCore.classifyFailure(text+' https://user:SECRET@private.test/a?token=SECRET Cookie: SECRET');
    assert.equal(result.code,code,text);assert.equal(result.retryable,retryable,text);assert.equal(typeof result.message,'string');
    assert.doesNotMatch(JSON.stringify(result),/SECRET|private\.test|https?:|Cookie:/);
  }
  assert.deepEqual(nativeCore.classifyFailure('https://private.test/403'),nativeCore.classifyFailure('unknown tool failure'));
  assert.equal(nativeCore.classifyFailure('',{code:'ENOENT'}).code,'tool_missing');
  assert.equal(nativeCore.classifyFailure('',{code:'ENOSPC'}).code,'disk_full');
  assert.equal(nativeCore.classifyFailure('',{code:'ETIMEDOUT'}).code,'network_timeout');
  assert.equal(nativeCore.classifyFailure('',{code:'ECONNRESET'}).retryable,true);
  assert.equal(nativeCore.classifyFailure('',{code:'invalid_request'}).retryable,false);
  assert.equal(nativeCore.classifyFailure('',{code:'transfer_stalled'}).retryable,true);
  assert.equal(nativeCore.classifyFailure('',{code:'cancelled'}).retryable,false);
});

test('watchdog configuration has safe defaults and bounded testable transfer/processing deadlines',()=>{
  assert.equal(typeof nativeCore.watchdogTimeouts,'function');
  assert.deepEqual(nativeCore.watchdogTimeouts({}),{transferMs:180000,processingMs:600000});
  assert.deepEqual(nativeCore.watchdogTimeouts({transferTimeoutMs:250,processingTimeoutMs:400}),{transferMs:250,processingMs:400});
  assert.deepEqual(nativeCore.watchdogTimeouts({transferTimeoutMs:0,processingTimeoutMs:'SECRET'}),{transferMs:180000,processingMs:600000});
  assert.deepEqual(nativeCore.watchdogTimeouts({transferTimeoutMs:1,processingTimeoutMs:1e15}),{transferMs:100,processingMs:3600000});
});

test('category folders are validated and isolate output, locks and partial files',()=>{
  const request={type:'download',url:'https://example.org/a',quality:'best',connections:8,filename:'01 - Introdução',folder:'Social Selling'};
  assert.equal(validateRequest(request).folder,'Social Selling');
  const config={output:'C:/Videos',ffmpeg:'ffmpeg',node:'node',temp:'C:/Temp'};
  const args=buildArgs(request,config);
  assert.equal(args[args.indexOf('--paths')+1],path.join(config.output,'Social Selling'));
  assert.notEqual(destinationKey(request),destinationKey({...request,folder:'SDR'}));
  assert.notEqual(downloadKey(request),downloadKey({...request,folder:'SDR'}));
  for(const folder of ['../outside','C:\\elsewhere','a/b','a\\b','..','CON','NUL.mp4','x\n','a'.repeat(81)])assert.throws(()=>validateRequest({...request,folder}));
  assert.equal(validateRequest({...request,folder:undefined}).folder,'');
});

test('modules add exactly one validated level and isolate destinations from other modules',()=>{
  const request={type:'download',url:'https://example.org/a',quality:'best',connections:8,filename:'01 - Abordagem',folder:'SDR',module:'01 - Módulo 1 - Introdução'};
  assert.equal(validateRequest(request).module,request.module);
  const config={output:'C:/Videos',ffmpeg:'ffmpeg',node:'node'};const args=buildArgs(request,config);
  assert.equal(args[args.indexOf('--paths')+1],path.join(config.output,request.folder,request.module));
  assert.notEqual(destinationKey(request),destinationKey({...request,module:'02 - Módulo 2'}));
  assert.notEqual(downloadKey(request),downloadKey({...request,module:'02 - Módulo 2'}));
  const secondArgs=buildArgs({...request,module:'02 - Módulo 2'},config);
  assert.notEqual(args.find(a=>a.startsWith('temp:')),secondArgs.find(a=>a.startsWith('temp:')));
  assert.equal(destinationKey(request),destinationKey({...request,module:request.module.toUpperCase()}));
  assert.equal(validateRequest({...request,module:'  Aula: Início  '}).module,'Aula_ Início');
  for(const module of ['..','../outside','a/b','a\\b','x\n','C:\\escape','CON','a'.repeat(81)])assert.throws(()=>validateRequest({...request,module}));
  assert.throws(()=>validateRequest({...request,folder:''}));
});

test('module-less downloads retain legacy lock and partial keys',()=>{
  const request={url:'https://example.org/a',quality:'best',filename:'01 - Abordagem',folder:'SDR'};
  for(const module of [undefined,'']){
    assert.equal(downloadKey({...request,module}),'54536f0f1a76e44b');
    assert.equal(destinationKey({...request,module}),'name-a7ea8dd83219c2ec');
  }
});

test('native protocol reassembles split frames and UTF-8 without losing messages', () => {
  const d = new FrameDecoder();
  const bytes = Buffer.concat([encodeFrame({title:'ação 🎬'}), encodeFrame({ok:true})]);
  assert.deepEqual(d.push(bytes.subarray(0, 2)), []);
  assert.deepEqual(d.push(bytes.subarray(2, 9)), []);
  assert.deepEqual(d.push(bytes.subarray(9)), [{title:'ação 🎬'}, {ok:true}]);
});
test('native protocol rejects oversized and malformed frames', () => {
  const header = Buffer.alloc(4); header.writeUInt32LE(2000000);
  assert.throws(() => new FrameDecoder().push(header));
  assert.throws(() => new FrameDecoder().push(Buffer.from([1,0,0,0,123])));
});
test('requests reject executable URLs, credentials, header injection and invalid options', () => {
  for (const url of ['file:///C:/secret', 'javascript:alert(1)', '--exec=calc', 'https://user:pass@example.org/a']) {
    assert.throws(() => validateRequest({type:'download',url,quality:'best',connections:8}));
  }
  assert.throws(() => validateRequest({type:'download',url:'https://example.org/a',quality:'--exec=calc',connections:8}));
  assert.throws(() => validateRequest({type:'download',url:'https://example.org/a',quality:'best',connections:999}));
  assert.throws(() => validateRequest({type:'probe',url:'https://example.org',referer:'https://example.org/\r\nInjected: x'}));
});
test('download command isolates URL, ignores user configs and enables parallelism without throttle', () => {
  const args = buildArgs({type:'download',url:'https://example.org/a?x=1&y=2',quality:'1080',connections:8}, {output:'C:/Videos',ffmpeg:'C:/ffmpeg.exe',aria2:'C:/aria2c.exe',node:'C:/node.exe'});
  assert.equal(args.at(-2), '--');
  assert.equal(args.at(-1), 'https://example.org/a?x=1&y=2');
  assert.ok(args.includes('--ignore-config'));
  assert.ok(args.includes('--no-playlist'));
  assert.equal(args[args.indexOf('--concurrent-fragments')+1], '8');
  assert.match(args[args.indexOf('-f')+1], /height<=1080/);
  assert.equal(args.includes('--limit-rate'), false);
  assert.ok(args.includes('--continue'));
});
test('probe summary excludes DRM formats and identifies audio-only and live streams', () => {
  const result = summarize({title:'Teste',is_live:true,formats:[
    {height:2160,vcodec:'av01',acodec:'none',has_drm:true},
    {height:1080,vcodec:'h264',acodec:'aac'},
    {vcodec:'none',acodec:'aac'}, {height:720,vcodec:'h264',acodec:'none'}
  ]});
  assert.deepEqual(result.heights, [1080,720]);
  assert.equal(result.live,true);
  assert.equal(result.drmOnly,false);
  assert.equal(summarize({formats:[{has_drm:true,vcodec:'h264'}]}).drmOnly,true);
});
test('different qualities and URLs cannot overwrite or resume each other', () => {
  const config={output:'C:/Videos',ffmpeg:'C:/ffmpeg.exe',node:'C:/node.exe'};
  const command=(url,quality)=>{const args=buildArgs({type:'download',url,quality,connections:8},config);return args[args.indexOf('-o')+1];};
  assert.notEqual(command('https://example.org/video','480'),command('https://example.org/video','best'));
  assert.notEqual(command('https://example.org/video?a=1','best'),command('https://example.org/video?a=2','best'));
  assert.equal(command('https://example.org/video','best'),command('https://example.org/video','best'));
});
test('parses real aria2 progress and JSON progress joined after a carriage-return readout',()=>{
  assert.deepEqual(parseTransferLine('[#956ccf 704KiB/2.5MiB(26%) CN:3 DL:791KiB ETA:2s]'),{status:'downloading',downloaded_bytes:720896,total_bytes:2621440,speed:809984,eta:2});
  assert.deepEqual(parseTransferLine('[#abc 1MiB/2MiB(50%)]__PROGRESS__{"status":"finished","downloaded_bytes":2097152}'),{status:'finished',downloaded_bytes:2097152});
  assert.equal(parseTransferLine('Unrelated tool output'),null);
});
test('custom filename keeps Portuguese text, leaves extension to the downloader and escapes template syntax',()=>{
  assert.equal(normalizeFilename('  Aula 01 - Introdução.mp4  '),'Aula 01 - Introdução');
  assert.equal(normalizeFilename('Aula: Social Selling'),'Aula_ Social Selling');
  const args=buildArgs({type:'download',url:'https://example.org/video',quality:'720',connections:4,filename:'100% - %(title)s'}, {output:'C:/Videos',ffmpeg:'C:/ffmpeg.exe',node:'C:/node.exe'});
  assert.equal(args[args.indexOf('-o')+1],'100%% - %%(title)s.%(ext)s');
  assert.ok(args.some(a=>a.startsWith('temp:')),'Partial files must be isolated from other sources with the same custom name');
});
test('custom filename cannot escape the download folder or use Windows reserved names',()=>{
  for(const name of ['../a','C:\\temp\\a','a/b','CON','NUL.mp4','COM1.txt','..','a\n--exec calc'])assert.throws(()=>normalizeFilename(name));
  assert.equal(normalizeFilename('   '),'');
  assert.throws(()=>normalizeFilename('a'.repeat(500)));
});
test('two sources targeting the same custom Windows filename share a destination lock',()=>{
  assert.equal(destinationKey({url:'https://one.test/a',quality:'best',filename:'Aula 01'}),destinationKey({url:'https://two.test/b',quality:'720',filename:'aula 01'}));
  assert.notEqual(destinationKey({url:'https://one.test/a',quality:'best',filename:'Aula 01'}),destinationKey({url:'https://one.test/a',quality:'best',filename:'Aula 02'}));
});
test('normalization is stable across validation and command building for repeated extensions',()=>{
  for(const input of ['Aula.mp4.mkv','Aula.mp4. ','Aula.mp4 .mkv']){
    const name=normalizeFilename(input);assert.equal(name,'Aula');assert.equal(normalizeFilename(name),name);
    const request=validateRequest({type:'download',url:'https://example.test/video',quality:'best',connections:4,filename:input});
    const args=buildArgs(request,{output:'C:/Videos',ffmpeg:'C:/ffmpeg.exe',node:'C:/node.exe'});assert.equal(args[args.indexOf('-o')+1],`${request.filename}.%(ext)s`);
  }
});
test('native host refuses YouTube with a permanent unsupported_site failure',()=>{
  for(const type of ['probe','download']){
    assert.throws(()=>validateRequest({type,id:'a',url:'https://www.youtube.com/watch?v=x',quality:'best',connections:8}),error=>error.code==='unsupported_site');
    assert.throws(()=>validateRequest({type,id:'a',url:'https://cdn.test/v.mp4',referer:'https://youtu.be/x',quality:'best',connections:8}),error=>error.code==='unsupported_site');
  }
  const failure=nativeCore.classifyFailure('',{code:'unsupported_site'});
  assert.equal(failure.retryable,false);assert.match(failure.message,/YouTube/);
  assert.equal(validateRequest({type:'probe',id:'a',url:'https://cdn.test/v.mp4'}).url,'https://cdn.test/v.mp4');
});
