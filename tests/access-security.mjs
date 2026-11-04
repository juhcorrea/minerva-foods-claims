import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createApiHandler} from '../worker/backend.js';

const require = createRequire(import.meta.url);
const engine = require('../dist/engine.js');
const handler = createApiHandler({engine});
const ORIGIN = 'https://claims-security.example.test';
const ADMIN_TOKEN = 'A'.repeat(43);
const OTHER_ADMIN_TOKEN = 'B'.repeat(43);
const sha = async value => Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))).toString('hex');

class MemoryBucket {
  constructor() {this.objects = new Map();this.sequence=0;}
  async get(key) {const obj=this.objects.get(key);return obj?{etag:obj.etag,customMetadata:obj.meta,json:async()=>JSON.parse(obj.value),text:async()=>obj.value}:null;}
  async head(key) {const obj=this.objects.get(key);return obj?{etag:obj.etag,customMetadata:obj.meta}:null;}
  async put(key,value,options={}) {
    const old=this.objects.get(key);
    if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;
    if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;
    const etag='security-etag-'+(++this.sequence);
    this.objects.set(key,{value:String(value),etag,meta:options.customMetadata||{}});
    return {etag};
  }
  async delete(key) {this.objects.delete(key);}
}

async function environment() {
  const admins=[
    {id:'owner',name:'Owner',email:'owner@example.invalid',tokenHash:await sha(ADMIN_TOKEN)},
    {id:'developer',name:'Developer',email:'developer@example.invalid',tokenHash:await sha(OTHER_ADMIN_TOKEN)},
  ];
  return {BUCKET:new MemoryBucket(),ADMIN_LINK_HASHES:JSON.stringify(admins)};
}

async function call(env,path,{method='GET',body,cookie,headers={},csrf=true}={}) {
  const h=new Headers(headers);
  if(cookie)h.set('Cookie',cookie);
  if(method!=='GET'&&method!=='HEAD') {
    if(!h.has('Content-Type'))h.set('Content-Type','application/json');
    if(csrf){h.set('Origin',ORIGIN);h.set('X-Minerva-Request','1');}
  }
  const r=await handler(new Request(ORIGIN+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env);
  const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={text};}
  return {status:r.status,data,text,headers:r.headers,cookie:r.headers.get('Set-Cookie')?.split(';')[0]};
}
async function admin(env,token=ADMIN_TOKEN) {
  const result=await call(env,'/api/auth/exchange',{method:'POST',body:{token}});
  assert.equal(result.status,200,JSON.stringify(result.data));
  assert(result.cookie,'Activation must issue a cookie');
  return result;
}
async function pending(env,name='Security Viewer') {
  const result=await call(env,'/api/auth/request',{method:'POST',body:{name}});
  assert([200,201].includes(result.status),JSON.stringify(result.data));
  assert(result.cookie,'Access request must issue a cookie');
  return result;
}
async function memberId(env,adminCookie,name) {
  const list=await call(env,'/api/members',{cookie:adminCookie});
  assert.equal(list.status,200);const item=list.data.members.find(m=>m.name===name);assert(item,'Pending request must be listed');return item.id;
}

test('untrusted ChatGPT identity headers never grant report or admin access',async()=>{
  const env=await environment();
  const forged={'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.invalid','X-Forwarded-User':'owner'};
  const session=await call(env,'/api/session',{headers:forged});
  assert.equal(session.status,200);assert.notEqual(session.data.role,'admin');assert.notEqual(session.data.approved,true);
  for(const path of ['/api/report','/api/report/meta','/api/members']){
    const r=await call(env,path,{headers:forged});assert([401,403].includes(r.status),path);assert(!r.text.includes('tokenHash'));
  }
});

test('activation uses secret only; cookie flags and stored credentials do not reveal bearer values',async()=>{
  const env=await environment();const a=await admin(env);
  const set=a.headers.get('Set-Cookie');
  assert.match(set,/^__Host-minerva-session=/);assert.match(set,/;\s*Secure/i);assert.match(set,/;\s*HttpOnly/i);assert.match(set,/;\s*Path=\//i);assert.match(set,/;\s*SameSite=(Lax|Strict)/i);
  const stored=[...env.BUCKET.objects.values()].map(x=>x.value).join('\n');
  assert(!stored.includes(ADMIN_TOKEN));assert(!stored.includes(a.cookie.split('=')[1]));
  for(const path of ['/api/session','/api/members']){
    const r=await call(env,path,{cookie:a.cookie});assert.equal(r.status,200);assert(!r.text.includes(ADMIN_TOKEN));assert(!r.text.includes('tokenHash'));assert(!r.text.includes(a.cookie.split('=')[1]));assert.match(r.headers.get('Cache-Control'),/no-store/);assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);
  }
});

test('a pending person cannot approve self, set role in payload, or see another request',async()=>{
  const env=await environment();const a=await admin(env);const p=await pending(env,'Viewer One');const id=await memberId(env,a.cookie,'Viewer One');
  const self=await call(env,'/api/members/'+encodeURIComponent(id)+'/approve',{method:'POST',body:{role:'admin'},cookie:p.cookie});assert.equal(self.status,403);
  const rerole=await call(env,'/api/auth/request',{method:'POST',body:{name:'Owner',email:'owner@example.invalid',role:'admin',approved:true},cookie:p.cookie});assert.equal(rerole.status,400);
  const s=await call(env,'/api/session',{cookie:p.cookie});assert.notEqual(s.data.role,'admin');assert.notEqual(s.data.approved,true);
  assert.equal((await call(env,'/api/members',{cookie:p.cookie})).status,403);
  assert.equal((await call(env,'/api/report',{cookie:p.cookie})).status,403);
});

