import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {buildMigrationFiles} from '../worker/migration.js';
import {validateMigrationBackup,loadMigrationBackup,restoreMigrationObjects,prepareMigrationObjects} from '../migration/restore-data.mjs';
const E=createRequire(import.meta.url)('../dist/engine.js');
const hash=x=>createHash('sha256').update(x).digest('hex');
const keys=['private/report-latest-v1.json','private/correction-progress-v1.json','private/access-v3.json'];
const stamp='2026-01-05T10:00:00.000Z';
class Bucket{
  objects=new Map();writes=[];
  constructor(objects={}){for(const[k,v]of Object.entries(objects))this.objects.set(k,{value:structuredClone(v),etag:'seed-'+k});}
  async get(key){const o=this.objects.get(key);return o?{etag:o.etag,json:async()=>structuredClone(o.value)}:null;}
  async head(key){const o=this.objects.get(key);return o?{etag:o.etag}:null;}
  async list(){return {objects:[...this.objects.keys()].map(key=>({key})),truncated:false};}
  async put(key,bytes,options){this.writes.push(key);if(this.objects.has(key)&&options.onlyIf.etagDoesNotMatch==='*')return null;const value=JSON.parse(new TextDecoder().decode(bytes));this.objects.set(key,{value,options,etag:'restored-'+key});return {etag:'restored-'+key};}
}
function fixtures(){
  const bh=Array(57).fill(null),ch=Array(32).fill(null),bd=Array(57).fill(null),cr=Array(32).fill(null);
  Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
  Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
  Object.assign(bd,{0:'TESTE-1',1:'2025-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'DEMO/1',24:90001,25:'EXPORTAÇÃO - CTNR',28:'FORNECEDOR DEMONSTRATIVO',35:1200,56:'Analista Exemplo'});
  Object.assign(cr,{1:2026,3:'MERCADO EXTERNO',7:'DEMO/1',9:'CONF. DEMO',10:'FORNECEDOR DEMONSTRATIVO',11:'Boleto',12:'Pago',13:'2026-01-01',14:300,17:'2026-01-01',19:300,23:'Reembolsado',30:2026,31:'Analista Exemplo'});
  return {
    [keys[0]]:{schemaVersion:1,revision:'report-example',updatedAt:stamp,updatedBy:'Responsável Exemplo',updatedByUserId:'owner',files:{bd:'BD exemplo.xlsx',control:'Controle exemplo.xlsx'},asOf:'2026-01-05',bd:[bh,bd],control:[ch,cr]},
    [keys[1]]:{schemaVersion:1,entries:{['a'.repeat(64)]:{done:true,updatedAt:stamp,updatedBy:'Responsável Exemplo',updatedByUserId:'owner',reportRevision:'older-report'}}},
    [keys[2]]:{schemaVersion:3,revision:'acl-example',updatedAt:stamp,admins:{owner:{id:'owner',name:'Responsável Exemplo',email:'owner@example.test',activatedAt:stamp}},members:{'person-a':{id:'person-a',name:'Pessoa Exemplo',email:'person@example.test',status:'approved',role:'editor',requestCode:'ABCD-2345',requestedAt:stamp,approvedAt:stamp,approvedBy:'Responsável Exemplo'},'legacy-b':{id:'legacy-b',name:'Legado Exemplo',email:'legacy@example.test',status:'approved'}},audit:[{at:stamp,actorId:'owner',actorName:'Responsável Exemplo',action:'access_approved',target:'person-a'}]},
  };
}
async function pack(objects=fixtures()){
  const sourceData=new TextEncoder().encode('synthetic-source-fixture');
  const exported=await buildMigrationFiles({bucket:new Bucket(objects),source:{data:sourceData,sha256:hash(sourceData),commitSha:'b'.repeat(40),fileCount:1,restorationInstructions:'Instruções de restauração fictícias.'},now:()=>Date.parse(stamp)});
  return {manifest:exported.manifest,files:new Map(exported.files.filter(x=>x.name!=='MANIFESTO.json').map(x=>[x.name,x.data]))};
}

test('real export -> validate -> restore preserves published calculations, profiles and correction keys',async()=>{
  const original=fixtures(),backup=await pack(original),destination=new Bucket();
  const checked=await validateMigrationBackup(backup.manifest,backup.files);
  const result=await restoreMigrationObjects(destination,checked,{confirmNewEmptyBucket:true});
  assert.deepEqual(result.writtenKeys,keys);assert.equal(result.reportRevision,'report-example');
  for(const key of keys)assert.deepEqual(destination.objects.get(key).value,original[key]);
  const restored=destination.objects.get(keys[0]),options={years:[2025,2026],asOf:original[keys[0]].asOf,lossFormula:'subtract-negotiating'};
  assert.deepEqual(E.analyze(restored.value.bd,restored.value.control,options).summary,E.analyze(original[keys[0]].bd,original[keys[0]].control,options).summary);
  assert.deepEqual(restored.options.customMetadata,{revision:'report-example',updatedAt:stamp,updatedBy:'Responsável Exemplo',updatedByUserId:'owner',bdName:'BD exemplo.xlsx',controlName:'Controle exemplo.xlsx',asOf:'2026-01-05'});
  assert(destination.objects.get(keys[1]).value.entries['a'.repeat(64)].done);
  assert.equal(destination.objects.get(keys[2]).value.members['person-a'].role,'editor');
  assert.equal(destination.objects.get(keys[2]).value.members['legacy-b'].role,undefined);
  assert.equal([...destination.objects.keys()].some(k=>/sessions|rates/.test(k)),false);
});

test('restore rejects nonempty destination and damaged checksum before any writes',async()=>{
  const backup=await pack(),destination=new Bucket({'private/sessions/old':{private:true}});
  await assert.rejects(restoreMigrationObjects(destination,backup,{confirmNewEmptyBucket:true}),/não está vazio/);assert.deepEqual(destination.writes,[]);
  const empty=new Bucket();backup.files.set('dados/bases-publicadas.json',new TextEncoder().encode('{}'));
  await assert.rejects(restoreMigrationObjects(empty,backup,{confirmNewEmptyBucket:true}),/divergente/);assert.deepEqual(empty.writes,[]);
  await assert.rejects(restoreMigrationObjects(empty,await pack()),/Confirme explicitamente/);assert.deepEqual(empty.writes,[]);
});

test('unknown storage key and credential fields cannot be imported even with a rewritten checksum',async()=>{
  const altered=await pack();altered.manifest.objects[0].key='private/sessions/forged';
  await assert.rejects(restoreMigrationObjects(new Bucket(),altered,{confirmNewEmptyBucket:true}),/desconhecido/);
  const backup=await pack(),file='dados/cadastros-perfis.json';
  const value=JSON.parse(new TextDecoder().decode(backup.files.get(file)));value.admins.owner.tokenHash='forged';
  const data=new TextEncoder().encode(JSON.stringify(value));backup.files.set(file,data);Object.assign(backup.manifest.files.find(x=>x.path===file),{bytes:data.length,sha256:hash(data)});
  const destination=new Bucket();await assert.rejects(restoreMigrationObjects(destination,backup,{confirmNewEmptyBucket:true}),/campo não permitido/);assert.deepEqual(destination.writes,[]);
});

test('missing objects stay absent, without invented empty records',async()=>{
  const backup=await pack({}),destination=new Bucket();
  const result=await restoreMigrationObjects(destination,backup,{confirmNewEmptyBucket:true});
  assert.deepEqual(result.absentKeys,keys);assert.deepEqual(result.writtenKeys,[]);assert.equal(result.reportRevision,null);assert.equal(destination.objects.size,0);
});

test('conditional create blocks a concurrent destination write and reports partial import',async()=>{
  const backup=await pack(),destination=new Bucket(),put=destination.put.bind(destination);
  destination.put=async(key,...args)=>{if(key===keys[1])destination.objects.set(key,{value:{concurrent:true}});return put(key,...args);};
  await assert.rejects(restoreMigrationObjects(destination,backup,{confirmNewEmptyBucket:true}),error=>{assert.deepEqual(error.writtenKeys,[keys[0]]);return /interrompida/.test(error.message);});
  assert.deepEqual(destination.objects.get(keys[1]).value,{concurrent:true});assert(!destination.objects.has(keys[2]));
});

test('offline loader validates extracted package and preparation writes no existing directory',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'claims-migration-'));
  try{
    const backup=await pack();await mkdir(path.join(root,'dados'));await writeFile(path.join(root,'MANIFESTO.json'),JSON.stringify(backup.manifest));
    for(const[name,data]of backup.files)await writeFile(path.join(root,name),data);
    const checked=await loadMigrationBackup(root),prepared=path.join(root,'prepared');
    const plan=await prepareMigrationObjects(checked,prepared);assert.equal(plan.requiresNewEmptyBucket,true);assert.equal(plan.objects.length,3);
    assert.deepEqual(JSON.parse(await readFile(path.join(prepared,'report-latest-v1.json'),'utf8')),fixtures()[keys[0]]);
    await assert.rejects(prepareMigrationObjects(checked,prepared),error=>error.code==='EEXIST');
  }finally{await rm(root,{recursive:true,force:true});}
});
