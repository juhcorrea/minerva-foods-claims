// Bounded garbage collection for browser-analysis uploads. Every batch checks
// the stage again; the cursor controls traversal, never deletion authorization.
const cleanupStagePrefix = 'private/client-staging/';
const cleanupIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const cleanupGraceMs = 2 * 3600000;
const cleanupBatchSize = 12;
const cleanupEncoder = new TextEncoder();
const cleanupDecoder = new TextDecoder();

function cleanupCursor(state) {
  if (!state.pendingId && !state.listCursor) return null;
  const bytes = cleanupEncoder.encode(JSON.stringify({v:1,listCursor:state.listCursor || null,pendingId:state.pendingId || null}));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function cleanupState(cursor) {
  if (cursor == null) return {listCursor:null,pendingId:null};
  try {
    if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const bytes = Uint8Array.from(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const value = JSON.parse(cleanupDecoder.decode(bytes));
    if (value.v !== 1 || Object.keys(value).some(key=>!['v','listCursor','pendingId'].includes(key))) throw new Error();
    if (value.listCursor !== null && (typeof value.listCursor !== 'string' || !value.listCursor || value.listCursor.length > 4096)) throw new Error();
    if (value.pendingId !== null && (typeof value.pendingId !== 'string' || !cleanupIdPattern.test(value.pendingId))) throw new Error();
    return value;
  } catch {throw new TypeError('Invalid cleanup cursor');}
}

function cleanupResult(state, deleted = 0, skipped) {
  const cursor = cleanupCursor(state);
  return {deleted,hasMore:cursor !== null,cursor,...(skipped ? {skipped} : {})};
}

function cleanupNextCursor(page) {
  if (!page || !Array.isArray(page.objects) || typeof page.truncated !== 'boolean') throw new Error('Invalid cleanup listing');
  if (!page.truncated) return null;
  if (typeof page.cursor !== 'string' || !page.cursor || page.cursor.length > 4096) throw new Error('Invalid cleanup listing cursor');
  return page.cursor;
}

export async function cleanup(bucket, currentRevision, {now = () => Date.now(), cursor = null} = {}) {
  if (!bucket || ['get','list','delete'].some(method=>typeof bucket[method] !== 'function')) throw new TypeError('Cleanup storage is unavailable');
  if (typeof currentRevision !== 'string' || !cleanupIdPattern.test(currentRevision)) return cleanupResult({},0,'no-current-revision');
  const at = typeof now === 'function' ? now() : now;
  if (!Number.isFinite(at)) throw new TypeError('Invalid cleanup time');
  const state = cleanupState(cursor);
  let id = state.pendingId;
  if (!id) {
    const page = await bucket.list({prefix:cleanupStagePrefix,limit:1,...(state.listCursor ? {cursor:state.listCursor} : {})});
    state.listCursor = cleanupNextCursor(page);
    if (!page.objects.length) return cleanupResult(state);
    const key = page.objects[0].key;
    if (typeof key !== 'string' || !key.startsWith(cleanupStagePrefix) || !key.endsWith('.json')) return cleanupResult(state,0,'unknown-stage');
    id = key.slice(cleanupStagePrefix.length,-5);
    if (!cleanupIdPattern.test(id)) return cleanupResult(state,0,'unknown-stage');
  }
  const next = {listCursor:state.listCursor,pendingId:null};
  if (id === currentRevision) return cleanupResult(next,0,'current-publication');
  const stageKey = cleanupStagePrefix + id + '.json', object = await bucket.get(stageKey);
  if (!object) return cleanupResult(next,0,'missing-stage');
  const stage = await object.json();
  const expiresAt = typeof stage?.expiresAt === 'string' ? Date.parse(stage.expiresAt) : NaN;
  if (stage?.schemaVersion !== 2 || stage.id !== id || !Number.isFinite(expiresAt)) return cleanupResult(next,0,'invalid-stage');
  // Publishing also rejects expired stages. The extra two-hour grace protects
  // old in-flight reads, while a live publication is retained regardless of age.
  if (expiresAt > at - cleanupGraceMs) return cleanupResult(next,0,'retained-stage');
  const prefix = 'private/client-reports/' + id + '/';
  const parts = await bucket.list({prefix,limit:cleanupBatchSize});
  cleanupNextCursor(parts);
  if (parts.objects.length > cleanupBatchSize || parts.objects.some(part=>typeof part.key !== 'string' || !part.key.startsWith(prefix) || !/^(?:(bd|control)\/(0|[1-9]\d*)\.(original|projected|projected-v3)|projection-3-upgrade)\.json$/.test(part.key.slice(prefix.length)))) return cleanupResult(next,0,'unknown-part');
  let deleted = 0;
  for (const part of parts.objects) {await bucket.delete(part.key);deleted++;}
  if (!parts.truncated && deleted < cleanupBatchSize) {
    await bucket.delete(stageKey);
    return cleanupResult(next,deleted + 1);
  }
  // Restart the same exact prefix next time. This remains safe if another
  // collector deleted some of these objects between the two requests.
  return cleanupResult({listCursor:state.listCursor,pendingId:id},deleted);
}
