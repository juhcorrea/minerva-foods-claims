/* Private migration snapshot. This module only reads the three operational
 * objects below; it deliberately never enumerates the bucket or writes data. */
const MIGRATION_OBJECTS = Object.freeze([
  {key:'private/report-latest-v1.json', path:'dados/bases-publicadas.json', schemaVersion:1},
  {key:'private/correction-progress-v1.json', path:'dados/acompanhamento-correcoes.json', schemaVersion:1},
  {key:'private/access-v3.json', path:'dados/cadastros-perfis.json', schemaVersion:3},
]);
const migrationEncoder = new TextEncoder();

export class MigrationExportError extends Error {
  constructor(status, code, message) {super(message); this.name='MigrationExportError'; this.status=status; this.code=code;}
}
const migrationFail = (status, code, message) => {throw new MigrationExportError(status, code, message);};
const migrationInvalid = () => migrationFail(503, 'MIGRATION_INVALID_STORAGE', 'Não foi possível conferir os dados publicados para gerar o backup. A administração precisa verificar o armazenamento.');
const migrationRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const migrationScalar = value => value === null || ['string','boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value));

function migrationPick(record, fields) {
  if (!migrationRecord(record)) migrationInvalid();
  const selected = Object.create(null);
  for (const field of fields) if (Object.hasOwn(record, field)) {
    if (!migrationScalar(record[field])) migrationInvalid();
    selected[field] = record[field];
  }
  return selected;
}

function migrationRows(value) {
  if (!Array.isArray(value) || value.some(row => !Array.isArray(row) || row.some(cell => !migrationScalar(cell)))) migrationInvalid();
  return value;
}

function migrationReport(value) {
  if (!migrationRecord(value) || value.schemaVersion !== 1 || typeof value.revision !== 'string') migrationInvalid();
  const report = migrationPick(value, ['schemaVersion','revision','updatedAt','updatedBy','updatedByUserId','asOf']);
  report.files = migrationPick(value.files, ['bd','control']);
  report.bd = migrationRows(value.bd);
  report.control = migrationRows(value.control);
  return report;
}

function migrationProgress(value) {
  if (!migrationRecord(value) || value.schemaVersion !== 1 || !migrationRecord(value.entries)) migrationInvalid();
  const entries = Object.create(null);
  for (const [key, record] of Object.entries(value.entries)) {
    if (!/^[a-f0-9]{64}$/.test(key) || !migrationRecord(record) || typeof record.done !== 'boolean') migrationInvalid();
    // SHA-256 keys identify corrections. They are data, not authentication hashes.
    entries[key] = migrationPick(record, ['done','updatedAt','updatedBy','updatedByUserId','reportRevision']);
  }
  return {schemaVersion:1, entries};
}

function migrationAcl(value, admins) {
  if (!migrationRecord(value) || value.schemaVersion !== 3 || typeof value.revision !== 'string' || !migrationRecord(value.admins) || !migrationRecord(value.members) || (value.audit !== undefined && !Array.isArray(value.audit))) migrationInvalid();
  const acl = migrationPick(value, ['schemaVersion','revision','updatedAt']);
  acl.admins = Object.create(null);
  for (const [key, record] of Object.entries(value.admins)) acl.admins[key] = migrationPick(record, ['id','name','email','activatedAt']);
  // Configuration is the effective administrator directory. Copy labels only,
  // never credentials, activation hashes, URLs, or any unknown configuration.
  for (const admin of admins || []) {
    const profile = migrationPick(admin, ['id','name','email']);
    if (typeof profile.id !== 'string') migrationInvalid();
    acl.admins[profile.id] = {...acl.admins[profile.id], ...profile};
  }
  acl.members = Object.create(null);
  for (const [key, record] of Object.entries(value.members)) {
    acl.members[key] = migrationPick(record, ['id','name','email','status','role','requestCode','requestedAt','approvedAt','approvedBy','approvedById','revokedAt','revokedBy','updatedAt']);
    if(record.identity!==undefined){
      const identity=migrationPick(record.identity,['provider','issuer','subject','email']);
      if(identity.provider!=='cloudflare-access'||typeof identity.issuer!=='string'||!/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.cloudflareaccess\.com$/.test(identity.issuer)||typeof identity.subject!=='string'||!identity.subject.trim()||typeof identity.email!=='string'||!identity.email.includes('@')||record.emailVerified!==true)migrationInvalid();
      acl.members[key].identity=identity;acl.members[key].emailVerified=true;
    }
  }
  acl.audit = (value.audit || []).map(record => migrationPick(record, ['at','actorId','actorName','action','target','previousStatus','previousRole','role']));
  return acl;
}

async function migrationRead(bucket, item) {
  const object = await bucket.get(item.key);
  if (!object) return {...item, present:false, etag:null, value:null};
  if (typeof object.etag !== 'string' || !object.etag) migrationInvalid();
  let value;
  try {value = await object.json();} catch {migrationInvalid();}
  return {...item, present:true, etag:object.etag, value};
}

async function migrationEtag(bucket, key) {
  const object = await (typeof bucket.head === 'function' ? bucket.head(key) : bucket.get(key));
  if (object && (typeof object.etag !== 'string' || !object.etag)) migrationInvalid();
  return object ? object.etag : null;
}

async function migrationConsistentSnapshot(bucket) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const objects = await Promise.all(MIGRATION_OBJECTS.map(item => migrationRead(bucket, item)));
    // All initial reads finish before all verification reads begin. Stable
    // ETags establish one shared interval for these three object versions.
    const verified = await Promise.all(objects.map(item => migrationEtag(bucket, item.key)));
    if (objects.every((item,index) => item.etag === verified[index])) return objects;
  }
  migrationFail(409, 'MIGRATION_CHANGED', 'O painel foi atualizado durante a geração do backup. Tente baixar novamente.');
}

