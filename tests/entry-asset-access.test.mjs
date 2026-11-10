import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createD1Bucket} from '../worker/d1-store.js';

const source=await readFile(new URL('../worker/entry.js',import.meta.url),'utf8');
const origin='https://claims-assets.example.test';
const publicPaths=['/access.html','/access.css','/access.js','/site.webmanifest','/assets/minerva-logo.png','/assets/montserrat-latin.woff2'];
const privatePaths=['/analysts.js','/meetings.js','/engine.js','/app.js','/team.js','/styles.css','/executive.js','/executive.css','/executive-shell.css','/claim-control.js','/claim-control.css','/calculation-rules.js','/presentation-mode.js','/presentation-mode.css','/section-collapse.js','/section-collapse.css','/multi-select.js','/multi-select.css','/client-analysis.js','/analysis-worker.js','/client-backup.js','/client-backup-worker.js','/assets/flags/br.svg','/vendor/pptxgen.bundle.js','/assets/minerva-cover.png','/future-report.js'];
const privateMarker='PRIVATE_REPORT_CONFIGURATION';
const accessMarker='PUBLIC_ACCESS_FORM';
const anonymous={authenticated:false,approved:false,role:'visitor'};
const session=role=>({authenticated:true,approved:true,role});

function fixture({native=false}={}){
 const calls=[],network=[];let decodes=0;
 class Bytes extends Uint8Array{}
 Object.defineProperty(Bytes,'fromBase64',{value:native?value=>{decodes++;return new Uint8Array(Buffer.from(value,'base64'));}:undefined});
 const paths=[...publicPaths,...privatePaths,'/index.html'];
 const assets=Object.fromEntries(paths.map(path=>[path,{type:path.endsWith('.html')?'text/html':'application/octet-stream',body:Buffer.from(path==='/access.html'?accessMarker:publicPaths.includes(path)?'PUBLIC_BRAND_ASSET':privateMarker).toString('base64')}]));
 const context={
  Request,Response,Headers,URL,Uint8Array:Bytes,atob:value=>{decodes++;return atob(value);},createD1Bucket,
  ClaimsEngine:{},MIGRATION_SOURCE:{base64:''},STATIC_ASSETS:assets,
  createApiHandler:()=>async(request,env)=>{
   calls.push({path:new URL(request.url).pathname,method:request.method,cookie:request.headers.get('cookie'),bucket:env.BUCKET});
   if(new URL(request.url).pathname==='/api/session'){
    if(env.throwSession)throw new Error('Storage unavailable');
    if(env.invalidSessionJson)return new Response('{',{status:200});
    return Response.json(env.session??anonymous,{status:env.sessionStatus??200});
   }
   return Response.json({api:true},{status:202});
  },
  fetch:async url=>{network.push(url);return new Response('PUBLIC_BRAND_ICON',{headers:{'content-type':'image/png'}});},
 };
 vm.createContext(context);vm.runInContext(source.replace(/^import .*from '\.\/d1-store\.js';\s*$/m,'').replace('export default {','globalThis.worker = {'),context,{filename:'worker/entry.js'});
 return {calls,network,assets,context,get decodes(){return decodes;},request:(path,env={},method='GET',headers={})=>context.worker.fetch(new Request(origin+path,{method,headers:{cookie:'session=test-browser',...headers}}),env,{})};
}

test('stale HTML document destinations redirect only to the constant gated root without reflecting the URL',async()=>{
 const f=fixture(),stale='/%20stale%20navigation,%20example?next=https%3A%2F%2Fother.invalid%2F#untrusted-fragment';
 for(const method of ['GET','HEAD'])for(const headers of [{accept:'text/html,application/xhtml+xml;q=0.9'},{'sec-fetch-mode':'navigate',accept:'*/*'}]){
  const response=await f.request(stale,{},method,headers);assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');assert.equal(await response.text(),'');assert.match(response.headers.get('cache-control'),/private, no-store/);
 }
 assert.equal(f.calls.length,0,'Redirect contains no report and does not replace root authorization');assert.equal(f.decodes,0);
 for(const identity of [anonymous,{authenticated:true,approved:false,role:'requester',status:'pending'},{authenticated:true,approved:false,role:'viewer',status:'revoked'}]){
  const next=await f.request('/',{session:identity},'GET',{accept:'text/html'});assert.equal(next.status,200);assert.equal(await next.text(),accessMarker);
 }
 assert.equal(await (await f.request('/',{session:session('admin')},'GET',{accept:'text/html'})).text(),privateMarker);
});

