import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CORRECTION_PROGRESS_KEYS,CORRECTION_PROGRESS_LEGACY_KEY,CORRECTION_PROGRESS_OBJECT_BYTES,readCorrectionProgress,readCorrectionProgressMetadata,correctionProgressRevision,saveProgressEntry,partitionCorrectionProgress} from '../worker/correction-progress.js';
import {buildMigrationFiles} from '../worker/migration.js';
import {validateMigrationBackup,restoreMigrationObjects} from '../migration/restore-data.mjs';
const key=value=>createHash('sha256').update(String(value)).digest('hex');
const entry=(done=true)=>({done,updatedAt:'2026-11-10T12:00:00.000Z',updatedBy:'Synthetic Reviewer Name',updatedByUserId:'22222222-2222-4222-8222-222222222222',reportRevision:'11111111-1111-4111-8111-111111111111'});
class Bucket{
 objects=new Map();serial=0;gets=0;heads=0;multi=0;puts=0;
 async get(key){this.gets++;const item=this.objects.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.body)}:null;}
 async head(key){this.heads++;const item=this.objects.get(key);return item?{etag:item.etag}:null;}
 async headMany(keys){this.multi++;return keys.map(key=>this.objects.has(key)?{etag:this.objects.get(key).etag}:null);}
 async put(key,body,options={}){this.puts++;body=typeof body==='string'?body:new TextDecoder().decode(body);assert(Buffer.byteLength(body)<1000000,'D1 object limit');const old=this.objects.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches||options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag='version-'+(++this.serial);this.objects.set(key,{etag,body});return {etag};}
 async list(){return {objects:[...this.objects.keys()].map(key=>({key})),truncated:false};}
}
test('shard acknowledgements override legacy false, preserve originals and use one metadata query without reading bodies',async()=>{
 const bucket=new Bucket(),first=key('first'),second=key('second');await bucket.put(CORRECTION_PROGRESS_LEGACY_KEY,JSON.stringify({schemaVersion:1,revision:'old',entries:{[first]:entry(),[second]:entry()}}));const original=bucket.objects.get(CORRECTION_PROGRESS_LEGACY_KEY).body;
 const before=await readCorrectionProgress(bucket),meta=await readCorrectionProgressMetadata(bucket);assert.equal(meta.revision,before.revision);
 const reads=bucket.gets,heads=bucket.heads;await readCorrectionProgressMetadata(bucket);assert.equal(bucket.gets,reads);assert.equal(bucket.heads,heads);assert(bucket.multi>0);
 const saved=await saveProgressEntry(bucket,first,entry(false)),after=await readCorrectionProgress(bucket);
 assert.equal(after.value.entries[first].done,false);assert.equal(after.value.entries[second].done,true);assert.notEqual(after.revision,before.revision);assert.equal(after.revision,saved.correctionProgressRevision);assert.equal(bucket.objects.get(CORRECTION_PROGRESS_LEGACY_KEY).body,original);
 const fallback={get:bucket.get.bind(bucket),head:bucket.head.bind(bucket)};assert.equal((await readCorrectionProgressMetadata(fallback)).revision,after.revision);
});
test('concurrent writers sharing a shard merge via CAS and validate on every retry',async()=>{
 const bucket=new Bucket(),a='a'+'1'.repeat(63),b='a'+'2'.repeat(63);let arrived=0,release,checks=0;const barrier=new Promise(resolve=>release=resolve),get=bucket.get.bind(bucket);
 bucket.get=async key=>{const found=await get(key);if(key===CORRECTION_PROGRESS_KEYS[11]&&arrived<2){arrived++;if(arrived===2)release();await barrier;}return found;};
 const results=await Promise.all([a,b].map(key=>saveProgressEntry(bucket,key,entry(),{validate:async()=>{checks++;}})));
 assert.equal(results.length,2);assert.equal(checks,3);const found=await readCorrectionProgress(bucket);assert.deepEqual(Object.keys(found.value.entries).sort(),[a,b]);assert.equal(bucket.objects.size,1);
});
test('permission or report changes at commit and during a CAS retry never overwrite a mark',async()=>{
 const bucket=new Bucket(),hash=key('review');await assert.rejects(saveProgressEntry(bucket,hash,entry(),{validate:async()=>{throw Object.assign(new Error('Denied'),{status:403});}}),{status:403});assert.equal(bucket.objects.size,0);
 const put=bucket.put.bind(bucket);let checks=0;bucket.put=async(...args)=>{if(bucket.puts++===0)return null;return put(...args);};
 await assert.rejects(saveProgressEntry(bucket,hash,entry(),{validate:async()=>{if(++checks===2)throw Object.assign(new Error('New report'),{status:409});}}),{status:409});assert.equal(checks,2);assert.equal(bucket.objects.size,0);
});
test('different shard changes invalidate revisions, missing storage stays none and malformed partitions fail closed',async()=>{
 const bucket=new Bucket();assert.equal(correctionProgressRevision(await readCorrectionProgressMetadata(bucket)),'none');assert.equal((await readCorrectionProgress(bucket)).value,null);
 const a='1'.repeat(64),b='f'.repeat(64);await saveProgressEntry(bucket,a,entry());const first=(await readCorrectionProgress(bucket)).revision;await saveProgressEntry(bucket,b,entry(false));assert.notEqual((await readCorrectionProgressMetadata(bucket)).revision,first);
 await bucket.put(CORRECTION_PROGRESS_KEYS[2],JSON.stringify({schemaVersion:1,entries:{[b]:entry()}}));await assert.rejects(readCorrectionProgress(bucket),error=>error.code==='CORRECTION_PROGRESS_INVALID');
});
test('bounded storage rejects an oversized shard before authorization or mutation and accepts later undo',async()=>{
 const bucket=new Bucket(),hash=key('capacity');await saveProgressEntry(bucket,hash,entry());const before=JSON.stringify([...bucket.objects]),puts=bucket.puts;let validates=0;
 await assert.rejects(saveProgressEntry(bucket,hash,{...entry(),updatedBy:'x'.repeat(CORRECTION_PROGRESS_OBJECT_BYTES)},{validate:async()=>validates++}),error=>error.code==='PROGRESS_CAPACITY');
 assert.equal(validates,0);assert.equal(bucket.puts,puts);assert.equal(JSON.stringify([...bucket.objects]),before);await saveProgressEntry(bucket,hash,entry(false));assert.equal((await readCorrectionProgress(bucket)).value.entries[hash].done,false);
});
test('full reads compute revision from the same object versions that supplied their entries',async()=>{
 const bucket=new Bucket(),a='2'.repeat(64);await saveProgressEntry(bucket,a,entry());const read=bucket.get.bind(bucket);let changed=false;
 bucket.get=async key=>{const object=await read(key);if(key===CORRECTION_PROGRESS_KEYS[3]&&!changed){changed=true;await bucket.put(key,JSON.stringify({schemaVersion:1,entries:{[a]:entry(false)}}));}return object;};
 const snapshot=await readCorrectionProgress(bucket);assert.equal(snapshot.value.entries[a].done,true);assert.notEqual(snapshot.revision,(await readCorrectionProgressMetadata(bucket)).revision);
});
test('large progress backup roundtrip preserves every entry while each stored object stays below D1 limits',async()=>{
 const entries=Object.fromEntries(Array.from({length:10000},(_,i)=>[key('large-'+i),entry(i%3!==0)])),logical={schemaVersion:1,entries},parts=partitionCorrectionProgress(logical),bucket=new Bucket();
 assert(Buffer.byteLength(JSON.stringify(logical))>2*1024*1024);assert.equal(parts.length,16);for(const part of parts){assert(part.body.byteLength<CORRECTION_PROGRESS_OBJECT_BYTES);await bucket.put(part.key,part.body);}
 const sourceData=new TextEncoder().encode('Synthetic source'),exported=await buildMigrationFiles({bucket,source:{data:sourceData,sha256:createHash('sha256').update(sourceData).digest('hex'),commitSha:'a'.repeat(40),fileCount:1,restorationInstructions:'Use an empty offline destination.'}});
 const files=new Map(exported.files.filter(file=>file.name!=='MANIFESTO.json').map(file=>[file.name,file.data])),checked=await validateMigrationBackup(exported.manifest,files),destination=new Bucket();
 const restored=await restoreMigrationObjects(destination,checked,{confirmNewEmptyBucket:true});assert.equal(restored.writtenKeys.length,16);assert(!destination.objects.has(CORRECTION_PROGRESS_LEGACY_KEY));
 assert.deepEqual({...((await readCorrectionProgress(destination)).value.entries)},entries);assert.equal(exported.manifest.counts.correctionEntries,10000);
});
