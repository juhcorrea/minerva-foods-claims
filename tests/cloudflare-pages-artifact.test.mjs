import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,webcrypto} from 'node:crypto';
import vm from 'node:vm';
import {createPagesArtifact,writePagesArtifact,assetPaths,workerModules} from '../scripts/build-cloudflare-pages.mjs';
import {migrationZipChunks} from '../worker/zip.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),hash=value=>createHash('sha256').update(value).digest('hex');
const sourceZip=Buffer.concat(migrationZipChunks([{name:'README.txt',data:Buffer.from('Synthetic restoration source only.')}])) ,migrationSource={base64:sourceZip.toString('base64'),sha256:hash(sourceZip),commitSha:'a'.repeat(40),fileCount:1,restorationInstructions:'Synthetic restore instructions.'};
const artifact=await createPagesArtifact(root,{migrationSource});
const sourceSnapshot=Object.fromEntries(['build.mjs','worker/entry.js','.openai/hosting.json'].map(file=>[file,hash(fs.readFileSync(path.join(root,file)))]));
function temporary(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'claims-pages-artifact-'));
  t.after(()=>{const relative=path.relative(os.tmpdir(),directory);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(directory,{recursive:true,force:true});});return directory;
}
function write(root,name,value){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);}

test('Pages artifact contains only compiled Worker, complete routing and a neutral static fallback',()=>{
  assert.deepEqual(Object.keys(artifact.files).sort(),['404.html','_routes.json','_worker.js']);
  assert.deepEqual(JSON.parse(artifact.files['_routes.json']),{version:1,include:['/*'],exclude:[]});
  assert(!artifact.files['404.html'].includes('<script'));assert(!artifact.files['404.html'].includes('MINERVA_HOSTED'));
  assert.equal(artifact.summary.assetCount,assetPaths(fs.readFileSync(path.join(root,'build.mjs'),'utf8')).length);
  assert(artifact.summary.workerBytes<64*1024*1024);assert(artifact.summary.gzipBytes>0&&artifact.summary.gzipBytes<artifact.summary.workerBytes);
  assert.equal(artifact.summary.workerSha256,hash(artifact.files['_worker.js']));
  assert(artifact.files['_worker.js'].includes('const MIGRATION_SOURCE='));assert(artifact.files['_worker.js'].includes('const STATIC_ASSETS='));assert(!/^import\s/m.test(artifact.files['_worker.js']));
  for(const[file,digest]of Object.entries(sourceSnapshot))assert.equal(hash(fs.readFileSync(path.join(root,file))),digest,'Sites source remains unchanged: '+file);
});

test('allowlist parser cannot execute build code or include source directories, environment files or traversal',()=>{
  const original=fs.readFileSync(path.join(root,'build.mjs'),'utf8');
  for(const path of ['../private.json','.env','server/index.js','private/report.js','dados/bases.js','app.js'])assert.throws(()=>assetPaths(original.replace("'index.html'",`'${path}'`)),/asset|inventory|frontend|allowlist/i);
  assert.throws(()=>assetPaths("for(const file of [process.env.SECRET]){}"),/literal/);
  assert.throws(()=>assetPaths("for(const file of ['index.html', doSomething()]){}"),/literal/);
});

test('Worker dependencies resolve recursively and reject external, escaped, circular and unsupported imports',t=>{
  const directory=temporary(t);write(directory,'worker/entry.js',"import { one } from './one.js';\nexport default {fetch(){return one();}};");write(directory,'worker/one.js',"import { two } from './nested/two.js';\nexport function one(){return two();}");write(directory,'worker/nested/two.js','export function two(){return 2;}');
  assert.deepEqual(workerModules(directory,['worker/entry.js']).map(module=>module.path),['worker/nested/two.js','worker/one.js','worker/entry.js']);
  for(const content of ["import { value } from '../../outside.js';","import { value } from 'some-package';","import value from './one.js';","import './one.js';","const module=import('./one.js');"]){write(directory,'worker/entry.js',content);assert.throws(()=>workerModules(directory,['worker/entry.js']),/import/i);}
  write(directory,'worker/entry.js',"import { one } from './one.js';");write(directory,'worker/one.js',"import { one } from './entry.js';");assert.throws(()=>workerModules(directory,['worker/entry.js']),/Circular/);
});

test('deployment writer stays inside isolated build output and refuses unrelated files',t=>{
  const directory=temporary(t),destination=writePagesArtifact(directory,artifact);assert.deepEqual(fs.readdirSync(destination).sort(),['404.html','_routes.json','_worker.js']);
  assert.throws(()=>writePagesArtifact(directory,artifact,'dist'),/isolated/);assert.throws(()=>writePagesArtifact(directory,artifact,'../elsewhere'),/isolated/);assert.throws(()=>writePagesArtifact(directory,artifact,'build'),/isolated/);
  assert.throws(()=>writePagesArtifact(directory,{files:{...artifact.files,'private.json':'SYNTHETIC_PRIVATE_VALUE'}}),/Unexpected/);
  write(directory,'build/cloudflare-pages/old-export.json','SYNTHETIC_PRIVATE_VALUE');assert.throws(()=>writePagesArtifact(directory,artifact),/unexpected files/);assert.equal(fs.readFileSync(path.join(destination,'old-export.json'),'utf8'),'SYNTHETIC_PRIVATE_VALUE');
});