test('document fallback never redirects files, internal namespaces, malformed paths or non-navigation requests',async()=>{
 const f=fixture();
 const blocked=['/unknown.js','/missing.xlsx','/missing.html','/.env','/.git/HEAD','/assets/unknown','/vendor/unknown','/worker/unknown','/server/unknown','/private/unknown','/dados/unknown','/cdn-cgi/access/unknown','/cdn-cgi','/api','/%61pi/unknown','/%61ssets/unknown','/unknown%2Ejs','/%2Egit/HEAD','/%5Cprivate','/%0D%0Aheader','/%E0%A4%A'];
 for(const pathname of blocked)for(const method of ['GET','HEAD']){
  const response=await f.request(pathname,{},method,{accept:'text/html','sec-fetch-mode':'navigate'});assert.equal(response.status,404,pathname);assert.equal(response.headers.get('location'),null,pathname);
 }
 for(const headers of [{},{accept:'application/json'},{accept:'text/html-data'},{accept:'*/*','sec-fetch-mode':'cors'}])assert.equal((await f.request('/old-page',{},'GET',headers)).status,404);
 assert.equal((await f.request('/old-page',{},'POST',{accept:'text/html','sec-fetch-mode':'navigate'})).status,405);
 assert.equal(f.calls.length,0);
 const api=await f.request('/api/unknown',{},'GET',{accept:'text/html','sec-fetch-mode':'navigate'});assert.equal(api.status,202);assert.equal(api.headers.get('location'),null);assert.equal(f.calls.at(-1).path,'/api/unknown');
});

test('HTML navigation headers do not bypass authorization of existing private scripts or root storage failures',async()=>{
 const f=fixture(),headers={accept:'text/html','sec-fetch-mode':'navigate'};
 assert.equal((await f.request('/app.js',{},'GET',headers)).status,401);
 assert.equal((await f.request('/app.js',{session:{authenticated:true,approved:false,role:'viewer'}},'HEAD',headers)).status,403);
 const unavailable=await f.request('/',{throwSession:true},'GET',headers);assert.equal(unavailable.status,503);assert(!(await unavailable.text()).includes(privateMarker));
});

test('asset decoding is skipped for HEAD and cached only after live approval, including the native decoder',async()=>{
 for(const native of [false,true]){
  const f=fixture({native}),env={session:session('viewer')};
  assert.equal((await f.request('/engine.js',env,'HEAD')).status,200);assert.equal(f.decodes,0);
  assert.equal(await (await f.request('/engine.js',env)).text(),privateMarker);assert.equal(f.decodes,1);
  assert.equal(await (await f.request('/engine.js',env)).text(),privateMarker);assert.equal(f.decodes,1);
  const revoked=await f.request('/engine.js',{session:anonymous});assert.equal(revoked.status,401);assert(!(await revoked.text()).includes(privateMarker));assert.equal(f.calls.length,4);assert.equal(f.decodes,1);
 }
});

test('decoded asset memory remains bounded and evicted assets are decoded again',async()=>{
 const f=fixture({native:true}),env={session:session('admin')};
 for(const key of ['/app.js','/engine.js','/team.js'])f.assets[key].body=Buffer.alloc(4*1024*1024,7).toString('base64');
 for(const key of ['/app.js','/engine.js','/team.js'])assert.equal((await f.request(key,env)).status,200);
 assert.equal(vm.runInContext('decodedAssetBytes',f.context),8*1024*1024);assert.equal(vm.runInContext('decodedAssets.size',f.context),2);assert.equal(f.decodes,3);
 await f.request('/app.js',env);assert.equal(f.decodes,4);assert.equal(vm.runInContext('decodedAssetBytes',f.context),8*1024*1024);
});

test('D1 supplies the private object store only when the existing R2 binding is absent',async()=>{
 const f=fixture(),db={prepare(){throw Error('Unexpected query in the API stub');}},env={DB:db,session:session('admin')};
 assert.equal((await f.request('/api/example',env)).status,202);assert.equal(typeof f.calls.at(-1).bucket.get,'function');assert.equal(env.BUCKET,undefined,'Request binding must not mutate the deployment environment');
 const bucket={private:true};await f.request('/api/example',{...env,BUCKET:bucket});assert.equal(f.calls.at(-1).bucket,bucket);
});

