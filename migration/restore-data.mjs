// Offline validation and controlled R2 restore. This module is not an HTTP route.
const enc = new TextEncoder();
const definitions = Object.freeze([
  {key:'private/report-latest-v1.json',path:'dados/bases-publicadas.json',schemaVersion:1},
  {key:'private/correction-progress-v1.json',path:'dados/acompanhamento-correcoes.json',schemaVersion:1},
  {key:'private/access-v3.json',path:'dados/cadastros-perfis.json',schemaVersion:3},
]);
const allowedPaths = new Set([...definitions.map(x=>x.path),'codigo-operacional.zip','RESTAURACAO.txt']);
const isRecord = x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
function requireValue(ok,message){if(!ok)throw new Error(message);}
function keys(value,allowed,label){requireValue(isRecord(value),`${label}: objeto inválido.`);for(const key of Object.keys(value))requireValue(allowed.includes(key),`${label}: campo não permitido (${key}).`);}
function scalar(value){return value===null||typeof value==='string'||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value));}
function fields(value,allowed,label){keys(value,allowed,label);requireValue(Object.values(value).every(scalar),`${label}: campos devem ser valores simples.`);}
function mapValues(value,check,label){requireValue(isRecord(value),`${label}: mapa inválido.`);for(const [key,entry]of Object.entries(value)){requireValue(!['__proto__','prototype','constructor'].includes(key),`${label}: identificador inválido.`);check(entry,key);}}
function validateObject(value,definition){
  if(value===null)return;
  requireValue(isRecord(value)&&value.schemaVersion===definition.schemaVersion,`${definition.path}: versão inválida.`);
  if(definition.schemaVersion===3){
    keys(value,['schemaVersion','revision','updatedAt','admins','members','audit'],'Cadastros');
    requireValue(typeof value.revision==='string','Cadastros: revisão ausente.');
    mapValues(value.admins,(v,k)=>{fields(v,['id','name','email','activatedAt'],'Administrador');requireValue(v.id===k,'Administrador: ID divergente.');},'Administradores');
    mapValues(value.members,(v,k)=>{fields(v,['id','name','email','status','role','requestCode','requestedAt','approvedAt','approvedBy','approvedById','revokedAt','revokedBy','updatedAt'],'Cadastro');requireValue(v.id===k,'Cadastro: ID divergente.');requireValue(['pending','approved','revoked','rejected'].includes(v.status),'Cadastro: status inválido.');requireValue(v.role===undefined||['viewer','editor'].includes(v.role),'Cadastro: perfil inválido.');},'Cadastros');
    requireValue(Array.isArray(value.audit),'Cadastros: auditoria inválida.');
    value.audit.forEach(v=>fields(v,['at','actorId','actorName','action','target','previousStatus','previousRole','role'],'Auditoria'));
  }else if(definition.key.includes('correction-progress')){
    keys(value,['schemaVersion','entries'],'Correções');
    mapValues(value.entries,(v,k)=>{requireValue(/^[a-f0-9]{64}$/.test(k),'Correções: chave inválida.');fields(v,['done','updatedAt','updatedBy','updatedByUserId','reportRevision'],'Correção');requireValue(typeof v.done==='boolean','Correções: marcação inválida.');},'Correções');
  }else{
    keys(value,['schemaVersion','revision','updatedAt','updatedBy','updatedByUserId','files','asOf','bd','control'],'Bases');
    requireValue(typeof value.revision==='string','Bases: revisão ausente.');
    fields(value.files,['bd','control'],'Nomes das bases');
    for(const name of ['bd','control'])requireValue(Array.isArray(value[name])&&value[name].every(row=>Array.isArray(row)&&row.every(scalar)),`Bases: linhas inválidas (${name}).`);
    for(const key of ['updatedAt','updatedBy','updatedByUserId','asOf'])if(key in value)requireValue(scalar(value[key]),`Bases: ${key} inválido.`);
  }
}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function dataBytes(value){requireValue(typeof value==='string'||value instanceof Uint8Array,'Conteúdo do arquivo inválido.');return typeof value==='string'?enc.encode(value):value;}

/** Validate every payload and its digest before any destination is opened. */
export async function validateMigrationBackup(manifest,files){
  requireValue(manifest?.schemaVersion===1&&manifest.kind==='minerva-claims-private-migration','Manifesto de migração inválido.');
  requireValue(Array.isArray(manifest.files)&&Array.isArray(manifest.objects),'Listas do manifesto ausentes.');
  requireValue(manifest.objects.length===definitions.length,'O manifesto precisa descrever os três objetos privados.');
  requireValue(manifest.files.length===allowedPaths.size,'O pacote precisa conter código, instruções e três arquivos de dados.');
  const bytes=new Map(),seen=new Set();
  for(const file of manifest.files){
    requireValue(allowedPaths.has(file.path)&&!seen.has(file.path),'Arquivo desconhecido ou duplicado no manifesto.');seen.add(file.path);
    const supplied=files instanceof Map?files.get(file.path):files?.[file.path];
    const data=dataBytes(supplied);
    requireValue(Number.isSafeInteger(file.bytes)&&data.byteLength===file.bytes,`Tamanho divergente: ${file.path}`);
    requireValue(typeof file.sha256==='string'&&await digest(data)===file.sha256,`Checksum divergente: ${file.path}`);
    bytes.set(file.path,data.slice());
  }
  requireValue(manifest.source?.sha256===manifest.files.find(x=>x.path==='codigo-operacional.zip').sha256,'Checksum do código divergente.');
  const objects=[];
  for(const definition of definitions){
    const entries=manifest.objects.filter(x=>x.key===definition.key);
    requireValue(entries.length===1&&entries[0].path===definition.path,'Objeto de armazenamento desconhecido ou duplicado.');
    const entry=entries[0];let value;
    try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.get(definition.path)));}catch{throw new Error(`JSON inválido: ${definition.path}`);}
    requireValue(typeof entry.present==='boolean'&&entry.present===(value!==null),`Presença divergente: ${definition.path}`);
    validateObject(value,definition);
    if(value!==null)requireValue(entry.schemaVersion===value.schemaVersion&&(!('revision'in value)||entry.revision===value.revision),`Revisão divergente: ${definition.path}`);
    const customMetadata={};
    if(value!==null&&definition.key.includes('report-latest')){
      for(const key of ['revision','updatedAt','updatedBy','updatedByUserId','asOf'])if(value[key]!=null)customMetadata[key]=String(value[key]);
      customMetadata.bdName=String(value.files.bd||'');customMetadata.controlName=String(value.files.control||'');
    }
    objects.push({...definition,present:entry.present,value,body:bytes.get(definition.path),customMetadata});
  }
  return {manifest:structuredClone(manifest),files:bytes,objects};
}

