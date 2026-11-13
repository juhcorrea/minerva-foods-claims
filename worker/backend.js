import {buildMigrationFiles, MigrationExportError} from './migration.js';
import {migrationZipResponse} from './zip.js';
import {createClientReportHandler} from './client-report.js';
import {CorrectionProgressError,readCorrectionProgress,readCorrectionProgressMetadata,correctionProgressRevision,saveProgressEntry} from './correction-progress.js';
import {CloudflareAccessError, cloudflareAccessConfig, createCloudflareAccessVerifier} from './cloudflare-access.js';

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
const MATERIAL_INPUTS_KEY = 'private/material-inputs-v1.json';
const COOKIE = '__Host-minerva-session';
const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 86400000;
const MAX_BODY = 20 * 1024 * 1024;
const MAX_ROWS = 25000;
const MAX_CELLS = 1500000;
const MAX_MEMBERS = 5000;
const MAX_PENDING = 500;
const SAFE_HEADERS = {'content-type':'application/json; charset=utf-8','cache-control':'private, no-store, max-age=0','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer','vary':'Cookie, Cf-Access-Jwt-Assertion'};
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
function publicSession(access){return{authenticated:!!access.authenticated,approved:!!access.approved,role:access.role,status:access.status,userId:access.member?.id||access.admin?.id||null,name:access.member?.name||actorLabel(access.admin?.name,access.admin?.id)||'',email:access.admin?.id==='developer'?'':access.member?.email||access.admin?.email||'',requestCode:access.member?.requestCode||null,expiresAt:access.identity?.expiresAt||access.session?.expiresAt||null,...(access.provider?{provider:access.provider,authProvider:access.provider,verifiedEmail:access.identity?.email||null}:{})};}
const memberRole=member=>['admin','editor','reviewer'].includes(member?.role)?member.role:'viewer';
function requireCurrentRole(acl,access,allowedRoles){
 // Bootstrap administrators are authenticated by runtime configuration and
 // cannot be demoted, revoked or deleted through member endpoints. They keep
 // the administration reachable even if delegated admins revoke one another.
 if(access.admin&&ADMIN_IDS.includes(access.admin.id)&&allowedRoles.includes('admin'))return access.admin;
 const member=acl?.members[access.member?.id];
 if(!allowedRoles.includes(access.role)||member?.status!=='approved'||!allowedRoles.includes(memberRole(member))||(access.provider==='cloudflare-access'&&!matchesAccessIdentity(member,access.identity)))fail(403,access.role==='editor'?'EDITOR_PERMISSION_CHANGED':'PERMISSION_CHANGED','Sua permissão mudou. Atualize a visão para continuar.');
 return member;
}
async function confirmMutationPermission(bucket,access,allowedRoles=['admin','editor']){
 if(access.admin&&ADMIN_IDS.includes(access.admin.id)&&allowedRoles.includes('admin'))return;
 const{value:acl}=await readAcl(bucket);requireCurrentRole(acl,access,allowedRoles);
}
function materialValues(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['containerTotal','containerFrozen','containerChilled','containerDry','freightUsd','note','agreements'].includes(key)))fail(400,'MATERIAL_INVALID','Confira os campos manuais do material.');
 const value={};
 for(const key of ['containerTotal','containerFrozen','containerChilled','containerDry','freightUsd']){
  const n=input[key];
  if(n==null||n===''){value[key]=null;continue;}
  if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>1e15||(key!=='freightUsd'&&!Number.isSafeInteger(n)))fail(400,'MATERIAL_INVALID','Informe valores positivos; volumes devem ser inteiros.');
  value[key]=n;
 }
 value.note=safeLabel(input.note,'',1000);value.agreements={};
 if(input.agreements!==undefined){
  if(!input.agreements||typeof input.agreements!=='object'||Array.isArray(input.agreements)||Object.keys(input.agreements).length>200)fail(400,'MATERIAL_INVALID','Confira os acordos informados.');
  for(const [carrier,months]of Object.entries(input.agreements)){
   if(!carrier.trim()||carrier.length>160||['__proto__','constructor','prototype'].includes(carrier)||/[\u0000-\u001f]/.test(carrier)||!months||typeof months!=='object'||Array.isArray(months)||Object.keys(months).length>12)fail(400,'MATERIAL_INVALID','Confira o armador e os meses dos acordos.');
   const counts={};for(const [month,n]of Object.entries(months)){if(!/^(?:[1-9]|1[0-2])$/.test(month)||(n!==null&&(typeof n!=='number'||!Number.isSafeInteger(n)||n<0||n>1e9)))fail(400,'MATERIAL_INVALID','Confira a quantidade de acordos por mês.');counts[month]=n;}
   value.agreements[carrier]=counts;
  }
 }
 return value;
}
function materialDocument(value){
 if(!value)return{schemaVersion:1,revision:null,periods:{},updatedAt:null,updatedBy:null};
 if(value.schemaVersion!==1||!value.periods||typeof value.periods!=='object'||Array.isArray(value.periods)||typeof value.revision!=='string')fail(503,'MATERIAL_STORAGE_INVALID','Os materiais salvos precisam ser conferidos.');
 return{schemaVersion:1,revision:value.revision,periods:value.periods,updatedAt:value.updatedAt,updatedBy:actorLabel(value.updatedBy,value.updatedByUserId)};
}
async function saveMaterialInputs(bucket,access,body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['revision','year','values'].includes(key))||!Number.isInteger(body.year)||body.year<2000||body.year>2100||(body.revision!==null&&typeof body.revision!=='string'))fail(400,'MATERIAL_INVALID','Informe o ano e a versão dos campos manuais.');
 const values=materialValues(body.values),found=await jsonObject(bucket,MATERIAL_INPUTS_KEY),previous=materialDocument(found.value);
 if(body.revision!==previous.revision)fail(409,'MATERIAL_CHANGED','Outra pessoa atualizou os materiais. Recarregue antes de salvar.');
 await confirmMutationPermission(bucket,access,['admin','editor']);
 const actor=access.admin||access.member,value={schemaVersion:1,revision:uuid(),periods:{...previous.periods,[body.year]:values},updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id};
 if(!await putConditional(bucket,MATERIAL_INPUTS_KEY,value,found.etag))fail(409,'MATERIAL_CHANGED','Os materiais foram atualizados simultaneamente. Recarregue antes de salvar.');
 return materialDocument(value);
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
const matchesAccessIdentity=(member,identity)=>member?.identity?.provider==='cloudflare-access'&&member.identity.issuer===identity.issuer&&member.identity.subject===identity.subject&&member.identity.email===identity.email;
function accessIdentitySession(identity,member){
 const approved=member?.status==='approved',revoked=['revoked','rejected'].includes(member?.status);
 return {provider:'cloudflare-access',identity,authenticated:true,approved,role:approved?memberRole(member):revoked?'denied':'requester',status:approved?'approved':revoked?'revoked':member?'pending':'unregistered',member};
}
async function resolveCloudflareAccess(bucket,request,config,verify){
 const identity=await verify(request,config);
 if(!identity)return {provider:'cloudflare-access',authenticated:false,approved:false,role:'visitor',status:'anonymous'};
 const admin=config.admins.find(candidate=>candidate.email===identity.email);
 if(admin){
  // Runtime bootstrap is limited to exactly two configured, verified emails.
  // Legacy member email labels are never considered an authenticated identity.
  await ensureAcl(bucket,config.admins);
  return {provider:'cloudflare-access',identity,authenticated:true,approved:true,role:'admin',status:'approved',admin};
 }
 const {value:acl}=await readAcl(bucket);
 const member=Object.values(acl?.members||{}).find(candidate=>matchesAccessIdentity(candidate,identity));
 return accessIdentitySession(identity,member);
}
async function createVerifiedRequest(bucket,admins,identity,name){
 for(let attempt=0;attempt<4;attempt++){
  const {value:acl,etag}=await ensureAcl(bucket,admins),members=Object.values(acl.members);
  const existing=members.find(member=>matchesAccessIdentity(member,identity));if(existing)return {member:existing,created:false};
  if(members.length>=MAX_MEMBERS||members.filter(member=>member.status==='pending').length>=MAX_PENDING)fail(429,'REQUEST_CAPACITY','Não foi possível registrar uma nova solicitação agora. Avise a administração.');
  const id=uuid();let code;do{code=requestCode();}while(members.some(member=>member.requestCode===code));
  const member={id,name,email:identity.email,status:'pending',role:'viewer',requestCode:code,requestedAt:stamp(),approvedAt:null,approvedBy:null,revokedAt:null,updatedAt:stamp(),identity:{provider:'cloudflare-access',issuer:identity.issuer,subject:identity.subject,email:identity.email},emailVerified:true};
  acl.members[id]=member;appendAudit(acl,{actorId:id,actorName:name,action:'verified_access_requested',target:id,provider:'cloudflare-access'});
  if(await putConditional(bucket,ACL_KEY,acl,etag))return {member,created:true};
 }
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Tente novamente.');
}
async function activateAdmin(bucket,admins,admin){for(let n=0;n<4;n++){const{value:acl,etag}=await ensureAcl(bucket,admins);acl.admins[admin.id]={id:admin.id,name:admin.name,email:admin.email,activatedAt:stamp()};appendAudit(acl,{actorId:admin.id,actorName:admin.name,action:'admin_activated',target:admin.id});if(await putConditional(bucket,ACL_KEY,acl,etag))return;}fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Tente novamente.');}
async function changeApproval(bucket,access,id,approve){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma solicitação válida. Administradoras não podem ser alteradas aqui.');
 for(let n=0;n<4;n++){const{value:acl,etag}=await readAcl(bucket),actor=requireCurrentRole(acl,access,['admin']);if(!acl||!acl.members[id])fail(404,'MEMBER_NOT_FOUND','A solicitação não foi encontrada.');const member=acl.members[id];if(approve&&member.status!=='approved')member.role='viewer';member.status=approve?'approved':'revoked';member.updatedAt=stamp();if(approve){member.approvedAt=stamp();member.approvedBy=actor.name;member.approvedById=actor.id;}else{member.revokedAt=stamp();member.revokedBy=actor.name;member.role='viewer';}appendAudit(acl,{actorId:actor.id,actorName:actor.name,action:approve?'access_approved':'access_revoked',target:id});if(await putConditional(bucket,ACL_KEY,acl,etag))return{member,revision:acl.revision};}
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Atualize a lista e tente novamente.');
}
async function deleteMemberRequest(bucket,access,id){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma solicitação válida. Administradoras não podem ser excluídas aqui.');
 for(let attempt=0;attempt<4;attempt++){
  const{value:acl,etag}=await readAcl(bucket),actor=requireCurrentRole(acl,access,['admin']);
  const member=acl?.members[id];
  if(!member)fail(404,'MEMBER_NOT_FOUND','A solicitação não foi encontrada.');
  if(member.role==='admin')fail(400,'INVALID_MEMBER','Administradoras não podem ser excluídas aqui.');
  if(member.status==='approved')fail(409,'MEMBER_STILL_APPROVED','Revogue o acesso antes de excluir a solicitação.');
  if(!['pending','rejected','revoked'].includes(member.status))fail(409,'MEMBER_STATUS_CHANGED','Atualize a lista e confira a situação da solicitação antes de excluir.');
  const previousStatus=member.status;
  delete acl.members[id];
  // Existing cookies lose access because every request resolves the member in
  // the current ACL. Keep only the deletion action, without copying its labels.
  appendAudit(acl,{actorId:actor.id,action:'access_request_deleted',target:id,previousStatus});
  if(await putConditional(bucket,ACL_KEY,acl,etag))return{deleted:true,id,revision:acl.revision};
 }
 fail(409,'ACCESS_CHANGED','Os acessos foram atualizados simultaneamente. Atualize a lista e tente novamente.');
}
async function changeMemberRole(bucket,access,id,body){
 if(ADMIN_IDS.includes(id)||!(/^[a-f0-9-]{36}$/i).test(id))fail(400,'INVALID_MEMBER','Selecione uma pessoa autorizada. Administradoras não podem ser alteradas aqui.');
 if(Object.keys(body).some(key=>key!=='role')||!['viewer','reviewer','editor','admin'].includes(body.role))fail(400,'INVALID_ROLE','Selecione Consulta, Conferente, Atualizar bases ou Administrador.');
 for(let attempt=0;attempt<4;attempt++){
  const{value:acl,etag}=await readAcl(bucket),actor=requireCurrentRole(acl,access,['admin']);
  const member=acl?.members[id];
  if(!member)fail(404,'MEMBER_NOT_FOUND','A pessoa não foi encontrada.');
  if(member.status!=='approved')fail(409,'MEMBER_NOT_APPROVED','Aprove o acesso antes de alterar a permissão.');
  if(body.role==='admin'&&access.provider==='cloudflare-access'){
   const identity=member.identity,domain=access.identity.email.split('@').at(-1);
   if(member.emailVerified!==true||identity?.provider!=='cloudflare-access'||identity.issuer!==access.identity.issuer||typeof identity.subject!=='string'||!identity.subject||identity.email!==member.email||typeof identity.email!=='string'||identity.email.split('@').length!==2||identity.email.split('@')[1]!==domain)fail(409,'VERIFIED_IDENTITY_REQUIRED','A pessoa precisa entrar com a identidade corporativa verificada antes de receber o perfil de administrador.');
  }
  const previousRole=memberRole(member);
  member.role=body.role;member.updatedAt=stamp();
  appendAudit(acl,{actorId:actor.id,actorName:actor.name,action:'access_role_changed',target:id,previousRole,role:body.role});
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
  const years = rawYears == null ? [Number(engine.today().slice(0,4))] : rawYears.split(',').map(Number);
  if (!years.length || years.length>201 || years.some(y => !Number.isInteger(y) || y<1900 || y>2100)) fail(400, 'INVALID_YEARS', 'Selecione anos inteiros entre 1900 e 2100.');
  const rawAllYears=url.searchParams.get('allYears');
  if(rawAllYears!==null&&!['1','0','true','false'].includes(rawAllYears))fail(400,'INVALID_YEAR_SCOPE','Informe um escopo de anos válido.');
  const allYears=rawAllYears==='1'||rawAllYears==='true';
  const rawMonths=url.searchParams.get('months');
  const monthValues=rawMonths===null?[]:rawMonths.split(',');
  if(url.searchParams.getAll('months').length>1||monthValues.length>12||monthValues.some(month=>!(/^(?:[1-9]|1[0-2])$/).test(month)))fail(400,'INVALID_MONTHS','Selecione meses inteiros entre 1 e 12.');
  const selectedMonths=[...new Set(monthValues.map(Number))].sort((a,b)=>a-b);
  const months=selectedMonths.length===12?[]:selectedMonths;
  const asOf = url.searchParams.get('asOf') || saved.asOf || engine.today();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !engine.parseDate(asOf)) fail(400, 'INVALID_DATE', 'Informe uma data da análise válida.');
  const readSelections=(key,maxLength,normalize)=>{const raw=url.searchParams.getAll(key),seen=new Set();if(raw.length>200||raw.some(value=>value.length>maxLength||/[\u0000-\u001f]/.test(value)))fail(400,'INVALID_FILTER','O filtro informado é inválido. Selecione até 200 valores por filtro.');return raw.map(value=>value.trim()).filter(value=>{const key=normalize(value);if(!key||seen.has(key))return false;seen.add(key);return true;});};
  const suppliers=readSelections('supplier',240,engine.normalizeSupplier),operations=readSelections('operation',200,engine.normalizeStatus),controlOperations=readSelections('controlOperation',200,engine.normalizeStatus);
  const claimStatuses=readSelections('claimStatus',200,engine.normalizeStatus);
  const claimStatusOptions=new Set(saved.bd.slice(1).filter(row=>row?.slice(0,36).some(value=>value!=null&&value!=='')).map(row=>engine.normalizeStatus(row?.[6])||'NAO INFORMADO'));
  if(claimStatuses.some(value=>!claimStatusOptions.has(engine.normalizeStatus(value))))fail(400,'INVALID_CLAIM_STATUS','Selecione situações presentes na BD.');
  const supplier=suppliers.join(' · '),operation=operations.join(' · '),controlOperation=controlOperations.join(' · ');
  const correctionScenario = url.searchParams.get('correctionScenario') ?? 'corrected';
  const operationOptions=new Set(saved.bd.slice(1).map(row=>engine.normalizeStatus(row?.[25])).filter(Boolean));
  const supplierOptions=new Set([...saved.bd.slice(1).map(row=>String(row?.[28]??'').trim()||'(SEM NEGOCIAÇÃO)'),...saved.control.slice(1).map(row=>String(row?.[10]??'').trim()||'(SEM FORNECEDOR)')].map(engine.normalizeSupplier));
  const controlOperationOptions=new Set([...operationOptions,engine.normalizeStatus('SEM OPERAÇÃO IDENTIFICADA')]);
  if (operations.some(value=>!operationOptions.has(engine.normalizeStatus(value)))) fail(400, 'INVALID_OPERATION', 'Selecione operações presentes na BD.');
  if (controlOperations.some(value=>!controlOperationOptions.has(engine.normalizeStatus(value)))) fail(400, 'INVALID_OPERATION', 'Selecione operações disponíveis no Controle.');
  if (suppliers.some(value=>!supplierOptions.has(engine.normalizeSupplier(value)))) fail(400,'INVALID_SUPPLIER','Selecione fornecedores presentes nas bases.');
  if (!['original', 'corrected'].includes(correctionScenario)) fail(400, 'INVALID_CORRECTION_SCENARIO', 'Selecione Base original ou Com correções.');
  return {years: [...new Set(years)], allYears, months, asOf, supplier, suppliers, operation, operations, controlOperation, controlOperations, claimStatuses, correctionScenario, lossFormula: 'subtract-negotiating'};
}

// Manual follow-up is stored separately from the uploaded financial snapshot.
// Keys describe the complete correction, not row positions or generated group IDs.
const progressValue = value => value == null ? '' : String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
async function correctionProgressKey(group) {
 const refs=[...new Set((group.orders?.length?group.orders:[group.reference]).map(progressValue))].sort();
 const changes=(group.changes||[...(group.year?.changes||[]),...(group.market?.changes||[])]).map(change=>JSON.stringify([progressValue(change.field),progressValue(change.reference),progressValue(change.original),progressValue(change.corrected)])).sort();
 return hashToken(JSON.stringify({schema:1,refs,changes}));
}
function publicCorrectionProgress(key,entry) {
 return {key,done:entry?.done===true,updatedAt:typeof entry?.updatedAt==='string'?entry.updatedAt:null,updatedBy:typeof entry?.updatedBy==='string'?actorLabel(entry.updatedBy,entry.updatedByUserId):null};
}
async function hydrateCorrectionProgress(bucket,model,engine,bdRows,controlRows) {
 const found=await readCorrectionProgress(bucket),{value}=found;
 await Promise.all((model.correctionGroups||[]).map(async group=>{const key=await correctionProgressKey(group);group.progress=publicCorrectionProgress(key,value?.entries[key]);}));
 await Promise.all((engine.correctionReviewTargets?.(model,bdRows,controlRows)||[]).map(async({item,identity})=>{
  const key=await hashToken(identity),entry=value?.entries[key]??engine.correctionReviewLegacyProgress(item),progress=publicCorrectionProgress(key,entry);
  for(const source of [...item.groups,...item.audits,...item.issues])source.reviewProgress=progress;
 }));
 model.meta={...model.meta,correctionProgressRevision:correctionProgressRevision(found)};
 return model;
}
function correctionOptions(value,url,saved,engine) {
 if(value==null)return analysisOptions(new URL('/api/report',url),saved,engine);
 if(typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['years','allYears','months','asOf','supplier','suppliers','operation','operations','controlOperation','controlOperations','correctionScenario','lossFormula'].includes(key)))fail(400,'INVALID_FILTER','Os filtros da correção são inválidos.');
 const query=new URL('/api/report',url);
 if(value.years!==undefined){if(!Array.isArray(value.years)||!value.years.length||value.years.length>201||value.years.some(year=>!Number.isInteger(year)||year<1900||year>2100))fail(400,'INVALID_YEARS','Selecione anos inteiros entre 1900 e 2100.');query.searchParams.set('years',value.years.join(','));}
 if(value.allYears!==undefined){if(typeof value.allYears!=='boolean')fail(400,'INVALID_YEAR_SCOPE','Informe um escopo de anos válido.');query.searchParams.set('allYears',value.allYears?'1':'0');}
 if(value.months!==undefined){if(!Array.isArray(value.months)||value.months.length>12||value.months.some(month=>!Number.isInteger(month)||month<1||month>12))fail(400,'INVALID_MONTHS','Selecione meses inteiros entre 1 e 12.');if(value.months.length)query.searchParams.set('months',value.months.join(','));}
 for(const [plural,singular] of [['suppliers','supplier'],['operations','operation'],['controlOperations','controlOperation']]){const input=Object.prototype.hasOwnProperty.call(value,plural)?value[plural]:value[singular];if(input===undefined)continue;const values=Array.isArray(input)?input:[input];if(values.length>200||values.some(item=>typeof item!=='string'))fail(400,'INVALID_FILTER','Os filtros da correção são inválidos.');for(const item of values)query.searchParams.append(singular,item);}
 for(const key of ['asOf','correctionScenario'])if(value[key]!==undefined){if(typeof value[key]!=='string')fail(400,'INVALID_FILTER','Os filtros da correção são inválidos.');query.searchParams.set(key,value[key]);}
 return analysisOptions(query,saved,engine);
}
async function saveCorrectionProgress(bucket,access,body,url,engine) {
 if(Object.keys(body).some(key=>!['key','done','reportRevision','options'].includes(key))||typeof body.key!=='string'||!(/^[a-f0-9]{64}$/).test(body.key)||typeof body.done!=='boolean'||typeof body.reportRevision!=='string'||!body.reportRevision||body.reportRevision.length>100)fail(400,'INVALID_CORRECTION_PROGRESS','Informe uma correção e uma marcação válidas.');
 const {value:saved}=await jsonObject(bucket,REPORT_KEY);
 if(!saved||saved.revision!==body.reportRevision)fail(409,'REPORT_CHANGED','O relatório foi atualizado. Atualize a visão antes de marcar a correção.');
 if(saved.schemaVersion!==1||!Array.isArray(saved.bd)||!Array.isArray(saved.control))fail(503,'REPORT_INVALID','O relatório publicado precisa ser conferido pelas administradoras.');
 const options=correctionOptions(body.options,url,saved,engine);
 let model;try{model=engine.analyze(saved.bd,saved.control,options);}catch{fail(503,'REPORT_ANALYSIS_FAILED','Não foi possível conferir a correção no relatório publicado.');}
 const keys=await Promise.all([...(model.correctionGroups||[]).map(correctionProgressKey),...(engine.correctionReviewTargets?.(model,saved.bd,saved.control)||[]).map(target=>hashToken(target.identity))]);
 if(!keys.includes(body.key))fail(409,'CORRECTION_CHANGED','A divergência mudou ou não está neste recorte. Atualize a visão antes de marcar.');
 const actor=access.admin||access.member,entry={done:body.done,updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,reportRevision:body.reportRevision};
 const result=await saveProgressEntry(bucket,body.key,entry,{validate:async()=>{
  await confirmMutationPermission(bucket,access,['admin','editor','reviewer']);
  if((await reportMeta(bucket))?.revision!==body.reportRevision)fail(409,'REPORT_CHANGED','O relatório foi atualizado. Atualize a visão antes de marcar a correção.');
 }});
 return {progress:publicCorrectionProgress(body.key,entry),reportRevision:body.reportRevision,correctionProgressRevision:result.correctionProgressRevision};
}

