// Gera os pacotes distribuíveis em dist/:
//   node scripts/build.mjs store    -> zip da Chrome Web Store (sem a chave "key" do manifesto)
//   node scripts/build.mjs release  -> zip do instalador para o GitHub Releases
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dist=path.join(root,'dist');
const mode=process.argv[2];
const version=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8')).version;
const forbidden=/(^|\/)(work|node_modules|Instalado|dist|outputs)(\/|$)|config\.json$|\.env|\.part$|\.log$|PASTA-DA-EXTENSAO\.txt$/i;

function copy(from,to){
  fs.mkdirSync(to,{recursive:true});
  for(const entry of fs.readdirSync(from,{withFileTypes:true})){
    const source=path.join(from,entry.name),target=path.join(to,entry.name);
    if(forbidden.test(path.relative(root,source).replaceAll('\\','/')))continue;
    if(entry.isDirectory()){fs.mkdirSync(target,{recursive:true});copy(source,target);}
    else fs.copyFileSync(source,target);
  }
}
function list(dir,base=dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?list(path.join(dir,e.name),base):[path.relative(base,path.join(dir,e.name)).replaceAll('\\','/')]);}
function zip(folder,file){
  fs.rmSync(file,{force:true});
  // Windows ships bsdtar, which writes .zip; elsewhere fall back to Info-ZIP.
  const tar=path.join(process.env.SystemRoot || 'C:\\Windows','System32','tar.exe');
  const result=process.platform==='win32'&&fs.existsSync(tar)
    ?spawnSync(tar,['-a','-c','-f',file,...fs.readdirSync(folder)],{cwd:folder,stdio:'inherit'})
    :spawnSync('zip',['-qr',file,'.'],{cwd:folder,stdio:'inherit'});
  if(result.status!==0)throw new Error(`Falha ao compactar ${file}`);
}

if(!['store','release'].includes(mode)){console.error('Use: node scripts/build.mjs store|release');process.exit(2);}
const stage=path.join(dist,mode==='store'?'store':'release',mode==='store'?'':'SirM-Downloader-Videos');
fs.rmSync(path.join(dist,mode),{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});

if(mode==='store'){
  copy(path.join(root,'extension'),stage);
  const manifest=JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8'));
  delete manifest.key; // A loja recusa "key" e atribui o próprio ID.
  if(manifest.description.length>132)throw new Error('A descrição do manifesto passa de 132 caracteres.');
  fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
}else{
  for(const dir of ['extension','native'])copy(path.join(root,dir),path.join(stage,dir));
  for(const file of ['install.ps1','uninstall.ps1','Instalar.cmd','Desinstalar.cmd','extension-id.txt','store-extension-id.txt','LEIA-ME.md','README.md','CHANGELOG.md','PRIVACY.md','LICENSE'])
    fs.copyFileSync(path.join(root,file),path.join(stage,file));
}
const files=list(path.join(dist,mode));
const leaked=files.filter(f=>forbidden.test(f));
if(leaked.length)throw new Error('Arquivos proibidos no pacote: '+leaked.join(', '));
const out=path.join(dist,mode==='store'?`sirm-downloader-videos-store-${version}.zip`:`SirM-Downloader-Videos-${version}.zip`);
zip(path.join(dist,mode),out);
console.log(`${path.relative(root,out)} • ${files.length} arquivos`);
