/* global window, scrollTo */
// Gera screenshots do painel com dados fictícios (bridge falso, nenhum download real).
// Requer Playwright: npm i -D playwright (ou PLAYWRIGHT_MODULE apontando para uma instalação existente).
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';
const root=path.resolve('extension');const out=path.resolve(process.argv[2]||'work/shots');fs.mkdirSync(out,{recursive:true});
const types={'.mjs':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.html':'text/html; charset=utf-8'};
const server=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/+/,'');const file=path.join(root,rel);if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({channel:'chromium',headless:true});const errors=[];
async function shot(name,{width,height,connected=true,scenario='single',fullPage=false}){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(name+': '+e.message));
  await page.addInitScript(({connected})=>{
    const lessons=['Boas-vindas e visão geral','Configurando o ambiente','Primeiro projeto na prática','Publicando o resultado','Próximos passos'].map((t,i)=>({href:'https://cursos.exemplo.test/m/lessons/demo?classId='+(i+1),title:t,module:i<2?'Módulo 1 • Fundamentos':'Módulo 2 • Prática',moduleIndex:i<2?0:1}));
    window.chrome={storage:{local:{get:async()=>({}),set:async()=>{},remove:async()=>{}}},tabs:{get:async()=>({url:'https://cursos.exemplo.test/m/lessons/demo?classId=3',title:'Primeiro projeto na prática — Curso Demo'})},
      scripting:{executeScript:async o=>[{result:o.target.allFrames?[{url:'https://cdn.exemplo.test/hls/aula-3/master.m3u8',kind:'HLS',source:'Player',referer:'https://cursos.exemplo.test/'}]:{anchors:lessons,category:'Curso Demo',modules:[{title:'Módulo 1 • Fundamentos',count:2},{title:'Módulo 2 • Prática',count:3}],incomplete:false,warnings:[]}}]},
      runtime:{sendMessage:async()=>({items:[],generation:1}),connect:()=>({onMessage:{addListener(){}},onDisconnect:{addListener(){}},postMessage(){},disconnect(){}}),
        connectNative:()=>{let h,d;return {onMessage:{addListener:f=>h=f},onDisconnect:{addListener:f=>d=f},postMessage:m=>{
          if(m.type==='hello')setTimeout(()=>connected?h({type:'ready',supportsFilename:true,supportsFolders:true,supportsModules:true,folder:['C:','Users','voce','Downloads','TurboVideo'].join(String.fromCharCode(92)),parallel:true}):d(),30);
          if(m.type==='probe')setTimeout(()=>h({id:m.id,type:'info',title:'Primeiro projeto na prática',heights:[1080,720,480],drmOnly:false,live:false}),30);
          if(m.type==='download'){let n=0;const total=812*1048576;const tick=()=>{n++;h({id:m.id,type:'progress',downloaded:Math.min(total,n*0.23*total),total,speed:38.4*1048576,eta:Math.max(0,12-n*3),phase:'downloading'});if(n<3)setTimeout(tick,20);};setTimeout(tick,20);}
        }};}}};
  },{connected,scenario});
  await page.goto(`http://127.0.0.1:${server.address().port}/dashboard.html?tab=1`);await page.waitForTimeout(400);
  if(scenario==='single'&&connected){await page.locator('#probe').click();await page.waitForTimeout(150);await page.locator('#filename').fill('Aula 03 - Primeiro projeto na prática');await page.locator('#download').click();await page.waitForTimeout(250);await page.evaluate(()=>scrollTo(0,0));}
  if(scenario==='batch'){await page.locator('#bulk-scan').click();await page.locator('.lesson-row').nth(4).waitFor();await page.locator('#bulk-list').scrollIntoViewIfNeeded();}
  if(scenario==='downloads'){await page.locator('#probe').click();await page.waitForTimeout(150);await page.locator('#filename').fill('Aula 03 - Primeiro projeto na prática');await page.locator('#download').click();await page.waitForTimeout(250);await page.locator('#jobs').evaluate(e=>e.scrollIntoView({block:'center'}));}
  await page.screenshot({path:path.join(out,name+'.png'),fullPage});await page.close();
}
try{
  await shot('desktop-full',{width:1280,height:800,fullPage:true});
  await shot('mobile-full',{width:390,height:844,fullPage:true});
  await shot('store-1-painel',{width:1280,height:800});
  await shot('store-2-lista-aulas',{width:1280,height:800,scenario:'batch'});
  await shot('store-4-downloads',{width:1280,height:800,scenario:'downloads'});
  await shot('store-3-auxiliar',{width:1280,height:800,connected:false,scenario:'none'});
}finally{await browser.close();server.close();}
console.log(JSON.stringify({out,errors}));
