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



test('anonymous session is structured and ChatGPT headers cannot authorize',async()=>{
 const env=environment();const session=await call(env,'/api/session');assert.equal(session.status,200);assert.equal(session.body.authenticated,false);assert.equal(session.body.status,'anonymous');
 assert.equal((await call(env,'/api/report')).status,401);
 const forged=await call(env,'/api/report',null,{headers:{'oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.invalid','x-role':'admin'}});assert.equal(forged.status,401);assert.equal(env.BUCKET.objects.size,0);
});
test('missing storage and malformed admin hash roster fail closed',async()=>{
 assert.equal((await call({ADMIN_LINK_HASHES:JSON.stringify(configs())},'/api/session')).status,503);
 for(const roster of [null,[],[configs()[0]],[...configs(),{id:'owner',tokenHash:digest('x')}],[configs()[0],{...configs()[1],tokenHash:configs()[0].tokenHash}],[configs()[0],{...configs()[1],tokenHash:'bad'}]])assert.equal((await call({BUCKET:new MemoryR2(),ADMIN_LINK_HASHES:JSON.stringify(roster)},'/api/session')).status,503);
});
test('admin secret exchange creates a secure opaque cookie; storage has only hashes',async()=>{
 const env=environment();const auth=await login(env);assert.equal(auth.status,200);assert.equal(auth.body.role,'admin');assert.equal(auth.body.name,'Owner');assert.equal(auth.body.accessToken,undefined);
 const header=auth.headers.get('set-cookie');for(const part of ['__Host-minerva-session=','HttpOnly','Secure','SameSite=Lax','Path=/','Max-Age=2592000'])assert(header.includes(part));
 const raw=auth.cookie.split('=')[1];assert.equal(raw.length,43);assert.notEqual(raw,tokens.owner);
 for(const[key,o]of env.BUCKET.objects){assert(!key.includes(raw));assert(!o.text.includes(raw));assert(!o.text.includes(tokens.owner));assert(!o.text.includes(tokens.developer));}
 const session=await call(env,'/api/session',auth.cookie);assert.equal(session.body.userId,'owner');assert.equal(session.body.approved,true);
});
test('both configured admin links activate; links remain reusable until rotation',async()=>{
 for(const order of [['owner','developer'],['developer','owner']]){const env=environment();const results=await Promise.all(order.map(id=>login(env,id)));assert(results.every(r=>r.status===200&&r.body.role==='admin'));assert.equal((await login(env,'owner')).status,200);const list=await call(env,'/api/members',results[0].cookie);assert.deepEqual(new Set(list.body.admins.map(a=>a.id)),new Set(['owner','developer']));assert.equal(list.body.admins.some(a=>'tokenHash'in a),false);}
});
test('supplemental link activates only Developer while preserving both primary links and sessions',async()=>{
 const env=environment();const primary=await Promise.all(['owner','developer'].map(id=>login(env,id)));
 const extra=Buffer.alloc(32,14).toString('base64url');env.DEVELOPER_ADMIN_LINK_HASH=digest(extra);
 const auth=await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:extra,id:'owner',name:'Forged',email:'owner@example.invalid'}});
 assert.equal(auth.status,200);assert.equal(auth.body.role,'admin');assert.equal(auth.body.userId,'developer');assert.equal(auth.body.name,'Desenvolvimento');assert.equal(auth.body.email,'');
 const session=await call(env,'/api/session',auth.cookie);assert.equal(session.body.userId,'developer');assert.equal(session.body.approved,true);
 for(let i=0;i<2;i++){const id=['owner','developer'][i];assert.equal((await login(env,id)).body.userId,id);assert.equal((await call(env,'/api/session',primary[i].cookie)).body.userId,id);}
 const pending=await ask(env);assert.equal((await approve(env,auth.cookie,pending.body.userId)).status,200);assert.equal((await call(env,'/api/session',pending.cookie)).body.role,'viewer');
 const list=await call(env,'/api/members',auth.cookie);assert.equal(list.body.admins.length,2);assert.deepEqual(new Set(list.body.admins.map(a=>a.id)),new Set(['owner','developer']));
 for(const data of [auth.body,session.body,list.body]){const serialized=JSON.stringify(data);assert(!serialized.includes('tokenHash'));assert(!serialized.includes(env.DEVELOPER_ADMIN_LINK_HASH));assert(!serialized.includes(extra));}
 const stored=JSON.parse(env.BUCKET.objects.get('private/sessions/'+digest(auth.cookie.split('=')[1])+'.json').text);assert.equal(stored.principalId,'developer');assert.equal(stored.adminHash,digest(extra));
 for(const value of env.BUCKET.objects.values())assert(!value.text.includes(extra));
 assert.equal((await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:Buffer.alloc(32,15).toString('base64url')}})).status,401);
});
test('invalid or duplicate supplemental configuration fails closed without replacing the primary roster',async()=>{
 for(const extra of [null,'',42,{},'not-a-hash','A'.repeat(64),digest(tokens.owner),digest(tokens.developer)]){
  const env=environment();env.DEVELOPER_ADMIN_LINK_HASH=extra;
  assert.equal((await call(env,'/api/session')).status,503);assert.equal((await login(env)).status,503);assert.equal(env.BUCKET.objects.size,0);
 }
});
test('supplemental rotation and removal revoke only sessions issued by that hash',async()=>{
 for(const operation of ['rotate','remove']){
  const env=environment();const primary=await Promise.all(['owner','developer'].map(id=>login(env,id)));
  const extra=Buffer.alloc(32,14).toString('base64url'),replacement=Buffer.alloc(32,16).toString('base64url');env.DEVELOPER_ADMIN_LINK_HASH=digest(extra);
  const auth=await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:extra}});assert.equal(auth.status,200);
  if(operation==='rotate')env.DEVELOPER_ADMIN_LINK_HASH=digest(replacement);else delete env.DEVELOPER_ADMIN_LINK_HASH;
  assert.equal((await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:extra}})).status,401);
  const expired=await call(env,'/api/session',auth.cookie);assert.equal(expired.body.status,'expired');assert.equal(expired.body.approved,false);assert(expired.headers.get('set-cookie').includes('Max-Age=0'));assert.equal((await call(env,'/api/report',auth.cookie)).status,401);
  for(let i=0;i<2;i++){const id=['owner','developer'][i];assert.equal((await login(env,id)).body.userId,id);assert.equal((await call(env,'/api/session',primary[i].cookie)).body.userId,id);}
  if(operation==='rotate'){const renewed=await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:replacement}});assert.equal(renewed.status,200);assert.equal(renewed.body.userId,'developer');assert.equal((await call(env,'/api/session',renewed.cookie)).body.role,'admin');}
 }
});
test('invalid token and identity supplied in body cannot grant administration',async()=>{
 const env=environment();for(const token of ['wrong',Buffer.alloc(32,7).toString('base64url')])assert.equal((await call(env,'/api/auth/exchange',null,{method:'POST',body:{token,role:'admin'}})).status,401);
 const role=await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Owner',role:'admin',email:'owner@example.invalid'}});assert.equal(role.status,400);
 const pending=await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Owner',email:'owner@example.invalid'}});assert.equal(pending.body.role,'requester');assert.equal(pending.body.approved,false);assert.equal((await call(env,'/api/report',pending.cookie)).status,403);
});
test('request requires a name but does not restrict or validate contact domain',async()=>{
 const env=environment();const r=await ask(env);assert.equal(r.status,201);assert.equal(r.body.status,'pending');assert.match(r.body.requestCode,/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);assert.equal(r.body.email,'contato@qualquer-dominio.example');
 assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:{name:''}})).status,400);
 assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:{name:'A'.repeat(121)}})).status,400);
 const noEmail=await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Sem Contato'}});assert.equal(noEmail.status,201);assert.equal(noEmail.body.email,'');
});
test('same browser request is reused; matching name/contact on another device stays pending',async()=>{
 const env=environment();const admin=await login(env);const first=await ask(env,'Pessoa');const repeated=await ask(env,'Pessoa',first.cookie);assert.equal(repeated.status,200);assert.equal(repeated.body.userId,first.body.userId);
 await approve(env,admin.cookie,first.body.userId);assert.equal((await call(env,'/api/session',first.cookie)).body.role,'viewer');
 const clone=await ask(env,'Pessoa');assert.notEqual(clone.body.userId,first.body.userId);assert.equal(clone.body.approved,false);assert.equal((await call(env,'/api/report',clone.cookie)).status,403);
 assert.equal((await call(env,'/api/members',admin.cookie)).body.members.length,2);
});
test('only admins approve exact request IDs; viewer cannot publish or manage others',async()=>{
 const env=environment();const pending=await ask(env);assert.equal((await approve(env,pending.cookie,pending.body.userId)).status,403);
 const developer=await login(env,'developer');assert.equal((await approve(env,developer.cookie,pending.body.userId)).status,200);assert.equal((await call(env,'/api/session',pending.cookie)).body.approved,true);
 for(const path of ['/api/members','/api/report'])assert.equal((await call(env,path,pending.cookie,{method:'POST',body:sampleInput()})).status,403);
 assert.equal((await call(env,'/api/members',pending.cookie)).status,403);
 for(const id of ['owner','developer']){assert.equal((await approve(env,developer.cookie,id)).status,400);assert.equal((await call(env,'/api/members/'+id,developer.cookie,{method:'DELETE'})).status,400);}
});
test('revocation blocks current cookie immediately; explicit reapproval restores it',async()=>{
 const env=environment();const admin=await login(env);const visitor=await ask(env);await approve(env,admin.cookie,visitor.body.userId);
 assert.equal((await call(env,'/api/report',visitor.cookie)).status,200);
 assert.equal((await call(env,'/api/members/'+visitor.body.userId,admin.cookie,{method:'DELETE'})).status,200);
 const revoked=await call(env,'/api/session',visitor.cookie);assert.equal(revoked.status,200);assert.equal(revoked.body.status,'revoked');assert.equal(revoked.body.requestCode,visitor.body.requestCode);assert.equal(revoked.cookie,undefined);assert.equal((await call(env,'/api/report',visitor.cookie)).status,403);
 assert.equal((await ask(env,'Pessoa',visitor.cookie)).body.status,'revoked');
 await approve(env,admin.cookie,visitor.body.userId);assert.equal((await call(env,'/api/session',visitor.cookie)).body.role,'viewer');assert.equal((await call(env,'/api/report',visitor.cookie)).status,200);
});
test('logout invalidates server-side session, not just its browser cookie',async()=>{
 const env=environment();const admin=await login(env);const out=await call(env,'/api/auth/logout',admin.cookie,{method:'POST',body:{}});assert.equal(out.status,200);assert(out.headers.get('set-cookie').includes('Max-Age=0'));assert.equal((await call(env,'/api/report',admin.cookie)).status,401);assert.equal((await call(env,'/api/session',admin.cookie)).body.authenticated,false);
});
test('30-day expiry is enforced and contact matching never restores expired access',async()=>{
 let now=Date.parse('2026-10-30T12:00:00Z');const api=createApiHandler({engine,now:()=>now});const env=environment();const admin=await login(env,'owner',api);const visitor=await ask(env,'Pessoa',null,api);
 await call(env,'/api/members/'+visitor.body.userId+'/approve',admin.cookie,{method:'POST',body:{}},api);
 now+=30*86400000+1;const expired=await call(env,'/api/session',visitor.cookie,{},api);assert.equal(expired.body.status,'expired');assert.equal(expired.body.approved,false);assert(expired.headers.get('set-cookie').includes('Max-Age=0'));assert.equal((await call(env,'/api/report',visitor.cookie,{},api)).status,401);
 const again=await ask(env,'Pessoa',visitor.cookie,api);assert.equal(again.body.status,'pending');assert.notEqual(again.body.userId,visitor.body.userId);
});
test('rotating one admin hash rejects its old link and sessions but not the other admin',async()=>{
 const env=environment();const one=await login(env,'owner');const other=await login(env,'developer');const replacement=Buffer.alloc(32,9).toString('base64url');const roster=configs();roster[0].tokenHash=digest(replacement);env.ADMIN_LINK_HASHES=JSON.stringify(roster);
 assert.equal((await login(env,'owner')).status,401);assert.equal((await call(env,'/api/session',one.cookie)).body.status,'expired');assert.equal((await call(env,'/api/report',one.cookie)).status,401);assert.equal((await call(env,'/api/session',other.cookie)).body.role,'admin');
 const renewed=await call(env,'/api/auth/exchange',null,{method:'POST',body:{token:replacement}});assert.equal(renewed.status,200);assert.equal(renewed.body.userId,'owner');
});
test('CSRF protections apply to public auth as well as authenticated mutations',async()=>{
 const env=environment();for(const path of ['/api/auth/request','/api/auth/exchange','/api/auth/logout'])for(const headers of [{},{origin,'content-type':'application/json'},{origin:'https://evil.test','content-type':'application/json','x-minerva-request':'1'}])assert.equal((await call(env,path,null,{method:'POST',body:{name:'Pessoa',token:tokens.owner},csrf:false,headers})).status,403);
 assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:'name=Pessoa',csrf:false,headers:{origin,'content-type':'text/plain','x-minerva-request':'1'}})).status,415);
 assert.equal(env.BUCKET.objects.size,0);
});
test('public request rate and capacity are bounded without granting access',async()=>{
 const env=environment();for(let n=0;n<60;n++)assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Pessoa '+n},headers:{'cf-connecting-ip':'192.0.2.1'}})).status,201);
 assert.equal((await call(env,'/api/auth/request',null,{method:'POST',body:{name:'Pessoa 61'},headers:{'cf-connecting-ip':'192.0.2.1'}})).status,429);
 const aclObject=env.BUCKET.objects.get('private/access-v3.json');const acl=JSON.parse(aclObject.text);for(let n=60;n<500;n++)acl.members['fixture-'+n]={id:'fixture-'+n,status:'pending',requestCode:'TEST-'+n};aclObject.text=JSON.stringify(acl);
 assert.equal((await ask(env)).status,429);assert.equal((await call(env,'/api/report')).status,401);
});
test('publish persists report; approved sessions receive paid Control cash including unmatched references',async()=>{
 const env=environment();const admin=await login(env);const visitor=await ask(env);await approve(env,admin.cookie,visitor.body.userId);
 const published=await call(env,'/api/report',admin.cookie,{method:'POST',body:sampleInput()});assert.equal(published.status,200);assert.equal(published.body.updatedBy,'Owner');assert.equal(published.body.model.summary.claimed,1000);assert.equal(published.body.model.summary.received,1249,'Paid Control cash includes the linked USD 250 and unmatched USD 999');
 const result=await call(env,'/api/report',visitor.cookie);assert.equal(result.body.revision,published.body.revision);assert.equal(result.body.bd,undefined);assert.equal(result.body.control,undefined);assert.equal(result.body.model.unmatchedControls,undefined);assert.equal(result.body.model.receiptReport.annual.find(a=>a.year===2026).received,1249);assert(result.body.model.receiptReport.rows.some(r=>r.reference==='UNRELATED-SECRET'));assert(!result.body.model.installments.some(r=>r.reference==='UNRELATED-SECRET'));assert.match(result.headers.get('cache-control'),/no-store/);assert.equal(result.headers.get('access-control-allow-origin'),null);
 const unmatched=result.body.model.receiptCohorts.rows.find(row=>row.reference==='UNRELATED-SECRET');
 assert.equal(unmatched.received,999);assert.equal(unmatched.validationState,'control-only');assert.equal(unmatched.supplier,'OTHER-SECRET');assert.deepEqual(unmatched.bdRows,[]);
 assert.equal(result.body.model.summary.receivedLinkedClaims,250);assert.equal(result.body.model.summary.receivedWithoutClaimDetail,999);
 assert.equal(result.body.model.summary.receivedCount,2,'The unpaid installment does not enter received cash');
 assert.equal((await call(env,'/api/report')).status,401);assert.equal((await call(env,'/api/report/meta')).status,401);const pending=await ask(env);assert.equal((await call(env,'/api/report',pending.cookie)).status,403);
});
test('development attribution is display-only across sessions, reports and historical metadata',async()=>{
 const env=environment(),admin=await login(env,'developer'),input=sampleInput();
 input.bd[1][56]='Developer Example';input.control[1][31]='Developer Example';
 assert.equal(admin.body.name,'Desenvolvimento');assert.equal(admin.body.email,'');assert.equal(admin.body.userId,'developer');assert.equal(admin.body.role,'admin');
 const admins=(await call(env,'/api/members',admin.cookie)).body.admins;
 assert.equal(admins.find(a=>a.id==='developer').name,'Desenvolvimento');assert.equal(admins.find(a=>a.id==='developer').email,'');assert.equal(admins.find(a=>a.id==='owner').name,'Owner');
 const acl=JSON.parse(env.BUCKET.objects.get('private/access-v3.json').text);
 assert.equal(acl.admins.developer.name,'Developer');assert.equal(acl.admins.developer.email,'developer@example.invalid');
 const published=await call(env,'/api/report',admin.cookie,{method:'POST',body:input});assert.equal(published.status,200);assert.equal(published.body.updatedBy,'Desenvolvimento');
 const object=env.BUCKET.objects.get('private/report-latest-v1.json'),saved=JSON.parse(object.text);
 assert.equal(saved.updatedBy,'Developer');assert.equal(saved.updatedByUserId,'developer');assert.equal(saved.bd[1][56],'Developer Example');assert.equal(saved.control[1][31],'Developer Example');
 assert.equal((await call(env,'/api/report/meta',admin.cookie)).body.reportMeta.updatedBy,'Desenvolvimento');
 assert.equal((await call(env,'/api/session',admin.cookie)).body.reportMeta.updatedBy,'Desenvolvimento');
 assert.equal((await call(env,'/api/report',admin.cookie)).body.updatedBy,'Desenvolvimento');
 assert(published.body.model.receiptReport.rows.some(row=>row.receiptAnalyst==='Developer Example'),'Names originating in the financial spreadsheet are preserved');
 for(const name of ['Developer','Developer Example','DEVELOPER EXAMPLE']){
  const legacy={...saved,updatedBy:name};delete legacy.updatedByUserId;object.text=JSON.stringify(legacy);object.customMetadata={...object.customMetadata,updatedBy:name};delete object.customMetadata.updatedByUserId;
  assert.equal((await call(env,'/api/report/meta',admin.cookie)).body.reportMeta.updatedBy,'Desenvolvimento','Historical head metadata uses the display label');
  object.customMetadata={};
  assert.equal((await call(env,'/api/report/meta',admin.cookie)).body.reportMeta.updatedBy,'Desenvolvimento','Historical body fallback uses the display label');
  assert.equal((await call(env,'/api/report',admin.cookie)).body.updatedBy,'Desenvolvimento');assert.equal(JSON.parse(object.text).updatedBy,name,'Reading historical data does not rewrite its audit identity');
 }
});
test('invalid and oversized report updates preserve previous snapshot',async()=>{
 const env=environment();const admin=await login(env);const first=await call(env,'/api/report',admin.cookie,{method:'POST',body:sampleInput()});
 const wrong=sampleInput();wrong.bd[0][1]='Wrong';assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:wrong})).status,400);
 const nested=sampleInput();nested.control[1][10]={role:'admin'};assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:nested})).status,400);
 assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:sampleInput(),headers:{'content-length':String(apiConstants.maxBodyBytes+1)}})).status,413);
 assert.equal((await call(env,'/api/report',admin.cookie)).body.revision,first.body.revision);
});
test('stale and racing publications cannot replace the current report',async()=>{
 const env=environment();const admin=await login(env);const first=await call(env,'/api/report',admin.cookie,{method:'POST',body:sampleInput()});const next=sampleInput();next.bd[1][35]=2000;
 assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:next,headers:{'if-match':'wrong'}})).status,409);
 env.BUCKET.failNextConditional=true;assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:next,headers:{'if-match':first.body.revision}})).status,409);
 assert.equal((await call(env,'/api/report',admin.cookie)).body.model.summary.claimed,1000);
 assert.equal((await call(env,'/api/report',admin.cookie,{method:'POST',body:next,headers:{'if-match':first.body.revision}})).body.model.summary.claimed,2000);
});
test('server-side filters remain constrained and non-API routing is external',async()=>{
 const env=environment();const admin=await login(env);await call(env,'/api/report',admin.cookie,{method:'POST',body:sampleInput()});
 assert.equal((await call(env,'/api/report?years=2025',admin.cookie)).body.model.summary.received,0);assert.equal((await call(env,'/api/report?years=2025,2026',admin.cookie)).body.model.summary.received,1249);assert.equal((await call(env,'/api/report?years=2024',admin.cookie)).status,400);assert.equal((await call(env,'/api/report?asOf=2026-02-31',admin.cookie)).status,400);
 assert.equal(await handler(new Request(origin+'/index.html'),env),null);
});


