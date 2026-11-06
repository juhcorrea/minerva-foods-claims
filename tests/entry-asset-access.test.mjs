import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../worker/entry.js',import.meta.url),'utf8');
const origin='https://claims-assets.example.test';
const publicPaths=['/access.html','/access.css','/access.js','/site.webmanifest','/assets/minerva-logo.png','/assets/montserrat-latin.woff2'];
const privatePaths=['/analysts.js','/meetings.js','/engine.js','/app.js','/team.js','/styles.css','/executive.js','/executive.css','/executive-shell.css','/claim-control.js','/claim-control.css','/calculation-rules.js','/presentation-mode.js','/presentation-mode.css','/vendor/pptxgen.bundle.js','/assets/minerva-cover.png','/future-report.js'];
const privateMarker='PRIVATE_REPORT_CONFIGURATION';
const accessMarker='PUBLIC_ACCESS_FORM';
const anonymous={authenticated:false,approved:false,role:'visitor'};
const session=role=>({authenticated:true,approved:true,role});

function fixture(){
 const calls=[],network=[];
 const paths=[...publicPaths,...privatePaths,'/index.html'];
 const assets=Object.fromEntries(paths.map(path=>[path,{type:path.endsWith('.html')?'text/html':'application/octet-stream',body:Buffer.from(path==='/access.html'?accessMarker:publicPaths.includes(path)?'PUBLIC_BRAND_ASSET':privateMarker).toString('base64')}]));
 const context={
  Request,Response,Headers,URL,Uint8Array,atob,
  ClaimsEngine:{},MIGRATION_SOURCE:{base64:''},STATIC_ASSETS:assets,
  createApiHandler:()=>async(request,env)=>{
   calls.push({path:new URL(request.url).pathname,method:request.method,cookie:request.headers.get('cookie')});
   if(new URL(request.url).pathname==='/api/session'){
    if(env.throwSession)throw new Error('Storage unavailable');
    if(env.invalidSessionJson)return new Response('{',{status:200});
    return Response.json(env.session??anonymous,{status:env.sessionStatus??200});
   }
   return Response.json({api:true},{status:202});
  },
  fetch:async url=>{network.push(url);return new Response('PUBLIC_BRAND_ICON',{headers:{'content-type':'image/png'}});},
 };
 vm.runInNewContext(source.replace('export default {','globalThis.worker = {'),context,{filename:'worker/entry.js'});
 return {calls,network,request:(path,env={},method='GET')=>context.worker.fetch(new Request(origin+path,{method,headers:{cookie:'session=test-browser'}}),env,{})};
}

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
