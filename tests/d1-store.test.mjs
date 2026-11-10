import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createD1Bucket,D1_OBJECT_MAX_BYTES} from '../worker/d1-store.js';
import {cleanup} from '../worker/client-report-cleanup.js';
import {createApiHandler,apiConstants} from '../worker/backend.js';

// Run the actual SQL against SQLite, rather than emulating its CAS semantics.
// Only the D1 binding/result envelope and BLOB array return shape are adapted.
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../worker/d1-schema.sql',import.meta.url),'utf8'));
  t.after(() => sqlite.close());
  const calls = [];
  const row = value => value ? Object.fromEntries(Object.entries(value).map(([key,item]) => [key,item instanceof Uint8Array ? [...item] : item])) : null;
  const db = {prepare(sql) {
    return {bind(...values) {
      const args = values.map(value => value instanceof ArrayBuffer ? new Uint8Array(value) : value);
      return {
        async first(){calls.push({sql,values,method:'first'});return row(sqlite.prepare(sql).get(...args));},
        async all(){calls.push({sql,values,method:'all'});return {success:true,results:sqlite.prepare(sql).all(...args).map(row)};},
        async run(){calls.push({sql,values,method:'run'});const result=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:Number(result.changes)}};}
      };
    }};
  }};
  return {sqlite,db,calls,bucket:createD1Bucket(db)};
}

test('D1 stores UTF-8 and binary bodies losslessly and returns a single-use response stream',async t => {
  const {bucket}=fixture(t),key='private/ação.json',text=JSON.stringify({label:'São Paulo · 日本 · 🧾',value:123.45});
  const written=await bucket.put(key,text,{httpMetadata:{contentType:'application/json'},customMetadata:{revision:'test-revision'}});
  assert.equal(written.key,key);assert.match(written.etag,/^[a-f0-9-]{36}$/);assert.equal(written.size,Buffer.byteLength(text));
  const item=await bucket.get(key);assert.equal(item.etag,written.etag);assert.deepEqual(item.httpMetadata,{contentType:'application/json'});assert.deepEqual(item.customMetadata,{revision:'test-revision'});
  assert.equal(item.bodyUsed,false);assert.deepEqual(await item.json(),JSON.parse(text));assert.equal(item.bodyUsed,true);await assert.rejects(item.text(),TypeError);
  assert.equal(await new Response((await bucket.get(key)).body).text(),text);
  const backing=Uint8Array.of(90,0,255,128,65,91),slice=backing.subarray(1,5);
  await bucket.put('binary',slice);backing.fill(42);
  assert.deepEqual(new Uint8Array(await (await bucket.get('binary')).arrayBuffer()),Uint8Array.of(0,255,128,65));
});

test('head reads only metadata and length, while missing objects and deletion match R2 behavior',async t => {
  const {bucket,calls}=fixture(t);
  assert.equal(await bucket.get('missing'),null);assert.equal(await bucket.head('missing'),null);
  await bucket.put('object','secret body',{customMetadata:{revision:'v1'}});calls.length=0;
  const head=await bucket.head('object');assert.equal(head.size,11);assert.equal(head.body,undefined);assert.equal(head.json,undefined);
  assert.equal(calls.length,1);assert.match(calls[0].sql,/length\(body\)/);assert.doesNotMatch(calls[0].sql,/, body FROM/);
  head.customMetadata.revision='mutated';assert.equal((await bucket.head('object')).customMetadata.revision,'v1');
  await bucket.delete('object');await bucket.delete('missing');assert.equal(await bucket.get('object'),null);
});

test('headMany reads an ordered metadata snapshot in one query without fetching bodies',async t => {
  const {bucket,calls}=fixture(t);
  const a=await bucket.put('shard-a','first body',{customMetadata:{revision:'a'}});
  const b=await bucket.put("shard-'b",'second body',{customMetadata:{revision:'b'}});
  calls.length=0;
  const heads=await bucket.headMany(["shard-'b",'absent','shard-a','shard-a']);
  assert.deepEqual(heads.map(head=>head?.etag??null),[b.etag,null,a.etag,a.etag]);
  assert.equal(calls.length,1);assert.equal(calls[0].method,'all');
  assert.match(calls[0].sql,/WHERE object_key IN \(\?1,\?2,\?3,\?4\)/);
  assert.doesNotMatch(calls[0].sql,/, body FROM/);assert(!calls[0].sql.includes("shard-'b"));
  assert(heads.filter(Boolean).every(head=>head.body===undefined&&head.json===undefined));
  heads[2].customMetadata.revision='modified';assert.equal(heads[3].customMetadata.revision,'a');
  calls.length=0;assert.deepEqual(await bucket.headMany([]),[]);assert.equal(calls.length,0);
  await assert.rejects(bucket.headMany('shard-a'),TypeError);
  await assert.rejects(bucket.headMany(Array(65).fill('shard-a')),TypeError);
  await assert.rejects(bucket.headMany(['shard-a',null]),TypeError);
  assert.equal(calls.length,0);
});