async function migrationDigest(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
const migrationJson = value => migrationEncoder.encode(JSON.stringify(value) + '\n');

export async function buildMigrationFiles({bucket, admins = [], source, now = () => Date.now()}) {
  // Production lazily decodes the embedded archive. Read that getter once so
  // simultaneous backups do not allocate several copies of the source ZIP.
  const sourceData = source?.data;
  if (!source || !(sourceData instanceof Uint8Array) || !sourceData.byteLength || !/^[a-f0-9]{40}$/.test(source.commitSha || '') || !Number.isInteger(source.fileCount) || source.fileCount < 1 || typeof source.restorationInstructions !== 'string' || !source.restorationInstructions.trim()) {
    migrationFail(503, 'MIGRATION_SOURCE_UNAVAILABLE', 'O pacote do código ainda não está disponível nesta publicação.');
  }
  const sourceHash = await migrationDigest(sourceData);
  if (source.sha256 !== sourceHash) migrationFail(503, 'MIGRATION_SOURCE_UNAVAILABLE', 'O pacote do código precisa ser conferido antes do backup.');
  const snapshot = await migrationConsistentSnapshot(bucket);
  const sanitized = snapshot.map((item,index) => item.present ? [migrationReport,migrationProgress,value => migrationAcl(value,admins)][index](item.value) : null);
  const files = snapshot.map((item,index) => ({name:item.path, data:migrationJson(sanitized[index])}));
  files.push({name:'codigo-operacional.zip', data:sourceData});
  files.push({name:'RESTAURACAO.txt', data:migrationEncoder.encode(source.restorationInstructions)});
  const [report,progress,acl] = sanitized;
  const manifest = {
    schemaVersion:1,
    kind:'minerva-claims-private-migration',
    capturedAt:new Date(now()).toISOString(),
    source:{commitSha:source.commitSha, sha256:sourceHash, fileCount:source.fileCount},
    objects:snapshot.map((item,index) => ({key:item.key, path:item.path, present:item.present, etag:item.etag, schemaVersion:item.present?sanitized[index].schemaVersion:null, revision:item.present?sanitized[index].revision||null:null})),
    counts:{bdRows:report?Math.max(0,report.bd.length-1):0, controlRows:report?Math.max(0,report.control.length-1):0, correctionEntries:Object.keys(progress?.entries || {}).length, admins:Object.keys(acl?.admins || {}).length, members:Object.keys(acl?.members || {}).length, auditEvents:acl?.audit?.length || 0},
    files:await Promise.all(files.map(async file => ({path:file.name, bytes:file.data.byteLength, sha256:await migrationDigest(file.data)}))),
  };
  files.push({name:'MANIFESTO.json', data:migrationEncoder.encode(JSON.stringify(manifest,null,2)+'\n')});
  return {files,manifest};
}
