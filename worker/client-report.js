import {cleanup} from './client-report-cleanup.js';
import {sanitizeMigrationMaterials} from './migration.js';
// Small authenticated storage operations for browser-side analysis. Source
// worksheets stay private; readers receive only the fields used by the engine.
export const CLIENT_REPORT_PROJECTION_VERSION = 3;
export const clientReportColumns = Object.freeze({
 bd:Object.freeze([0,1,3,5,6,7,8,9,10,13,16,19,22,24,25,28,31,32,35,40,46,49,56,57,61,62,63]),
 control:Object.freeze([0,1,2,3,7,9,10,11,12,13,14,17,19,20,21,23,30,31])
});
export function projectClientRows(sheet,rows,firstRow=0){
 const selected=clientReportColumns[sheet];if(!selected)throw new Error('Invalid worksheet');
 const width=sheet==='bd'?64:32,prefix=sheet==='bd'?36:20,marker=sheet==='bd'?2:4;
 return rows.map((row,index)=>{
  const projected=Array(width).fill(null);for(const col of selected)projected[col]=row[col]??null;
  // Preserve row-presence semantics without transmitting an unused cell value.
  if(firstRow+index>0&&row.slice(0,prefix).some(v=>v!=null&&v!=='')&&!projected.slice(0,prefix).some(v=>v!=null&&v!==''))projected[marker]=true;
  return projected;
 });
}