function redactModel(model) {
  // These rows cover all the uploaded Control, including unrelated operations.
  // They are diagnostic input, not part of the shared report.
  const {unmatchedControls, ...safe} = model;
  return safe;
}



export function createApiHandler({engine,now=()=>Date.now(),migrationSource=null,accessFetch}){
 if(!engine?.analyze||!engine?.validateHeaders||!engine?.parseDate||!engine?.today)throw new Error('A reconciliation engine is required.');
 const verifyAccess=createCloudflareAccessVerifier({now,...(accessFetch?{fetcher:accessFetch}:{})});
 const clientReports=createClientReportHandler({engine,now,fail,response,readBody,jsonObject,putConditional,hashToken,stamp,uuid,actorLabel,confirmMutationPermission,readCorrectionProgress,readCorrectionProgressMetadata,saveProgressEntry,correctionProgressRevision,publicCorrectionProgress,migrationSource,readAcl});
 return async function handleApi(request,env){
  const url=new URL(request.url);if(!url.pathname.startsWith('/api/'))return null;let shouldClear=false;
  try{
   if(!env?.BUCKET||typeof env.BUCKET.get!=='function'||typeof env.BUCKET.put!=='function')fail(503,'STORAGE_NOT_READY','O armazenamento compartilhado ainda não está disponível.');
   if(env.AUTH_MODE&&!['legacy','sites','cloudflare-access'].includes(env.AUTH_MODE))fail(503,'AUTH_MODE_INVALID','O modo de identificação precisa ser conferido.');
   const accessMode=env.AUTH_MODE==='cloudflare-access',accessConfig=accessMode?cloudflareAccessConfig(env):null,admins=accessMode?accessConfig.admins:adminConfig(env);
   const clientMode=env.CF_CLIENT_ANALYSIS==='1';
   const getReportMetadata=clientMode?clientReports.metadata:reportMeta;
   if(!['GET','HEAD'].includes(request.method))checkMutation(request,url);
   if(accessMode&&url.pathname==='/api/auth/exchange')fail(403,'LEGACY_AUTH_DISABLED','Entre com seu e-mail corporativo pelo Cloudflare Access.');
   if(accessMode&&url.pathname==='/api/auth/logout'&&request.method==='POST')return response({authenticated:false,approved:false,role:'visitor',status:'anonymous',provider:'cloudflare-access',authProvider:'cloudflare-access',verifiedEmail:null,logoutUrl:'/cdn-cgi/access/logout'},200,{'set-cookie':clearCookie()});
   const access=accessMode?await resolveCloudflareAccess(env.BUCKET,request,accessConfig,verifyAccess):await resolveAccess(env.BUCKET,request,admins,now);shouldClear=!!access.clear;
   if(url.pathname==='/api/session'&&request.method==='GET')return response({...publicSession(access),analysisMode:clientMode?'browser':'server',reportMeta:access.approved?await getReportMetadata(env.BUCKET):null},200,shouldClear?{'set-cookie':clearCookie()}:{});
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
    return response({...publicSession({authenticated:true,approved:true,role:'admin',status:'approved',admin,session:issued.session}),analysisMode:clientMode?'browser':'server',reportMeta:await getReportMetadata(env.BUCKET)},200,{'set-cookie':cookieHeader(issued.token)});
   }
   if(url.pathname==='/api/auth/request'&&request.method==='POST'){
    const body=await readBody(request,4096);
    if(Object.keys(body).some(k=>!['name','email','website'].includes(k)))fail(400,'INVALID_REQUEST','Informe somente seu nome e contato opcional.');
    if(body.website)fail(400,'INVALID_REQUEST','Não foi possível registrar a solicitação.');
     if(accessMode){
      if(!access.identity)fail(401,'ACCESS_IDENTITY_REQUIRED','Entre com seu e-mail corporativo antes de solicitar acesso.');
      if(access.admin||access.member)return response({...publicSession(access),reportMeta:access.approved?await getReportMetadata(env.BUCKET):null});
      const name=safeLabel(body.name,'',120);if(name.length<2)fail(400,'NAME_REQUIRED','Informe seu nome para a administração reconhecer a solicitação.');
      await rateLimit(env.BUCKET,request,'request',now);
      const result=await createVerifiedRequest(env.BUCKET,admins,access.identity,name);
      return response({...publicSession(accessIdentitySession(access.identity,result.member)),reportMeta:null},result.created?201:200);
     }
    if(access.authenticated)return response({...publicSession(access),reportMeta:access.approved?await getReportMetadata(env.BUCKET):null});
    const name=safeLabel(body.name,'',120);const email=safeLabel(body.email,'',240);
    if(name.length<2)fail(400,'NAME_REQUIRED','Informe seu nome para a administração reconhecer a solicitação.');
    await rateLimit(env.BUCKET,request,'request',now);
    const member=await createRequest(env.BUCKET,admins,name,email);const issued=await issueSession(env.BUCKET,{id:member.id,role:'viewer'},now);
    return response({...publicSession({authenticated:true,approved:false,role:'requester',status:'pending',member,session:issued.session}),reportMeta:null},201,{'set-cookie':cookieHeader(issued.token)});
   }
   if(!access.authenticated)fail(401,'SESSION_REQUIRED','Solicite acesso ou use seu link administrativo para continuar.');
   if(!access.approved)fail(403,access.status==='revoked'?'ACCESS_REVOKED':'ACCESS_PENDING',access.status==='revoked'?'Seu acesso foi revogado. A administração pode rever essa decisão.':'Sua solicitação aguarda aprovação da administração.');
   const modifying=!['GET','HEAD'].includes(request.method);
   const editorMutation=access.role==='editor'&&request.method==='POST'&&(['/api/report','/api/correction-progress','/api/material-inputs'].includes(url.pathname)||(clientMode&&(['/api/client-report/start','/api/client-report/cleanup'].includes(url.pathname)||/^\/api\/client-report\/[a-f0-9-]{36}\/(parts|commit)$/i.test(url.pathname))));
   const reviewerMutation=access.role==='reviewer'&&request.method==='POST'&&url.pathname==='/api/correction-progress';
   if(modifying&&access.role!=='admin'&&!editorMutation&&!reviewerMutation)fail(403,'ADMIN_REQUIRED','Você não tem permissão para esta alteração. Apenas a administração pode gerenciar os acessos.');
   if(clientMode){const handled=await clientReports.handle({request,url,bucket:env.BUCKET,access});if(handled)return handled;}
   if(url.pathname==='/api/migration/export'){
    if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Somente a administração pode baixar o backup privado.');
    if(request.method!=='GET')fail(405,'METHOD_NOT_ALLOWED','Use o download do backup privado.');
    if(!migrationSource)fail(503,'MIGRATION_SOURCE_UNAVAILABLE','O código de restauração ainda não está disponível nesta versão.');
    const {files}=await buildMigrationFiles({bucket:env.BUCKET,admins,source:migrationSource,now});
    await confirmMutationPermission(env.BUCKET,access,['admin']);
    return migrationZipResponse(files);
   }
   if(url.pathname==='/api/report/meta'&&request.method==='GET'){
    const [metadata,progress]=await Promise.all([reportMeta(env.BUCKET),readCorrectionProgressMetadata(env.BUCKET)]);
    return response({reportMeta:metadata,correctionProgressRevision:correctionProgressRevision(progress),agingDate:engine.today()});
   }
   if(url.pathname==='/api/correction-progress'&&request.method==='POST')return response(await saveCorrectionProgress(env.BUCKET,access,await readBody(request,16384),url,engine));
   if(url.pathname==='/api/material-inputs'&&request.method==='GET')return response(materialDocument((await jsonObject(env.BUCKET,MATERIAL_INPUTS_KEY)).value));
   if(url.pathname==='/api/material-inputs'&&request.method==='POST')return response(await saveMaterialInputs(env.BUCKET,access,await readBody(request,65536)));
   if(url.pathname==='/api/report'&&request.method==='GET'){
    const reportView=url.searchParams.get('view')??'full';
    if(!['full','suppliers'].includes(reportView)||url.searchParams.getAll('view').length>1)fail(400,'INVALID_REPORT_VIEW','Selecione uma visão válida do relatório.');
    const{value:saved}=await jsonObject(env.BUCKET,REPORT_KEY);if(!saved)return response({model:null,files:null,updatedAt:null,updatedBy:null,revision:null});
    if(saved.schemaVersion!==1||!Array.isArray(saved.bd)||!Array.isArray(saved.control))fail(503,'REPORT_INVALID','O relatório publicado precisa ser conferido pelas administradoras.');
    const opts=analysisOptions(url,saved,engine);if(reportView==='suppliers')opts.reportView='suppliers';
    let model;try{model=engine.analyze(saved.bd,saved.control,opts);}catch{fail(503,'REPORT_ANALYSIS_FAILED','Não foi possível processar o relatório publicado.');}
    return response({...snapshotMetadata(saved),model:redactModel(await hydrateCorrectionProgress(env.BUCKET,model,engine,saved.bd,saved.control))},200,{'etag':`"${saved.revision}"`});
   }
   if(url.pathname==='/api/report'&&request.method==='POST'){
    const body=await readBody(request);
    if(body.demo===true||body.isDemo===true)fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
    const budget={count:0};validateRows(body.bd,'BD',budget);validateRows(body.control,'Controle Recebimento',budget);
    const files={bd:filename(body.files?.bd,'BD.xlsx'),control:filename(body.files?.control,'Controle de Recebimento.xlsx')};
    if(/demonstra[cç][aã]o|fict[ií]ci/i.test(files.bd+' '+files.control))fail(400,'DEMO_NOT_PUBLISHABLE','Dados de demonstração não podem ser publicados para a equipe.');
    const asOf=body.asOf||engine.today();if(typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!engine.parseDate(asOf))fail(400,'INVALID_DATE','Informe a data da análise para a publicação.');
    let model;try{engine.validateHeaders(body.bd,'BD');engine.validateHeaders(body.control,'Controle Recebimento');model=engine.analyze(body.bd,body.control,{years:[Number(engine.today().slice(0,4))],asOf,correctionScenario:'corrected',lossFormula:'subtract-negotiating'});}catch(err){fail(400,'INVALID_REPORT',err.message||'As planilhas não têm o formato esperado.');}
    const{value:previous,etag}=await jsonObject(env.BUCKET,REPORT_KEY);const expected=request.headers.get('if-match');
    if(expected&&cleanRevision(expected)!==(previous?.revision||'none'))fail(409,'REPORT_CHANGED','Outra atualização já foi publicada. Carregue a versão atual antes de publicar novamente.');
    const actor=access.admin||access.member;
    const saved={schemaVersion:1,revision:uuid(),updatedAt:stamp(),updatedBy:actor.name,updatedByUserId:actor.id,files,asOf,bd:body.bd,control:body.control};
    const metadata={revision:saved.revision,updatedAt:saved.updatedAt,updatedBy:saved.updatedBy,updatedByUserId:saved.updatedByUserId,bdName:files.bd,controlName:files.control,asOf};
    await confirmMutationPermission(env.BUCKET,access);
    if(!await putConditional(env.BUCKET,REPORT_KEY,saved,etag,metadata))fail(409,'REPORT_CHANGED','Outra atualização foi publicada ao mesmo tempo. Carregue a versão atual antes de tentar novamente.');
    return response({...snapshotMetadata(saved),model:redactModel(await hydrateCorrectionProgress(env.BUCKET,model,engine,saved.bd,saved.control))},200,{'etag':`"${saved.revision}"`});
   }
   if(url.pathname==='/api/members'&&request.method==='GET'){
    if(access.role!=='admin')fail(403,'ADMIN_REQUIRED','Apenas as administradoras podem consultar os acessos.');
    const{value:acl}=await ensureAcl(env.BUCKET,admins);
    requireCurrentRole(acl,access,['admin']);
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
  }catch(err){const extra=shouldClear?{'set-cookie':clearCookie()}:{};if(err instanceof ApiError||err instanceof CorrectionProgressError||err instanceof MigrationExportError||err instanceof CloudflareAccessError)return response({error:err.message,code:err.code},err.status,extra);return response({error:'Não foi possível concluir a operação. Tente novamente.',code:'SERVER_ERROR'},500,extra);}
 };
}
export const apiConstants=Object.freeze({adminIds:ADMIN_IDS,cookieName:COOKIE,sessionDays:SESSION_DAYS,maxBodyBytes:MAX_BODY});
