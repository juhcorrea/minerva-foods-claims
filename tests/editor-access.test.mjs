import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createApiHandler,apiConstants} from '../worker/backend.js';
const require=createRequire(import.meta.url);
const engine=require('../dist/engine.js');
const handler=createApiHandler({engine});
const origin='https://claims.example.test';
const tokens={owner:Buffer.alloc(32,1).toString('base64url'),developer:Buffer.alloc(32,2).toString('base64url')};
const digest=value=>createHash('sha256').update(value).digest('hex');
const configs=()=>[{id:'owner',name:'Owner',email:'owner@example.invalid',tokenHash:digest(tokens.owner)},{id:'developer',name:'Developer',email:'developer@example.invalid',tokenHash:digest(tokens.developer)}];
class MemoryR2{
 objects=new Map();serial=0;failNextConditional=false;
 async get(key){const o=this.objects.get(key);return o?{etag:o.etag,customMetadata:{...o.customMetadata},json:async()=>JSON.parse(o.text)}:null;}
 async head(key){const o=this.objects.get(key);return o?{etag:o.etag,customMetadata:{...o.customMetadata}}:null;}
 async put(key,text,options={}){const old=this.objects.get(key);if(this.failNextConditional&&key.includes('report-')){this.failNextConditional=false;return null;}if(options.onlyIf?.etagMatches&&options.onlyIf.etagMatches!==old?.etag)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const value={text,etag:'etag-'+(++this.serial),customMetadata:{...options.customMetadata}};this.objects.set(key,value);return{etag:value.etag};}
 async delete(key){this.objects.delete(key);}
}
const environment=()=>({ADMIN_LINK_HASHES:JSON.stringify(configs()),BUCKET:new MemoryR2()});
function request(path,cookie=null,options={}){const headers=new Headers(options.headers||{});if(cookie)headers.set('cookie',cookie);const method=options.method||'GET';if(!['GET','HEAD'].includes(method)&&options.csrf!==false){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}return new Request(origin+path,{method,headers,body:options.body===undefined?undefined:typeof options.body==='string'?options.body:JSON.stringify(options.body)});}
async function call(env,path,cookie=null,options={},api=handler){const r=await api(request(path,cookie,options),env);return{status:r.status,headers:r.headers,cookie:r.headers.get('set-cookie')?.split(';')[0],body:await r.json()};}
async function login(env,id='owner',api=handler){return call(env,'/api/auth/exchange',null,{method:'POST',body:{token:tokens[id]}},api);}
async function ask(env,name='Pessoa Teste',cookie=null,api=handler){return call(env,'/api/auth/request',cookie,{method:'POST',body:{name,email:'contato@qualquer-dominio.example'}},api);}
async function approve(env,admin,id){return call(env,'/api/members/'+id+'/approve',admin,{method:'POST',body:{}});}