test('Control operation query expands only the Control projection and remains authorized',async()=>{
 const env=environment(),admin=await login(env),input=sampleInput();
 const domestic=[...input.bd[1]];Object.assign(domestic,{0:'MI-1',22:'MI/1',24:9988,25:'COMERCIAL',28:'CLIENTE DOMESTICO',3:'MI'});input.bd.push(domestic);
 const paid=[...input.control[1]];Object.assign(paid,{7:'MI/1',10:'CLIENTE DOMESTICO',19:700});input.control.push(paid);
 const published=await call(env,'/api/report',admin.cookie,{method:'POST',body:input});assert.equal(published.status,200);
 assert.equal(published.body.model.summary.received,1249,'Paid Control cash includes the linked USD 250 and unmatched USD 999');
 assert(published.body.model.controlReport.installments.some(i=>i.reference==='MI/1'));
 assert(published.body.model.controlReport.operationOptions.includes('COMERCIAL'));
 assert(published.body.model.controlReport.supplierOptions.includes('CLIENTE DOMESTICO'));
 const selected=await call(env,'/api/report?controlOperation=COMERCIAL',admin.cookie);assert.equal(selected.status,200);
 assert.equal(selected.body.model.summary.received,1249,'Filtering only Control operations does not remove unmatched cash from the executive comparison');
 assert.deepEqual(selected.body.model.controlReport.installments.map(i=>i.reference),['MI/1']);
 assert.equal(selected.body.model.controlReport.installments[0].includedInRealized,false);
 assert.equal(selected.body.model.controlReport.installments[0].includedInConfirmed,true);
 assert.deepEqual(selected.body.model.receiptReport,published.body.model.receiptReport);
 assert.equal((await call(env,'/api/report?operation=COMERCIAL',admin.cookie)).status,400);
 assert.equal((await call(env,'/api/report?controlOperation='+encodeURIComponent('x'.repeat(201)),admin.cookie)).status,400);
 assert.equal((await call(env,'/api/report?controlOperation='+encodeURIComponent('COMERCIAL\n'),admin.cookie)).status,400);
 assert.equal((await call(env,'/api/report?controlOperation=COMERCIAL')).status,401);
});

