import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildMigrationFiles,MigrationExportError} from '../worker/migration.js';

const reportKey='private/report-latest-v1.json';
const progressKey='private/correction-progress-v1.json';
const aclKey='private/access-v3.json';
const stamp='2026-01-15T12:00:00.000Z';
const correctionKey='ab'.repeat(32);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceBytes=new TextEncoder().encode('synthetic source archive');
const source={data:sourceBytes,sha256:sha(sourceBytes),commitSha:'1'.repeat(40),fileCount:2,restorationInstructions:'Restaure somente em um projeto novo.'};
const configs=[{id:'owner',name:'Admin Exemplo',email:'admin@example.test',tokenHash:'secret-admin-hash',tokenHashes:['secret-extra-hash'],url:'secret-activation-url'}];

function seed() {
  return {
    [reportKey]:{schemaVersion:1,revision:'report-one',updatedAt:stamp,updatedBy:'Admin Exemplo',updatedByUserId:'owner',files:{bd:'Base.xlsx',control:'Controle.xlsx',secret:'secret-file-extra'},asOf:'2026-01-15',bd:[['Referência','Valor'],['DEMO-001',200]],control:[['Referência','Recebido'],['DEMO-001',50],['DEMO-001',0]],unknown:'secret-report-extra'},
    [progressKey]:{schemaVersion:1,entries:{[correctionKey]:{done:true,updatedAt:stamp,updatedBy:'Admin Exemplo',updatedByUserId:'owner',reportRevision:'older-report',tokenHash:'secret-progress-extra'}},sessions:'secret-progress-root'},
    [aclKey]:{schemaVersion:3,revision:'access-one',updatedAt:stamp,admins:{owner:{id:'owner',name:'Old label',email:'old@example.test',activatedAt:stamp,tokenHash:'secret-stored-admin'}},members:{'member-1':{id:'member-1',name:'Pessoa Exemplo',email:'person@example.test',status:'approved',role:'editor',requestCode:'DEMO-1234',requestedAt:stamp,approvedAt:stamp,approvedBy:'Admin Exemplo',approvedById:'owner',revokedAt:null,revokedBy:null,updatedAt:stamp,session:'secret-member-session'}},audit:[{at:stamp,actorId:'owner',actorName:'Admin Exemplo',action:'access_approved',target:'member-1',previousStatus:'pending',previousRole:'viewer',role:'editor',token:'secret-audit-token'}],tokenHashes:['secret-root-hash']},
    'private/sessions/do-not-export.json':{session:'secret-session-object'},
    'private/rates/do-not-export.json':{ipHash:'secret-ip-hash'},
  };
}

class ReadOnlyR2 {
  constructor(values=seed()) {this.values=new Map(Object.entries(values).map(([key,value])=>[key,{value,etag:'etag-'+key}])); this.reads=[];this.writes=0;this.heads=0;}
  async get(key) {this.reads.push(key);const stored=this.values.get(key);if(!stored)return null;const text=JSON.stringify(stored.value);return {etag:stored.etag,json:async()=>JSON.parse(text)};}
  async head(key) {this.heads++;const stored=this.values.get(key);return stored?{etag:stored.etag}:null;}
  async put() {this.writes++;throw Error('Export must never write');}
  async delete() {this.writes++;throw Error('Export must never delete');}
  async list() {throw Error('Export must never enumerate private storage');}
}
const run=(bucket,overrides={})=>buildMigrationFiles({bucket,admins:configs,source,now:()=>Date.parse(stamp),...overrides});
const jsonFile=(files,name)=>JSON.parse(new TextDecoder().decode(files.find(file=>file.name===name).data));

