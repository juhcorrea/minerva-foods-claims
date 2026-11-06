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




const PROGRESS_KEY='private/correction-progress-v1.json';
function twoOrders(){const input=sampleInput();const claim=[...input.bd[1]];Object.assign(claim,{0:'CLAIM-2',22:'SO/SECOND',24:9988});const paid=[...input.control[1]];Object.assign(paid,{7:'SO/SECOND'});input.bd.push(claim);input.control.push(paid);return input;}
const queryOptions={years:[2025,2026],asOf:'2026-10-30',supplier:'',operation:'',controlOperation:'',lossFormula:'subtract-negotiating'};
async function publish(env,admin,input=twoOrders(),revision){const result=await call(env,'/api/report',admin.cookie,{method:'POST',body:input,headers:revision?{'if-match':revision}:{}});return result.status===200?call(env,'/api/report?years=2025,2026',admin.cookie):result;}
async function mark(env,admin,snapshot,group,done,extra={}){return call(env,'/api/correction-progress',admin.cookie,{method:'POST',body:{key:group.progress.key,done,reportRevision:snapshot.revision,options:queryOptions,...extra}});}

test('correction follow-up persists for viewers across sessions without changing report data',async()=>{
 const env=environment(),admin=await login(env),visitor=await ask(env);await approve(env,admin.cookie,visitor.body.userId);
 const saved=await publish(env,admin);assert.equal(saved.status,200);const snapshot=saved.body,g=snapshot.model.correctionGroups[0];
 assert.match(g.progress.key,/^[a-f0-9]{64}$/);assert.deepEqual(g.progress,{key:g.progress.key,done:false,updatedAt:null,updatedBy:null});
 const financialBefore=env.BUCKET.objects.get('private/report-latest-v1.json').text;
 const result=await mark(env,admin,snapshot,g,true);assert.equal(result.status,200);assert.equal(result.body.progress.done,true);assert.equal(result.body.progress.updatedBy,'Owner');assert.equal(result.body.progress.updatedByUserId,undefined);
 assert.equal(result.body.reportRevision,snapshot.revision);assert.equal(env.BUCKET.objects.get('private/report-latest-v1.json').text,financialBefore);
 const reloaded=await call(env,'/api/report?years=2025,2026',visitor.cookie);const marked=reloaded.body.model.correctionGroups.find(x=>x.progress.key===g.progress.key);
 assert.equal(marked.progress.done,true);assert.equal(marked.progress.updatedAt,result.body.progress.updatedAt);assert.deepEqual(reloaded.body.model.summary,snapshot.model.summary);
 const secondAdmin=await login(env,'developer');const undone=await mark(env,secondAdmin,reloaded.body,marked,false);assert.equal(undone.status,200);assert.equal(undone.body.progress.updatedBy,'Desenvolvimento');
 const stored=JSON.parse(env.BUCKET.objects.get(PROGRESS_KEY).text).entries[g.progress.key];assert.equal(stored.updatedBy,'Developer');assert.equal(stored.updatedByUserId,'developer');
 assert.equal((await call(env,'/api/report?years=2025,2026',visitor.cookie)).body.model.correctionGroups.find(x=>x.progress.key===g.progress.key).progress.done,false);
});

test('follow-up mutation enforces admin authorization, origin, boolean and current group',async()=>{
 const env=environment(),admin=await login(env),visitor=await ask(env);await approve(env,admin.cookie,visitor.body.userId);const saved=(await publish(env,admin)).body,g=saved.model.correctionGroups[0];
 const body={key:g.progress.key,done:true,reportRevision:saved.revision,options:queryOptions};
 assert.equal((await call(env,'/api/correction-progress',null,{method:'POST',body})).status,401);
 assert.equal((await call(env,'/api/correction-progress',visitor.cookie,{method:'POST',body})).status,403);
 assert.equal((await call(env,'/api/correction-progress',admin.cookie,{method:'POST',body,csrf:false})).status,403);
 for(const bad of [{done:'true'},{done:1},{key:'x'},{reportRevision:''},{options:{...queryOptions,years:[2101]}},{options:{...queryOptions,allYears:'true'}},{options:{supplier:{}}},{updatedBy:'Forged'}])assert.equal((await call(env,'/api/correction-progress',admin.cookie,{method:'POST',body:{...body,...bad}})).status,400);
 assert.equal((await call(env,'/api/correction-progress',admin.cookie,{method:'POST',body:{...body,key:'f'.repeat(64)}})).status,409);
 assert.equal(env.BUCKET.objects.has(PROGRESS_KEY),false);
});

