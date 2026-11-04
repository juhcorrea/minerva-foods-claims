import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname);
const output=path.join(root,'build');
const assets={};
const types={'.txt':'text/plain; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.webmanifest':'application/manifest+json'};
for(const file of ['index.html','site.webmanifest','access.html','access.css','access.js','styles.css','integration.css','preferences.css','preferences.js','table-filters.css','table-filters.js','column-layout.css','column-layout.js','charts.css','analysts.css','analysts.js','copy-reference.css','copy-reference.js','correction-progress.css','correction-impact.css','correction-impact.js','powerpoint.js','vendor/pptxgen.bundle.js','vendor/pptxgen.LICENSE.txt','portfolio.css','portfolio.js','meetings.css','meetings.js','team.css','app.js','team.js','engine.js','vendor/xlsx.full.min.js','assets/montserrat-latin.woff2','assets/minerva-logo.png','assets/minerva-cover.png']){
 const absolute=path.join(root,'dist',file);if(!fs.existsSync(absolute))throw new Error('Missing required asset: '+file);
 let bytes=fs.readFileSync(absolute);
 if(file==='index.html'){
  let html=bytes.toString('utf8');
  if(!html.includes('href="team.css"'))html=html.replace('</head>','  <link rel="stylesheet" href="team.css">\n</head>');
  if(!html.includes('src="team.js"'))html=html.replace('</body>','  <script src="team.js"></script>\n</body>');
  html=html.replace('<script src="vendor/', '<script>window.MINERVA_HOSTED=true;</script>\n  <script src="vendor/');
  bytes=Buffer.from(html);
 }
 if(file.endsWith('.html')){
  const html=bytes.toString('utf8').replace(/\b(src|href)="([A-Za-z0-9_./-]+\.(?:js|css))"/g,(match,attribute,url)=>{
   const target=path.join(root,'dist',url.replace(/^\/+/,''));
   if(!fs.existsSync(target))throw new Error('Missing HTML asset: '+url);
   const version=createHash('sha256').update(fs.readFileSync(target)).digest('hex').slice(0,12);
   return `${attribute}="${url}?v=${version}"`;
  });
  bytes=Buffer.from(html);
 }
 assets['/'+file]={type:types[path.extname(file)]||'application/octet-stream',body:bytes.toString('base64')};
}
const engine=fs.readFileSync(path.join(root,'dist/engine.js'),'utf8');
const backend=fs.readFileSync(path.join(root,'worker/backend.js'),'utf8');
const wrapper=fs.readFileSync(path.join(root,'worker/entry.js'),'utf8');
fs.mkdirSync(path.join(output,'server'),{recursive:true});fs.mkdirSync(path.join(output,'.openai'),{recursive:true});
fs.writeFileSync(path.join(output,'server/index.js'),engine+'\n'+backend+'\nconst STATIC_ASSETS='+JSON.stringify(assets)+';\n'+wrapper);
fs.copyFileSync(path.join(root,'.openai/hosting.json'),path.join(output,'.openai/hosting.json'));
console.log(JSON.stringify({entry:'build/server/index.js',bytes:fs.statSync(path.join(output,'server/index.js')).size,assets:Object.keys(assets).length}));
