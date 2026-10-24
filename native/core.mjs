import {createHash} from 'node:crypto';
import path from 'node:path';
const MAX_FRAME = 1024 * 1024;
const FAILURES={
  http_401:[true,'A origem recusou o acesso (HTTP 401). A sessão ou o link pode ter expirado. Reabra a aula e tente novamente.'],
  http_403:[true,'A origem recusou o acesso (HTTP 403). O link pode ter expirado ou a aula pode exigir autenticação. Reabra a aula para capturar um link novo.'],
  http_404:[true,'O vídeo não foi encontrado (HTTP 404). O link pode ter expirado. Reabra a aula e tente novamente.'],
  http_429:[true,'A origem limitou as solicitações (HTTP 429). Aguarde antes de tentar novamente.'],
  http_5xx:[true,'O servidor do vídeo apresentou uma falha (HTTP 5xx). Aguarde e tente novamente.'],
  authentication_required:[false,'A origem exige autenticação. Reabra a aula, confirme o acesso e capture o vídeo novamente. Esta versão não lê seus cookies.'],
  network_timeout:[true,'A conexão com a origem excedeu o tempo de espera. Confira a rede e tente novamente.'],
  network_error:[true,'A conexão com a origem foi interrompida. Confira a rede e tente novamente.'],
  transfer_stalled:[true,'A transferência ficou sem avanço e foi interrompida. A aula pode ser tentada novamente com um link novo.'],
  processing_stalled:[true,'A finalização do vídeo excedeu o tempo permitido e foi interrompida. Tente novamente.'],
  drm_unsupported:[false,'O vídeo tem proteção DRM e não é compatível.'],
  disk_full:[false,'Não há espaço disponível no disco. Libere espaço antes de tentar novamente.'],
  tool_missing:[false,'Uma ferramenta necessária não foi encontrada. Execute Instalar.cmd novamente.'],
  permission_denied:[false,'O auxiliar não tem permissão para gravar no destino. Confira o acesso à pasta e às ferramentas.'],
  destination_exists:[false,'Já existe um arquivo com esse nome na pasta de downloads. Escolha outro nome.'],
  destination_unsafe:[false,'A pasta de destino é um link ou fica fora da pasta permitida. Escolha outra pasta.'],
  invalid_request:[false,'Dados de download inválidos. Confira o endereço, nome, pasta, módulo e qualidade.'],
  busy:[false,'Este vídeo já está sendo baixado ou o limite de tarefas foi atingido. Aguarde ou cancele a tarefa anterior.'],
  unsupported_site:[false,'O YouTube não é suportado pelo SirM Downloader Videos, conforme a política da Chrome Web Store.'],
  unsupported_url:[false,'Página não suportada. Reproduza a aula e use um link de mídia detectado.'],
  output_missing:[true,'A ferramenta terminou sem produzir um arquivo de vídeo válido. Tente novamente.'],
  output_invalid:[false,'A ferramenta retornou um arquivo fora do destino permitido. O resultado foi recusado.'],
  probe_timeout:[true,'A análise excedeu 90 segundos. Tente um link de mídia detectado.'],
  invalid_metadata:[true,'O site não retornou informações válidas do vídeo. Reabra a aula e tente novamente.'],
  response_too_large:[false,'A resposta do site excedeu o tamanho permitido.'],
  cancelled:[false,'Download cancelado.'],
  download_failed:[false,'O download falhou e a causa não foi identificada. Reabra a aula e confira se o vídeo pode ser reproduzido.']
};
export function classifyFailure(stderr='',options={}){
  const errno={ENOENT:'tool_missing',ENOSPC:'disk_full',EDQUOT:'disk_full',EACCES:'permission_denied',EPERM:'permission_denied',ETIMEDOUT:'network_timeout',ECONNRESET:'network_error',ECONNREFUSED:'network_error',EHOSTUNREACH:'network_error',ENOTFOUND:'network_error',EAI_AGAIN:'network_error'};
  let code=errno[options.code]||options.code;
  if(!Object.hasOwn(FAILURES,code)){
    const text=String(stderr?.message??stderr).replace(/https?:\/\/\S+/gi,'');
    const status=/(?:HTTP(?:Error| Error|\/\d(?:\.\d)?)?|status(?: code)?[=:]?|response code|server returned)\s*[:=]?\s*(401|403|404|429|5\d\d)\b/i.exec(text)?.[1];
    code=/\bDRM\b|widevine|fairplay/i.test(text)?'drm_unsupported':
      /no space left|not enough (?:free )?(?:disk )?space|disk (?:is )?full|ENOSPC|\[Errno 28\]|WinError 112/i.test(text)?'disk_full':
      /(?:ffmpeg|ffprobe|aria2c?|yt-dlp).*?(?:not found|not installed|missing)|cannot find (?:the )?(?:file|path)|\[WinError 2\]/i.test(text)?'tool_missing':
      status?(status.startsWith('5')?'http_5xx':`http_${status}`):
      /\blog(?:in| in)\b|sign in|authentication required|cookies?.*(?:required|needed)|(?:need|require).*cookies?|private video|not authorized/i.test(text)?'authentication_required':
      /timed? out|timeout|operation too slow|WinError 10060/i.test(text)?'network_timeout':
      /connection (?:reset|refused|aborted)|temporary failure|name or service not known|getaddrinfo|network is unreachable|remote (?:end |host )?closed|TLS|SSL.*(?:error|failed)/i.test(text)?'network_error':
      /unsupported URL/i.test(text)?'unsupported_url':
      /permission denied|access is denied|EACCES/i.test(text)?'permission_denied':
      /Já existe um arquivo/i.test(text)?'destination_exists':
      /pasta.*(?:link|dentro)|fora.*permitid/i.test(text)?'destination_unsafe':
      /outro painel|três tarefas|repetido/i.test(text)?'busy':'download_failed';
  }
  const [retryable,message]=FAILURES[code];return {code,retryable,message};
}
export function watchdogTimeouts(config={}){
  const bounded=(value,fallback,max)=>typeof value==='number'&&Number.isFinite(value)&&value>0?Math.max(100,Math.min(max,value)):fallback;
  return {transferMs:bounded(config.transferTimeoutMs,180000,1800000),processingMs:bounded(config.processingTimeoutMs,600000,3600000)};
}
export function downloadKey(data) {return createHash('sha256').update(`${data.url}\n${data.quality}${data.filename?'\n'+data.filename:''}${data.folder?'\nfolder:'+data.folder.toLowerCase():''}${data.module?'\nmodule:'+data.module.toLowerCase():''}`).digest('hex').slice(0,16);}
export function destinationKey(data){return data.filename?'name-'+createHash('sha256').update(`${data.filename.toLowerCase()}${data.folder?'\nfolder:'+data.folder.toLowerCase():''}${data.module?'\nmodule:'+data.module.toLowerCase():''}`).digest('hex').slice(0,16):downloadKey(data);}
export function normalizeFolder(value){
  if(value===undefined || value===null || value==='')return '';
  if(typeof value!=='string' || value.length>80 || /[\x00-\x1f\\/]/.test(value))throw new Error('Use uma pasta de até 80 caracteres, sem caminho ou quebra de linha.');
  const folder=value.normalize('NFC').trim().replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/g,'');
  if(!folder || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(folder))throw new Error('Nome de pasta inválido para o Windows.');
  return folder;
}
export function outputDirectory(data,config){
  const folder=normalizeFolder(data.folder),module=normalizeFolder(data.module);
  if(module&&!folder)throw new Error('Escolha uma categoria antes de informar o módulo.');
  return module?path.join(config.output,folder,module):folder?path.join(config.output,folder):config.output;
}
export function normalizeFilename(value){
  if(value===undefined || value===null)return '';
  if(typeof value!=='string' || value.length>120 || /[\x00-\x1f\\/]/.test(value))throw new Error('Use um nome de até 120 caracteres, sem caminho de pasta ou quebra de linha.');
  let name=value.normalize('NFC').trim();if(!name)return '';
  name=name.replace(/[<>:"|?*]/g,'_');
  let previous;
  do{previous=name;name=name.replace(/[. ]+$/g,'').replace(/\.(mp4|mkv|webm|mov|m4v|avi|mp3|m4a|opus|ogg|wav)$/i,'');}while(name!==previous);
  if(!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))throw new Error('Esse nome não é permitido pelo Windows. Escolha outro.');
  return name;
}
export function parseTransferLine(line){
  const marker=line.indexOf('__PROGRESS__');
  if(marker>=0){try{return JSON.parse(line.slice(marker+12));}catch{return null;}}
  const match=/\[#[a-z\d]+\s+([\d.]+[KMGT]?i?B)\/([\d.]+[KMGT]?i?B).*?DL:([\d.]+[KMGT]?i?B)(?:\s+ETA:([^\]]+))?/i.exec(line);
  if(!match)return null;
  const bytes=text=>{const m=/^([\d.]+)([KMGT]?)i?B$/i.exec(text);return Number(m[1])*1024**Math.max(0,' KMGT'.indexOf(m[2].toUpperCase()));};
  let eta=null;if(match[4]){eta=0;for(const part of match[4].matchAll(/(\d+)([hms])/g))eta+=Number(part[1])*({h:3600,m:60,s:1}[part[2]]);}
  return {status:'downloading',downloaded_bytes:bytes(match[1]),total_bytes:bytes(match[2]),speed:bytes(match[3]),eta};
}
export function encodeFrame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > MAX_FRAME) throw new Error('Mensagem muito grande.');
  const header = Buffer.alloc(4); header.writeUInt32LE(body.length);
  return Buffer.concat([header, body]);
}
export class FrameDecoder {
  buffer = Buffer.alloc(0);
  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const messages = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32LE(0);
      if (!size || size > MAX_FRAME) throw new Error('Tamanho de mensagem inválido.');
      if (this.buffer.length < 4 + size) break;
      messages.push(JSON.parse(this.buffer.subarray(4, 4 + size).toString('utf8')));
      this.buffer = this.buffer.subarray(4 + size);
    }
    return messages;
  }
}
// Mirrors extension/media.mjs: the Chrome Web Store forbids downloading from YouTube.
const BLOCKED_HOSTS=['youtube.com','youtu.be','youtube-nocookie.com','googlevideo.com'];
function blockedSite(href){const host=new URL(href).hostname.toLowerCase();return BLOCKED_HOSTS.some(domain=>host===domain||host.endsWith('.'+domain));}
function httpUrl(value) {
  if (typeof value !== 'string' || value.length > 16384 || /[\x00-\x20]/.test(value)) throw new Error('Endereço inválido.');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use um endereço HTTP ou HTTPS sem senha.');
  if (blockedSite(url.href)) throw Object.assign(new Error('Site não suportado.'),{code:'unsupported_site'});
  return url.href;
}
export function validateRequest(data) {
  if (!data || !['hello','probe','download','cancel','openFolder'].includes(data.type)) throw new Error('Comando inválido.');
  const result = {type:data.type, id:typeof data.id === 'string' ? data.id.slice(0,80) : ''};
  if (['probe','download'].includes(data.type)) {
    result.url = httpUrl(data.url);
    if (data.referer) result.referer = httpUrl(data.referer);
  }
  if (data.type === 'download') {
    if (!['best','2160','1440','1080','720','480','audio'].includes(data.quality)) throw new Error('Qualidade inválida.');
    if (![1,4,8,16].includes(data.connections)) throw new Error('Número de conexões inválido.');
    result.quality = data.quality; result.connections = data.connections;
    result.filename=normalizeFilename(data.filename);
    result.folder=normalizeFolder(data.folder);
    result.module=normalizeFolder(data.module);
    if(result.module&&!result.folder)throw new Error('Escolha uma categoria antes de informar o módulo.');
  }
  return result;
}
export function buildArgs(input, config) {
  const data = validateRequest(input);
  const args = ['--ignore-config','--no-plugin-dirs','--no-playlist','--no-colors','--encoding','utf-8','--socket-timeout','25',
    '--no-js-runtimes','--js-runtimes',`node:${config.node}`];
  if (data.referer) args.push('--referer',data.referer);
  if (data.type === 'probe') return [...args,'--skip-download','--dump-single-json','--',data.url];
  args.push('--ffmpeg-location',config.ffmpeg,'--paths',outputDirectory(data,config),'--windows-filenames','--no-overwrites','--continue',
    '-o',data.filename?`${data.filename.replace(/%/g,'%%')}.%(ext)s`:`%(title).120B [%(id).40B] [${data.quality}-${downloadKey(data)}].%(ext)s`,'--concurrent-fragments',String(data.connections),
    '--retries','5','--fragment-retries','5','--newline','--progress','--progress-delta','0.5',
    '--progress-template','download:__PROGRESS__%(progress)j','--print','after_move:__FILE__%(filepath)j');
  if(data.filename)args.push('--paths',`temp:${path.join(config.temp || path.join(config.output,'.turbovideo-partials'),downloadKey(data))}`);
  if (config.aria2) args.push('--downloader',`http:${config.aria2}`,'--downloader-args',
    `aria2c:-x ${data.connections} -s ${data.connections} -k 1M --file-allocation=none --summary-interval=1 --console-log-level=warn --download-result=hide --max-tries=5 --retry-wait=2`);
  if (data.quality === 'audio') args.push('-f','bestaudio/best','-x','--audio-format','mp3','--audio-quality','0');
  else {
    const filter = data.quality === 'best' ? '' : `[height<=${data.quality}]`;
    args.push('-f',`bv*${filter}+ba/b${filter}`, '--merge-output-format','mkv');
  }
  return [...args,'--',data.url];
}
export function summarize(info) {
  const formats = Array.isArray(info.formats) ? info.formats : [];
  const clear = formats.filter(f => !f.has_drm);
  return {title:String(info.title || 'Vídeo').slice(0,300),duration:info.duration || null,live:!!info.is_live,
    heights:[...new Set(clear.filter(f => f.vcodec !== 'none' && f.height).map(f=>f.height))].sort((a,b)=>b-a),
    drmOnly:!!info.has_drm || (formats.length > 0 && clear.length === 0)};
}
