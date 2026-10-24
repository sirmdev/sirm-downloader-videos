// Renderiza o tile promocional (440x280) e o marquee (1400x560) da Chrome Web Store.
// Requer Playwright: npm i -D playwright (ou PLAYWRIGHT_MODULE apontando para uma instalação existente).
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';import path from 'node:path';
const root=path.resolve('extension');const out=path.resolve(process.argv[2]);
const font=fs.readFileSync(path.join(root,'fonts/outfit-latin-wght.woff2')).toString('base64');
const icon=fs.readFileSync(path.join(root,'icons/icon-128.png')).toString('base64');
const html=(w,h,big)=>`<!doctype html><meta charset="utf-8"><style>@font-face{font-family:Outfit;src:url(data:font/woff2;base64,${font})}
*{margin:0}body{width:${w}px;height:${h}px;font-family:Outfit;color:#f6f2fb;background:radial-gradient(ellipse 70% 80% at 90% 0,rgba(130,10,209,.55),transparent 70%),radial-gradient(ellipse 60% 60% at 0 100%,rgba(83,0,130,.5),transparent 70%),#0b0710;display:flex;align-items:center;gap:${big?56:22}px;padding:0 ${big?110:30}px;box-sizing:border-box;overflow:hidden}
img{width:${big?200:92}px;height:${big?200:92}px;border-radius:${big?48:22}px;box-shadow:0 20px 60px rgba(130,10,209,.6)}
.e{font-size:${big?18:10}px;letter-spacing:${big?4:2}px;color:#c77dff;font-weight:600;text-transform:uppercase}
h1{font-size:${big?76:34}px;font-weight:800;letter-spacing:${big?-2.5:-1}px;line-height:1.02;margin:${big?14:6}px 0}
h1 span{background:linear-gradient(90deg,#c77dff,#d4b3f0);-webkit-background-clip:text;color:transparent}
p{font-size:${big?24:12}px;color:#b7a8c9;line-height:1.4}</style>
<img src="data:image/png;base64,${icon}"><div><div class="e">SirM Downloader Videos</div><h1>Seu vídeo.<br><span>Na melhor qualidade.</span></h1><p>${big?'MP4, HLS e DASH • qualidade até 4K • conexões paralelas • listas de aulas':'Grátis • código aberto • sem anúncios'}</p></div>`;
const browser=await chromium.launch({channel:'chromium',headless:true});
try{for(const [name,w,h,big] of [['promo-440x280',440,280,false],['marquee-1400x560',1400,560,true]]){const page=await browser.newPage({viewport:{width:w,height:h}});await page.setContent(html(w,h,big));await page.waitForTimeout(200);await page.screenshot({path:path.join(out,name+'.png')});await page.close();}}
finally{await browser.close();}
console.log('ok');