test('approval and revocation apply to this browser session, not matching user-supplied names',async()=>{
  const env=await environment();const a=await admin(env);const p=await pending(env,'Same Name');
  const id=await memberId(env,a.cookie,'Same Name');
  const grant=await call(env,'/api/members/'+encodeURIComponent(id)+'/approve',{method:'POST',body:{},cookie:a.cookie});assert.equal(grant.status,200);
  assert.equal((await call(env,'/api/session',{cookie:p.cookie})).data.role,'viewer');
  const copy=await pending(env,'Same Name');assert.notEqual(copy.cookie,p.cookie);assert.equal((await call(env,'/api/report',{cookie:copy.cookie})).status,403);
  assert.equal((await call(env,'/api/members/'+encodeURIComponent(id),{method:'DELETE',body:{},cookie:a.cookie})).status,200);
  for(const path of ['/api/report','/api/report/meta'])assert.equal((await call(env,path,{cookie:p.cookie})).status,403);
  const revoked=await call(env,'/api/session',{cookie:p.cookie});assert.notEqual(revoked.data.approved,true);
  assert.equal((await call(env,'/api/members/'+encodeURIComponent(id)+'/approve',{method:'POST',body:{},cookie:a.cookie})).status,200);
  assert.equal((await call(env,'/api/session',{cookie:p.cookie})).data.role,'viewer');
});

test('admin secret rotation invalidates old admin sessions and old links',async()=>{
  const env=await environment();const a=await admin(env);const links=JSON.parse(env.ADMIN_LINK_HASHES);links[0].tokenHash=await sha('C'.repeat(43));env.ADMIN_LINK_HASHES=JSON.stringify(links);
  const oldSession=await call(env,'/api/session',{cookie:a.cookie});assert.notEqual(oldSession.data.approved,true);
  assert([401,403].includes((await call(env,'/api/members',{cookie:a.cookie})).status));
  assert([400,401,403].includes((await call(env,'/api/auth/exchange',{method:'POST',body:{token:ADMIN_TOKEN}})).status));
  const fresh=await admin(env,'C'.repeat(43));assert.equal((await call(env,'/api/session',{cookie:fresh.cookie})).data.role,'admin');
});

test('all credential and authorization mutations reject cross-origin or simple requests',async()=>{
  const env=await environment();const a=await admin(env);const p=await pending(env,'CSRF Viewer');const id=await memberId(env,a.cookie,'CSRF Viewer');
  for(const [path,body,cookie]of [
    ['/api/auth/exchange',{token:ADMIN_TOKEN},undefined],['/api/auth/request',{name:'Attack'},undefined],['/api/auth/logout',{},a.cookie],['/api/members/'+id+'/approve',{},a.cookie],
  ]) {
    const noOrigin=await call(env,path,{method:'POST',body,cookie,csrf:false});assert.equal(noOrigin.status,403,path);
    const cross=await call(env,path,{method:'POST',body,cookie,csrf:false,headers:{Origin:'https://evil.example','X-Minerva-Request':'1'}});assert.equal(cross.status,403,path);
  }
  const viewer=await call(env,'/api/session',{cookie:p.cookie});assert.notEqual(viewer.data.approved,true);
});

test('logout invalidates a captured session cookie rather than only clearing the browser',async()=>{
  const env=await environment();const a=await admin(env);
  const out=await call(env,'/api/auth/logout',{method:'POST',body:{},cookie:a.cookie});assert.equal(out.status,200);
  assert([401,403].includes((await call(env,'/api/members',{cookie:a.cookie})).status));
  const session=await call(env,'/api/session',{cookie:a.cookie});assert.notEqual(session.data.approved,true);
});

test('tokens in query strings and duplicate or malformed cookies do not authorize',async()=>{
  const env=await environment();const a=await admin(env);
  const invalid=[a.cookie+'; '+a.cookie,'__Host-minerva-session=__proto__','__Host-minerva-session=../../access-v3.json'];
  for(const cookie of invalid){const r=await call(env,'/api/session',{cookie});assert.notEqual(r.data.approved,true);assert.equal((await call(env,'/api/report',{cookie})).status,401);}
  const query=await call(env,'/api/report?token='+ADMIN_TOKEN+'&role=admin');assert.equal(query.status,401);
});

test('a persisted session expires server-side at the original thirty-day deadline',async()=>{
  const env=await environment();const a=await admin(env);
  for(const obj of env.BUCKET.objects.values()){
    const data=JSON.parse(obj.value);
    if(data.role==='admin'&&data.expiresAt){data.expiresAt='2000-01-01T00:00:00.000Z';obj.value=JSON.stringify(data);}
  }
  const s=await call(env,'/api/session',{cookie:a.cookie});assert.equal(s.data.status,'expired');assert.equal(s.data.approved,false);assert.match(s.headers.get('Set-Cookie'),/Max-Age=0/);
  assert.equal((await call(env,'/api/report',{cookie:a.cookie})).status,401);
});