/** Filesystem helper for an EXTRACTED private ZIP; never follows symlink paths. */
export async function loadMigrationBackup(directory){
  const fs=await import('node:fs/promises'),path=await import('node:path');
  const root=await fs.realpath(directory);
  async function read(relative){
    let cursor=root;
    for(const part of relative.split('/')){cursor=path.join(cursor,part);requireValue(!(await fs.lstat(cursor)).isSymbolicLink(),'Links simbólicos não são aceitos no backup.');}
    return new Uint8Array(await fs.readFile(cursor));
  }
  let manifest;try{manifest=JSON.parse(new TextDecoder().decode(await read('MANIFESTO.json')));}catch{throw new Error('MANIFESTO.json ausente ou inválido.');}
  const files=new Map();for(const name of allowedPaths)files.set(name,await read(name));
  return validateMigrationBackup(manifest,files);
}

/** Controlled import only. The caller must supply the NEW, offline R2 binding. */
export async function restoreMigrationObjects(bucket,backup,{confirmNewEmptyBucket=false}={}){
  requireValue(confirmNewEmptyBucket===true,'Confirme explicitamente um bucket novo, vazio e sem tráfego.');
  requireValue(bucket&&typeof bucket.list==='function'&&typeof bucket.put==='function','Binding R2 de destino inválido.');
  // Revalidate to prevent a caller mutating a previously validated backup.
  const checked=await validateMigrationBackup(backup.manifest,backup.files);
  const existing=await bucket.list({limit:1});
  requireValue(Array.isArray(existing?.objects)&&existing.objects.length===0&&!existing.truncated,'O bucket de destino não está vazio. Nenhum registro foi sobrescrito.');
  const written=[];
  try{
    for(const object of checked.objects){
      if(!object.present)continue;
      const result=await bucket.put(object.key,object.body,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'},...(Object.keys(object.customMetadata).length?{customMetadata:object.customMetadata}:{})});
      requireValue(result,`O destino mudou durante a restauração (${object.key}).`);
      written.push(object.key);
    }
  }catch(cause){
    const error=new Error('Restauração interrompida. Mantenha o destino sem tráfego; não repita a importação sobre este bucket. Confira writtenKeys e use um novo bucket vazio. Nenhum objeto preexistente foi sobrescrito.',{cause});
    error.writtenKeys=written;throw error;
  }
  return {writtenKeys:written,absentKeys:checked.objects.filter(x=>!x.present).map(x=>x.key),reportRevision:checked.objects[0].value?.revision||null};
}

/** Prepare payloads for a trusted storage tool; not a publication or upload. */
export async function prepareMigrationObjects(backup,directory){
  const checked=await validateMigrationBackup(backup.manifest,backup.files);
  const fs=await import('node:fs/promises'),path=await import('node:path');
  await fs.mkdir(directory,{mode:0o700}); // Deliberately fails if destination exists.
  const plan={format:1,requiresNewEmptyBucket:true,reportRevision:checked.objects[0].value?.revision||null,objects:[]};
  for(const object of checked.objects){
    const filename=object.key.split('/').at(-1);
    if(object.present)await fs.writeFile(path.join(directory,filename),object.body,{flag:'wx',mode:0o600});
    plan.objects.push({key:object.key,present:object.present,file:object.present?filename:null,httpMetadata:{contentType:'application/json'},customMetadata:object.customMetadata,onlyIf:{etagDoesNotMatch:'*'}});
  }
  await fs.writeFile(path.join(directory,'upload-plan.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx',mode:0o600});
  return plan;
}

if(typeof process!=='undefined'&&process.argv?.[1]){
  const {pathToFileURL}=await import('node:url');
  if(pathToFileURL(process.argv[1]).href===import.meta.url){
    try{
      const [directory,flag,output,...extra]=process.argv.slice(2);
      requireValue(directory&&(!flag||(flag==='--prepare'&&output))&&!extra.length,'Uso: node migration/restore-data.mjs PASTA_DO_ZIP [--prepare NOVA_PASTA_PRIVADA]');
      const backup=await loadMigrationBackup(directory);
      if(flag)await prepareMigrationObjects(backup,output);
      console.log(JSON.stringify({validated:true,capturedAt:backup.manifest.capturedAt,reportRevision:backup.objects[0].value?.revision||null,objects:backup.objects.map(x=>({key:x.key,present:x.present})),prepared:output||null,uploaded:false},null,2));
    }catch(error){console.error(error.message);process.exitCode=1;}
  }
}
