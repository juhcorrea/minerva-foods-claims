// Manual acknowledgements stay separate from immutable source worksheets.
// Each hash prefix has its own atomic CAS object; the legacy object is read-only.
export const CORRECTION_PROGRESS_LEGACY_KEY='private/correction-progress-v1.json';
export const CORRECTION_PROGRESS_SHARD_PREFIX='private/correction-progress-shards-v1/';
export const CORRECTION_PROGRESS_OBJECT_BYTES=900000;
export const CORRECTION_PROGRESS_KEYS=Object.freeze([CORRECTION_PROGRESS_LEGACY_KEY,...Array.from({length:16},(_,i)=>CORRECTION_PROGRESS_SHARD_PREFIX+i.toString(16)+'.json')]);
const cpEncoder=new TextEncoder();
const cpPlain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const cpKey=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export class CorrectionProgressError extends Error {
  constructor(status,code,message){super(message);this.name='CorrectionProgressError';this.status=status;this.code=code;}
}
const cpFail=(status,code,message)=>{throw new CorrectionProgressError(status,code,message);};
const cpInvalid=()=>cpFail(503,'CORRECTION_PROGRESS_INVALID','O acompanhamento das correções precisa ser conferido.');
function cpValidate(value,prefix){
  if(!cpPlain(value)||value.schemaVersion!==1||!cpPlain(value.entries))cpInvalid();
  for(const [key,entry]of Object.entries(value.entries))if(!cpKey(key)||(prefix!==undefined&&key[0]!==prefix)||!cpPlain(entry)||typeof entry.done!=='boolean')cpInvalid();
  return value;
}
function cpEtag(object){if(object===null||object===undefined)return null;if(typeof object.etag!=='string'||!object.etag)cpInvalid();return object.etag;}
async function cpComposite(objects){
  const etags=objects.map(cpEtag);if(etags.every(value=>value===null))return 'none';
  const bytes=await crypto.subtle.digest('SHA-256',cpEncoder.encode(JSON.stringify(etags)));
  return 'p2:'+Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
}
async function cpReadObject(bucket,key,index){
  const object=await bucket.get(key);if(!object)return null;const etag=cpEtag(object);let value;
  try{value=await object.json();}catch{cpInvalid();}
  return {etag,value:cpValidate(value,index?((index-1).toString(16)):undefined)};
}
export function correctionProgressRevision(found){return found?.revision||found?.value?.revision||found?.etag||'none';}
export async function readCorrectionProgressMetadata(bucket){
  const objects=typeof bucket.headMany==='function'?await bucket.headMany([...CORRECTION_PROGRESS_KEYS]):await Promise.all(CORRECTION_PROGRESS_KEYS.map(key=>typeof bucket.head==='function'?bucket.head(key):bucket.get(key)));
  if(!Array.isArray(objects)||objects.length!==CORRECTION_PROGRESS_KEYS.length)cpInvalid();
  const revision=await cpComposite(objects);
  return {value:revision==='none'?null:{revision},etag:revision==='none'?null:revision,revision};
}
export async function readCorrectionProgress(bucket){
  const objects=await Promise.all(CORRECTION_PROGRESS_KEYS.map((key,index)=>cpReadObject(bucket,key,index))),revision=await cpComposite(objects);
  if(revision==='none')return {value:null,etag:null,revision};
  const entries=Object.create(null);
  for(const object of objects)if(object)Object.assign(entries,object.value.entries);
  return {value:{schemaVersion:1,revision,entries},etag:revision,revision};
}
export async function saveProgressEntry(bucket,key,entry,{validate=async()=>{},attempts=5}={}){
  if(!cpKey(key)||!cpPlain(entry)||typeof entry.done!=='boolean'||typeof validate!=='function'||!Number.isInteger(attempts)||attempts<1||attempts>5)cpFail(400,'INVALID_CORRECTION_PROGRESS','Informe uma correção e uma marcação válidas.');
  const objectKey=CORRECTION_PROGRESS_SHARD_PREFIX+key[0]+'.json',index=parseInt(key[0],16)+1;
  for(let attempt=0;attempt<attempts;attempt++){
    const found=await cpReadObject(bucket,objectKey,index),next={schemaVersion:1,revision:crypto.randomUUID(),entries:{...(found?.value.entries||{}),[key]:entry}},body=JSON.stringify(next);
    if(cpEncoder.encode(body).byteLength>CORRECTION_PROGRESS_OBJECT_BYTES)cpFail(409,'PROGRESS_CAPACITY','O acompanhamento atingiu o limite. Avise a administração.');
    await validate();
    const written=await bucket.put(objectKey,body,{onlyIf:found?{etagMatches:found.etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json; charset=utf-8'}});
    if(written)return {entry,correctionProgressRevision:correctionProgressRevision(await readCorrectionProgressMetadata(bucket))};
  }
  cpFail(409,'CORRECTION_PROGRESS_CHANGED','Outra marcação foi salva ao mesmo tempo. Tente novamente.');
}
// For the controlled, empty-target restore only. The portable backup keeps its
// original logical schema; large acknowledgements are split before storage.
export function partitionCorrectionProgress(value){
  cpValidate(value);
  const groups=Array.from({length:16},()=>Object.create(null));
  for(const [key,entry]of Object.entries(value.entries))groups[parseInt(key[0],16)][key]=entry;
  return groups.flatMap((entries,index)=>{
    if(!Object.keys(entries).length)return [];
    const body=cpEncoder.encode(JSON.stringify({schemaVersion:1,revision:crypto.randomUUID(),entries})+'\n');
    if(body.byteLength>CORRECTION_PROGRESS_OBJECT_BYTES)cpFail(409,'PROGRESS_CAPACITY','O acompanhamento excede o limite de armazenamento.');
    return [{key:CORRECTION_PROGRESS_KEYS[index+1],body}];
  });
}