test('private snapshot preserves authoritative data, correction identifiers and profiles; excludes credential fields',async()=>{
  const bucket=new ReadOnlyR2();const before=JSON.stringify([...bucket.values]);
  const {files,manifest}=await run(bucket);
  assert.deepEqual(files.map(file=>file.name),['dados/bases-publicadas.json','dados/acompanhamento-correcoes.json','dados/cadastros-perfis.json','codigo-operacional.zip','RESTAURACAO.txt','MANIFESTO.json']);
  const report=jsonFile(files,'dados/bases-publicadas.json');assert.deepEqual(report.bd,seed()[reportKey].bd);assert.deepEqual(report.control,seed()[reportKey].control);assert.equal(report.revision,'report-one');
  const progress=jsonFile(files,'dados/acompanhamento-correcoes.json');assert.equal(progress.entries[correctionKey].done,true);assert.equal(progress.entries[correctionKey].reportRevision,'older-report','Earlier correction report revisions remain useful history');
  const acl=jsonFile(files,'dados/cadastros-perfis.json');assert.equal(acl.members['member-1'].role,'editor');assert.equal(acl.members['member-1'].status,'approved');assert.equal(acl.members['member-1'].requestCode,'DEMO-1234');assert.equal(acl.admins.owner.name,'Admin Exemplo');assert.equal(acl.admins.owner.activatedAt,stamp);assert.equal(acl.audit[0].previousRole,'viewer');
  const allData=files.map(file=>new TextDecoder().decode(file.data)).join('\n');assert.doesNotMatch(allData,/secret-/);assert.doesNotMatch(allData,/tokenHash|tokenHashes|adminHash|ipHash/);
  assert.equal(bucket.writes,0);assert.equal(JSON.stringify([...bucket.values]),before);
  assert.deepEqual(new Set(bucket.reads),new Set([reportKey,progressKey,aclKey]));
  assert.equal(manifest.capturedAt,stamp);assert.equal(manifest.source.commitSha,source.commitSha);
  assert.deepEqual(manifest.counts,{bdRows:1,controlRows:2,correctionEntries:1,admins:1,members:1,auditEvents:1});
  assert.deepEqual(manifest.objects.map(item=>item.schemaVersion),[1,1,3]);
  for(const item of manifest.files){const file=files.find(file=>file.name===item.path);assert.equal(item.bytes,file.data.byteLength);assert.equal(item.sha256,sha(file.data));}
  assert.deepEqual(jsonFile(files,'MANIFESTO.json'),manifest);
});

test('absent state is explicit and does not invent a report, corrections or ACL',async()=>{
  const {files,manifest}=await run(new ReadOnlyR2({}));
  for(const item of manifest.objects){assert.equal(item.present,false);assert.equal(item.etag,null);assert.equal(item.schemaVersion,null);assert.equal(jsonFile(files,item.path),null);}
  assert.deepEqual(manifest.counts,{bdRows:0,controlRows:0,correctionEntries:0,admins:0,members:0,auditEvents:0});
});

test('publication during snapshot retries and returns the coherent updated revision',async()=>{
  const bucket=new ReadOnlyR2();const head=bucket.head.bind(bucket);let changed=false;
  bucket.head=async key=>{if(!changed){changed=true;const report=bucket.values.get(reportKey);report.value={...report.value,revision:'report-two',control:[['Ref','Amount'],['DEMO-002',75]]};report.etag='new-report-etag';}return head(key);};
  const {files,manifest}=await run(bucket);assert.equal(jsonFile(files,'dados/bases-publicadas.json').revision,'report-two');assert.equal(manifest.objects[0].etag,'new-report-etag');assert.equal(bucket.reads.length,6);assert.equal(bucket.writes,0);
});

test('continually changing state returns a bounded conflict rather than an inconsistent archive',async()=>{
  const bucket=new ReadOnlyR2();let serial=0;
  bucket.head=async key=>({etag:bucket.values.get(key).etag+'-'+(++serial)});
  await assert.rejects(run(bucket),error=>error instanceof MigrationExportError&&error.status===409&&error.code==='MIGRATION_CHANGED');
  assert.equal(bucket.reads.length,9);assert.equal(bucket.writes,0);
});

test('snapshot can verify etags with get when a storage adapter has no head',async()=>{
  const bucket=new ReadOnlyR2();bucket.head=undefined;
  const {manifest}=await run(bucket);assert.equal(manifest.counts.members,1);assert.equal(bucket.reads.length,6);
});

test('malformed known objects and non-scalar allowlisted data fail instead of exporting hidden objects',async()=>{
  const cases=[
    [reportKey,null],
    [reportKey,{...seed()[reportKey],schemaVersion:99}],
    [reportKey,{...seed()[reportKey],bd:[['Value'],[{token:'hidden'}]]}],
    [progressKey,{schemaVersion:1,entries:{invalid:{done:true}}}],
    [progressKey,{schemaVersion:1,entries:{[correctionKey]:{done:'yes'}}}],
    [aclKey,{...seed()[aclKey],members:{bad:{id:'bad',name:{token:'hidden'}}}}],
  ];
  for(const [key,value] of cases){const data=seed();data[key]=value;await assert.rejects(run(new ReadOnlyR2(data)),error=>error.status===503&&error.code==='MIGRATION_INVALID_STORAGE');}
});

test('missing or tampered source package fails before private storage reads',async()=>{
  const bucket=new ReadOnlyR2();
  for(const bad of [null,{...source,sha256:'0'.repeat(64)},{...source,commitSha:'not-a-commit'},{...source,data:new Uint8Array()},{...source,restorationInstructions:''}]){
    await assert.rejects(run(bucket,{source:bad}),error=>error.status===503&&error.code==='MIGRATION_SOURCE_UNAVAILABLE');
  }
  assert.equal(bucket.reads.length,0);
});

test('lazy source archive is decoded only once for each backup',async()=>{
  let decoded=0;const lazy={...source,get data(){decoded++;return sourceBytes;}};
  await run(new ReadOnlyR2(),{source:lazy});assert.equal(decoded,1);
});