function sampleInput() {
  const bdHeader = Array(57).fill('');
  Object.assign(bdHeader, {0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
  const controlHeader = Array(32).fill('');
  Object.assign(controlHeader, {1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
  const claim = Array(57).fill(null);
  Object.assign(claim, {0:'CLAIM-1',1:'2025-11-06',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'SO/DEMO-4',24:99101,25:'EXPORTAÇÃO - CARRETA',28:'FORNECEDOR TESTE',35:1000});
  const paid = Array(32).fill(null);
  Object.assign(paid, {1:2026,3:'MERCADO EXTERNO',7:'SO/DEMO-4',9:'CONF-1',10:'FORNECEDOR TESTE LTDA',11:'Boleto',12:'Pago',13:'2026-02-28',14:250,17:'2026-02-28',19:250,23:'Reembolsado',30:2026,31:'Analista QA'});
  const open = [...paid];Object.assign(open,{12:'Dentro do Prazo',13:null,17:null,19:0,23:'Aguardando Pagamento'});
  const unrelated = [...paid];Object.assign(unrelated,{7:'UNRELATED-SECRET',10:'OTHER-SECRET',19:999});
  return {bd:[bdHeader, claim],control:[controlHeader, paid, open, unrelated],files:{bd:'BD.xlsx',control:'Controle.xlsx'},asOf:'2026-10-30'};
}
const rolePath=id=>'/api/members/'+id+'/role';
const setRole=(env,admin,id,role)=>call(env,rolePath(id),admin.cookie,{method:'POST',body:{role}});
const publish=(env,cookie,input=sampleInput())=>call(env,'/api/report',cookie,{method:'POST',body:input});

test('editor grant enables publishing and correction follow-up without access management',async()=>{
 const env=environment(),admin=await login(env),member=await ask(env,'Analista de operações');
 await approve(env,admin.cookie,member.body.userId);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer');
 assert.equal((await publish(env,member.cookie)).status,403);
 const grant=await setRole(env,admin,member.body.userId,'editor');assert.equal(grant.status,200);assert.equal(grant.body.member.role,'editor');
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'editor');
 const published=await publish(env,member.cookie);assert.equal(published.status,200);assert.equal(published.body.updatedBy,'Analista de operações');
 const saved=JSON.parse(env.BUCKET.objects.get('private/report-latest-v1.json').text);
 assert.equal(saved.updatedByUserId,member.body.userId);assert.equal(saved.updatedBy,'Analista de operações');
 const historical=await call(env,'/api/report?years=2025,2026',member.cookie),group=historical.body.model.correctionGroups[0];assert(group);
 const marked=await call(env,'/api/correction-progress',member.cookie,{method:'POST',body:{key:group.progress.key,done:true,reportRevision:published.body.revision,options:{years:[2025,2026]}}});
 assert.equal(marked.status,200);assert.equal(marked.body.progress.updatedBy,'Analista de operações');
 const another=await ask(env,'Outra pessoa');
 assert.equal((await call(env,'/api/members',member.cookie)).status,403);
 assert.equal((await approve(env,member.cookie,another.body.userId)).status,403);
 assert.equal((await call(env,'/api/members/'+another.body.userId,member.cookie,{method:'DELETE',body:{}})).status,403);
 assert.equal((await setRole(env,member,member.body.userId,'viewer')).status,403);
 assert.equal((await setRole(env,member,another.body.userId,'editor')).status,403);
 const roster=await call(env,'/api/members',admin.cookie);
 assert.equal(roster.body.members.find(m=>m.id===member.body.userId).role,'editor');
 assert(roster.body.audit.some(e=>e.action==='access_role_changed'&&e.target===member.body.userId&&e.previousRole==='viewer'&&e.role==='editor'&&e.actorId==='owner'));
});

test('downgrade, revocation and legacy members obey the current ACL on existing sessions',async()=>{
 const env=environment(),admin=await login(env),member=await ask(env);await approve(env,admin.cookie,member.body.userId);
 // Existing records predate roles and must stay read-only.
 const aclKey='private/access-v3.json',object=env.BUCKET.objects.get(aclKey),legacy=JSON.parse(object.text);delete legacy.members[member.body.userId].role;object.text=JSON.stringify(legacy);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer');
 assert.equal((await call(env,'/api/members',admin.cookie)).body.members[0].role,'viewer');
 await setRole(env,admin,member.body.userId,'editor');const published=await publish(env,member.cookie);assert.equal(published.status,200);
 const group=(await call(env,'/api/report?years=2025,2026',member.cookie)).body.model.correctionGroups[0];
 assert.equal((await setRole(env,admin,member.body.userId,'viewer')).status,200);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer');
 assert.equal((await publish(env,member.cookie)).status,403);
 assert.equal((await call(env,'/api/correction-progress',member.cookie,{method:'POST',body:{key:group.progress.key,done:true,reportRevision:published.body.revision,options:{years:[2025,2026]}}})).status,403);
 assert.equal((await call(env,'/api/report',member.cookie)).status,200);
 await setRole(env,admin,member.body.userId,'editor');
 assert.equal((await call(env,'/api/members/'+member.body.userId,admin.cookie,{method:'DELETE',body:{}})).status,200);
 assert.equal((await publish(env,member.cookie)).status,403);assert.equal((await call(env,'/api/report',member.cookie)).status,403);
 await approve(env,admin.cookie,member.body.userId);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer','Reapproval starts read-only after a revocation');
 assert.equal((await publish(env,member.cookie)).status,403);
});

test('role changes reject unapproved members, escalation, invalid bodies and missing CSRF',async()=>{
 const env=environment(),admin=await login(env),member=await ask(env);
 assert.equal((await setRole(env,admin,member.body.userId,'editor')).status,409);
 await approve(env,admin.cookie,member.body.userId);
 for(const body of [{},{role:'owner'},{role:null},{role:1},{role:'editor',approved:true}])assert.equal((await call(env,rolePath(member.body.userId),admin.cookie,{method:'POST',body})).status,400);
 assert.equal((await call(env,rolePath(member.body.userId),admin.cookie,{method:'POST',body:{role:'editor'},csrf:false})).status,403);
 assert.equal((await setRole(env,admin,'owner','viewer')).status,400);assert.equal((await setRole(env,admin,'developer','viewer')).status,400);
 assert.equal((await call(env,rolePath(member.body.userId),null,{method:'POST',body:{role:'editor'}})).status,401);
 assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Pretend admin',role:'editor'}})).status,400);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer');
});

test('editor downgrade during upload is checked again before committing the snapshot',async()=>{
 const env=environment(),admin=await login(env),member=await ask(env);await approve(env,admin.cookie,member.body.userId);await setRole(env,admin,member.body.userId,'editor');
 const existing=await publish(env,admin.cookie),before=env.BUCKET.objects.get('private/report-latest-v1.json').text;
 let triggered=false;const originalGet=env.BUCKET.get.bind(env.BUCKET);
 env.BUCKET.get=async key=>{
  if(key==='private/report-latest-v1.json'&&!triggered){triggered=true;assert.equal((await setRole(env,admin,member.body.userId,'viewer')).status,200);}
  return originalGet(key);
 };
 const attempt=await publish(env,member.cookie);assert.equal(attempt.status,403);assert.equal(attempt.body.code,'EDITOR_PERMISSION_CHANGED');
 assert.equal(env.BUCKET.objects.get('private/report-latest-v1.json').text,before);
 assert.equal((await call(env,'/api/report',admin.cookie)).body.revision,existing.body.revision);
});

test('reviewer marks and unmarks corrections but cannot publish or manage access',async()=>{
 const env=environment(),admin=await login(env),member=await ask(env,'Conferente QA');await approve(env,admin.cookie,member.body.userId);
 assert.equal((await setRole(env,member,member.body.userId,'reviewer')).status,403);
 assert.equal((await setRole(env,admin,member.body.userId,'reviewer')).status,200);
 assert.equal((await call(env,'/api/session',member.cookie)).body.role,'reviewer');
 const published=await publish(env,admin.cookie),before=env.BUCKET.objects.get('private/report-latest-v1.json').text;
 const report=await call(env,'/api/report?years=2025,2026',member.cookie),key=report.body.model.correctionGroups[0].progress.key;
 const body={key,done:true,reportRevision:published.body.revision,options:{years:[2025,2026]}};
 assert.equal((await call(env,'/api/correction-progress',member.cookie,{method:'POST',body,csrf:false})).status,403);
 for(const done of [true,false]){const result=await call(env,'/api/correction-progress',member.cookie,{method:'POST',body:{...body,done}});assert.equal(result.status,200);assert.equal(result.body.progress.done,done);assert.equal(result.body.progress.updatedBy,'Conferente QA');}
 assert.equal((await publish(env,member.cookie)).status,403);assert.equal((await call(env,'/api/members',member.cookie)).status,403);assert.equal((await call(env,'/api/migration/export',member.cookie)).status,403);
 assert.equal((await setRole(env,member,member.body.userId,'admin')).status,403);
 assert.equal(env.BUCKET.objects.get('private/report-latest-v1.json').text,before);
 const get=env.BUCKET.get.bind(env.BUCKET);let changed=false;
 env.BUCKET.get=async path=>{if(path==='private/correction-progress-v1.json'&&!changed){changed=true;await setRole(env,admin,member.body.userId,'viewer');}return get(path);};
 const denied=await call(env,'/api/correction-progress',member.cookie,{method:'POST',body});assert.equal(denied.status,403);assert.equal(denied.body.code,'PERMISSION_CHANGED');assert.equal(JSON.parse(env.BUCKET.objects.get('private/correction-progress-v1.json').text).entries[key].done,false);
});

test('delegated admins manage approved roles and requests; bootstrap administrators stay protected',async()=>{
 const env=environment(),admin=await login(env),delegate=await ask(env,'Admin delegado QA'),member=await ask(env,'Pessoa QA');
 assert.equal((await setRole(env,admin,delegate.body.userId,'admin')).status,409);await approve(env,admin.cookie,delegate.body.userId);await setRole(env,admin,delegate.body.userId,'admin');
 assert.equal((await call(env,'/api/session',delegate.cookie)).body.role,'admin');assert.equal((await call(env,'/api/members',delegate.cookie)).status,200);
 assert.equal((await approve(env,delegate.cookie,member.body.userId)).status,200);
 for(const role of ['reviewer','editor','admin','viewer']){const result=await setRole(env,delegate,member.body.userId,role);assert.equal(result.status,200);assert.equal((await call(env,'/api/session',member.cookie)).body.role,role);}
 for(const actor of [admin,delegate])for(const id of ['owner','developer']){
  assert.equal((await setRole(env,actor,id,'viewer')).status,400);
  assert.equal((await call(env,'/api/members/'+id,actor.cookie,{method:'DELETE',body:{}})).status,400);
  assert.equal((await call(env,'/api/members/'+id+'/request',actor.cookie,{method:'DELETE',body:{}})).status,400);
 }
 await setRole(env,delegate,member.body.userId,'admin');assert.equal((await call(env,'/api/members/'+member.body.userId,delegate.cookie,{method:'DELETE',body:{}})).status,200);await approve(env,delegate.cookie,member.body.userId);assert.equal((await call(env,'/api/session',member.cookie)).body.role,'viewer','Reapproval must not restore delegated administration');
 const roster=(await call(env,'/api/members',delegate.cookie)).body;assert(roster.audit.some(event=>event.action==='access_role_changed'&&event.actorId===delegate.body.userId));
 assert.equal((await setRole(env,delegate,delegate.body.userId,'viewer')).status,200);assert.equal((await call(env,'/api/members',delegate.cookie)).status,403);assert.equal((await setRole(env,delegate,delegate.body.userId,'admin')).status,403);
});

test('ACL conflict retry revalidates the delegated administrator before any target change',async()=>{
 const env=environment(),admin=await login(env),delegate=await ask(env,'Delegate QA'),member=await ask(env,'Target QA');
 for(const user of [delegate,member])await approve(env,admin.cookie,user.body.userId);await setRole(env,admin,delegate.body.userId,'admin');
 const key='private/access-v3.json',put=env.BUCKET.put.bind(env.BUCKET);let raced=false;
 env.BUCKET.put=async(path,text,options)=>{if(path===key&&!raced){raced=true;assert.equal((await setRole(env,admin,delegate.body.userId,'viewer')).status,200);}return put(path,text,options);};
 const result=await setRole(env,delegate,member.body.userId,'admin');assert.equal(result.status,403);assert.equal(result.body.code,'PERMISSION_CHANGED');
 const acl=JSON.parse(env.BUCKET.objects.get(key).text);assert.equal(acl.members[member.body.userId].role,'viewer');assert.equal(acl.members[delegate.body.userId].role,'viewer');assert(acl.admins.owner&&acl.admins.developer);
});

test('Owner supplemental activation preserves all primary links and isolates rotation',async()=>{
 const env=environment(),originalOwner=await login(env),originalDev=await login(env,'developer');
 const extraOwner=Buffer.alloc(32,21).toString('base64url'),extraDev=Buffer.alloc(32,22).toString('base64url');
 env.OWNER_ADMIN_LINK_HASH=digest(extraOwner);env.DEVELOPER_ADMIN_LINK_HASH=digest(extraDev);
 const activate=token=>call(env,'/api/auth/exchange',null,{method:'POST',body:{token}});
 const owner=await activate(extraOwner),dev=await activate(extraDev);
 assert.equal(owner.status,200);assert.equal(owner.body.userId,'owner');assert.equal(owner.body.name,'Owner');assert.equal(owner.body.role,'admin');
 assert.equal(dev.status,200);assert.equal(dev.body.userId,'developer');assert.equal(dev.body.name,'Desenvolvimento');
 const sessionKey='private/sessions/'+digest(owner.cookie.split('=')[1])+'.json';
 assert.equal(JSON.parse(env.BUCKET.objects.get(sessionKey).text).adminHash,digest(extraOwner));
 for(const record of env.BUCKET.objects.values()){assert(!record.text.includes(extraOwner));assert(!record.text.includes(extraDev));}
 env.OWNER_ADMIN_LINK_HASH=digest(Buffer.alloc(32,23).toString('base64url'));
 assert.equal((await activate(extraOwner)).status,401);assert.equal((await call(env,'/api/session',owner.cookie)).body.approved,false);
 for(const auth of [originalOwner,originalDev,dev])assert.equal((await call(env,'/api/session',auth.cookie)).body.approved,true);
 for(const id of ['owner','developer'])assert.equal((await login(env,id)).status,200);
});

test('Owner supplemental hashes reject malformed values and collisions with every other link',async()=>{
 for(const value of [null,'',1,{},'invalid','A'.repeat(64),digest(tokens.owner),digest(tokens.developer),digest('extra dev')]){
  const env=environment();env.DEVELOPER_ADMIN_LINK_HASH=digest('extra dev');env.OWNER_ADMIN_LINK_HASH=value;
  assert.equal((await call(env,'/api/session')).status,503);assert.equal(env.BUCKET.objects.size,0);
 }
});
