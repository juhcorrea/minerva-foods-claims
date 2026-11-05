import {buildMigrationFiles, MigrationExportError} from './migration.js';
import {migrationZipResponse} from './zip.js';

/* Minerva Claims shared API — capability links and per-browser approvals.
 * Admin activation links carry 256-bit secrets, supplied only as hashes in env.
 * Sessions are opaque 256-bit cookies; R2 stores their hashes, never raw secrets.
 * Viewer permissions are checked against the current approval record on every
 * request. E-mail/contact labels and ChatGPT identity headers grant no access.
 */
const ADMIN_IDS = Object.freeze(['owner', 'developer']);
const ACL_KEY = 'private/access-v3.json';
const REPORT_KEY = 'private/report-latest-v1.json';
const CORRECTION_PROGRESS_KEY = 'private/correction-progress-v1.json';
const COOKIE = '__Host-minerva-session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400000;
const MAX_BODY = 20 * 1024 * 1024;
const MAX_ROWS = 25000;
const MAX_CELLS = 1500000;
const MAX_MEMBERS = 5000;
const MAX_PENDING = 500;
const SAFE_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Cookie'};
class ApiError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}
const fail=(status,code,message)=>{throw new ApiError(status,code,message);};
const response=(body,status=200,extra={})=>new Response(JSON.stringify(body),{status,headers:{...SAFE_HEADERS,...extra}});
const stamp=()=>new Date().toISOString();
const uuid=()=>crypto.randomUUID();
const cleanRevision=value=>String(value||'').replace(/^"|"$/g,'');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
// Display labels are separate from the authenticated identity and stored audit.
// The name fallback covers snapshots published before actor IDs were metadata.
const actorLabel=(name,id)=>id==='developer'||(!id&&/^developer(?:\s+example)?$/i.test(String(name||'').trim()))?'Desenvolvimento':name;
const snapshotMetadata=value=>value?{revision:value.revision,updatedAt:value.updatedAt,updatedBy:actorLabel(value.updatedBy,value.updatedByUserId),files:value.files||{bd:value.bdName||'',control:value.controlName||''},asOf:value.asOf||null}:null;
function randomToken(){const a=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...a)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');}
async function hashToken(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function equalHash(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let diff=0;for(let i=0;i<64;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function safeLabel(value,fallback,max=120){if(value==null)return fallback;if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))fail(400,'INVALID_LABEL','Informe um nome ou contato válido.');return value.trim()||fallback;}
function adminConfig(env){
 let values;try{values=JSON.parse(env.ADMIN_LINK_HASHES||'');}catch{fail(503,'ADMIN_NOT_CONFIGURED','Os links administrativos ainda não estão configurados.');}
 if(!Array.isArray(values)||values.length!==2||new Set(values.map(v=>v?.id)).size!==2||values.some(v=>!v||!ADMIN_IDS.includes(v.id)||typeof v.tokenHash!=='string'||!(/^[a-f0-9]{64}$/).test(v.tokenHash)))fail(503,'ADMIN_NOT_CONFIGURED','Os links administrativos ainda não estão configurados.');
 if(values[0].tokenHash===values[1].tokenHash)fail(503,'ADMIN_NOT_CONFIGURED','Os links administrativos precisam ser distintos.');
 // Optional extra links preserve both original links and their sessions.
 // Configuration stores only hashes; each extra must identify exactly one admin.
 const extras={owner:env.OWNER_ADMIN_LINK_HASH,developer:env.DEVELOPER_ADMIN_LINK_HASH};
 const extraHashes=Object.values(extras).filter(value=>value!==undefined);
 if(extraHashes.some(value=>typeof value!=='string'||!(/^[a-f0-9]{64}$/).test(value))||new Set([...values.map(v=>v.tokenHash),...extraHashes]).size!==values.length+extraHashes.length)fail(503,'ADMIN_NOT_CONFIGURED','O link administrativo adicional precisa ser conferido.');
 return values.map(v=>({id:v.id,name:safeLabel(v.name,v.id==='owner'?'Owner':'Developer'),email:safeLabel(v.email,'',240),tokenHash:v.tokenHash,tokenHashes:extras[v.id]?[v.tokenHash,extras[v.id]]:[v.tokenHash]}));
}
function adminAcceptsHash(admin,hash){let accepted=false;for(const allowed of admin.tokenHashes)if(equalHash(allowed,hash))accepted=true;return accepted;}
async function jsonObject(bucket,key){const obj=await bucket.get(key);if(!obj)return{value:null,etag:null};let value;try{value=await obj.json();}catch{fail(503,'STORAGE_INVALID','O armazenamento precisa ser conferido pela administração.');}return{value,etag:obj.etag};}
async function putConditional(bucket,key,value,etag,metadata){const options={httpMetadata:{contentType:'application/json'},onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'}};if(metadata)options.customMetadata=metadata;return bucket.put(key,JSON.stringify(value),options);}
function validAcl(value){if(value&&(value.schemaVersion!==3||!value.members||typeof value.members!=='object'||Array.isArray(value.members)||!value.admins||typeof value.admins!=='object'||Array.isArray(value.admins)||typeof value.revision!=='string'))fail(503,'ACCESS_STORAGE_INVALID','A configuração de acesso precisa ser conferida.');return value;}
function freshAcl(admins){return{schemaVersion:3,revision:uuid(),updatedAt:stamp(),admins:Object.fromEntries(admins.map(a=>[a.id,{id:a.id,name:a.name,email:a.email,activatedAt:null}])),members:{},audit:[]};}
async function readAcl(bucket){const found=await jsonObject(bucket,ACL_KEY);validAcl(found.value);return found;}
async function ensureAcl(bucket,admins){for(let n=0;n<4;n++){const found=await readAcl(bucket);if(found.value)return found;const created=freshAcl(admins);if(await putConditional(bucket,ACL_KEY,created,null))return readAcl(bucket);}fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Tente novamente.');}
function appendAudit(acl,event){acl.audit=[...(Array.isArray(acl.audit)?acl.audit:[]),{at:stamp(),...event}].slice(-200);acl.updatedAt=stamp();acl.revision=uuid();}
function cookieValue(request){const matches=(request.headers.get('cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(COOKIE+'='));if(matches.length!==1)return null;const token=matches[0].slice(COOKIE.length+1);return tokenPattern.test(token)?token:null;}
function cookieHeader(token){return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS*86400}`;}
function clearCookie(){return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;}
function publicSession(access){return{authenticated:!!access.authenticated,approved:!!access.approved,role:access.role,status:access.status,userId:access.member?.id||access.admin?.id||null,name:access.member?.name||actorLabel(access.admin?.name,access.admin?.id)||'',email:access.admin?.id==='developer'?'':access.member?.email||access.admin?.email||'',requestCode:access.member?.requestCode||null,expiresAt:access.session?.expiresAt||null};}
const memberRole=member=>member?.role==='editor'?'editor':'viewer';
async function confirmEditorPermission(bucket,access){
 if(access.role!=='editor')return;
 const{value:acl}=await readAcl(bucket),member=acl?.members[access.member.id];
 if(member?.status!=='approved'||memberRole(member)!=='editor')fail(403,'EDITOR_PERMISSION_CHANGED','Sua permissão de atualização mudou. Atualize a visão para continuar.');
}
async function resolveAccess(bucket,request,admins,now){
 const token=cookieValue(request);if(!token)return{authenticated:false,approved:false,role:'visitor',status:'anonymous'};
 const sessionKey='private/sessions/'+await hashToken(token)+'.json';const{value:session}=await jsonObject(bucket,sessionKey);
 if(!session||session.schemaVersion!==1||typeof session.expiresAt!=='string')return{authenticated:false,approved:false,role:'visitor',status:'anonymous',clear:true};
 if(!Number.isFinite(Date.parse(session.expiresAt))||Date.parse(session.expiresAt)<=now())return{authenticated:false,approved:false,role:'visitor',status:'expired',clear:true,sessionKey};
 if(session.role==='admin'){
  const admin=admins.find(a=>a.id===session.principalId);
  if(!admin||!adminAcceptsHash(admin,session.adminHash))return{authenticated:false,approved:false,role:'visitor',status:'expired',clear:true,sessionKey};
  return{authenticated:true,approved:true,role:'admin',status:'approved',admin,session,sessionKey};
 }
 if(session.role!=='viewer')return{authenticated:false,approved:false,role:'visitor',status:'anonymous',clear:true};
 const{value:acl}=await readAcl(bucket);const member=acl?.members[session.principalId];
 if(!member)return{authenticated:false,approved:false,role:'visitor',status:'anonymous',clear:true};
 const approved=member.status==='approved';const revoked=['revoked','rejected'].includes(member.status);
 // Sessions only identify the member. Current ACL role and approval decide access.
 return{authenticated:true,approved,role:approved?memberRole(member):revoked?'denied':'requester',status:approved?'approved':revoked?'revoked':'pending',member,session,sessionKey};
}
async function issueSession(bucket,principal,now){const token=randomToken(),key='private/sessions/'+await hashToken(token)+'.json';const session={schemaVersion:1,principalId:principal.id,role:principal.role,issuedAt:new Date(now()).toISOString(),expiresAt:new Date(now()+SESSION_MS).toISOString()};if(principal.role==='admin')session.adminHash=principal.tokenHash;await bucket.put(key,JSON.stringify(session),{httpMetadata:{contentType:'application/json'}});return{token,session,key};}
async function reportMeta(bucket){const head=typeof bucket.head==='function'?await bucket.head(REPORT_KEY):null;if(head?.customMetadata?.revision)return snapshotMetadata(head.customMetadata);const{value}=await jsonObject(bucket,REPORT_KEY);return snapshotMetadata(value);}
async function rateLimit(bucket,request,kind,now){
 const ip=request.headers.get('cf-connecting-ip');if(!ip||ip.length>100)return;
 const key='private/rates/'+kind+'-'+await hashToken(ip)+'.json';const duration=kind==='request'?3600000:60000;const limit=kind==='request'?60:30;const window=Math.floor(now()/duration);
 for(let n=0;n<4;n++){const{value,etag}=await jsonObject(bucket,key);const count=value?.window===window?Number(value.count)||0:0;if(count>=limit)fail(429,'TOO_MANY_REQUESTS','Muitas tentativas neste intervalo. Aguarde antes de tentar novamente.');if(await putConditional(bucket,key,{window,count:count+1},etag))return;}
 fail(429,'TOO_MANY_REQUESTS','Aguarde um instante antes de tentar novamente.');
}
function requestCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const bytes=crypto.getRandomValues(new Uint8Array(8));const chars=[...bytes].map(b=>alphabet[b%alphabet.length]);return chars.slice(0,4).join('')+'-'+chars.slice(4).join('');}
async function createRequest(bucket,admins,name,email){
 for(let n=0;n<4;n++){const{value:acl,etag}=await ensureAcl(bucket,admins);const members=Object.values(acl.members);if(members.length>=MAX_MEMBERS||members.filter(m=>m.status==='pending').length>=MAX_PENDING)fail(429,'REQUEST_CAPACITY','Não foi possível registrar uma nova solicitação agora. Avise a administração.');const id=uuid();let code;do{code=requestCode();}while(members.some(m=>m.requestCode===code));const member={id,name,email,status:'pending',role:'viewer',requestCode:code,requestedAt:stamp(),approvedAt:null,approvedBy:null,revokedAt:null,updatedAt:stamp()};acl.members[id]=member;appendAudit(acl,{actorId:id,actorName:name,action:'access_requested',target:id});if(await putConditional(bucket,ACL_KEY,acl,etag))return member;}
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Tente novamente.');
}
async function activateAdmin(bucket,admins,admin){for(let n=0;n<4;n++){const{value:acl,etag}=await ensureAcl(bucket,admins);acl.admins[admin.id]={id:admin.id,name:admin.name,email:admin.email,activatedAt:stamp()};appendAudit(acl,{actorId:admin.id,actorName:admin.name,action:'admin_activated',target:admin.id});if(await putConditional(bucket,ACL_KEY,acl,etag))return;}fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Tente novamente.');}
async function changeApproval(bucket,access,id,approve){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma solicitação válida. Administradoras não podem ser alteradas aqui.');
 for(let n=0;n<4;n++){const{value:acl,etag}=await readAcl(bucket);if(!acl||!acl.members[id])fail(404,'MEMBER_NOT_FOUND','A solicitação não foi encontrada.');const member=acl.members[id];member.status=approve?'approved':'revoked';member.updatedAt=stamp();if(approve){member.approvedAt=stamp();member.approvedBy=access.admin.name;member.approvedById=access.admin.id;}else{member.revokedAt=stamp();member.revokedBy=access.admin.name;member.role='viewer';}appendAudit(acl,{actorId:access.admin.id,actorName:access.admin.name,action:approve?'access_approved':'access_revoked',target:id});if(await putConditional(bucket,ACL_KEY,acl,etag))return{member,revision:acl.revision};}
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Atualize a lista e tente novamente.');
}
async function deleteMemberRequest(bucket,access,id){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma solicitação válida. Administradoras não podem ser excluídas aqui.');
 for(let attempt=0;attempt<4;attempt++){
  const{value:acl,etag}=await readAcl(bucket);
  const member=acl?.members[id];
  if(!member)fail(404,'MEMBER_NOT_FOUND','A solicitação não foi encontrada.');
  if(member.role==='admin')fail(400,'INVALID_MEMBER','Administradoras não podem ser excluídas aqui.');
  if(member.status==='approved')fail(409,'MEMBER_STILL_APPROVED','Revogue o acesso antes de excluir a solicitação.');
  if(!['pending','rejected','revoked'].includes(member.status))fail(409,'MEMBER_STATUS_CHANGED','Atualize a lista e confira a situação da solicitação antes de excluir.');
  const previousStatus=member.status;
  delete acl.members[id];
  // Existing cookies lose access because every request resolves the member in
  // the current ACL. Keep only the deletion action, without copying its labels.
  appendAudit(acl,{actorId:access.admin.id,action:'access_request_deleted',target:id,previousStatus});
  if(await putConditional(bucket,ACL_KEY,acl,etag))return{deleted:true,id,revision:acl.revision};
 }
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Atualize a lista e tente novamente.');
}
async function changeMemberRole(bucket,access,id,body){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma pessoa autorizada. Administradoras não podem ser alteradas aqui.');
 if(Object.keys(body).some(key=>key!=='role')||!['viewer','editor'].includes(body.role))fail(400,'INVALID_ROLE','Selecione Consulta ou Atualizar bases.');
 for(let attempt=0;attempt<4;attempt++){
  const{value:acl,etag}=await readAcl(bucket);
  const member=acl?.members[id];
  if(!member)fail(404,'MEMBER_NOT_FOUND','A pessoa não foi encontrada.');
  if(member.status!=='approved')fail(409,'MEMBER_NOT_APPROVED','Aprove o acesso antes de alterar a permissão.');
  const previousRole=memberRole(member);
  member.role=body.role;member.updatedAt=stamp();
  appendAudit(acl,{actorId:access.admin.id,actorName:access.admin.name,action:'access_role_changed',target:id,previousRole,role:body.role});
  if(await putConditional(bucket,ACL_KEY,acl,etag))return{member,revision:acl.revision};
 }
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Atualize a lista e tente novamente.');
}

function checkMutation(request, url) {
  if (request.headers.get('origin') !== url.origin || request.headers.get('x-minerva-request') !== '1') {
    fail(403, 'INVALID_ORIGIN', 'Esta alteração deve ser feita pelo painel autorizado.');
  }
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) {
    fail(415, 'JSON_REQUIRED', 'Envie a alteração em formato JSON.');
  }
}

async function readBody(request, limit = MAX_BODY) {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail(413, 'BODY_TOO_LARGE', 'A atualização excede o tamanho permitido.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'BODY_REQUIRED', 'Informe os dados da atualização.');
  const chunks = []; let length = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {await reader.cancel(); fail(413, 'BODY_TOO_LARGE', 'A atualização excede o tamanho permitido.');}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON', 'Os dados enviados não são um JSON válido.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_BODY', 'Informe um objeto de atualização válido.');
  return body;
}

function validateRows(rows, name, budget) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > MAX_ROWS) fail(400, 'INVALID_WORKSHEET', `A aba ${name} deve conter cabeçalho e até ${MAX_ROWS - 1} linhas de dados.`);
  for (const row of rows) {
    if (!Array.isArray(row) || row.length > 80) fail(400, 'INVALID_WORKSHEET', `A aba ${name} contém uma linha inválida.`);
    budget.count += row.length;
    if (budget.count > MAX_CELLS) fail(413, 'WORKSHEET_TOO_LARGE', 'As planilhas excedem o limite de células desta análise.');
    for (const v of row) {
      if (v == null || typeof v === 'boolean') continue;
      if (typeof v === 'number' && Number.isFinite(v)) continue;
      if (typeof v === 'string' && v.length <= 100000) continue;
      fail(400, 'INVALID_CELL', `A aba ${name} contém uma célula não suportada.`);
    }
  }
}

function filename(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u001f]/.test(value)) fail(400, 'INVALID_FILENAME', 'O nome do arquivo é inválido.');
  return value.trim() || fallback;
}

function analysisOptions(url, saved, engine) {
  const rawYears = url.searchParams.get('years');
  const years = rawYears == null ? [2025, 2026] : rawYears.split(',').map(Number);
  if (!years.length || years.some(y => y !== 2025 && y !== 2026)) fail(400, 'INVALID_YEARS', 'Selecione 2025, 2026 ou os dois anos.');
  const asOf = url.searchParams.get('asOf') || saved.asOf || engine.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !engine.parseDate(asOf)) fail(400, 'INVALID_DATE', 'Informe uma data da análise válida.');
  const supplier = url.searchParams.get('supplier') || '';
  const operation = url.searchParams.get('operation') || '';
  const controlOperation = url.searchParams.get('controlOperation') || '';
  const correctionScenario = url.searchParams.get('correctionScenario') ?? 'corrected';
  if (supplier.length > 240 || operation.length > 80 || controlOperation.length > 200 || /[\u0000-\u001f]/.test(controlOperation)) fail(400, 'INVALID_FILTER', 'O filtro informado é inválido.');
  if (operation && !['EXPORTAÇÃO - CTNR', 'EXPORTAÇÃO - CARRETA'].includes(operation)) fail(400, 'INVALID_OPERATION', 'Selecione uma operação de exportação válida.');
  if (!['original', 'corrected'].includes(correctionScenario)) fail(400, 'INVALID_CORRECTION_SCENARIO', 'Selecione Base original ou Com correções.');
  return {years: [...new Set(years)], asOf, supplier, operation, controlOperation, correctionScenario, lossFormula: 'subtract-negotiating'};
}

// Manual follow-up is stored separately from the uploaded financial snapshot.
// Keys describe the complete correction, not row positions or generated group IDs.
const progressValue = value => value == null ? '' : String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
async function correctionProgressKey(group) {
 const refs=[...new Set((group.orders?.length?group.orders:[group.reference]).map(progressValue))].sort();
 const changes=(group.changes||[...(group.year?.changes||[]),...(group.market?.changes||[])]).map(change=>JSON.stringify([progressValue(change.field),progressValue(change.reference),progressValue(change.original),progressValue(change.corrected)])).sort();
 return hashToken(JSON.stringify({schema:1,refs,changes}));
}
async function readCorrectionProgress(bucket) {
 const found=await jsonObject(bucket,CORRECTION_PROGRESS_KEY);
 if(found.value&&(found.value.schemaVersion!==1||!found.value.entries||typeof found.value.entries!=='object'||Array.isArray(found.value.entries)))fail(503,'CORRECTION_PROGRESS_INVALID','O acompanhamento das correções precisa ser conferido.');
 return found;
}
function publicCorrectionProgress(key,entry) {
 return {key,done:entry?.done===true,updatedAt:typeof entry?.updatedAt==='string'?entry.updatedAt:null,updatedBy:typeof entry?.updatedBy==='string'?actorLabel(entry.updatedBy,entry.updatedByUserId):null};
}
async function hydrateCorrectionProgress(bucket,model) {
 const {value}=await readCorrectionProgress(bucket);
 await Promise.all((model.correctionGroups||[]).map(async group=>{const key=await correctionProgressKey(group);group.progress=publicCorrectionProgress(key,value?.entries[key]);}));
 return model;
}
function correctionOptions(value,url,saved,engine) {
 if(value==null)return analysisOptions(new URL('/api/report',url),saved,engine);
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['years','asOf','supplier','operation','controlOperation','correctionScenario','lossFormula'].includes(key)))fail(400,'INVALID_FILTER','Os filtros da correção são inválidos.');
 const query=new URL('/api/report',url);
 if(value.years!==undefined){if(!Array.isArray(value.years)||!value.years.length||value.years.length>2||value.years.some(year=>year!==2025&&year!==2026))fail(400,'INVALID_YEARS','Selecione 2025, 2026 ou os dois anos.');query.searchParams.set('years',value.years.join(','));}
 for(const key of ['asOf','supplier','operation','controlOperation','correctionScenario'])if(value[key]!==undefined){if(typeof value[key]!=='string')fail(400,'INVALID_FILTER','Os filtros da correção são inválidos.');query.searchParams.set(key,value[key]);}
 return analysisOptions(query,saved,engine);
}
async function saveCorrectionProgress(bucket,access,body,url,engine) {
 if(Object.keys(body).some(key=>!['key','done','reportRevision','options'].includes(key))||typeof body.key!=='string'||!(/^[a-f0-9]{64}$/).test(body.key)||typeof body.done!=='boolean'||typeof body.reportRevision!=='string'||!body.reportRevision||body.reportRevision.length>100)fail(400,'INVALID_CORRECTION_PROGRESS','Informe uma correção e uma marcação válidas.');
 const {value:saved}=await jsonObject(bucket,REPORT_KEY);
 if(!saved||saved.revision!==body.reportRevision)fail(409,'REPORT_CHANGED','O relatório foi atualizado. Atualize a visão antes de marcar a correção.');
 if(saved.schemaVersion!==1||!Array.isArray(saved.bd)||!Array.isArray(saved.control))fail(503,'REPORT_INVALID','O relatório publicado precisa ser conferido pelas administradoras.');
 const options=correctionOptions(body.options,url,saved,engine);
 let model;try{model=engine.analyze(saved.bd,saved.control,options);}catch{fail(503,'REPORT_ANALYSIS_FAILED','Não foi possível conferir a correção no relatório publicado.');}
 const keys=await Promise.all((model.correctionGroups||[]).map(correctionProgressKey));
 if(!keys.includes(body.key))fail(409,'CORRECTION_CHANGED','A divergência mudou ou não está neste recorte. Atualize a visão antes de marcar.');
 for(let attempt=0;attempt<5;attempt++){
  const {value,etag}=await readCorrectionProgress(bucket);
  if((await reportMeta(bucket))?.revision!==body.reportRevision)fail(409,'REPORT_CHANGED','O relatório foi atualizado. Atualize a visão antes de marcar a correção.');
  const actor=access.admin||access.member;
  const entry={done:body.done,updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,reportRevision:body.reportRevision};
  const next={schemaVersion:1,entries:{...(value?.entries||{}),[body.key]:entry}};
  await confirmEditorPermission(bucket,access);
  if(await putConditional(bucket,CORRECTION_PROGRESS_KEY,next,etag))return {progress:publicCorrectionProgress(body.key,entry),reportRevision:body.reportRevision};
 }
 fail(409,'CORRECTION_PROGRESS_CHANGED','Outra marcação foi salva ao mesmo tempo. Tente novamente.');
}

function redactModel(model) {
  // These rows cover all the uploaded Control, including unrelated operations.
  // They are diagnostic input, not part of the shared report.
  const {unmatchedControls, ...safe} = model;
  return safe;
}



export function createApiHandler({engine,now=()=>Date.now(),migrationSource=null}){
 if(!engine?.analyze||!engine?.validateHeaders||!engine?.parseDate||!engine?.today)throw new Error('A reconciliation engine is required.');
 return async function handleApi(request,env){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return null;let shouldClear=false;
  try{
   if(!env?.BUCKET||typeof env.BUCKET.get!=='function'||typeof env.BUCKET.put!=='function')fail(503,'STORAGE_NOT_READY','O armazenamento compartilhado ainda não está disponível.');
   const admins=adminConfig(env);
   if(!['GET','HEAD'].includes(request.method))checkMutation(request,url);
   const access=await resolveAccess(env.BUCKET,request,admins,now);shouldClear=!!access.clear;
   if(url.pathname==='/api/session'&&request.method==='GET')return response({...publicSession(access),reportMeta:access.approved?await reportMeta(env.BUCKET):null},200,shouldClear?{'set-cookie':clearCookie()}:{});
   if(url.pathname==='/api/auth/logout'&&request.method==='POST'){
    if(access.sessionKey){if(typeof env.BUCKET.delete==='function')await env.BUCKET.delete(access.sessionKey);else await env.BUCKET.put(access.sessionKey,JSON.stringify({schemaVersion:1,expiresAt:'1970-01-01T00:00:00.000Z'}));}
    return response({authenticated:false,approved:false,role:'visitor',status:'anonymous'},200,{'set-cookie':clearCookie()});
   }
   if(url.pathname==='/api/auth/exchange'&&request.method==='POST'){
    await rateLimit(env.BUCKET,request,'exchange',now);const body=await readBody(request,4096);
    if(typeof body.token!=='string'||!tokenPattern.test(body.token))fail(401,'INVALID_LINK','O link administrativo é inválido ou foi substituído.');
    const digest=await hashToken(body.token);let admin=null;for(const candidate of admins)if(adminAcceptsHash(candidate,digest))admin=candidate;
    if(!admin)fail(401,'INVALID_LINK','O link administrativo é inválido ou foi substituído.');
    await activateAdmin(env.BUCKET,admins,admin);const issued=await issueSession(env.BUCKET,{...admin,role:'admin',tokenHash:digest},now);
    return response({...publicSession({authenticated:true,approved:true,role:'admin',status:'approved',admin,session:issued.session}),reportMeta:await reportMeta(env.BUCKET)},200,{'set-cookie':cookieHeader(issued.token)});
   }
   if(url.pathname==='/api/auth/request'&&request.method==='POST'){
    const body=await readBody(request,4096);
    if(Object.keys(body).some(k=>!['name','email','website'].includes(k)))fail(400,'INVALID_REQUEST','Informe somente seu nome e contato opcional.');
    if(body.website)fail(400,'INVALID_REQUEST','Não foi possível registrar a solicitação.');
    if(access.authenticated)return response({...publicSession(access),reportMeta:access.approved?await reportMeta(env.BUCKET):null});
    const name=safeLabel(body.name,'',120);const email=safeLabel(body.email,'',240);
    if(name.length<2)fail(400,'NAME_REQUIRED','Informe seu nome para a administração reconhecer a solicitação.');
    await rateLimit(env.BUCKET,request,'request',now);
    const member=await createRequest(env.BUCKET,admins,name,email);const issued=await issueSession(env.BUCKET,{id:member.id,role:'viewer'},now);
    return response({...publicSession({authenticated:true,approved:false,role:'requester',status:'pending',member,session:issued.session}),reportMeta:null},201,{'set-cookie':cookieHeader(issued.token)});
   }
   if(!access.authenticated)fail(401,'SESSION_REQUIRED','Solicite acesso ou use seu link administrativo para continuar.');
   if(!access.approved)fail(403,access.status==='revoked'?'ACCESS_REVOKED':'ACCESS_PENDING',access.status==='revoked'?'Seu acesso foi revogado. A administração pode rever essa decisão.':'Sua solicitação aguarda aprovação da administração.');
   const modifying=!['GET','HEAD'].includes(request.method);
   const editorMutation=access.role==='editor'&&request.method==='POST'&&['/api/report','/api/correction-progress'].includes(url.pathname);
   if(modifying&&access.role!=='admin'&&!editorMutation)fail(403,'ADMIN_REQUIRED','Você não tem permissão para esta alteração. Apenas as administradoras podem gerenciar os acessos.');
   if(url.pathname==='/api/migration/export'){
    if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode baixar o backup privado.');
    if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED','Use o download do backup privado.');
    if(!migrationSource)fail(503,'MIGRATION_SOURCE_UNAVAILABLE','O código de restauração ainda não está disponível nesta versão.');
    const {files}=await buildMigrationFiles({bucket:env.BUCKET,admins,source:migrationSource,now});
    return migrationZipResponse(files);
   }
   if(url.pathname==='/api/report/meta'&&request.method==='GET')return response({reportMeta:await reportMeta(env.BUCKET)});
   if(url.pathname==='/api/correction-progress'&&request.method==='POST')return response(await saveCorrectionProgress(env.BUCKET,access,await readBody(request,16384),url,engine));
   if(url.pathname==='/api/report'&&request.method==='GET'){
    const{value:saved}=await jsonObject(env.BUCKET,REPORT_KEY);if(!saved)return response({model:null,files:null,updatedAt:null,updatedBy:null,revision:null});
    if(saved.schemaVersion!==1||!Array.isArray(saved.bd)||!Array.isArray(saved.control))fail(503,'REPORT_INVALID','O relatório publicado precisa ser conferido pelas administradoras.');
    const opts=analysisOptions(url,saved,engine);let model;try{model=engine.analyze(saved.bd,saved.control,opts);}catch{fail(503,'REPORT_ANALYSIS_FAILED','Não foi possível processar o relatório publicado.');}
    return response({...snapshotMetadata(saved),model:redactModel(await hydrateCorrectionProgress(env.BUCKET,model))},200,{'etag':`"${saved.revision}"`});
   }
   if(url.pathname==='/api/report'&&request.method==='POST'){
    const body=await readBody(request);
    if(body.demo===true||body.isDemo===true)fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
    const budget={count:0};validateRows(body.bd,'BD',budget);validateRows(body.control,'Controle Recebimento',budget);
    const files={bd:filename(body.files?.bd,'BD.xlsx'),control:filename(body.files?.control,'Controle de Recebimento.xlsx')};
    if(/demonstra[cç][aã]o|fict[ií]ci/i.test(files.bd+' '+files.control))fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
    const asOf=body.asOf||engine.today();if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!engine.parseDate(asOf))fail(400,'INVALID_DATE','Informe a data da análise para a publicação.');
    let model;try{engine.validateHeaders(body.bd,'BD');engine.validateHeaders(body.control,'Controle Recebimento');model=engine.analyze(body.bd,body.control,{years:[2025,2026],asOf,correctionScenario:'corrected',lossFormula:'subtract-negotiating'});}catch(err){fail(400,'INVALID_REPORT',err.message||'As planilhas não têm o formato esperado.');}
    const{value:previous,etag}=await jsonObject(env.BUCKET,REPORT_KEY);const expected=request.headers.get('if-match');
    if(expected&&cleanRevision(expected)!==(previous?.revision||'none'))fail(409,'REPORT_CHANGED','Outra atualização já foi publicada. Carregue a versão atual antes de publicar novamente.');
    const actor=access.admin||access.member;
    const saved={schemaVersion:1,revision:uuid(),updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,files,asOf,bd:body.bd,control:body.control};
    const metadata={revision:saved.revision,updatedAt:saved.updatedAt,updatedBy:saved.updatedBy,updatedByUserId:saved.updatedByUserId,bdName:files.bd,controlName:files.control,asOf};
    await confirmEditorPermission(env.BUCKET,access);
    if(!await putConditional(env.BUCKET,REPORT_KEY,saved,etag,metadata))fail(409,'REPORT_CHANGED','Outra atualização foi publicada ao mesmo tempo. Carregue a versão atual antes de tentar novamente.');
    return response({...snapshotMetadata(saved),model:redactModel(await hydrateCorrectionProgress(env.BUCKET,model))},200,{'etag':`"${saved.revision}"`});
   }
   if(url.pathname==='/api/members'&&request.method==='GET'){
    if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Apenas as administradoras podem consultar os acessos.');
    const{value:acl}=await ensureAcl(env.BUCKET,admins);
    return response({admins:admins.map(a=>({id:a.id,name:actorLabel(a.name,a.id),email:a.id==='developer'?'':a.email,activatedAt:acl.admins[a.id]?.activatedAt||null})),revision:acl.revision,members:Object.values(acl.members).map(m=>({...m,role:memberRole(m)})).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)),audit:(acl.audit||[]).slice(-50)});
   }
   const approvePath=url.pathname.match(/^\/api\/members\/([^/]+)\/approve$/);
   if(approvePath&&request.method==='POST'){
    const result=await changeApproval(env.BUCKET,access,approvePath[1],true);return response(result);
   }
   const rolePath=url.pathname.match(/^\/api\/members\/([^/]+)\/role$/);
   if(rolePath&&request.method==='POST')return response(await changeMemberRole(env.BUCKET,access,rolePath[1],await readBody(request,4096)));
   const deleteRequestPath=url.pathname.match(/^\/api\/members\/([^/]+)\/request$/);
   if(deleteRequestPath&&request.method==='DELETE')return response(await deleteMemberRequest(env.BUCKET,access,deleteRequestPath[1]));
   const revokePath=url.pathname.match(/^\/api\/members\/([^/]+)$/);
   if(revokePath&&request.method==='DELETE'){
    const result=await changeApproval(env.BUCKET,access,revokePath[1],false);return response(result);
   }
   fail(404,'NOT_FOUND','Esta operação não existe.');
  }catch(err){const extra=shouldClear?{'set-cookie':clearCookie()}:{};if(err instanceof ApiError||err instanceof MigrationExportError)return response({error:err.message,code:err.code},err.status,extra);return response({error:'Não foi possível concluir a operação. Tente novamente.',code:'SERVER_ERROR'},500,extra);}
 };
}
export const apiConstants=Object.freeze({adminIds:ADMIN_IDS,cookieName:COOKIE,sessionDays:SESSION_DAYS,maxBodyBytes:MAX_BODY});