export function createClientReportHandler(deps){
 const {engine,now,fail,response,readBody,jsonObject,putConditional,hashToken,stamp,uuid,actorLabel,confirmMutationPermission,readCorrectionProgress,readCorrectionProgressMetadata,saveProgressEntry,correctionProgressRevision,publicCorrectionProgress,migrationSource,readAcl}=deps;
 const REPORT='private/client-report-v2.json';
 const MAX_PART=65536,MAX_TOTAL=20*1024*1024,MAX_PARTS=768,MAX_CELLS=1500000;
 const actorOf=access=>access.admin||access.member;
 const isId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id);
 const stageKey=id=>'private/client-staging/'+id+'.json';
 const objectKey=(id,sheet,index,original=false)=>`private/client-reports/${id}/${sheet}/${index}.${original?'original':'projected'}.json`;
 const derivedKey=(id,sheet,index)=>`private/client-reports/${id}/${sheet}/${index}.projected-v${CLIENT_REPORT_PROJECTION_VERSION}.json`;
 const upgradeKey=id=>`private/client-reports/${id}/projection-${CLIENT_REPORT_PROJECTION_VERSION}-upgrade.json`;
 const projectionVersion=value=>value?.projectionVersion??1;
 const requireCurrentProjection=value=>{if(value&&projectionVersion(value)!==CLIENT_REPORT_PROJECTION_VERSION)fail(409,'REPORT_PROJECTION_OUTDATED','A cópia de leitura das bases armazenadas precisa ser preparada pela administração. Os arquivos já publicados estão preservados; não é necessário importá-los novamente.');};
 const meta=value=>value?{revision:value.revision,updatedAt:value.updatedAt,updatedBy:actorLabel(value.updatedBy,value.updatedByUserId),files:value.files,asOf:value.asOf,projectionVersion:projectionVersion(value)}:null;
 const fields=(body,allowed)=>{if(Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_REQUEST','A solicitação contém campos inesperados.');};
 const label=(value,fallback)=>{if(value==null)return fallback;if(typeof value!=='string'||value.length>240||/[\u0000-\u001f]/.test(value))fail(400,'INVALID_FILENAME','Confira o nome do arquivo.');return value.trim()||fallback;};
 async function published(bucket){const found=await jsonObject(bucket,REPORT);if(found.value&&(found.value.schemaVersion!==2||!Array.isArray(found.value.parts)||!isId(found.value.revision)))fail(503,'REPORT_INVALID','A publicação precisa ser conferida.');return found;}
 async function metadata(bucket){return meta((await published(bucket)).value);}
 async function progress(bucket){const found=await readCorrectionProgress(bucket);return {revision:correctionProgressRevision(found),entries:Object.fromEntries(Object.entries(found.value?.entries||{}).map(([key,entry])=>[key,publicCorrectionProgress(key,entry)]))};}
 async function ownedStage(bucket,id,access){
  if(!isId(id))fail(400,'INVALID_UPLOAD','A atualização é inválida.');
  const found=await jsonObject(bucket,stageKey(id)),value=found.value;
  if(!value||value.schemaVersion!==2||value.ownerId!==actorOf(access).id)fail(404,'UPLOAD_NOT_FOUND','A atualização não foi encontrada para este perfil.');
  if(projectionVersion(value)!==CLIENT_REPORT_PROJECTION_VERSION)fail(409,'UPLOAD_PROJECTION_OUTDATED','A forma de preparar as bases foi atualizada. Inicie a publicação novamente para enviar todas as colunas necessárias.');
  if(Date.parse(value.expiresAt)<=now())fail(409,'UPLOAD_EXPIRED','A atualização expirou. Publique as bases novamente.');
  return found;
 }
 function publicParts(saved,original=false){return saved.parts.map(part=>({sheet:part.sheet,index:part.index,firstRow:part.firstRow,rowCount:part.rowCount,sha256:original?part.originalSha256:part.sha256,url:`/api/client-report/parts?revision=${saved.revision}&sheet=${part.sheet}&index=${part.index}${original?'&original=1':''}`}));}
 function upgradeResult(saved,stage){const ready=projectionVersion(saved)===CLIENT_REPORT_PROJECTION_VERSION,completed=ready?saved.parts.length:stage?.hashes?.length||0;return {revision:saved.revision,projectionVersion:CLIENT_REPORT_PROJECTION_VERSION,totalParts:saved.parts.length,completed,nextPart:completed,ready};}
 async function upgradeState(bucket,revision){
  if(!isId(revision))fail(400,'INVALID_UPGRADE','A preparação da base é inválida.');
  const current=await published(bucket);
  if(current.value?.revision!==revision)fail(409,'REPORT_CHANGED','A base publicada mudou. Atualize a visão antes de continuar.');
  if(projectionVersion(current.value)===CLIENT_REPORT_PROJECTION_VERSION)return {...current,ready:true};
  const found=await jsonObject(bucket,upgradeKey(revision)),stage=found.value;
  if(!stage||stage.schemaVersion!==1||stage.revision!==revision||stage.targetVersion!==CLIENT_REPORT_PROJECTION_VERSION||!Array.isArray(stage.hashes)||stage.hashes.length>current.value.parts.length)fail(409,'UPGRADE_NOT_STARTED','Inicie a preparação da base armazenada.');
  if(stage.expectedEtag!==current.etag)fail(409,'REPORT_CHANGED','A base publicada mudou durante a preparação. Atualize a visão.');
  return {...current,stage,stageEtag:found.etag,ready:false};
 }
 async function upgradeStart(bucket,request,access){
  const body=await readBody(request,1024);fields(body,[]);
  const current=await published(bucket),saved=current.value;
  if(!saved)fail(409,'REPORT_NOT_FOUND','Não há base publicada para preparar.');
  if(projectionVersion(saved)===CLIENT_REPORT_PROJECTION_VERSION)return response(upgradeResult(saved));
  if(![1,2].includes(projectionVersion(saved))||saved.parts.length<2||saved.parts.length>MAX_PARTS)fail(409,'UPGRADE_UNSUPPORTED','A versão da base armazenada precisa ser conferida.');
  const found=await jsonObject(bucket,upgradeKey(saved.revision));
  if(found.value){const state=await upgradeState(bucket,saved.revision);return response(upgradeResult(state.value,state.stage));}
  const stage={schemaVersion:1,revision:saved.revision,targetVersion:CLIENT_REPORT_PROJECTION_VERSION,expectedEtag:current.etag,createdAt:stamp(),hashes:[]};
  await confirmMutationPermission(bucket,access,['admin']);
  if(!await putConditional(bucket,upgradeKey(saved.revision),stage,null)){const state=await upgradeState(bucket,saved.revision);return response(upgradeResult(state.value,state.stage));}
  return response(upgradeResult(saved,stage),201);
 }
 async function upgradePart(bucket,request,access){
  const body=await readBody(request,1024);fields(body,['revision','part']);
  if(!Number.isInteger(body.part)||body.part<0||body.part>=MAX_PARTS)fail(400,'INVALID_PART','Selecione uma parte válida da base armazenada.');
  const state=await upgradeState(bucket,body.revision),saved=state.value;
  if(state.ready)return response(upgradeResult(saved));
  const stage=state.stage;
  if(body.part<stage.hashes.length)return response(upgradeResult(saved,stage));
  if(body.part!==stage.hashes.length||body.part>=saved.parts.length)fail(409,'PART_ORDER','Prepare as partes na ordem indicada.');
  const part=saved.parts[body.part];
  if(!Object.hasOwn(clientReportColumns,part.sheet)||!Number.isInteger(part.index)||part.index<0||!Number.isInteger(part.firstRow)||part.firstRow<0||!Number.isInteger(part.rowCount)||part.rowCount<1||part.rowCount>1000||!Number.isInteger(part.size)||part.size>MAX_PART||part.size<1||!/^[a-f0-9]{64}$/.test(part.originalSha256||''))fail(503,'REPORT_INVALID','A identificação da parte original precisa ser conferida.');
  const object=await bucket.get(objectKey(saved.revision,part.sheet,part.index,true));
  if(!object)fail(503,'REPORT_INCOMPLETE','Uma parte original da base armazenada não foi encontrada.');
  const original=await object.text(),size=new TextEncoder().encode(original).length;
  if(size!==part.size||size>MAX_PART||await hashToken(original)!==part.originalSha256)fail(503,'ORIGINAL_HASH_MISMATCH','A integridade da parte original não foi confirmada. A base publicada foi preservada.');
  let rows;try{rows=JSON.parse(original).rows;}catch{fail(503,'REPORT_INVALID','A parte original da base precisa ser conferida.');}
  if(!Array.isArray(rows)||rows.length!==part.rowCount||rows.some(row=>!Array.isArray(row)||row.length>80))fail(503,'REPORT_INVALID','As linhas da parte original não correspondem ao manifesto.');
  const projected=JSON.stringify({rows:projectClientRows(part.sheet,rows,part.firstRow)}),digest=await hashToken(projected),key=derivedKey(saved.revision,part.sheet,part.index);
  await confirmMutationPermission(bucket,access,['admin']);
  const written=await bucket.put(key,projected,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{sha256:digest}});
  if(!written){const previous=typeof bucket.head==='function'?await bucket.head(key):await bucket.get(key);if(previous?.customMetadata?.sha256!==digest)fail(409,'PART_CHANGED','A cópia preparada desta parte possui outro conteúdo. A publicação foi preservada.');}
  await confirmMutationPermission(bucket,access,['admin']);
  stage.hashes.push(digest);
  if(!await putConditional(bucket,upgradeKey(saved.revision),stage,state.stageEtag)){
   const concurrent=await upgradeState(bucket,saved.revision);
   if(!concurrent.ready&&concurrent.stage.hashes[body.part]!==digest)fail(409,'UPGRADE_CHANGED','Outra preparação avançou. Atualize a visão para retomar.');
   return response(upgradeResult(concurrent.value,concurrent.stage));
  }
  return response(upgradeResult(saved,stage));
 }
 async function upgradeCommit(bucket,request,access){
  const body=await readBody(request,1024);fields(body,['revision']);
  const state=await upgradeState(bucket,body.revision),saved=state.value;
  if(state.ready)return response(upgradeResult(saved));
  if(state.stage.hashes.length!==saved.parts.length||state.stage.hashes.some(hash=>!/^[a-f0-9]{64}$/.test(hash)))fail(409,'INCOMPLETE_UPGRADE','Prepare todas as partes antes de ativar a leitura.');
  // The report identity, original descriptors and all publication timestamps
  // stay intact. Only the derived reader projection changes atomically.
  const next={...saved,projectionVersion:CLIENT_REPORT_PROJECTION_VERSION,parts:saved.parts.map((part,index)=>({...part,sha256:state.stage.hashes[index],projectedVersion:CLIENT_REPORT_PROJECTION_VERSION}))};
  await confirmMutationPermission(bucket,access,['admin']);
  if(!await putConditional(bucket,REPORT,next,state.etag))fail(409,'REPORT_CHANGED','A base publicada mudou. Atualize a visão para continuar.');
  return response(upgradeResult(next));
 }
 async function start(bucket,request,access){
  const body=await readBody(request,4096);fields(body,['expectedRevision','expectedRows','files','asOf','demo']);
  if(!body.expectedRows||Object.keys(body.expectedRows).some(key=>!['bd','control'].includes(key))||['bd','control'].some(key=>!Number.isInteger(body.expectedRows[key])||body.expectedRows[key]<2||body.expectedRows[key]>25000))fail(400,'INVALID_ROW_COUNT','Informe a quantidade completa de linhas das duas bases.');
  if(body.demo===true)fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
  const files={bd:label(body.files?.bd,'BD.xlsx'),control:label(body.files?.control,'Controle de Recebimento.xlsx')};
  if(/demonstra[cç][aã]o|fict[ií]ci/i.test(files.bd+' '+files.control))fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
  const asOf=body.asOf||engine.today();if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!engine.parseDate(asOf))fail(400,'INVALID_DATE','Informe uma data de análise válida.');
  const current=await published(bucket),expected=body.expectedRevision;
  if(typeof expected!=='string'||expected!==(current.value?.revision||'none'))fail(409,'REPORT_CHANGED','Outra atualização foi publicada. Atualize a visão antes de publicar.');
  const id=uuid(),stage={schemaVersion:2,projectionVersion:CLIENT_REPORT_PROJECTION_VERSION,id,ownerId:actorOf(access).id,expectedRevision:expected,expectedEtag:current.etag,expectedRows:body.expectedRows,files,asOf,createdAt:stamp(),expiresAt:new Date(now()+2*3600000).toISOString(),parts:[],rows:{bd:0,control:0},cells:0,bytes:0};
  await confirmMutationPermission(bucket,access);
  if(!await putConditional(bucket,stageKey(id),stage,null))fail(409,'UPLOAD_CHANGED','Tente iniciar a atualização novamente.');
  return response({uploadId:id,maxPartBytes:MAX_PART},201);
 }
 async function addPart(bucket,request,access,id){
  const body=await readBody(request,MAX_PART);fields(body,['sheet','index','firstRow','rows']);
  const {sheet,index,firstRow,rows}=body;
  if(!Object.hasOwn(clientReportColumns,sheet)||!Number.isInteger(index)||index<0||index>=MAX_PARTS||!Number.isInteger(firstRow)||firstRow<0||!Array.isArray(rows)||!rows.length||rows.length>1000)fail(400,'INVALID_PART','O trecho da planilha é inválido.');
  let cells=0;for(const row of rows){if(!Array.isArray(row)||row.length>80)fail(400,'INVALID_WORKSHEET','Confira o formato da planilha.');cells+=row.length;for(const value of row)if(!(value==null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=100000))fail(400,'INVALID_CELL','A planilha contém uma célula inválida.');}
  if(firstRow===0){try{engine.validateHeaders(rows,sheet==='bd'?'BD':'Controle Recebimento');}catch(error){fail(400,'INVALID_REPORT',error.message);}}
  const original=JSON.stringify({rows}),projected=JSON.stringify({rows:projectClientRows(sheet,rows,firstRow)}),originalSha256=await hashToken(original),sha256=await hashToken(projected);
  const size=new TextEncoder().encode(original).length,descriptor={sheet,index,firstRow,rowCount:rows.length,sha256,originalSha256,size};
  for(let attempt=0;attempt<4;attempt++){
   const {value:stage,etag}=await ownedStage(bucket,id,access);
   if(stage.committed)fail(409,'UPLOAD_FINISHED','Esta atualização já foi publicada.');
   const previous=stage.parts.find(part=>part.sheet===sheet&&part.index===index);
   if(previous){if(previous.originalSha256===originalSha256&&previous.firstRow===firstRow)return response(descriptor);fail(409,'PART_CHANGED','Um trecho desta atualização já foi recebido com outro conteúdo.');}
   if(stage.rows[sheet]!==firstRow||stage.parts.filter(part=>part.sheet===sheet).length!==index)fail(409,'PART_ORDER','Envie os trechos da planilha na ordem original.');
   if(stage.parts.length>=MAX_PARTS||stage.rows[sheet]+rows.length>stage.expectedRows[sheet]||stage.cells+cells>MAX_CELLS||stage.bytes+size>MAX_TOTAL)fail(413,'WORKSHEET_TOO_LARGE','As bases excedem o limite desta publicação.');
   await confirmMutationPermission(bucket,access);
   // Immutable parts plus the conditional stage pointer keep retries and races safe.
   for(const [originalFlag,text,digest] of [[true,original,originalSha256],[false,projected,sha256]]){
    const key=objectKey(id,sheet,index,originalFlag),written=await bucket.put(key,text,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json; charset=utf-8'},customMetadata:{sha256:digest}});
    if(!written){const existing=typeof bucket.head==='function'?await bucket.head(key):await bucket.get(key);if(existing?.customMetadata?.sha256!==digest)fail(409,'PART_CHANGED','Este trecho já existe com outro conteúdo. Reinicie a publicação.');}
   }
   await confirmMutationPermission(bucket,access);
   stage.parts.push(descriptor);stage.rows[sheet]+=rows.length;stage.cells+=cells;stage.bytes+=size;
   if(await putConditional(bucket,stageKey(id),stage,etag))return response(descriptor,201);
  }
  fail(409,'UPLOAD_CHANGED','Outra solicitação alterou esta atualização. Tente novamente.');
 }
 async function commit(bucket,request,access,id){
  const body=await readBody(request,1024);fields(body,[]);
  const {value:stage,etag:stageEtag}=await ownedStage(bucket,id,access);
  if(stage.rows.bd!==stage.expectedRows.bd||stage.rows.control!==stage.expectedRows.control)fail(400,'INCOMPLETE_UPLOAD','Carregue as duas bases completas antes de publicar.');
  const {value:current,etag}=await published(bucket);
  if(current?.revision===id)return response({...meta(current),model:null});
  if((current?.revision||'none')!==stage.expectedRevision||etag!==stage.expectedEtag)fail(409,'REPORT_CHANGED','Outra atualização foi publicada. Recarregue o relatório antes de publicar.');
  const actor=actorOf(access),saved={schemaVersion:2,revision:id,updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,files:stage.files,asOf:stage.asOf,parts:stage.parts,rows:stage.rows,projectionVersion:stage.projectionVersion};
  await confirmMutationPermission(bucket,access);
  if(!await putConditional(bucket,REPORT,saved,etag))fail(409,'REPORT_CHANGED','Outra atualização foi publicada ao mesmo tempo. Atualize a visão.');
  stage.committed=true;await putConditional(bucket,stageKey(id),stage,stageEtag);
  return response({...meta(saved),model:null},200,{'etag':`"${id}"`});
 }
 async function saveProgress(bucket,request,access){
  const body=await readBody(request,16384);fields(body,['key','done','reportRevision','options']);
  if(typeof body.key!=='string'||!/^[a-f0-9]{64}$/.test(body.key)||typeof body.done!=='boolean'||!isId(body.reportRevision))fail(400,'INVALID_CORRECTION_PROGRESS','Informe uma correção e uma marcação válidas.');
  // This is an authorized reviewer acknowledgement only. Financial values and the
  // reconciliation are still derived from the immutable worksheets in the worker.
  const actor=actorOf(access),entry={done:body.done,updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,reportRevision:body.reportRevision};
  const result=await saveProgressEntry(bucket,body.key,entry,{validate:async()=>{
   await confirmMutationPermission(bucket,access,['admin','editor','reviewer']);
   if((await metadata(bucket))?.revision!==body.reportRevision)fail(409,'REPORT_CHANGED','O relatório mudou. Atualize a visão antes de marcar a correção.');
  }});
  return response({progress:publicCorrectionProgress(body.key,entry),reportRevision:body.reportRevision,correctionProgressRevision:result.correctionProgressRevision});
 }
 async function handle({request,url,bucket,access}){
  if(url.pathname==='/api/report/meta'&&request.method==='GET'){
   const {value:saved}=await published(bucket);requireCurrentProjection(saved);
   return response({reportMeta:meta(saved),correctionProgressRevision:correctionProgressRevision(await readCorrectionProgressMetadata(bucket)),agingDate:engine.today(),analysisMode:'browser'});
  }
  if(url.pathname==='/api/correction-progress'&&request.method==='POST')return saveProgress(bucket,request,access);
  if(url.pathname==='/api/report')fail(409,'BROWSER_ANALYSIS_REQUIRED','Atualize a página para usar o processamento no navegador.');
  if(/^\/api\/client-report\/upgrade\/(start|part|commit)$/.test(url.pathname)){
   if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode preparar a leitura das bases armazenadas.');
   if(request.method!=='POST')fail(405,'METHOD_NOT_ALLOWED','Use a solicitação de preparação.');
   if(url.pathname.endsWith('/start'))return upgradeStart(bucket,request,access);
   return url.pathname.endsWith('/part')?upgradePart(bucket,request,access):upgradeCommit(bucket,request,access);
  }
  if(url.pathname==='/api/client-report/start'&&request.method==='POST')return start(bucket,request,access);
  if(url.pathname==='/api/client-report/cleanup'&&request.method==='POST'){
   const body=await readBody(request,10000);fields(body,['cursor']);await confirmMutationPermission(bucket,access);
   const current=await metadata(bucket);
   try{return response(await cleanup(bucket,current?.revision,{now,cursor:body.cursor??null}));}catch(error){if(error instanceof TypeError&&error.message==='Invalid cleanup cursor')fail(400,'INVALID_CURSOR','Reinicie a manutenção das versões anteriores.');throw error;}
  }
  const upload=url.pathname.match(/^\/api\/client-report\/([a-f0-9-]{36})\/(parts|commit)$/i);
  if(upload&&request.method==='POST')return upload[2]==='parts'?addPart(bucket,request,access,upload[1]):commit(bucket,request,access,upload[1]);
  if(url.pathname==='/api/client-report/progress'&&request.method==='GET')return response(await progress(bucket));
  if(url.pathname==='/api/client-report/backup-source'&&request.method==='GET'){
   if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode baixar o backup privado.');
   if(!migrationSource?.base64)fail(503,'MIGRATION_SOURCE_UNAVAILABLE','O código de restauração não está disponível.');
   const part=Number(url.searchParams.get('part')),partCount=Math.ceil(migrationSource.base64.length/65536);
   if(!url.searchParams.has('part')||!Number.isInteger(part)||part<0||part>=partCount)fail(400,'INVALID_PART','Selecione um trecho válido do backup.');
   await confirmMutationPermission(bucket,access,['admin']);
   return response({index:part,data:migrationSource.base64.slice(part*65536,(part+1)*65536)});
  }
  if(url.pathname==='/api/client-report'||url.pathname==='/api/client-report/backup'){
   if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED','Use a consulta do relatório.');
   const original=url.pathname.endsWith('/backup');if(original&&access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode baixar o backup privado.');
   const {value:saved}=await published(bucket),tracking=original?await readCorrectionProgress(bucket):await progress(bucket);
   if(!original)requireCurrentProjection(saved);
   const materialInputs=original?(await jsonObject(bucket,'private/material-inputs-v1.json')).value:null;
   const payload={...meta(saved),schemaVersion:2,projectionVersion:saved?projectionVersion(saved):CLIENT_REPORT_PROJECTION_VERSION,parts:saved?publicParts(saved,original):[],rows:saved?.rows||{bd:0,control:0},progress:original?tracking.value:tracking,analysisMode:'browser',...(original?{capturedAt:stamp(),reportMeta:saved?{schemaVersion:1,revision:saved.revision,updatedAt:saved.updatedAt,updatedBy:saved.updatedBy,updatedByUserId:saved.updatedByUserId,asOf:saved.asOf,files:saved.files}:null,acl:(await readAcl(bucket)).value,materialInputs:materialInputs===null?null:sanitizeMigrationMaterials(materialInputs),source:migrationSource?{sha256:migrationSource.sha256,fileCount:migrationSource.fileCount,commitSha:migrationSource.commitSha,restorationInstructions:migrationSource.restorationInstructions,partCount:Math.ceil(migrationSource.base64.length/65536)}:null}:{})};
   if(original)await confirmMutationPermission(bucket,access,['admin']);
   return response(payload);
  }
  if(url.pathname==='/api/client-report/parts'&&request.method==='GET'){
   const original=url.searchParams.get('original')==='1';if(original&&access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode baixar as bases originais.');
   const revision=url.searchParams.get('revision'),sheet=url.searchParams.get('sheet'),index=Number(url.searchParams.get('index'));
   if(!isId(revision)||!Object.hasOwn(clientReportColumns,sheet)||!url.searchParams.has('index')||!Number.isInteger(index)||index<0)fail(400,'INVALID_PART','Selecione um trecho válido da base.');
   const {value:saved}=await published(bucket);if(saved?.revision!==revision)fail(409,'REPORT_CHANGED','O relatório mudou. Atualize a visão.');
   if(!original)requireCurrentProjection(saved);
   const part=saved.parts.find(item=>item.sheet===sheet&&item.index===index);if(!part)fail(404,'PART_NOT_FOUND','Este trecho não pertence à publicação.');
   const key=!original&&part.projectedVersion===CLIENT_REPORT_PROJECTION_VERSION?derivedKey(revision,sheet,index):objectKey(revision,sheet,index,original);
   const object=await bucket.get(key);if(!object)fail(503,'REPORT_INCOMPLETE','A base publicada precisa ser conferida.');
   if(original)await confirmMutationPermission(bucket,access,['admin']);
   return new Response(object.body,{headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','etag':`"${original?part.originalSha256:part.sha256}"`}});
  }
  if(url.pathname==='/api/migration/export')fail(409,'BROWSER_BACKUP_REQUIRED','Atualize a página para baixar o backup pelo navegador.');
  if(url.pathname.startsWith('/api/client-report'))fail(404,'NOT_FOUND','Esta operação não existe.');
  return null;
 }
 return {metadata,handle};
}
