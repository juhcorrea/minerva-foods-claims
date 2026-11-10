import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createApiHandler} from '../worker/backend.js';
const engine=createRequire(import.meta.url)('../dist/engine.js');
const REPORT='private/report-latest-v1.json',PROGRESS='private/correction-progress-v1.json',origin='https://claims.example.test';
const tokens=[Buffer.alloc(32,41).toString('base64url'),Buffer.alloc(32,42).toString('base64url')],digest=value=>createHash('sha256').update(value).digest('hex');
class MemoryR2{
  objects=new Map();serial=0;gets=[];
  async get(key){this.gets.push(key);const value=this.objects.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null;}
  async head(key){const value=this.objects.get(key);return value?{etag:value.etag,customMetadata:value.metadata}:null;}
  async put(key,text,options={}){const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const value={text,etag:'qa-'+(++this.serial),metadata:options.customMetadata};this.objects.set(key,value);return {etag:value.etag};}
  async delete(key){this.objects.delete(key);}
}
function input(){
  const bh=Array(64).fill(null),ch=Array(32).fill(null);
  Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
  Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
  const claim=Object.assign(Array(64).fill(null),{0:'QA-SGR',1:'2025-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/1',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100.125,40:25.125,56:'Analista QA',60:'RAW_SOURCE_ONLY'});
  const paid=Object.assign(Array(32).fill(null),{1:2026,3:'MI',7:'QA/1',10:'Fornecedor QA',11:'Depósito',12:'Pago',13:'2026-02-01',14:25.125,17:'2026-02-01',19:25.125,20:80,30:2026,31:'Analista Controle'});
  return {schemaVersion:1,revision:'qa-report',asOf:'2026-11-09',files:{bd:'BD QA.xlsx',control:'Controle QA.xlsx'},bd:[bh,claim],control:[ch,paid]};
}
async function fixture(){
  const bucket=new MemoryR2(),calls=[],saved=input();
  const handler=createApiHandler({engine:{...engine,analyze(bd,control,opts){calls.push(opts);return engine.analyze(bd,control,opts);}}});
  const env={BUCKET:bucket,ADMIN_LINK_HASHES:JSON.stringify(['owner','developer'].map((id,index)=>({id,name:'Admin QA '+index,tokenHash:digest(tokens[index])})))};
  const call=async(path,cookie=null,body,method=body?'POST':'GET')=>{const headers=new Headers();if(cookie)headers.set('cookie',cookie);if(!['GET','HEAD'].includes(method)){headers.set('origin',origin);headers.set('x-minerva-request','1');headers.set('content-type','application/json');}const response=await handler(new Request(origin+path,{method,headers,body:body?JSON.stringify(body):undefined}),env);return {status:response.status,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0],body:await response.json()};};
  await bucket.put(REPORT,JSON.stringify(saved));
  const login=await call('/api/auth/exchange',null,{token:tokens[0]});assert.equal(login.status,200);
  bucket.gets=[];return {bucket,call,admin:login.cookie,calls,saved};
}
test('supplier API keeps authentication and current approval checks before source reads',async()=>{
  const f=await fixture();assert.equal((await f.call('/api/report?view=suppliers')).status,401);assert(!f.bucket.gets.includes(REPORT));
  const visitor=await f.call('/api/auth/request',null,{name:'Viewer QA'});f.bucket.gets=[];
  assert.equal((await f.call('/api/report?view=suppliers',visitor.cookie)).status,403);assert(!f.bucket.gets.includes(REPORT));assert.equal(f.calls.length,0);
  assert.equal((await f.call('/api/members/'+visitor.body.userId+'/approve',f.admin,{})).status,200);
  assert.equal((await f.call('/api/report?view=suppliers',visitor.cookie)).status,200);
  assert.equal((await f.call('/api/members/'+visitor.body.userId,f.admin,undefined,'DELETE')).status,200);f.bucket.gets=[];const count=f.calls.length;
  assert.equal((await f.call('/api/report?view=suppliers',visitor.cookie)).body.code,'ACCESS_REVOKED');assert(!f.bucket.gets.includes(REPORT));assert.equal(f.calls.length,count);
});
test('supplier API uses the same filters, amounts, source revision and private cache headers',async()=>{
  const f=await fixture(),filter='allYears=1&supplier=Fornecedor%20QA&operation=EXPORTA%C3%87%C3%83O%20-%20CTNR&correctionScenario=original';
  const full=await f.call('/api/report?'+filter,f.admin),lean=await f.call('/api/report?'+filter+'&view=suppliers',f.admin);
  assert.equal(lean.status,200);assert.equal(lean.body.revision,full.body.revision);assert.equal(lean.headers.get('etag'),full.headers.get('etag'));
  assert.deepEqual(lean.body.model.summary,full.body.model.summary);assert.deepEqual(lean.body.model.suppliers,full.body.model.suppliers.map(({openInstallments,...supplier})=>supplier));
  assert.equal(lean.body.model.meta.reportView,'suppliers');assert.equal(lean.body.model.meta.agingDate,engine.today());
  assert.equal(f.calls.at(-1).reportView,'suppliers');assert.equal(f.calls.at(-2).reportView,undefined);
  assert.deepEqual(lean.body.model.meta.years,[2025,2026]);assert.equal(lean.body.model.meta.correctionScenario,'original');
  assert.match(lean.headers.get('cache-control'),/private, no-store/);assert.equal(lean.headers.get('vary'),'Cookie');
  assert(!JSON.stringify(lean.body).includes('RAW_SOURCE_ONLY'));assert(!('bd'in lean.body));assert(!('claims'in lean.body.model));
  const explicit=await f.call('/api/report?'+filter+'&view=full',f.admin);assert.deepEqual(explicit.body,full.body);
});
test('supplier metadata follows shared correction progress without sending correction details',async()=>{
  const f=await fixture(),full=await f.call('/api/report?allYears=1',f.admin),key=full.body.model.correctionGroups[0].progress.key;
  const before=await f.call('/api/report?allYears=1&view=suppliers',f.admin);assert.equal(before.body.model.meta.correctionProgressRevision,'none');
  const mark=await f.call('/api/correction-progress',f.admin,{key,done:true,reportRevision:'qa-report',options:{allYears:true}});assert.equal(mark.status,200);
  const after=await f.call('/api/report?allYears=1&view=suppliers',f.admin);
  assert.equal(after.body.model.meta.correctionProgressRevision,mark.body.correctionProgressRevision);assert.notEqual(mark.body.correctionProgressRevision,'none');
  assert.equal(after.body.model.meta.correctionQueueCount,before.body.model.meta.correctionQueueCount);assert(!('correctionGroups'in after.body.model));
  await f.bucket.put(PROGRESS,JSON.stringify({schemaVersion:1,entries:null}));assert.equal((await f.call('/api/report?view=suppliers',f.admin)).body.code,'CORRECTION_PROGRESS_INVALID');
});
test('supplier API rejects unknown or repeated views and still validates all filters',async()=>{
  const f=await fixture();for(const query of ['view=unknown','view=','view=suppliers&view=full']){f.bucket.gets=[];const result=await f.call('/api/report?'+query,f.admin);assert.equal(result.status,400);assert.equal(result.body.code,'INVALID_REPORT_VIEW');assert(!f.bucket.gets.includes(REPORT));}
  for(const query of ['operation=UNKNOWN','supplier=UNKNOWN','claimStatus=UNKNOWN','years=oops','correctionScenario=bad'])assert.equal((await f.call('/api/report?view=suppliers&'+query,f.admin)).status,400);
  assert.equal(f.calls.length,0);
});

test('supplier API accepts multiple situations from BD and carries them through both report variants',async()=>{
 const f=await fixture();f.saved.bd.push([...f.saved.bd[1]]);f.saved.bd[2][6]='EM NEGOCIAÇÃO - PROCEDENTE';f.saved.bd[2][22]='QA/2';await f.bucket.put(REPORT,JSON.stringify(f.saved));
 const query=new URLSearchParams({allYears:'1'});query.append('claimStatus','RESSARCIMENTO ENCAMINHADO');query.append('claimStatus','EM NEGOCIAÇÃO - PROCEDENTE');
 const full=await f.call('/api/report?'+query,f.admin),lean=await f.call('/api/report?'+query+'&view=suppliers',f.admin);
 assert.equal(full.status,200);assert.equal(lean.status,200);assert.equal(lean.body.model.meta.claimStatuses.length,2);
 assert.equal(f.calls.at(-1).claimStatuses.length,2);assert.deepEqual(lean.body.model.summary,full.body.model.summary);
});