test('conditional creation and replacement are atomic and stale ETags cannot create or overwrite',async t => {
  const {bucket,db,calls}=fixture(t),other=createD1Bucket(db);
  const created=await Promise.all([bucket.put('shared','one',{onlyIf:{etagDoesNotMatch:'*'}}),other.put('shared','two',{onlyIf:{etagDoesNotMatch:'*'}})]);
  assert.equal(created.filter(Boolean).length,1);const original=created.find(Boolean);
  calls.length=0;
  const changed=await Promise.all([bucket.put('shared','winner A',{onlyIf:{etagMatches:original.etag},customMetadata:{revision:'A'}}),other.put('shared','winner B',{onlyIf:{etagMatches:original.etag},customMetadata:{revision:'B'}})]);
  assert.equal(changed.filter(Boolean).length,1);assert.equal(calls.length,2);assert(calls.every(call=>call.method==='run'&&/^UPDATE/.test(call.sql)));
  const accepted=changed.find(Boolean),before=await bucket.get('shared'),beforeText=await before.text();assert.equal(before.etag,accepted.etag);assert.notEqual(before.etag,original.etag);
  assert.equal(await bucket.put('shared','stale',{onlyIf:{etagMatches:original.etag}}),null);
  assert.equal(await bucket.put('missing','should not exist',{onlyIf:{etagMatches:original.etag}}),null);assert.equal(await bucket.get('missing'),null);
  const after=await bucket.get('shared');assert.equal(after.etag,accepted.etag);assert.equal(await after.text(),beforeText);assert.deepEqual(after.customMetadata,before.customMetadata);
  const replacement=await bucket.put('shared','new');assert.notEqual(replacement.etag,accepted.etag);assert.deepEqual(replacement.customMetadata,{});
});

test('prefix pagination is stable, case-sensitive and literal even for SQL wildcard characters',async t => {
  const {bucket,calls}=fixture(t),keys=['private/A','private/a','private/a%/1','private/a%/2','private/a_/1','private/aX/1','private/ação','private/🧾/1','public/a'];
  for(const key of keys)await bucket.put(key,'{}');
  const found=[];let cursor;
  do{const page=await bucket.list({prefix:'private/',cursor,limit:2});assert(page.objects.length<=2);assert(page.objects.every(item=>!Object.hasOwn(item,'body')));found.push(...page.objects.map(item=>item.key));cursor=page.cursor;if(!page.truncated)assert.equal(cursor,undefined);}while(cursor);
  assert.deepEqual(found,keys.filter(key=>key.startsWith('private/')).sort());
  assert.deepEqual((await bucket.list({prefix:'private/a%/'})).objects.map(item=>item.key),['private/a%/1','private/a%/2']);
  assert.deepEqual((await bucket.list({prefix:'private/a_/'})).objects.map(item=>item.key),['private/a_/1']);
  assert.equal((await bucket.list({prefix:'Private/'})).objects.length,0);
  assert.equal((await bucket.list({prefix:'private/🧾/'})).objects.length,1);
  const first=await bucket.list({prefix:'private/',limit:1});await assert.rejects(bucket.list({prefix:'public/',cursor:first.cursor}),/cursor/);await assert.rejects(bucket.list({cursor:'not valid!'}),/cursor/);
  assert(calls.filter(call=>call.method==='all').every(call=>!call.sql.includes('LIKE')));
});

test('SQL is bound, byte limits include UTF-8 metadata, and unsupported conditions fail before writes',async t => {
  const {bucket,calls,sqlite}=fixture(t),key="private/'; DROP TABLE claims_objects; --";
  await bucket.put(key,'valid');assert.equal(await (await bucket.get(key)).text(),'valid');
  assert(calls.every(call=>!call.sql.includes(key)));assert.equal(sqlite.prepare('SELECT count(*) AS n FROM claims_objects').get().n,1);
  const count=calls.length;
  await assert.rejects(bucket.put('too-large','é'.repeat(D1_OBJECT_MAX_BYTES/2)),RangeError);
  await assert.rejects(bucket.put('too-large-meta','x',{customMetadata:{text:'x'.repeat(16384)}}),RangeError);
  for(const onlyIf of [{etagMatches:''},{etagDoesNotMatch:'old'},{etagMatches:'a',etagDoesNotMatch:'*'},{unmodifiedSince:'today'}])await assert.rejects(bucket.put('bad','x',{onlyIf}),TypeError);
  await assert.rejects(bucket.put('bad',{not:'bytes'}),TypeError);await assert.rejects(bucket.put('bad','x',{customMetadata:{count:1}}),TypeError);
  await assert.rejects(bucket.get('bad\0key'),TypeError);await assert.rejects(bucket.list({limit:1001}),RangeError);assert.equal(calls.length,count);
  assert.throws(()=>sqlite.prepare('INSERT INTO claims_objects VALUES (?,?,?,?)').run('bypass',new Uint8Array(D1_OBJECT_MAX_BYTES),'e','{}'),/CHECK/);
});

