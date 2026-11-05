import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {createApiHandler, apiConstants} from '../worker/backend.js';
import {migrationZipChunks} from '../worker/zip.js';

const require=createRequire(import.meta.url);
const engine=require('../dist/engine.js');
const origin='https://claims.example.test';
const digest=value=>createHash('sha256').update(value).digest('hex');
const now=Date.parse('2026-01-12T12:00:00.000Z');
const sourceBytes=new Uint8Array(Buffer.concat(migrationZipChunks([{name:'README.txt',data:'Código de exemplo para teste.'}])));
const source={data:sourceBytes,sha256:digest(sourceBytes),fileCount:1,commitSha:'a'.repeat(40),restorationInstructions:'Restaure somente em um novo armazenamento privado.'};
const handler=createApiHandler({engine,now:()=>now,migrationSource:source});

class MemoryR2 {
 objects=new Map();writes=0;deletes=0;reads=[];
 seed(key,value){this.objects.set(key,{text:JSON.stringify(value),etag:digest(JSON.stringify(value))});}
 async get(key){this.reads.push(key);const value=this.objects.get(key);return value?{etag:value.etag,json:async()=>JSON.parse(value.text)}:null;}
 async head(key){this.reads.push(key);const value=this.objects.get(key);return value?{etag:value.etag}:null;}
 async put(){this.writes++;throw new Error('Export must not write to storage');}
 async delete(){this.deletes++;throw new Error('Export must not delete storage');}
}
function fixture(){
 const bucket=new MemoryR2();
 const adminTokens=apiConstants.adminIds.map(()=>randomBytes(32).toString('base64url'));
 const admins=apiConstants.adminIds.map((id,i)=>({id,name:'Administração de exemplo '+(i+1),email:'admin'+i+'@example.invalid',tokenHash:digest(adminTokens[i])}));
 const cookies={};
 const acl={schemaVersion:3,revision:'acl-demo',updatedAt:'2026-01-10T00:00:00.000Z',admins:Object.fromEntries(admins.map(({id,name,email})=>[id,{id,name,email,activatedAt:null}])),members:{},audit:[]};
 for(const role of ['admin','pending','viewer','editor','revoked']){
  const token=randomBytes(32).toString('base64url');
  const id=role==='admin'?admins[0].id:randomUUID();
  const session={schemaVersion:1,principalId:id,role:role==='admin'?'admin':'viewer',issuedAt:'2026-01-10T00:00:00.000Z',expiresAt:'2026-02-10T00:00:00.000Z'};
  if(role==='admin')session.adminHash=admins[0].tokenHash;
  else acl.members[id]={id,name:role+' de exemplo',email:role+'@example.invalid',status:role==='pending'?'pending':role==='revoked'?'revoked':'approved',role:role==='editor'?'editor':'viewer',requestedAt:'2026-01-10T00:00:00.000Z',requestCode:'ABCD-EFGH',approvedAt:null,approvedBy:null,updatedAt:'2026-01-10T00:00:00.000Z'};
  bucket.seed('private/sessions/'+digest(token)+'.json',session);
  cookies[role]=apiConstants.cookieName+'='+token;
 }
 bucket.seed('private/access-v3.json',acl);
 bucket.seed('private/report-latest-v1.json',{schemaVersion:1,revision:'report-demo',updatedAt:'2026-01-10T00:00:00.000Z',updatedBy:'Administração de exemplo',updatedByUserId:admins[0].id,files:{bd:'base-exemplo.xlsx',control:'controle-exemplo.xlsx'},asOf:'2026-01-10',bd:[['Cabeçalho de exemplo'],['Dado publicado de exemplo']],control:[['Cabeçalho de exemplo'],[125]]});
 bucket.seed('private/correction-progress-v1.json',{schemaVersion:1,entries:{['b'.repeat(64)]:{done:true,updatedAt:'2026-01-11T00:00:00.000Z',updatedBy:'Administração de exemplo',updatedByUserId:admins[0].id,reportRevision:'report-demo'}}});
 bucket.seed('private/rates/request-never-export.json',{ipHash:'never-export-ip-hash',count:1});
 return {BUCKET:bucket,ADMIN_LINK_HASHES:JSON.stringify(admins),cookies};
}
function request(cookie,{method='GET',query=''}={}){
 const headers=new Headers();
 if(cookie)headers.set('cookie',cookie);
 if(!['GET','HEAD'].includes(method)){headers.set('origin',origin);headers.set('content-type','application/json');headers.set('x-minerva-request','1');}
 return new Request(origin+'/api/migration/export'+query,{method,headers});
}
function unzipStored(bytes){
 const buffer=Buffer.from(bytes),entries=new Map();let offset=0;
 while(buffer.readUInt32LE(offset)===0x04034b50){
  assert.equal(buffer.readUInt16LE(offset+8),0,'The test fixture expects stored ZIP entries');
  const size=buffer.readUInt32LE(offset+18),nameLength=buffer.readUInt16LE(offset+26),extra=buffer.readUInt16LE(offset+28);
  const name=buffer.subarray(offset+30,offset+30+nameLength).toString();
  const start=offset+30+nameLength+extra;
  entries.set(name,buffer.subarray(start,start+size));offset=start+size;
 }
 assert.equal(buffer.readUInt32LE(offset),0x02014b50,'ZIP has its central directory');
 return entries;
}

