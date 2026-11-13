// Bundled after migration.js and zip.js for a dedicated browser Worker. The
// server only returns authenticated immutable pieces; hashing and ZIP happen
// here. No report calculation or credential is needed to build the backup.
const backupEncoder=new TextEncoder();
const backupPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const backupFail=message=>{throw new Error(message);};
const backupDigest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
function backupUrl(value,pathname,origin){
 let url;try{url=new URL(value,origin);}catch{backupFail('Endereço de backup inválido.');}
 if(url.origin!==origin||url.pathname!==pathname||url.username||url.password||url.hash)backupFail('Endereço de backup inválido.');
 return url;
}
async function backupRead(url,limit=2*1024*1024){
 const result=await fetch(url,{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json'}});
 if(!result.ok){let payload;try{payload=await result.json();}catch{}backupFail(payload?.error||'Não foi possível carregar o backup privado. Confira seu acesso administrativo.');}
 if(!/^application\/json(?:\s*;|$)/i.test(result.headers.get('content-type')||''))backupFail('O backup recebeu um formato inesperado.');
 const reader=result.body?.getReader();if(!reader)backupFail('O backup retornou vazio.');let size=0;const chunks=[];
 try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>limit){await reader.cancel();backupFail('Um trecho do backup excedeu o tamanho permitido.');}chunks.push(part.value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{backupFail('Um trecho do backup está inválido.');}
 return {data,bytes};
}
function backupValidateManifest(value,origin){
 if(!backupPlain(value)||!Array.isArray(value.parts)||value.parts.length>768||!backupPlain(value.source)||!Number.isInteger(value.source.partCount)||value.source.partCount<1||value.source.partCount>2048||!/^[a-f0-9]{64}$/.test(value.source.sha256||'')||!/^[a-f0-9]{40}$/.test(value.source.commitSha||'')||!Number.isInteger(value.source.fileCount)||value.source.fileCount<1||typeof value.source.restorationInstructions!=='string'||!value.source.restorationInstructions.trim())backupFail('O manifesto do backup precisa ser conferido.');
 if(value.reportMeta!==null&&(!backupPlain(value.reportMeta)||typeof value.reportMeta.revision!=='string'||!backupPlain(value.reportMeta.files)))backupFail('Os metadados das bases estão incompletos.');
 if(value.reportMeta===null&&value.parts.length)backupFail('Há trechos sem uma publicação correspondente.');
 if(typeof value.capturedAt!=='string'||!Number.isFinite(Date.parse(value.capturedAt)))backupFail('A data do backup está inválida.');
 for(const part of value.parts){
  if(!backupPlain(part)||!['bd','control'].includes(part.sheet)||!Number.isInteger(part.index)||part.index<0||!Number.isInteger(part.firstRow)||part.firstRow<0||!Number.isInteger(part.rowCount)||part.rowCount<1||part.rowCount>1000||!/^[a-f0-9]{64}$/.test(part.sha256||''))backupFail('A sequência de trechos está inválida.');
  const url=backupUrl(part.url,'/api/client-report/parts',origin);
  if(url.searchParams.get('original')!=='1'||url.searchParams.get('revision')!==value.reportMeta?.revision||url.searchParams.get('sheet')!==part.sheet||url.searchParams.get('index')!==String(part.index))backupFail('O backup exige trechos originais da mesma publicação.');
 }
 for(const sheet of ['bd','control']){
  const parts=value.parts.filter(part=>part.sheet===sheet).sort((a,b)=>a.index-b.index);let nextRow=0;
  for(let index=0;index<parts.length;index++){const part=parts[index];if(part.index!==index||part.firstRow!==nextRow)backupFail('Os trechos da planilha estão incompletos ou repetidos.');nextRow+=part.rowCount;}
  if(nextRow>25000||(value.reportMeta!==null&&nextRow<2))backupFail('A planilha do backup está incompleta.');
 }
 return value;
}
const backupSnapshot=value=>JSON.stringify({reportMeta:value.reportMeta,parts:value.parts,progress:value.progress??null,acl:value.acl??null,materialInputs:value.materialInputs??null,source:{sha256:value.source.sha256,fileCount:value.source.fileCount,commitSha:value.source.commitSha,partCount:value.source.partCount,restorationInstructions:value.source.restorationInstructions}});
async function backupParallel(items,fn){let next=0;await Promise.all(Array.from({length:Math.min(4,items.length)},async()=>{for(;;){const index=next++;if(index>=items.length)return;await fn(items[index],index);}}));}
async function buildClientBackup({origin,onProgress=()=>{}}){
 const endpoint=backupUrl('/api/client-report/backup','/api/client-report/backup',origin);
 onProgress('Conferindo a publicação e as permissões…');
 const manifest=backupValidateManifest((await backupRead(endpoint,32*1024*1024)).data,origin),initial=backupSnapshot(manifest),pieces=new Map();let loaded=0;
 await backupParallel(manifest.parts,async part=>{
  const {data,bytes}=await backupRead(backupUrl(part.url,'/api/client-report/parts',origin),131072);
  if(await backupDigest(bytes)!==part.sha256||!backupPlain(data)||!Array.isArray(data.rows)||data.rows.length!==part.rowCount)backupFail('Um trecho das bases não passou na conferência de integridade.');
  pieces.set(part.sheet+':'+part.index,data.rows);onProgress(`Carregando as bases originais… ${++loaded} de ${manifest.parts.length} trechos`);
 });
 let report=null;if(manifest.reportMeta!==null){report={...manifest.reportMeta,schemaVersion:1};for(const sheet of ['bd','control'])report[sheet]=manifest.parts.filter(part=>part.sheet===sheet).sort((a,b)=>a.index-b.index).flatMap(part=>pieces.get(sheet+':'+part.index));}
 const sourceParts=Array(manifest.source.partCount);loaded=0;
 await backupParallel(sourceParts,async(_,index)=>{
  const url=backupUrl('/api/client-report/backup-source?part='+index,'/api/client-report/backup-source',origin),{data}=await backupRead(url,131072);
  if(!backupPlain(data)||data.index!==index||typeof data.data!=='string'||!data.data.length||data.data.length>65536||data.data.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(data.data)||index<sourceParts.length-1&&data.data.includes('='))backupFail('Um trecho do código de restauração está inválido.');
  sourceParts[index]=data.data;onProgress(`Carregando o código de restauração… ${++loaded} de ${sourceParts.length} trechos`);
 });
 const latest=backupValidateManifest((await backupRead(endpoint,32*1024*1024)).data,origin);if(backupSnapshot(latest)!==initial)backupFail('O painel foi atualizado durante o backup. Tente baixar novamente.');
 let sourceData;try{sourceData=Uint8Array.from(atob(sourceParts.join('')),char=>char.charCodeAt(0));}catch{backupFail('O código de restauração está inválido.');}
 if(await backupDigest(sourceData)!==manifest.source.sha256)backupFail('O código de restauração não passou na conferência de integridade.');
 onProgress('Verificando os arquivos e preparando o ZIP…');
 const objects=new Map([['private/report-latest-v1.json',report],['private/correction-progress-v1.json',manifest.progress??null],['private/access-v3.json',manifest.acl??null],['private/material-inputs-v1.json',manifest.materialInputs??null]]);
 const tags=new Map(await Promise.all([...objects].map(async([key,value])=>[key,value===null?null:await backupDigest(backupEncoder.encode(JSON.stringify(value)))])));
 const bucket={get:async key=>objects.get(key)==null?null:{etag:tags.get(key),json:async()=>objects.get(key)},head:async key=>objects.get(key)==null?null:{etag:tags.get(key)}};
 const built=await buildMigrationFiles({bucket,source:{...manifest.source,data:sourceData},now:()=>Date.parse(manifest.capturedAt)});
 return {blob:new Blob(migrationZipChunks(built.files),{type:'application/zip'}),manifest:built.manifest};
}
self.addEventListener('message',async event=>{
 if(event.data?.type!=='download')return;
 try{const result=await buildClientBackup({origin:self.location.origin,onProgress:message=>self.postMessage({type:'progress',message})});self.postMessage({type:'complete',blob:result.blob});}
 catch(error){self.postMessage({type:'error',message:error?.message||'Não foi possível preparar o backup privado.'});}
});
