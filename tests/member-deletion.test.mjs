import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {createApiHandler, apiConstants} from '../worker/backend.js';

const require=createRequire(import.meta.url);
const handler=createApiHandler({engine:require('../dist/engine.js')});
const origin='https://claims.example.test';
const ACL_KEY='private/access-v3.json';
const digest=value=>createHash('sha256').update(value).digest('hex');

class MemoryR2 {
 objects=new Map();serial=0;beforePut=null;
 async get(key){const value=this.objects.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null;}
 async put(key,text,options={}){
  if(this.beforePut&&await this.beforePut(key,text,options)===false)return null;
  const previous=this.objects.get(key);
  if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==previous?.etag)return null;
  if(options.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;
  const value={text,etag:'etag-'+(++this.serial)};this.objects.set(key,value);return{etag:value.etag};
 }
 async delete(key){this.objects.delete(key);}
}
function environment(){
 const tokens=apiConstants.adminIds.map(()=>randomBytes(32).toString('base64url'));
 return{tokens,BUCKET:new MemoryR2(),ADMIN_LINK_HASHES:JSON.stringify(apiConstants.adminIds.map((id,i)=>({id,name:'Administração de teste '+(i+1),email:'admin'+(i+1)+'@example.invalid',tokenHash:digest(tokens[i])})))};
}
async function call(env,path,cookie=null,{method='GET',body,csrf=true,headers:extra={}}={}){
 const headers=new Headers(extra);
 if(cookie)headers.set('cookie',cookie);
 if(method!=='GET'&&csrf){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}
 const response=await handler(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
 return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
const login=env=>call(env,'/api/auth/exchange',null,{method:'POST',body:{token:env.tokens[0]}});
const request=(env,name='Pessoa de demonstração',cookie=null)=>call(env,'/api/auth/request',cookie,{method:'POST',body:{name,email:'contato@example.invalid'}});
const approve=(env,admin,id)=>call(env,'/api/members/'+id+'/approve',admin.cookie,{method:'POST',body:{}});
const revoke=(env,admin,id)=>call(env,'/api/members/'+id,admin.cookie,{method:'DELETE'});
const remove=(env,admin,id,options={})=>call(env,'/api/members/'+id+'/request',admin?.cookie,{method:'DELETE',...options});
const acl=env=>JSON.parse(env.BUCKET.objects.get(ACL_KEY).text);

test('deleting a pending request removes it from the roster, invalidates its cookie and leaves other data intact',async()=>{
 const env=environment(),admin=await login(env),member=await request(env),other=await request(env,'Outra pessoa fictícia');
 await env.BUCKET.put('private/report-latest-v1.json',JSON.stringify({revision:'synthetic-report',updatedAt:'2026-01-01T00:00:00.000Z',updatedBy:'Equipe de teste'}));
 const reportBefore=env.BUCKET.objects.get('private/report-latest-v1.json').text;
 const before=acl(env),result=await remove(env,admin,member.body.userId);
 assert.equal(result.status,200);assert.equal(result.body.deleted,true);assert.equal(result.body.id,member.body.userId);assert.notEqual(result.body.revision,before.revision);
 const after=acl(env);
 assert.equal(after.members[member.body.userId],undefined);
 assert.deepEqual(after.members[other.body.userId],before.members[other.body.userId]);
 assert.deepEqual(after.admins,before.admins);
 assert.equal(env.BUCKET.objects.get('private/report-latest-v1.json').text,reportBefore);
 const list=await call(env,'/api/members',admin.cookie);
 assert.deepEqual(list.body.members.map(m=>m.id),[other.body.userId]);
 const event=after.audit.find(e=>e.action==='access_request_deleted');
 assert.deepEqual(Object.keys(event).sort(),['action','actorId','at','previousStatus','target']);
 assert.equal(event.target,member.body.userId);assert.equal(event.previousStatus,'pending');assert.equal(event.actorId,apiConstants.adminIds[0]);
 assert(!JSON.stringify(result.body).includes(member.body.name));assert(!JSON.stringify(event).includes(member.body.email));
 const expired=await call(env,'/api/session',member.cookie);
 assert.equal(expired.body.authenticated,false);assert.equal(expired.body.approved,false);assert(expired.headers.get('set-cookie').includes('Max-Age=0'));
 assert.equal((await call(env,'/api/report',member.cookie)).status,401);
 assert.equal((await approve(env,admin,member.body.userId)).status,404);
 assert.equal((await remove(env,admin,member.body.userId)).status,404);
 const replacement=await request(env,'Pessoa de demonstração',member.cookie);
 assert.equal(replacement.status,201);assert.notEqual(replacement.body.userId,member.body.userId);assert.equal(replacement.body.approved,false);
});

test('approved members must be revoked first; revoked and legacy rejected requests can be deleted',async()=>{
 const env=environment(),admin=await login(env),member=await request(env);
 await approve(env,admin,member.body.userId);
 const before=env.BUCKET.objects.get(ACL_KEY).text;
 const blocked=await remove(env,admin,member.body.userId);
 assert.equal(blocked.status,409);assert.equal(blocked.body.code,'MEMBER_STILL_APPROVED');assert.equal(env.BUCKET.objects.get(ACL_KEY).text,before);
 assert.equal((await revoke(env,admin,member.body.userId)).status,200);
 assert.equal(acl(env).members[member.body.userId].status,'revoked','Existing DELETE endpoint still revokes, without removing');
 assert.equal((await remove(env,admin,member.body.userId)).status,200);
 assert.equal((await call(env,'/api/session',member.cookie)).body.authenticated,false);
 const legacy=await request(env,'Pedido rejeitado de teste'),state=acl(env);
 state.members[legacy.body.userId].status='rejected';await env.BUCKET.put(ACL_KEY,JSON.stringify(state));
 assert.equal((await remove(env,admin,legacy.body.userId)).status,200);
 assert.equal(acl(env).members[legacy.body.userId],undefined);
});

test('deletion is admin-only, protects administrator identities, and requires the current-origin mutation headers',async()=>{
 const env=environment(),admin=await login(env),member=await request(env),viewer=await request(env,'Consulta fictícia'),editor=await request(env,'Edição fictícia');
 await approve(env,admin,viewer.body.userId);await approve(env,admin,editor.body.userId);
 assert.equal((await call(env,'/api/members/'+editor.body.userId+'/role',admin.cookie,{method:'POST',body:{role:'editor'}})).status,200);
 const before=env.BUCKET.objects.get(ACL_KEY).text;
 assert.equal((await remove(env,null,member.body.userId)).status,401);
 for(const actor of [member,viewer,editor])assert.equal((await remove(env,actor,member.body.userId)).status,403);
 for(const id of [...apiConstants.adminIds,'invalid-id'])assert.equal((await remove(env,admin,id)).status,400);
 assert.equal((await remove(env,admin,randomUUID())).status,404);
 assert.equal((await remove(env,admin,member.body.userId,{csrf:false})).status,403);
 assert.equal((await remove(env,admin,member.body.userId,{csrf:false,headers:{origin:'https://untrusted.example','content-type':'application/json','x-minerva-request':'1'}})).status,403);
 assert.equal(env.BUCKET.objects.get(ACL_KEY).text,before);
});

test('simultaneous deletions retry conditional writes and preserve unrelated requests',async()=>{
 const env=environment(),admin=await login(env),first=await request(env,'Teste um'),second=await request(env,'Teste dois'),third=await request(env,'Teste preservado');
 const results=await Promise.all([remove(env,admin,first.body.userId),remove(env,admin,second.body.userId)]);
 assert(results.every(r=>r.status===200));assert.deepEqual(Object.keys(acl(env).members),[third.body.userId]);
 assert.equal(acl(env).audit.filter(e=>e.action==='access_request_deleted').length,2);
});

test('approval winning a concurrent write prevents deletion on retry',async()=>{
 const env=environment(),admin=await login(env),member=await request(env);
 let raced=false;
 env.BUCKET.beforePut=async(key,text)=>{
  if(key!==ACL_KEY||JSON.parse(text).members[member.body.userId])return;
  env.BUCKET.beforePut=null;raced=true;
  assert.equal((await approve(env,admin,member.body.userId)).status,200);
 };
 const result=await remove(env,admin,member.body.userId);
 assert(raced);assert.equal(result.status,409);assert.equal(result.body.code,'MEMBER_STILL_APPROVED');
 assert.equal(acl(env).members[member.body.userId].status,'approved');
 assert.equal(acl(env).audit.some(e=>e.action==='access_request_deleted'),false);
 assert.equal((await call(env,'/api/session',member.cookie)).body.approved,true);
});

test('exhausted conditional-write conflicts do not remove or audit the request',async()=>{
 const env=environment(),admin=await login(env),member=await request(env),before=env.BUCKET.objects.get(ACL_KEY).text;
 let failures=0;
 env.BUCKET.beforePut=(key,text)=>{if(key===ACL_KEY&&!JSON.parse(text).members[member.body.userId]){failures++;return false;}};
 const result=await remove(env,admin,member.body.userId);
 assert.equal(result.status,409);assert.equal(result.body.code,'ACCESS_CHANGED');assert.equal(failures,4);
 assert.equal(env.BUCKET.objects.get(ACL_KEY).text,before);
});