test('anonymous and unapproved sessions cannot retrieve report assets directly, including versioned URLs and HEAD',async()=>{
 const f=fixture();
 const cases=[
  {value:anonymous,status:401},
  {value:{authenticated:true,approved:false,role:'requester',status:'pending'},status:403},
  {value:{authenticated:true,approved:false,role:'viewer',status:'revoked'},status:403},
  {value:{authenticated:true,approved:true,role:'unknown'},status:403},
 ];
 for(const {value,status}of cases)for(const path of privatePaths)for(const method of ['GET','HEAD']){
  const response=await f.request(path+'?v=cache-version',{session:value},method);
  assert.equal(response.status,status,`${value.status||value.role}: ${method} ${path}`);
  assert(!((await response.text()).includes(privateMarker)),path);
  assert.match(response.headers.get('cache-control'),/private, no-store/);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
 }
 assert(f.calls.every(call=>call.path==='/api/session'&&call.cookie==='session=test-browser'));
 assert.equal(f.network.length,0);
});

test('approved administrators, editors and viewers can load every report asset',async()=>{
 const f=fixture();
 for(const role of ['admin','editor','viewer'])for(const path of privatePaths){
  const response=await f.request(path,{session:session(role)});
  assert.equal(response.status,200,`${role}: ${path}`);
  assert.equal(await response.text(),privateMarker);
 }
 assert.equal(f.calls.length,3*privatePaths.length);
});

test('access form, brand assets and its font remain public without session lookups',async()=>{
 const f=fixture();
 for(const path of ['/acesso',...publicPaths]){
  const response=await f.request(path,{throwSession:true});
  assert.equal(response.status,200,path);
  assert(!((await response.text()).includes(privateMarker)),path);
 }
 for(const path of ['/favicon.ico','/assets/minerva-favicon.png','/assets/minerva-icon-192.jpg','/assets/minerva-apple-touch-icon.jpg','/assets/minerva-logo.webp']){
  const response=await f.request(path,{throwSession:true});
  assert.equal(response.status,200,path);
  assert.equal(await response.text(),'PUBLIC_BRAND_ICON');
 }
 assert.equal(f.calls.length,0);
 assert.equal(f.network.length,5);
 assert(f.network.every(url=>new URL(url).hostname==='minervafoods.com'));
});

test('home and index preserve the login screen until the report session is approved',async()=>{
 const f=fixture();
 for(const path of ['/','/index.html']){
  for(const value of [anonymous,{authenticated:true,approved:false,role:'viewer',status:'revoked'}]){
   const response=await f.request(path,{session:value});
   assert.equal(response.status,200);
   assert.equal(await response.text(),accessMarker);
  }
  const response=await f.request(path,{session:session('viewer')});
  assert.equal(response.status,200);
  assert.equal(await response.text(),privateMarker);
 }
});

test('session failures fail closed without returning report assets',async()=>{
 const f=fixture();
 for(const env of [{sessionStatus:503},{sessionStatus:500},{throwSession:true},{invalidSessionJson:true}]){
  const response=await f.request('/analysts.js',env);
  assert.equal(response.status,503);
  assert(!((await response.text()).includes(privateMarker)));
 }
 for(const status of [401,403]){
  const response=await f.request('/meetings.js',{sessionStatus:status,session:session('admin')});
  assert.equal(response.status,status);
  assert(!((await response.text()).includes(privateMarker)));
 }
});

test('unknown assets stay 404, APIs retain their handler, and unsupported asset methods stay 405',async()=>{
 const f=fixture();
 for(const env of [{},{session:session('admin')},{throwSession:true}]){
  const response=await f.request('/unknown-file.js',env);
  assert.equal(response.status,404);
  assert(!((await response.text()).includes(privateMarker)));
 }
 const invalidMethod=await f.request('/analysts.js',{},'POST');
 assert.equal(invalidMethod.status,405);
 assert.equal(f.calls.length,0);
 const response=await f.request('/api/example',{},'POST');
 assert.equal(response.status,202);
 assert.deepEqual(await response.json(),{api:true});
 assert.deepEqual(f.calls.map(call=>({path:call.path,method:call.method})),[{path:'/api/example',method:'POST'}]);
});