test('unconfirmed database mutations and reads propagate errors instead of reporting success',async()=>{
  const db={prepare(){return{bind(){return{run:async()=>({success:false}),all:async()=>({success:false}),first:async()=>{throw new Error('D1 unavailable');}};}};}};
  const bucket=createD1Bucket(db);await assert.rejects(bucket.put('test','x'),/confirmed/);await assert.rejects(bucket.delete('test'),/confirmed/);await assert.rejects(bucket.list(),/read/);await assert.rejects(bucket.get('test'),/D1 unavailable/);
});

test('cleanup advances D1 cursors after deleted stage keys without exceeding the query budget',async t=>{
  const {bucket,calls}=fixture(t),now=Date.parse('2026-11-10T12:00:00Z'),current='00000000-1111-4111-8111-111111111111',old=['11111111-1111-4111-8111-111111111111','22222222-1111-4111-8111-111111111111'];
  for(const id of [current,...old])await bucket.put('private/client-staging/'+id+'.json',JSON.stringify({schemaVersion:2,id,expiresAt:'2026-11-10T08:00:00Z'}));
  for(const id of [current,...old])for(let n=0;n<13;n++)await bucket.put('private/client-reports/'+id+'/bd/'+n+'.projected.json','{}');
  let cursor=null,iterations=0;
  do{const start=calls.length,result=await cleanup(bucket,current,{now,cursor});assert(result.deleted<=12);assert(calls.length-start<=16);cursor=result.cursor;if(++iterations>8)throw new Error('D1 traversal stalled');}while(cursor);
  const remaining=await bucket.list({prefix:'private/'});assert.equal(remaining.objects.length,14);assert(remaining.objects.every(item=>item.key.includes(current)));
});

test('the private API uses D1 for authorization, immutable parts, metadata and streaming without engine analysis',async t => {
  const {bucket,calls}=fixture(t),tokens=[Buffer.alloc(32,63).toString('base64url'),Buffer.alloc(32,64).toString('base64url')];
  const env={BUCKET:bucket,CF_CLIENT_ANALYSIS:'1',ADMIN_LINK_HASHES:JSON.stringify(apiConstants.adminIds.map((id,index)=>({id,name:'Admin Example '+index,tokenHash:createHash('sha256').update(tokens[index]).digest('hex')})))};
  let analyses=0;
  const handler=createApiHandler({engine:{analyze(){analyses++;throw new Error('Must run in browser');},validateHeaders(){},parseDate:value=>value,today:()=> '2026-11-10'}}),origin='https://claims.example.test';
  async function call(path,cookie,body){const headers=new Headers();if(cookie)headers.set('cookie',cookie);if(body){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}const response=await handler(new Request(origin+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env);return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
  const denied=await call('/api/client-report');assert.equal(denied.status,401);assert.equal(calls.length,0);
  const admin=await call('/api/auth/exchange',null,{token:tokens[0]});assert.equal(admin.status,200);
  const stage=await call('/api/client-report/start',admin.cookie,{expectedRevision:'none',expectedRows:{bd:2,control:2},files:{bd:'BD.xlsx',control:'Controle.xlsx'}});assert.equal(stage.status,201);
  const rows={bd:[['SGR'],['TEST-1']],control:[['Ano'],[2026]]};
  for(const sheet of ['bd','control']){const part=await call('/api/client-report/'+stage.body.uploadId+'/parts',admin.cookie,{sheet,index:0,firstRow:0,rows:rows[sheet]});assert.equal(part.status,201);}
  const published=await call('/api/client-report/'+stage.body.uploadId+'/commit',admin.cookie,{});assert.equal(published.status,200);
  const manifest=await call('/api/client-report',admin.cookie);assert.equal(manifest.status,200);assert.equal(manifest.body.parts.length,2);
  const part=await call(manifest.body.parts[0].url,admin.cookie);assert.equal(part.status,200);assert.equal(part.body.rows[1][0],'TEST-1');
  const meta=await call('/api/report/meta',admin.cookie);assert.equal(meta.body.reportMeta.revision,published.body.revision);assert.equal(analyses,0);
  const outsider=await call('/api/auth/request',null,{name:'Viewer Example'});assert.equal(outsider.status,201);const pending=await call(manifest.body.parts[0].url,outsider.cookie);assert.equal(pending.status,403);
});
