import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {buildMigrationSource} from '../migration/source-archive.mjs';
import {buildClientBackup} from './build-client-backup.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const OUTPUT_FILES=['404.html','_routes.json','_worker.js'];
const TYPES={'.txt':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const MAX_WORKER_BYTES=64*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');

function approvedPath(root,relative){
  if(!relative||path.isAbsolute(relative)||relative.split(/[\\/]/).some(part=>!part||part==='.'||part==='..'))throw new Error('Unsafe source path: '+relative);
  let cursor=path.resolve(root);
  for(const part of relative.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw new Error('Symlink is not an approved source: '+relative);}
  if(!fs.statSync(cursor).isFile())throw new Error('Expected source file: '+relative);
  return cursor;
}
const read=(root,relative)=>fs.readFileSync(approvedPath(root,relative));

// Read the existing literal allowlist, never evaluate build code or traverse dist.
// New frontend assets therefore use the same inventory as the retained Sites build.
export function assetPaths(buildSource){
  const literal=buildSource.match(/for\s*\(\s*const\s+file\s+of\s*(\[[\s\S]*?\])\s*\)/)?.[1];
  if(!literal)throw new Error('The Sites asset allowlist could not be located.');
  let files;try{files=JSON.parse(literal.replace(/'([^'\\]*)'/g,(_match,value)=>JSON.stringify(value)));}catch{throw new Error('The Sites asset allowlist must contain literal paths only.');}
  if(!Array.isArray(files)||!files.length||new Set(files).size!==files.length||files.some(file=>typeof file!=='string'||!/^[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(file)||file.split('/').some(part=>part.startsWith('.')||['server','private','dados','node_modules'].includes(part))||!TYPES[path.extname(file)]))throw new Error('Invalid or unexpected frontend asset path.');
  for(const required of ['index.html','access.html','app.js','team.js','engine.js'])if(!files.includes(required))throw new Error('Required frontend asset is missing: '+required);
  return files;
}

function assetsFor(root,files){
  const allowed=new Set(files),assets={};
  for(const file of files){
    let bytes=read(root,'dist/'+file);
    if(file==='index.html'){
      let html=bytes.toString('utf8');
      if(!html.includes('href="team.css"'))html=html.replace('</head>','  <link rel="stylesheet" href="team.css">\n</head>');
      if(!html.includes('src="team.js"'))html=html.replace('</body>','  <script src="team.js"></script>\n</body>');
      if(!html.includes('window.MINERVA_HOSTED=true;'))html=html.replace('<script src="vendor/','<script>window.MINERVA_HOSTED=true;</script>\n  <script src="vendor/');
      if(!html.includes('window.MINERVA_HOSTED=true;'))throw new Error('Hosted bootstrap was not inserted.');
      bytes=Buffer.from(html);
    }
    if(file.endsWith('.html'))bytes=Buffer.from(bytes.toString('utf8').replace(/\b(src|href)="([A-Za-z0-9_./-]+\.(?:js|css))"/g,(_match,attribute,url)=>{
      const relative=url.replace(/^\/+/, '');
      if(!allowed.has(relative))throw new Error('HTML asset is outside the approved inventory: '+url);
      return `${attribute}="${url}?v=${hash(read(root,'dist/'+relative)).slice(0,12)}"`;
    }));
    assets['/'+file]={type:TYPES[path.extname(file)],body:bytes.toString('base64')};
  }
  return assets;
}

export function workerModules(root,entries=['worker/backend.js','worker/entry.js']){
  const emitted=new Set(),visiting=new Set(),parts=[];
  function visit(relative){
    if(emitted.has(relative))return;
    if(visiting.has(relative))throw new Error('Circular Worker import: '+relative);
    visiting.add(relative);
    let source=read(root,relative).toString('utf8');
    source=source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?\s*$/gm,(_match,names,specifier)=>{
      if(!/^\{[\s\w,$]+\}$/.test(names)||/\bas\b/.test(names)||!specifier.startsWith('./')&&!specifier.startsWith('../'))throw new Error('Unsupported Worker import in '+relative);
      const dependency=path.posix.normalize(path.posix.join(path.posix.dirname(relative),specifier));
      if(!/^worker\/[a-zA-Z0-9_/-]+\.js$/.test(dependency))throw new Error('Worker import leaves the approved source directory.');
      visit(dependency);return '';
    });
    if(/^\s*import\s|\bimport\s*\(/m.test(source))throw new Error('Unbundled Worker import in '+relative);
    visiting.delete(relative);emitted.add(relative);parts.push({path:relative,source});
  }
  entries.forEach(visit);return parts;
}

export async function createPagesArtifact(root=ROOT,{migrationSource}={}){
  root=path.resolve(root);
  buildClientBackup(root);
  const files=assetPaths(read(root,'build.mjs').toString('utf8')),assets=assetsFor(root,files),modules=workerModules(root);
  const backup=migrationSource??await buildMigrationSource(root);
  if(!backup||typeof backup.base64!=='string'||!backup.base64||hash(Buffer.from(backup.base64,'base64'))!==backup.sha256)throw new Error('Invalid private restoration source archive.');
  const entry=modules.find(module=>module.path==='worker/entry.js');
  if(!entry||!entry.source.includes('export default'))throw new Error('The Worker entry must export its fetch handler.');
  const worker=read(root,'dist/engine.js').toString('utf8')+'\n'+modules.filter(module=>module!==entry).map(module=>module.source).join('\n')+'\nconst MIGRATION_SOURCE='+JSON.stringify(backup)+';\nconst STATIC_ASSETS='+JSON.stringify(assets)+';\n'+entry.source;
  const bytes=Buffer.byteLength(worker),gzipBytes=gzipSync(worker,{level:9}).length;
  if(bytes>MAX_WORKER_BYTES)throw new Error('Worker exceeds the 64 MiB uncompressed limit.');
  const output={
    '_worker.js':worker,
    '_routes.json':JSON.stringify({version:1,include:['/*'],exclude:[]},null,2)+'\n',
    '404.html':'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="robots" content="noindex"><title>Serviço indisponível</title><h1>Serviço indisponível</h1><p>Tente novamente em alguns instantes.</p></html>\n',
  };
  return {files:output,summary:{entry:'build/cloudflare-pages/_worker.js',workerBytes:bytes,gzipBytes,workerSha256:hash(worker),assetCount:files.length,sourceFileCount:backup.fileCount,sourceCommit:backup.commitSha||null,modulePaths:modules.map(module=>module.path),outputFiles:OUTPUT_FILES}};
}

export function writePagesArtifact(root,artifact,relative='build/cloudflare-pages'){
  root=path.resolve(root);const destination=path.resolve(root,relative),within=path.relative(path.join(root,'build'),destination);
  if(!within||within.startsWith('..')||path.isAbsolute(within))throw new Error('Output must be an isolated directory inside build/.');
  let cursor=root;
  for(const part of path.relative(root,destination).split(path.sep)){cursor=path.join(cursor,part);if(fs.existsSync(cursor)&&fs.lstatSync(cursor).isSymbolicLink())throw new Error('Output cannot traverse a symlink.');}
  if(JSON.stringify(Object.keys(artifact.files).sort())!==JSON.stringify(OUTPUT_FILES))throw new Error('Unexpected deployment file.');
  if(fs.existsSync(destination)&&fs.readdirSync(destination).some(name=>!OUTPUT_FILES.includes(name)))throw new Error('Deployment directory contains unexpected files; use a clean isolated directory.');
  fs.mkdirSync(destination,{recursive:true});
  for(const[name,value]of Object.entries(artifact.files)){
    const target=path.join(destination,name);if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw new Error('Deployment file cannot be a symlink.');
    fs.writeFileSync(target,value);
  }
  return destination;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const artifact=await createPagesArtifact();writePagesArtifact(ROOT,artifact);console.log(JSON.stringify(artifact.summary));
}
