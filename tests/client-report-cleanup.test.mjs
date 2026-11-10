import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanup} from '../worker/client-report-cleanup.js';

const now=Date.parse('2026-11-10T12:00:00Z'),hour=3600000;
const ids=Array.from({length:8},(_,i)=>String(i+1).repeat(8)+'-1111-4111-8111-111111111111');
const stageKey=id=>'private/client-staging/'+id+'.json',partKey=(id,index,sheet='bd',variant='projected')=>'private/client-reports/'+id+'/'+sheet+'/'+index+'.'+variant+'.json';
class MemoryBucket {
  objects=new Map();calls=[];deleted=[];
  async get(key){this.calls.push(['get',key]);const text=this.objects.get(key);return text===undefined?null:{json:async()=>JSON.parse(text)};}
  async delete(key){this.calls.push(['delete',key]);this.deleted.push(key);this.objects.delete(key);}
  async list({prefix,cursor,limit}){this.calls.push(['list',prefix]);const all=[...this.objects.keys()].filter(key=>key.startsWith(prefix)&&(!cursor||key>cursor)).sort(),keys=all.slice(0,limit),truncated=all.length>keys.length;return {objects:keys.map(key=>({key})),truncated,...(truncated?{cursor:keys.at(-1)}:{})};}
  stage(id,expiresAt,extra={}){this.objects.set(stageKey(id),JSON.stringify({schemaVersion:2,id,expiresAt:new Date(expiresAt).toISOString(),...extra}));return this;}
  parts(id,count){for(let i=0;i<count;i++)this.objects.set(partKey(id,i),JSON.stringify({rows:[['synthetic']]}));return this;}
}
async function drain(bucket,current,maximum=40){let cursor=null;const batches=[];for(let n=0;n<maximum;n++){const before=bucket.calls.length,answer=await cleanup(bucket,current,{now,cursor});assert(answer.deleted<=12);assert(bucket.calls.length-before<=16);batches.push(answer);if(!answer.hasMore)return batches;cursor=answer.cursor;}throw new Error('Cleanup did not finish');}

test('cleanup removes old revisions in bounded batches and preserves the current publication and unrelated private records',async()=>{
  const bucket=new MemoryBucket().stage(ids[0],now-100*hour).parts(ids[0],3).stage(ids[1],now-3*hour).parts(ids[1],29).stage(ids[2],now-3*hour).parts(ids[2],0);
  const protectedKeys=['private/access-v3.json','private/correction-progress-v1.json','private/report-latest-v1.json','private/client-report-v2.json','private/sessions/example.json','private/client-reports/unowned/bd/0.original.json'];
  for(const key of protectedKeys)bucket.objects.set(key,'{}');
  const before=new Map(bucket.objects),batches=await drain(bucket,ids[0]);
  assert(batches.length>=5);assert.equal(bucket.objects.has(stageKey(ids[1])),false);assert.equal(bucket.objects.has(stageKey(ids[2])),false);assert(![...bucket.objects.keys()].some(key=>key.startsWith('private/client-reports/'+ids[1]+'/')));
  for(const [key,value]of before)if(protectedKeys.includes(key)||key.includes(ids[0]))assert.equal(bucket.objects.get(key),value);
  assert.equal(bucket.deleted.length,31);assert(!JSON.stringify(batches).includes('private/'));
});

test('live and recently expired stages are retained and an orphan without a verified stage is never deleted',async()=>{
  const bucket=new MemoryBucket().stage(ids[0],now-3*hour).parts(ids[0],1).stage(ids[1],now+hour).parts(ids[1],1).stage(ids[2],now-hour).parts(ids[2],1).stage(ids[3],now-2*hour+1).parts(ids[3],1);
  bucket.objects.set(partKey(ids[4],0),'orphan');
  const before=[...bucket.objects];await drain(bucket,ids[0]);assert.deepEqual([...bucket.objects],before);assert.equal(bucket.deleted.length,0);
  bucket.stage(ids[3],now-2*hour);await drain(bucket,ids[0]);assert(!bucket.objects.has(stageKey(ids[3])));assert(!bucket.objects.has(partKey(ids[3],0)));
});

test('each pending batch rechecks the current revision and the stage expiration before deleting more',async()=>{
  const bucket=new MemoryBucket().stage(ids[1],now-3*hour).parts(ids[1],24),first=await cleanup(bucket,ids[0],{now});assert.equal(first.deleted,12);assert(first.hasMore);
  const remaining=bucket.objects.size,next=await cleanup(bucket,ids[1],{now,cursor:first.cursor});assert.equal(next.deleted,0);assert.equal(next.skipped,'current-publication');assert.equal(bucket.objects.size,remaining);
  bucket.stage(ids[1],now+hour);const changed=await cleanup(bucket,ids[0],{now,cursor:first.cursor});assert.equal(changed.deleted,0);assert.equal(changed.skipped,'retained-stage');
});

test('unknown stage identities, invalid expiration and unrecognized part keys never widen deletion scope',async()=>{
  const bucket=new MemoryBucket().stage(ids[1],now-3*hour,{id:ids[5]}).parts(ids[1],1).stage(ids[2],now-3*hour,{expiresAt:'invalid'}).parts(ids[2],1).stage(ids[3],now-3*hour).parts(ids[3],1);
  bucket.objects.set('private/client-staging/unexpected.json','{}');bucket.objects.set('private/client-reports/'+ids[3]+'/private-access.json','protected');
  const before=[...bucket.objects],answers=await drain(bucket,ids[0]);assert.deepEqual([...bucket.objects],before);assert.equal(bucket.deleted.length,0);assert(answers.some(item=>item.skipped==='unknown-part'));
});

test('malformed and forged cursors cannot select arbitrary private objects',async()=>{
  const bucket=new MemoryBucket().stage(ids[1],now+hour).parts(ids[1],2),encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  for(const cursor of ['not a cursor',encode({v:1,listCursor:null,pendingId:'../access-v3'}),encode({v:1,listCursor:null,pendingId:ids[1],prefix:'private/'})])await assert.rejects(cleanup(bucket,ids[0],{now,cursor}),/cursor/);
  assert.equal(bucket.calls.length,0);
  const forged=encode({v:1,listCursor:null,pendingId:ids[1]}),answer=await cleanup(bucket,ids[0],{now,cursor:forged});assert.equal(answer.deleted,0);assert.equal(answer.skipped,'retained-stage');
  const missing=await cleanup(bucket,ids[0],{now,cursor:encode({v:1,listCursor:null,pendingId:ids[6]})});assert.equal(missing.skipped,'missing-stage');assert.equal(bucket.deleted.length,0);
  assert.equal((await cleanup(bucket,'none',{now})).skipped,'no-current-revision');
});

test('partial deletion failure retains the stage for a safe retry and concurrent collectors are idempotent',async()=>{
  const bucket=new MemoryBucket().stage(ids[1],now-3*hour).parts(ids[1],4),remove=bucket.delete.bind(bucket);let attempts=0;
  bucket.delete=async key=>{if(++attempts===3)throw new Error('Temporary D1 failure');await remove(key);};
  await assert.rejects(cleanup(bucket,ids[0],{now}),/Temporary/);assert(bucket.objects.has(stageKey(ids[1])));assert.equal(bucket.objects.size,3);
  bucket.delete=remove;await Promise.all([cleanup(bucket,ids[0],{now}),cleanup(bucket,ids[0],{now})]);assert.equal(bucket.objects.size,0);
});
