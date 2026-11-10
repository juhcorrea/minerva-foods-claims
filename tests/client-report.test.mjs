import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createApiHandler} from '../worker/backend.js';
import {projectClientRows} from '../worker/client-report.js';
const engine=createRequire(import.meta.url)('../dist/engine.js');
const origin='https://claims.example.test',hash=value=>createHash('sha256').update(value).digest('hex');
const tokens={owner:'a'.repeat(43),developer:'b'.repeat(43)};
class MemoryBucket{
 objects=new Map();serial=0;conflictKey=null;
 async get(key){const item=this.objects.get(key);return item?{etag:item.etag,customMetadata:item.metadata,json:async()=>JSON.parse(item.text),text:async()=>item.text,body:new Response(item.text).body}:null;}
 async head(key){const item=this.objects.get(key);return item?{etag:item.etag,customMetadata:item.metadata}:null;}
 async put(key,text,options={}){const old=this.objects.get(key);if(this.conflictKey===key){this.conflictKey=null;return null;}if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={text:String(text),etag:'etag-'+(++this.serial),metadata:options.customMetadata||{}};this.objects.set(key,item);return {etag:item.etag};}
 async delete(key){this.objects.delete(key);}
}
function input(){
 const bh=Array(64).fill(null),ch=Array(32).fill(null),b=Array(64).fill(null),c=Array(32).fill(null);
 Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
 Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
 Object.assign(b,{0:'QA-1',1:'2026-01-05',2:'UNUSED-PRIVATE-BD',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',22:'QA/001',28:'TEST SUPPLIER',35:100});
 Object.assign(c,{1:2026,4:'UNUSED-PRIVATE-CONTROL',7:'QA/001',10:'TEST SUPPLIER',12:'Pago',14:25,17:'2026-02-01',19:25});
 return {bd:[bh,b],control:[ch,c],files:{bd:'BD.xlsx',control:'Controle.xlsx'},asOf:'2026-11-10'};
}
async function fixture(){
 let analyses=0;
 const env={CF_CLIENT_ANALYSIS:'1',BUCKET:new MemoryBucket(),ADMIN_LINK_HASHES:JSON.stringify(Object.entries(tokens).map(([id,token])=>({id,name:id,email:id+'@corp.example',tokenHash:hash(token)})))};
 const source={base64:Buffer.from('SYNTHETIC-SOURCE').toString('base64'),sha256:hash('SYNTHETIC-SOURCE'),fileCount:1,commitSha:'a'.repeat(40),restorationInstructions:'Restore synthetic fixture'};
 const handler=createApiHandler({engine:{...engine,analyze(){analyses++;throw new Error('Server analysis forbidden');}},migrationSource:source});
 async function call(path,{cookie,method='GET',body,csrf=true}={}){const headers=new Headers();if(cookie)headers.set('cookie',cookie);if(method!=='GET'){headers.set('content-type','application/json');if(csrf){headers.set('origin',origin);headers.set('x-minerva-request','1');}}const response=await handler(new Request(origin+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env);const text=await response.text();return {status:response.status,body:JSON.parse(text),text,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
 const login=async id=>(await call('/api/auth/exchange',{method:'POST',body:{token:tokens[id]}})).cookie;
 const admin=await login('owner');
 const start=async(data=input(),expectedRevision='none',cookie=admin)=>(await call('/api/client-report/start',{cookie,method:'POST',body:{expectedRevision,expectedRows:{bd:data.bd.length,control:data.control.length},files:data.files,asOf:data.asOf}}));
 const part=(id,sheet,rows,index=0,firstRow=0,cookie=admin)=>call(`/api/client-report/${id}/parts`,{cookie,method:'POST',body:{sheet,rows,index,firstRow}});
 const commit=(id,cookie=admin)=>call(`/api/client-report/${id}/commit`,{cookie,method:'POST',body:{}});
 async function publish(data=input(),revision='none',cookie=admin){const begun=await start(data,revision,cookie);assert.equal(begun.status,201,JSON.stringify(begun.body));const id=begun.body.uploadId;for(const sheet of ['bd','control'])assert.equal((await part(id,sheet,data[sheet],0,0,cookie)).status,201);const done=await commit(id,cookie);assert.equal(done.status,200,JSON.stringify(done.body));return done.body;}
 return {env,call,login,admin,start,part,commit,publish,source,analyses:()=>analyses};
}
test('browser publication is atomic, immutable, hash checked and never runs server analysis',async()=>{
 const f=await fixture(),data=input(),begun=await f.start(data),id=begun.body.uploadId;
 assert.equal((await f.call('/api/client-report',{cookie:f.admin})).body.parts.length,0);
 assert.equal((await f.commit(id)).body.code,'INCOMPLETE_UPLOAD');
 for(const sheet of ['bd','control']){assert.equal((await f.part(id,sheet,[data[sheet][0]])).status,201);assert.equal((await f.part(id,sheet,[data[sheet][1]],1,1)).status,201);}
 const done=await f.commit(id);assert.equal(done.body.revision,id);assert.equal((await f.commit(id)).status,200);
 const manifest=(await f.call('/api/client-report',{cookie:f.admin})).body;assert.equal(manifest.parts.length,4);assert.deepEqual(manifest.rows,{bd:2,control:2});
 for(const descriptor of manifest.parts){const result=await f.call(descriptor.url,{cookie:f.admin});assert.equal(result.status,200);assert.equal(hash(result.text),descriptor.sha256);assert(!result.text.includes('UNUSED-PRIVATE'));assert.equal(result.headers.get('cache-control'),'private, no-store');}
 assert.equal((await f.call('/api/session',{cookie:f.admin})).body.reportMeta.revision,id);
 assert.equal((await f.call('/api/report/meta',{cookie:f.admin})).body.reportMeta.revision,id);
 for(const method of ['GET','POST'])assert.equal((await f.call('/api/report',{cookie:f.admin,method,body:method==='POST'?{}:undefined})).body.code,'BROWSER_ANALYSIS_REQUIRED');
 assert.equal(f.analyses(),0);
});
test('pending and anonymous users cannot read any bases; viewers cannot read originals or publish',async()=>{
 const f=await fixture();await f.publish();
 const asked=await f.call('/api/auth/request',{method:'POST',body:{name:'QA Viewer',email:'viewer@corp.example'}}),member=asked.body.userId;
 for(const path of ['/api/client-report','/api/client-report/progress','/api/client-report/backup','/api/client-report/backup-source?part=0','/api/client-report/parts?revision=none&sheet=bd&index=0']){assert.equal((await f.call(path)).status,401);assert.equal((await f.call(path,{cookie:asked.cookie})).status,403);}
 await f.call('/api/members/'+member+'/approve',{cookie:f.admin,method:'POST',body:{}});
 const manifest=await f.call('/api/client-report',{cookie:asked.cookie});assert.equal(manifest.status,200);
 assert.equal((await f.call(manifest.body.parts[0].url,{cookie:asked.cookie})).status,200);
 assert.equal((await f.call(manifest.body.parts[0].url+'&original=1',{cookie:asked.cookie})).status,403);
 for(const path of ['/api/client-report/backup','/api/client-report/backup-source?part=0'])assert.equal((await f.call(path,{cookie:asked.cookie})).status,403);
 assert.equal((await f.start(input(),manifest.body.revision,asked.cookie)).status,403);
 await f.call('/api/members/'+member+'/role',{cookie:f.admin,method:'POST',body:{role:'editor'}});
 assert.equal((await f.start(input(),manifest.body.revision,asked.cookie)).status,201);
 await f.call('/api/members/'+member,{cookie:f.admin,method:'DELETE',body:{}});
 assert.equal((await f.call(manifest.body.parts[0].url,{cookie:asked.cookie})).status,403);
});
test('upload validates ownership, ordering, retries, complete row counts and optimistic concurrency',async()=>{
 const f=await fixture(),data=input(),a=(await f.start()).body.uploadId,b=(await f.start()).body.uploadId,other=await f.login('developer');
 assert.equal((await f.part(a,'bd',data.bd,0,0,other)).status,404);
 assert.equal((await f.part(a,'bd',[data.bd[1]],1,1)).body.code,'PART_ORDER');
 assert.equal((await f.part(a,'bd',data.bd)).status,201);assert.equal((await f.part(a,'bd',data.bd)).status,200);
 const changed=structuredClone(data.bd);changed[1][35]=101;assert.equal((await f.part(a,'bd',changed)).body.code,'PART_CHANGED');
 assert.equal((await f.part(a,'bd',[data.bd[1]],1,2)).status,413);
 assert.equal((await f.commit(a)).body.code,'INCOMPLETE_UPLOAD');await f.part(a,'control',data.control);
 await f.part(b,'bd',data.bd);await f.part(b,'control',data.control);
 assert.equal((await f.commit(a)).status,200);assert.equal((await f.commit(b)).body.code,'REPORT_CHANGED');
 assert.equal((await f.start()).body.code,'REPORT_CHANGED');
 const old=(await f.call('/api/client-report',{cookie:f.admin})).body.parts[0].url;await f.publish(data,a);
 assert.equal((await f.call(old,{cookie:f.admin})).body.code,'REPORT_CHANGED');
});
test('invalid chunks, unsafe cells, CSRF and missing expected counts fail before publication',async()=>{
 const f=await fixture(),data=input(),id=(await f.start()).body.uploadId;
 assert.equal((await f.call('/api/client-report/start',{cookie:f.admin,method:'POST',body:{expectedRevision:'none'}})).body.code,'INVALID_ROW_COUNT');
 assert.equal((await f.call('/api/client-report/start',{cookie:f.admin,method:'POST',body:{},csrf:false})).status,403);
 assert.equal((await f.part(id,'bd',[['wrong header']])).status,400);
 const malformed=structuredClone(data.bd);malformed[1][2]={nested:true};assert.equal((await f.part(id,'bd',malformed)).body.code,'INVALID_CELL');
 malformed[1][2]='x'.repeat(65536);assert.equal((await f.part(id,'bd',malformed)).status,413);
 assert.equal((await f.part(id,'__proto__',data.bd)).status,400);
 assert.equal((await f.call('/api/client-report',{cookie:f.admin})).body.parts.length,0);
});
test('admin backup contains originals and source, revision-bound progress never changes amounts',async()=>{
 const f=await fixture(),published=await f.publish(),key='c'.repeat(64);
 const saved=await f.call('/api/correction-progress',{cookie:f.admin,method:'POST',body:{key,done:true,reportRevision:published.revision}});assert.equal(saved.status,200);
 const backup=(await f.call('/api/client-report/backup',{cookie:f.admin})).body;
 assert.equal(backup.reportMeta.schemaVersion,1);assert.equal(backup.progress.entries[key].updatedByUserId,'owner');assert(backup.acl.admins.owner);
 assert.equal(backup.source.sha256,f.source.sha256);
 let privateSeen=false;for(const descriptor of backup.parts){const result=await f.call(descriptor.url,{cookie:f.admin});assert.equal(hash(result.text),descriptor.sha256);if(result.text.includes('UNUSED-PRIVATE'))privateSeen=true;}assert(privateSeen);
 assert.equal((await f.call('/api/client-report/backup-source?part=0',{cookie:f.admin})).body.data,f.source.base64);
 assert.equal((await f.call('/api/client-report/backup-source?part=-1',{cookie:f.admin})).status,400);
 assert.equal((await f.call('/api/migration/export',{cookie:f.admin})).body.code,'BROWSER_BACKUP_REQUIRED');
 await f.publish(input(),published.revision);
 assert.equal((await f.call('/api/correction-progress',{cookie:f.admin,method:'POST',body:{key,done:false,reportRevision:published.revision}})).body.code,'REPORT_CHANGED');assert.equal(f.analyses(),0);
});
test('projection retains row presence while excluding unused values',()=>{
 for(const [sheet,width,marker] of [['bd',64,2],['control',32,4]]){
  const row=Array(width).fill(null);row[marker]='private content';const projected=projectClientRows(sheet,[row],1)[0];assert.equal(projected[marker],true);assert(!JSON.stringify(projected).includes('private content'));assert.equal(projected.length,width);
  assert.equal(projectClientRows(sheet,[row],0)[0][marker],null);
 }
});

test('publication racing a correction acknowledgement rejects the stale revision before writing progress',async()=>{
 const f=await fixture(),published=await f.publish(),get=f.env.BUCKET.get.bind(f.env.BUCKET),key='e'.repeat(64);let changed=false;
 f.env.BUCKET.get=async path=>{
  if(path==='private/correction-progress-v1.json'&&!changed){
   changed=true;const pointer=f.env.BUCKET.objects.get('private/client-report-v2.json'),next={...JSON.parse(pointer.text),revision:crypto.randomUUID()};
   await f.env.BUCKET.put('private/client-report-v2.json',JSON.stringify(next));
  }
  return get(path);
 };
 const result=await f.call('/api/correction-progress',{cookie:f.admin,method:'POST',body:{key,done:true,reportRevision:published.revision}});
 assert.equal(changed,true);assert.equal(result.status,409);assert.equal(result.body.code,'REPORT_CHANGED');assert.equal(f.env.BUCKET.objects.has('private/correction-progress-v1.json'),false);
});
