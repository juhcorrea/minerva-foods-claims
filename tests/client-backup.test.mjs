import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {buildMigrationFiles} from '../worker/migration.js';
import {validateMigrationBackup} from '../migration/restore-data.mjs';

const root=new URL('../',import.meta.url),origin='https://backup.example.test',when='2026-11-10T12:00:00.000Z';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const enc=new TextEncoder(),text=bytes=>new TextDecoder().decode(bytes);
const sourceData=Uint8Array.from({length:100000},(_,index)=>index%251);
const source={data:sourceData,sha256:digest(sourceData),commitSha:'a'.repeat(40),fileCount:8,restorationInstructions:'Restauração privada de demonstração. Configure novas credenciais.'};
const progressKey='ab'.repeat(32),reportKey='private/report-latest-v1.json',aclKey='private/access-v3.json',trackingKey='private/correction-progress-v1.json',materialsKey='private/material-inputs-v1.json';
function fixture(){
 const report={schemaVersion:1,revision:'12345678-1234-1234-1234-123456789abc',updatedAt:when,updatedBy:'Admin QA',updatedByUserId:'admin-qa',asOf:'2026-11-10',files:{bd:'BD.xlsx',control:'Controle.xlsx'},bd:[['Cabeçalho','Valor'],['ORDEM/1',100.125,null,true],['ORDEM/2',200.875],['ação','fim']],control:[['Referência','Valor'],['ORDEM/1',25.125],['ORDEM/2',30.5]]};
 const progress={schemaVersion:1,entries:{[progressKey]:{done:true,updatedAt:when,updatedBy:'Admin QA',updatedByUserId:'admin-qa',reportRevision:report.revision,token:'SECRET_PROGRESS'}}};
 const materialInputs={schemaVersion:1,revision:'materials-one',updatedAt:when,updatedBy:'Admin QA',updatedByUserId:'admin-qa',periods:{2026:{containerTotal:8,containerFrozen:4,containerChilled:3,containerDry:1,freightUsd:300.125,note:'QA',agreements:{'ARMADOR QA':{1:2,11:null}},token:'SECRET_MATERIAL_VALUES'}},token:'SECRET_MATERIALS'};
 const acl={schemaVersion:3,revision:'acl-one',updatedAt:when,admins:{owner:{id:'owner',name:'Admin QA',email:'admin@corp.example',tokenHash:'SECRET_ADMIN'}},members:{member:{id:'member',name:'Employee QA',email:'employee@corp.example',status:'approved',role:'editor',requestedAt:when,emailVerified:true,identity:{provider:'cloudflare-access',issuer:'https://qa-team.cloudflareaccess.com',subject:'verified-subject',email:'employee@corp.example',jwt:'SECRET_JWT'},cookie:'SECRET_COOKIE'}},audit:[],sessions:'SECRET_SESSIONS'};
 const {bd,control,...reportMeta}=report,partData=new Map(),parts=[];
 for(const [sheet,rows] of Object.entries({bd,control}))for(let index=0,firstRow=0;firstRow<rows.length;index++,firstRow+=2){const data=JSON.stringify({rows:rows.slice(firstRow,firstRow+2)}),url=`/api/client-report/parts?revision=${report.revision}&sheet=${sheet}&index=${index}&original=1`;parts.push({sheet,index,firstRow,rowCount:Math.min(2,rows.length-firstRow),sha256:digest(data),url});partData.set(url,data);}
 const base64=Buffer.from(sourceData).toString('base64'),sourceParts=Array.from({length:Math.ceil(base64.length/65536)},(_,index)=>base64.slice(index*65536,(index+1)*65536));
 const manifest={capturedAt:when,reportMeta,parts,progress,acl,materialInputs,source:{sha256:source.sha256,fileCount:source.fileCount,commitSha:source.commitSha,restorationInstructions:source.restorationInstructions,partCount:sourceParts.length}};
 return {report,progress,acl,materialInputs,manifest,partData,sourceParts};
}
async function runtime(data=fixture(),mutate){
 const sources=await Promise.all(['correction-progress.js','migration.js','zip.js','client-backup-entry.js'].map(file=>fs.readFile(new URL('worker/'+file,root),'utf8'))),requests=[];let manifestCalls=0;
 const fetcher=async(input,options)=>{const url=new URL(input,origin);requests.push({url:url.href,options});let body;
  if(url.pathname==='/api/client-report/backup'){manifestCalls++;body=structuredClone(data.manifest);if(manifestCalls>1)body.capturedAt='2026-11-10T12:00:01.000Z';}
  else if(url.pathname==='/api/client-report/backup-source'){const index=+url.searchParams.get('part');body={index,data:data.sourceParts[index]};}
  else {const found=data.partData.get(url.pathname+url.search);if(found===undefined)return Response.json({error:'Unknown test URL'},{status:404});body=found;}
  const override=mutate?.({url,body,manifestCalls,data});if(override instanceof Response)return override;if(override!==undefined)body=override;
  return new Response(typeof body==='string'?body:JSON.stringify(body),{headers:{'content-type':'application/json'}});
 };
 const context={TextEncoder,TextDecoder,Uint8Array,Uint32Array,DataView,Blob,Map,Set,URL,Response,crypto,atob,fetch:fetcher,self:{location:{origin},addEventListener(){},postMessage(){}}};vm.createContext(context);vm.runInContext(sources.map(source=>source.replace(/^import\s+\{[^}]+\}\s+from\s+['"]\.\/correction-progress\.js['"];?\s*$/gm,'').replace(/^export\s+(?=(?:async\s+)?(?:class|function|const)\b)/gm,'')).join('\n'),context);
 return {run:()=>context.buildClientBackup({origin}),requests,data};
}
function unzipStored(bytes){const entries=new Map(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let offset=0;while(view.getUint32(offset,true)===0x04034b50){assert.equal(view.getUint16(offset+8,true),0);const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;const name=text(bytes.subarray(offset+30,offset+30+nameLength));assert(!entries.has(name));entries.set(name,bytes.slice(start,start+size));offset=start+size;}assert.equal(view.getUint32(offset,true),0x02014b50);return entries;}
function memoryBucket(data){const objects=new Map([[reportKey,data.report],[trackingKey,data.progress],[aclKey,data.acl],[materialsKey,data.materialInputs]]);return {get:async key=>{const value=objects.get(key);return value==null?null:{etag:digest(JSON.stringify(value)),json:async()=>value};},head:async key=>{const value=objects.get(key);return value==null?null:{etag:digest(JSON.stringify(value))};}};}

test('browser Worker ZIP preserves the legacy migration payloads, hashes and verified ACL without secrets',async()=>{
 const data=fixture(),r=await runtime(data),actual=await r.run(),entries=unzipStored(new Uint8Array(await actual.blob.arrayBuffer()));
 const expected=await buildMigrationFiles({bucket:memoryBucket(data),source,now:()=>Date.parse(when)});
 assert.equal(actual.blob.type,'application/zip');assert.equal(entries.size,7);
 for(const file of expected.files)assert.deepEqual(entries.get(file.name),file.data,file.name);
 assert.deepEqual(JSON.parse(text(entries.get('dados/bases-publicadas.json'))),data.report);
 const material=JSON.parse(text(entries.get('dados/campos-manuais-materiais.json')));assert.equal(material.periods[2026].freightUsd,300.125);assert.equal(material.periods[2026].agreements['ARMADOR QA'][11],null);assert.equal(material.updatedByUserId,'admin-qa');
 const acl=JSON.parse(text(entries.get('dados/cadastros-perfis.json')));assert.equal(acl.members.member.identity.subject,'verified-subject');assert.equal(acl.members.member.emailVerified,true);assert.equal(acl.members.member.role,'editor');
 assert.doesNotMatch([...entries.values()].map(text).join('\n'),/SECRET_|tokenHash|jwt|cookie|sessions/);
 const manifest=JSON.parse(text(entries.get('MANIFESTO.json')));assert.equal(manifest.capturedAt,when);assert.equal(manifest.counts.bdRows,3);assert.equal(manifest.counts.controlRows,2);
 await validateMigrationBackup(manifest,entries);
 assert(r.requests.every(item=>item.url.startsWith(origin+'/api/client-report/')&&item.options.credentials==='same-origin'&&item.options.cache==='no-store'&&item.options.redirect==='error'));
});

test('browser backup preserves ten thousand marks and accepts the bounded worst-case shard manifest',async()=>{
 const data=fixture();data.progress.entries=Object.fromEntries(Array.from({length:10000},(_,index)=>[digest('mark-'+index),{done:index%2===0,updatedAt:when,updatedBy:'Synthetic Reviewer Name',updatedByUserId:'22222222-2222-4222-8222-222222222222',reportRevision:data.report.revision}]));
 assert(Buffer.byteLength(JSON.stringify(data.progress))>2*1024*1024);
 // Correction shards, legacy state, ACL, bounded manual periods and metadata.
 const bound=16*900000+900000+1000000+8*1024*1024+800000;
 const r=await runtime(data,({url,body})=>{if(url.pathname==='/api/client-report/backup'){const json=JSON.stringify(body);return new Response(json+' '.repeat(bound-Buffer.byteLength(json)),{headers:{'content-type':'application/json'}});}});
 const result=await r.run(),files=unzipStored(new Uint8Array(await result.blob.arrayBuffer())),tracking=JSON.parse(text(files.get('dados/acompanhamento-correcoes.json')));
 assert.deepEqual(tracking.entries,data.progress.entries);assert.equal(result.manifest.counts.correctionEntries,10000);await validateMigrationBackup(result.manifest,files);
 const oversized=await runtime(data,({url})=>url.pathname==='/api/client-report/backup'?new Response(' '.repeat(32*1024*1024+1),{headers:{'content-type':'application/json'}}):undefined);
 await assert.rejects(oversized.run(),/tamanho permitido/);assert.equal(oversized.requests.length,1);
});

test('browser backup rejects changed snapshots, corrupted rows/source, incomplete indexes and unsafe URLs',async()=>{
 const scenarios=[
  {label:'row checksum',mutate:({url,body})=>url.pathname.endsWith('/parts')?String(body).replace('100.125','100.126'):body},
  {label:'source checksum',mutate:({url,body})=>url.pathname.endsWith('/backup-source')?{...body,data:'AAAA'+body.data.slice(4)}:body},
  {label:'new publication',mutate:({url,body,manifestCalls})=>url.pathname.endsWith('/backup')&&manifestCalls>1?{...body,reportMeta:{...body.reportMeta,revision:'changed'}}:body},
  {label:'new approval',mutate:({url,body,manifestCalls})=>url.pathname.endsWith('/backup')&&manifestCalls>1?{...body,acl:{...body.acl,revision:'changed'}}:body},
  {label:'new material values',mutate:({url,body,manifestCalls})=>url.pathname.endsWith('/backup')&&manifestCalls>1?{...body,materialInputs:{...body.materialInputs,revision:'changed'}}:body},
  {label:'missing first piece',setup:data=>data.manifest.parts[0].firstRow=1},
  {label:'duplicate index',setup:data=>data.manifest.parts[1].index=0},
  {label:'projected data',setup:data=>data.manifest.parts[0].url=data.manifest.parts[0].url.replace('&original=1','')},
  {label:'cross origin',setup:data=>data.manifest.parts[0].url='https://evil.example'+data.manifest.parts[0].url},
  {label:'wrong route',setup:data=>data.manifest.parts[0].url='/api/members'},
  {label:'invalid source part index',mutate:({url,body})=>url.pathname.endsWith('/backup-source')?{...body,index:999}:body},
 ];
 for(const scenario of scenarios){const data=fixture();scenario.setup?.(data);const r=await runtime(data,scenario.mutate);await assert.rejects(r.run(),undefined,scenario.label);assert(r.requests.every(item=>new URL(item.url).origin===origin));}
});

test('backup fails without administrative responses and preserves explicit absent objects',async()=>{
 const rejected=await runtime(fixture(),()=>Response.json({error:'Acesso administrativo necessário.'},{status:403}));await assert.rejects(rejected.run(),/administrativo/);assert.equal(rejected.requests.length,1);
 const data=fixture();data.manifest.reportMeta=null;data.manifest.parts=[];data.manifest.progress=null;data.manifest.acl=null;data.manifest.materialInputs=null;
 const r=await runtime(data),result=await r.run(),entries=unzipStored(new Uint8Array(await result.blob.arrayBuffer()));for(const name of ['bases-publicadas','acompanhamento-correcoes','cadastros-perfis','campos-manuais-materiais'])assert.equal(JSON.parse(text(entries.get('dados/'+name+'.json'))),null);
 const manifest=JSON.parse(text(entries.get('MANIFESTO.json')));assert(manifest.objects.every(object=>object.present===false));await validateMigrationBackup(manifest,entries);
});

test('migration export and restore enforce verified identity allowlists',async()=>{
 const data=fixture();for(const mutate of [member=>member.emailVerified=false,member=>member.identity.provider='untrusted',member=>member.identity.issuer='https://evil.example',member=>member.identity.subject='']){const bad=structuredClone(data);mutate(bad.acl.members.member);await assert.rejects(buildMigrationFiles({bucket:memoryBucket(bad),source}),{code:'MIGRATION_INVALID_STORAGE'});}
});

test('backup coordinator cancels on logout, deduplicates active downloads and can retry after unsupported Worker',async()=>{
 const source=await fs.readFile(new URL('dist/client-backup.js',root),'utf8'),workers=[],clicked=[];let nextTimer=0;const timers=new Map();
 class WorkerMock{constructor(url){this.url=url;this.listeners={};this.terminated=false;workers.push(this);}addEventListener(type,fn){this.listeners[type]=fn;}postMessage(data){this.command=data;}terminate(){this.terminated=true;}}
 const document={currentScript:{src:origin+'/client-backup.js?v=1'},body:{append(){}},createElement:()=>({click(){clicked.push(this.download);},remove(){}})};
 const window={Worker:WorkerMock,location:{href:origin+'/'},setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:id=>timers.delete(id)};
 const context={window,document,Worker:WorkerMock,URL,Blob};vm.runInNewContext(source,context);const api=window.MinervaClientBackup;
 const first=api.download(),same=api.download();assert.equal(first,same);assert.equal(workers.length,1);api.clear();await assert.rejects(first,/cancelado/);assert.equal(workers[0].terminated,true);workers[0].listeners.message({data:{type:'complete',blob:new Blob(['late'],{type:'application/zip'})}});assert.equal(clicked.length,0,'A late Worker message cannot download after logout');
 window.Worker=undefined;await assert.rejects(api.download(),/navegador/);window.Worker=WorkerMock;
 const next=api.download();workers[1].listeners.message({data:{type:'complete',blob:new Blob(['ZIP'],{type:'application/zip'})}});assert.equal((await next).downloaded,true);assert.deepEqual(clicked,['Minerva-Claims-Migracao-Privada.zip']);assert.equal(workers[1].terminated,true);
});
