export function mediaKind(value, contentType='') {
  let url; try {url=new URL(value);} catch {return null;}
  if (!['http:','https:'].includes(url.protocol)) return null;
  const p=url.pathname.toLowerCase(); const mime=contentType.toLowerCase().split(';')[0];
  if (/\.(ts|m4s|vtt|srt)$/.test(p) || mime==='video/mp2t')return null;
  if (p.endsWith('.m3u8') || /mpegurl/.test(mime))return 'HLS';
  if (p.endsWith('.mpd') || mime==='application/dash+xml')return 'DASH';
  if (/\.(mp4|webm|mov|mkv|m4v|ogg|ogv)$/.test(p) || mime.startsWith('video/'))return 'Vídeo';
  return null;
}
// Chrome Web Store policy: YouTube pages and its media CDN are never downloaded.
const BLOCKED_HOSTS=['youtube.com','youtu.be','youtube-nocookie.com','googlevideo.com'];
export function blockedSite(value){
  let host;try{host=new URL(value).hostname.toLowerCase();}catch{return false;}
  return BLOCKED_HOSTS.some(domain=>host===domain||host.endsWith('.'+domain));
}
export function mergeCandidates(...groups) {
  const found=new Map();
  for (const item of groups.flat()) {
    try {const u=new URL(item.url);if(['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&!blockedSite(u.href))found.set(u.href,{...item,url:u.href});} catch { /* Invalid source. */ }
  }
  return [...found.values()].slice(-150);
}
function httpUrl(value){
  try{const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}
}
export function preferredSource(items){
  return items.map(item=>{
    const url=httpUrl(item?.url);if(!url)return null;
    if(/\.(ts|m4s|vtt|srt)$/i.test(new URL(url).pathname))return null;
    const detected=mediaKind(url);
    const kind=detected||(['HLS','DASH','Vídeo'].includes(item.kind)?item.kind:null);
    if(!kind)return null;
    const referer=httpUrl(item.referer)||'';
    return {url,kind,referer};
  }).filter(Boolean).sort((a,b)=>((a.kind==='Vídeo')-(b.kind==='Vídeo'))||Number(Boolean(b.referer))-Number(Boolean(a.referer)))[0];
}
