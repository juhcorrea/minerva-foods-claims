import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createApiHandler} from '../worker/backend.js';

const REPORT='private/report-latest-v1.json',PROGRESS='private/correction-progress-v1.json';
const origin='https://claims.example.test',digest=value=>createHash('sha256').update(value).digest('hex');
const tokens=[Buffer.alloc(32,21).toString('base64url'),Buffer.alloc(32,22).toString('base64url')];
class MemoryR2 {
  objects=new Map();serial=0;gets=[];heads=[];
  async get(key){this.gets.push(key);const o=this.objects.get(key);return o?{etag:o.etag,json:async()=>JSON.parse(o.text)}:null;}
  async head(key){this.heads.push(key);const o=this.objects.get(key);return o?{etag:o.etag,customMetadata:{...o.metadata}}:null;}
  async put(key,text,options={}){const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const value={text,etag:'etag-'+(++this.serial),metadata:{...options.customMetadata}};this.objects.set(key,value);return {etag:value.etag};}
  resetReads(){this.gets=[];this.heads=[];}
}
async function fixture(){
  const bucket=new MemoryR2();let analyses=0,today='2026-11-09';
  const engine={today:()=>today,normalizeSupplier:value=>String(value||'').toUpperCase(),normalizeStatus:value=>String(value||'').toUpperCase(),parseDate:value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value))?value:null,validateHeaders(){},analyze(){analyses++;return {meta:{years:[2026]},correctionGroups:[{reference:'QA-ORDER',orders:['QA-ORDER'],changes:[{field:'supplier',reference:'QA-ORDER',original:'Original QA',corrected:'Corrected QA'}]}]};}};
  const env={BUCKET:bucket,ADMIN_LINK_HASHES:JSON.stringify(['owner','developer'].map((id,index)=>({id,name:'Admin QA '+index,tokenHash:digest(tokens[index])})))};
  const handler=createApiHandler({engine});
  async function call(path,cookie=null,body){const headers=new Headers();if(cookie)headers.set('cookie',cookie);if(body){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}const response=await handler(new Request(origin+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env);return {status:response.status,headers:response.headers,cookie:response.headers.get('set-cookie')?.split(';')[0],body:await response.json()};}
  const metadata={revision:'report-qa-1',updatedAt:'2026-11-09T12:00:00Z',updatedBy:'Admin QA',bdName:'QA BD.xlsx',controlName:'QA Controle.xlsx',asOf:'2026-11-09'};
  await bucket.put(REPORT,JSON.stringify({schemaVersion:1,...metadata,bd:[['private source marker']],control:[['private control marker']]}),{customMetadata:metadata});
  const admin=await call('/api/auth/exchange',null,{token:tokens[0]});assert.equal(admin.status,200);
  bucket.resetReads();
  return {bucket,call,admin:admin.cookie,get analyses(){return analyses;},setDay(value){today=value;}};
}

test('metadata validates the revision and aging day without reading bases or running analysis',async()=>{
  const f=await fixture(),result=await f.call('/api/report/meta',f.admin);
  assert.equal(result.status,200);assert.equal(result.body.reportMeta.revision,'report-qa-1');
  assert.equal(result.body.correctionProgressRevision,'none');assert.equal(result.body.agingDate,'2026-11-09');
  assert.equal(f.analyses,0);assert(!f.bucket.gets.includes(REPORT));assert.deepEqual(f.bucket.heads,[REPORT]);
  assert(!JSON.stringify(result.body).includes('private source marker'));assert(JSON.stringify(result.body).length<700);
  assert.match(result.headers.get('cache-control'),/private, no-store/);
  f.setDay('2026-11-10');assert.equal((await f.call('/api/report/meta',f.admin)).body.agingDate,'2026-11-10');
});

test('metadata keeps anonymous, pending and revoked visitors outside the private report',async()=>{
  const f=await fixture();
  assert.equal((await f.call('/api/report/meta')).status,401);assert(!f.bucket.gets.includes(REPORT));assert.equal(f.bucket.heads.length,0);
  const pending=await f.call('/api/auth/request',null,{name:'Viewer QA'});assert.equal(pending.status,201);f.bucket.resetReads();
  assert.equal((await f.call('/api/report/meta',pending.cookie)).status,403);assert.equal(f.bucket.heads.length,0);assert(!f.bucket.gets.includes(PROGRESS));
  const acl=JSON.parse(f.bucket.objects.get('private/access-v3.json').text);acl.members[pending.body.userId].status='revoked';await f.bucket.put('private/access-v3.json',JSON.stringify(acl));f.bucket.resetReads();
  const revoked=await f.call('/api/report/meta',pending.cookie);assert.equal(revoked.status,403);assert.equal(revoked.body.code,'ACCESS_REVOKED');assert.equal(f.bucket.heads.length,0);assert(!f.bucket.gets.includes(PROGRESS));assert.equal(f.analyses,0);
});

test('marking a correction changes the metadata revision and the hydrated report together',async()=>{
  const f=await fixture(),before=await f.call('/api/report?years=2026',f.admin);
  assert.equal(before.status,200);assert.equal(before.body.model.meta.correctionProgressRevision,'none');
  const key=before.body.model.correctionGroups[0].progress.key;
  const mark=await f.call('/api/correction-progress',f.admin,{key,done:true,reportRevision:'report-qa-1'});assert.equal(mark.status,200);
  assert.notEqual(mark.body.correctionProgressRevision,'none');
  const meta=await f.call('/api/report/meta',f.admin),after=await f.call('/api/report?years=2026',f.admin);
  assert.equal(meta.body.reportMeta.revision,before.body.revision);
  assert.equal(meta.body.correctionProgressRevision,mark.body.correctionProgressRevision);
  assert.equal(after.body.model.meta.correctionProgressRevision,mark.body.correctionProgressRevision);
  assert.equal(after.body.model.correctionGroups[0].progress.done,true);
  const unmark=await f.call('/api/correction-progress',f.admin,{key,done:false,reportRevision:'report-qa-1'});assert.equal(unmark.status,200);assert.notEqual(unmark.body.correctionProgressRevision,mark.body.correctionProgressRevision);
});

test('legacy correction stores use the R2 ETag, including legacy writers that omit revisions',async()=>{
  const f=await fixture();await f.bucket.put(PROGRESS,JSON.stringify({schemaVersion:1,entries:{}}));
  const first=await f.call('/api/report/meta',f.admin),model=await f.call('/api/report?years=2026',f.admin);
  assert.match(first.body.correctionProgressRevision,/^etag-/);assert.equal(model.body.model.meta.correctionProgressRevision,first.body.correctionProgressRevision);
  await f.bucket.put(PROGRESS,JSON.stringify({schemaVersion:1,entries:{'qa-key':{done:true}}}));
  const second=await f.call('/api/report/meta',f.admin);assert.notEqual(second.body.correctionProgressRevision,first.body.correctionProgressRevision);
});

test('metadata fails closed when correction progress is invalid',async()=>{
  const f=await fixture();await f.bucket.put(PROGRESS,JSON.stringify({schemaVersion:1,entries:null}));
  const result=await f.call('/api/report/meta',f.admin);assert.equal(result.status,503);assert.equal(result.body.code,'CORRECTION_PROGRESS_INVALID');assert.equal(f.analyses,0);
});