test('reordered rows retain progress; new divergences and stale reports cannot reuse it',async()=>{
 const env=environment(),admin=await login(env),input=twoOrders();const first=(await publish(env,admin,input)).body;const group=first.model.correctionGroups.find(g=>g.reference==='SO/DEMO-4');
 assert.equal((await mark(env,admin,first,group,true)).status,200);
 const reordered=structuredClone(input);reordered.bd=[reordered.bd[0],...reordered.bd.slice(1).reverse()];reordered.control=[reordered.control[0],...reordered.control.slice(1).reverse()];
 const second=(await publish(env,admin,reordered,first.revision)).body;const moved=second.model.correctionGroups.find(g=>g.reference===group.reference);assert.equal(moved.progress.key,group.progress.key);assert.equal(moved.progress.done,true);
 assert.equal((await mark(env,admin,first,group,false)).status,409,'Old report cannot update mark');
 const changed=structuredClone(reordered);changed.control.find((r,i)=>i>0&&r[7]==='SO/DEMO-4')[1]=2027;
 const third=(await publish(env,admin,changed,second.revision)).body;const different=third.model.correctionGroups.find(g=>g.reference===group.reference);assert.notEqual(different.progress.key,group.progress.key);assert.equal(different.progress.done,false);
 assert.equal((await mark(env,admin,third,group,true)).status,409,'Old correction signature cannot be marked in current report');
 const added=structuredClone(reordered);added.control.push([...added.control.find((r,i)=>i>0&&r[7]==='SO/DEMO-4')]);
 const fourth=(await publish(env,admin,added,third.revision)).body;const more=fourth.model.correctionGroups.find(g=>g.reference===group.reference);assert.notEqual(more.progress.key,group.progress.key);assert.equal(more.progress.done,false,'New installment with same error changes complete signature');
});

test('two administrators marking different orders concurrently merge without lost updates',async()=>{
 const env=environment(),owner=await login(env),developer=await login(env,'developer'),saved=(await publish(env,owner)).body;assert.equal(saved.model.correctionGroups.length,2);
 const originalGet=env.BUCKET.get.bind(env.BUCKET),originalPut=env.BUCKET.put.bind(env.BUCKET);let arrivals=0,release,attempts=0;const barrier=new Promise(resolve=>release=resolve);
 env.BUCKET.get=async key=>{const snapshot=await originalGet(key);if(key===PROGRESS_KEY&&arrivals<2){arrivals++;if(arrivals===2)release();await barrier;}return snapshot;};
 env.BUCKET.put=async(key,...args)=>{if(key===PROGRESS_KEY)attempts++;return originalPut(key,...args);};
 const writes=await Promise.all([mark(env,owner,saved,saved.model.correctionGroups[0],true),mark(env,developer,saved,saved.model.correctionGroups[1],true)]);
 assert(writes.every(x=>x.status===200));assert(attempts>=3,'A failed conditional write is retried');
 const loaded=(await call(env,'/api/report?years=2025,2026',owner.cookie)).body;assert(loaded.model.correctionGroups.every(g=>g.progress.done));assert.deepEqual(new Set(loaded.model.correctionGroups.map(g=>g.progress.updatedBy)),new Set(['Owner','Desenvolvimento']));
});