test('private migration is denied to anonymous, pending, viewer, editor and revoked access without writes',async()=>{
 const env=fixture();
 for(const role of ['anonymous','pending','viewer','editor','revoked']){
  const response=await handler(request(env.cookies[role]),env);
  assert.equal(response.status,role==='anonymous'?401:403,role);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
  assert.equal(env.BUCKET.writes,0);assert.equal(env.BUCKET.deletes,0);
 }
 assert(!env.BUCKET.reads.includes('private/report-latest-v1.json'));
 assert(!env.BUCKET.reads.includes('private/correction-progress-v1.json'));
});

test('admin receives a private ZIP of published state, not sessions or rates, without storage writes',async()=>{
 const env=fixture();
 const before=[...env.BUCKET.objects];
 const response=await handler(request(env.cookies.admin,{query:'?key=private/sessions/fake.json'}),env);
 assert.equal(response.status,200);
 assert.match(response.headers.get('content-type'),/^application\/zip/);
 assert.match(response.headers.get('content-disposition'),/attachment;.*Minerva-Claims-Migracao-Privada\.zip/);
 assert.match(response.headers.get('cache-control'),/no-store/);
 const entries=unzipStored(await response.arrayBuffer());
 for(const name of ['codigo-operacional.zip','dados/bases-publicadas.json','dados/acompanhamento-correcoes.json','dados/cadastros-perfis.json','MANIFESTO.json','RESTAURACAO.txt'])assert(entries.has(name),name);
 const report=JSON.parse(entries.get('dados/bases-publicadas.json'));
 assert.equal(report.revision,'report-demo');assert.equal(report.bd[1][0],'Dado publicado de exemplo');assert.equal(report.control[1][0],125);
 const progress=JSON.parse(entries.get('dados/acompanhamento-correcoes.json'));
 assert.equal(progress.entries['b'.repeat(64)].done,true);
 const acl=JSON.parse(entries.get('dados/cadastros-perfis.json'));
 assert.equal(Object.keys(acl.members).length,4);assert.equal(Object.keys(acl.admins).length,2);
 const flattened=[...entries.values()].map(bytes=>bytes.toString()).join('\n');
 for(const term of ['never-export-ip-hash','adminHash','tokenHash',env.cookies.admin])assert(!flattened.includes(term));
 assert.equal(env.BUCKET.writes,0);assert.equal(env.BUCKET.deletes,0);assert.deepEqual([...env.BUCKET.objects],before);
 assert(!env.BUCKET.reads.some(key=>key.includes('/rates/')||key.endsWith('/fake.json')));
});

test('admin export requires GET and a source bundle; neither failure mutates storage',async()=>{
 const env=fixture();
 for(const method of ['HEAD','POST','DELETE']){
  const response=await handler(request(env.cookies.admin,{method}),env);
  assert.equal(response.status,405);
 }
 const unavailable=createApiHandler({engine,now:()=>now});
 const response=await unavailable(request(env.cookies.admin),env);
 assert.equal(response.status,503);assert.equal((await response.json()).code,'MIGRATION_SOURCE_UNAVAILABLE');
 assert.equal(env.BUCKET.writes,0);assert.equal(env.BUCKET.deletes,0);
});