class MemoryR2{
  objects=new Map();serial=0;reads=[];
  async get(key){this.reads.push(key);const value=this.objects.get(key);return value?{etag:value.etag,customMetadata:value.metadata,json:async()=>JSON.parse(value.text)}:null;}
  async head(key){const value=this.objects.get(key);return value?{etag:value.etag,customMetadata:value.metadata}:null;}
  async put(key,text,options={}){const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const value={text,etag:'test-'+(++this.serial),metadata:options.customMetadata};this.objects.set(key,value);return{etag:value.etag};}
  async delete(key){this.objects.delete(key);}
}
function runtime(){
  const context={Request,Response,Headers,URL,URLSearchParams,Uint8Array,Uint32Array,DataView,ArrayBuffer,TextEncoder,TextDecoder,ReadableStream,crypto:webcrypto,atob,btoa,console,Intl,fetch:async()=>{throw Error('Unexpected network call');}};
  const source=artifact.files['_worker.js'].replace(/^export default /gm,'globalThis.pagesWorker = ').replace(/^export (?=(?:async )?(?:function|class|const)\b)/gm,'');
  vm.runInNewContext(source,context,{filename:'compiled-cloudflare-pages-worker.js'});
  const token=Buffer.alloc(32,91).toString('base64url'),env={BUCKET:new MemoryR2(),ADMIN_LINK_HASHES:JSON.stringify([{id:'owner',name:'Admin Test One',tokenHash:hash(token)},{id:'developer',name:'Admin Test Two',tokenHash:hash(Buffer.alloc(32,92).toString('base64url'))}])};
  const origin='https://claims-pages.example.test';
  const request=(route,cookie=null,body,method=body?'POST':'GET')=>{const headers=new Headers();if(cookie)headers.set('cookie',cookie);if(body){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}return context.pagesWorker.fetch(new Request(origin+route,{method,headers,body:body?JSON.stringify(body):undefined}),env,{});};
  return {env,token,request};
}

test('compiled Worker protects report assets and private APIs and keeps backup administrative',async()=>{
  const f=runtime(),privatePaths=['/app.js','/engine.js','/team.js','/styles.css','/analysts.js','/meetings.js','/claim-control.js','/materials.css','/materials.js','/materials-data.js'];
  for(const file of privatePaths)for(const method of ['GET','HEAD'])assert.equal((await f.request(file+'?v=test',null,undefined,method)).status,401);
  for(const route of ['/api/report','/api/report/meta','/api/migration/export'])assert.equal((await f.request(route)).status,401);
  assert(!f.env.BUCKET.reads.includes('private/report-latest-v1.json'));
  for(const route of ['/worker/backend.js','/_worker.js','/.env','/.git/HEAD','/.openai/hosting.json','/dados/bases-publicadas.json','/dados/campos-manuais-materiais.json','/private/material-inputs-v1.json','/codigo-operacional.zip'])assert.equal((await f.request(route)).status,404);
  const entry=await f.request('/');assert.equal(entry.status,200);assert(!(await entry.text()).includes('window.MINERVA_HOSTED=true'));
  const login=await f.request('/api/auth/exchange',null,{token:f.token});assert.equal(login.status,200);const admin=login.headers.get('set-cookie').split(';')[0];
  const pending=await f.request('/api/auth/request',null,{name:'Viewer Test',email:'viewer@example.invalid'});assert.equal(pending.status,201);const viewer=pending.headers.get('set-cookie').split(';')[0],member=(await pending.json()).userId;assert.equal((await f.request('/app.js',viewer)).status,403);
  assert.equal((await f.request('/api/members/'+member+'/approve',admin,{})).status,200);
  for(const file of privatePaths){const response=await f.request(file,viewer);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private, no-store/);}
  const index=await f.request('/',viewer),html=await index.text();assert(html.includes('window.MINERVA_HOSTED=true'));
  for(const name of ['materials.css','materials.js','materials-data.js'])assert.match(html,new RegExp(name.replace('.','\\.')+'\\?v=[a-f0-9]{12}'));
  assert.equal((await f.request('/api/migration/export',viewer)).status,403);const backup=await f.request('/api/migration/export',admin);assert.equal(backup.status,200);assert.match(backup.headers.get('content-type'),/application\/zip/);assert.equal(Buffer.from(await backup.arrayBuffer()).subarray(0,2).toString(),'PK');
});

test('compiled Access mode fails closed when destination credentials are not configured',async()=>{
  const f=runtime();f.env.AUTH_MODE='cloudflare-access';
  for(const route of ['/api/session','/api/report','/app.js'])assert.equal((await f.request(route)).status,503,route);
  assert(artifact.summary.modulePaths.includes('worker/cloudflare-access.js'));
});