test('correction scenarios share the same audit key and accept progress in either view',async()=>{
 const env=environment(),admin=await login(env),snapshot=(await publish(env,admin)).body;
 const original=(await call(env,'/api/report?years=2025,2026&correctionScenario=original',admin.cookie)).body;
 const corrected=(await call(env,'/api/report?years=2025,2026&correctionScenario=corrected',admin.cookie)).body;
 const group=original.model.correctionGroups[0];assert(group,'The original view still includes correction audit records');
 assert(corrected.model.correctionGroups.some(g=>g.progress.key===group.progress.key),'Changing the display scenario does not create another correction identity');
 const before=env.BUCKET.objects.get('private/report-latest-v1.json').text;
 const saved=await mark(env,admin,snapshot,group,true,{options:{...queryOptions,correctionScenario:'original'}});
 assert.equal(saved.status,200);assert.equal(saved.body.progress.done,true);
 const refreshed=(await call(env,'/api/report?years=2025,2026&correctionScenario=corrected',admin.cookie)).body;
 assert.equal(refreshed.model.correctionGroups.find(g=>g.progress.key===group.progress.key).progress.done,true);
 for(const value of ['','bogus',null,true,{}])assert.equal((await mark(env,admin,snapshot,group,false,{options:{...queryOptions,correctionScenario:value}})).status,400);
 assert.equal((await mark(env,admin,snapshot,group,false,{options:{...queryOptions,correctionScenario:'corrected'}})).status,200);
 assert.equal(env.BUCKET.objects.get('private/report-latest-v1.json').text,before);
});

test('all-years correction follow-up keeps the effective scope and shared audit identity',async()=>{
 const env=environment(),admin=await login(env);await publish(env,admin);
 const snapshot=(await call(env,'/api/report?allYears=1',admin.cookie)).body,group=snapshot.model.correctionGroups[0];assert(group);
 const saved=await mark(env,admin,snapshot,group,true,{options:{...queryOptions,years:[2026],allYears:true}});
 assert.equal(saved.status,200);assert.equal(saved.body.progress.done,true);
 const selected=(await call(env,'/api/report?years=2025,2026',admin.cookie)).body;
 assert.equal(selected.model.correctionGroups.find(g=>g.progress.key===group.progress.key).progress.done,true);
 assert.equal((await mark(env,admin,snapshot,group,false,{options:{...queryOptions,years:[2026],allYears:false}})).status,409,'Scope cannot mark a correction absent from its selected-year model');
});

test('correction progress accepts plural and legacy array filters with plural precedence',async()=>{
 const env=environment(),admin=await login(env),input=twoOrders();input.bd[2][25]='COMERCIAL';input.bd[2][28]='OUTRO FORNECEDOR FICTICIO';
 await publish(env,admin,input);const query=new URLSearchParams({allYears:'1'});for(const value of ['EXPORTAÇÃO - CARRETA','COMERCIAL'])query.append('operation',value);for(const value of ['FORNECEDOR TESTE','OUTRO FORNECEDOR FICTICIO'])query.append('supplier',value);
 const snapshot=(await call(env,'/api/report?'+query,admin.cookie)).body,group=snapshot.model.correctionGroups[0];assert(group);
 const filters={...queryOptions,allYears:true,operations:['EXPORTAÇÃO - CARRETA','COMERCIAL'],suppliers:['FORNECEDOR TESTE','OUTRO FORNECEDOR FICTICIO'],controlOperations:[]};
 assert.equal((await mark(env,admin,snapshot,group,true,{options:filters})).status,200);
 const legacy={...queryOptions,allYears:true,operation:filters.operations,supplier:filters.suppliers,controlOperation:[]};assert.equal((await mark(env,admin,snapshot,group,false,{options:legacy})).status,200);
 assert.equal((await mark(env,admin,snapshot,group,true,{options:{...filters,operation:'INVALID IGNORED LEGACY',supplier:'INVALID IGNORED LEGACY'}})).status,200);
 for(const extra of [{suppliers:['FORNECEDOR TESTE',{}]},{operations:['EXPORTAÇÃO - CARRETA','INVALID']},{controlOperations:['INVALID']},{suppliers:Array(201).fill('FORNECEDOR TESTE')}])assert.equal((await mark(env,admin,snapshot,group,true,{options:{...filters,...extra}})).status,400);
});