test('correction scenario is forwarded explicitly while published spreadsheet rows remain original',async()=>{
 const seen=[];
 const scenarioApi=createApiHandler({engine:{...engine,analyze:(bd,control,options)=>{seen.push({...options});return engine.analyze(bd,control,options);}}});
 const env=environment(),admin=await login(env,'owner',scenarioApi),input=sampleInput();
 const published=await call(env,'/api/report',admin.cookie,{method:'POST',body:input},scenarioApi);
 assert.equal(published.status,200);assert.equal(seen.at(-1).correctionScenario,'corrected');
 const key='private/report-latest-v1.json',snapshot=env.BUCKET.objects.get(key).text,stored=JSON.parse(snapshot);
 assert.deepEqual(stored.bd,input.bd);assert.deepEqual(stored.control,input.control);assert.equal(stored.correctionScenario,undefined);
 for(const [query,expected] of [['','corrected'],['?correctionScenario=original','original'],['?correctionScenario=corrected','corrected']]){
  const result=await call(env,'/api/report'+query,admin.cookie,{},scenarioApi);
  assert.equal(result.status,200);assert.equal(seen.at(-1).correctionScenario,expected);assert.equal(result.body.revision,published.body.revision);
 }
 assert.equal(env.BUCKET.objects.get(key).text,snapshot,'Switching scenarios never publishes or rewrites uploaded spreadsheet values');
 const analyzed=seen.length;
 for(const value of ['','invalid','ORIGINAL','true','corrected,original']){
  const result=await call(env,'/api/report?correctionScenario='+encodeURIComponent(value),admin.cookie,{},scenarioApi);
  assert.equal(result.status,400);assert.equal(result.body.code,'INVALID_CORRECTION_SCENARIO');
 }
 assert.equal(seen.length,analyzed,'Invalid scenarios are rejected before analysis');
 const {reportQuery}=require('../dist/team.js');
 assert.equal(new URLSearchParams(reportQuery({})).get('correctionScenario'),'corrected');
 for(const scenario of ['original','corrected'])assert.equal(new URLSearchParams(reportQuery({correctionScenario:scenario,years:[2026],supplier:'Fornecedor QA'})).get('correctionScenario'),scenario);
});
