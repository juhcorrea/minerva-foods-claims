// The small R2-compatible subset used by the private API. D1 remains private;
// authorization belongs to the API, before it reads any object through this store.
export const D1_OBJECT_MAX_BYTES = 1000000;
const D1_METADATA_MAX_BYTES = 16384;
const d1Encoder = new TextEncoder();
const d1Decoder = new TextDecoder();
const D1_HEAD_COLUMNS = 'object_key, etag, metadata, length(body) AS size';

function d1Key(value, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value) || value.includes('\0') || d1Encoder.encode(value).length > 1024) throw new TypeError('Invalid object key');
  return value;
}

function d1MetadataRecord(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError('Invalid object metadata');
  const result = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') throw new TypeError('Object metadata must contain strings');
    result[key] = item;
  }
  return result;
}

function d1Metadata(options) {
  const metadata = JSON.stringify({httpMetadata:d1MetadataRecord(options.httpMetadata), customMetadata:d1MetadataRecord(options.customMetadata)});
  if (d1Encoder.encode(metadata).length > D1_METADATA_MAX_BYTES) throw new RangeError('Object metadata is too large');
  return metadata;
}

function d1Object(row) {
  if (!row) return null;
  const metadata = JSON.parse(row.metadata);
  return {key:row.object_key, etag:row.etag, httpEtag:'"' + row.etag + '"', size:Number(row.size), httpMetadata:metadata.httpMetadata || {}, customMetadata:metadata.customMetadata || {}};
}

function d1ReadBytes(value) {
  // D1 returns BLOBs as number arrays. SQLite fixtures may return Uint8Arrays.
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new TypeError('Invalid stored object body');
}

function d1WriteBytes(value) {
  if (typeof value === 'string') return d1Encoder.encode(value);
  if (value instanceof Uint8Array) return value.slice();
  throw new TypeError('Object body must be a string or Uint8Array');
}

function d1Condition(onlyIf) {
  if (onlyIf === undefined) return {kind:'any'};
  if (!onlyIf || typeof onlyIf !== 'object' || Array.isArray(onlyIf)) throw new TypeError('Invalid object condition');
  const keys = Object.keys(onlyIf);
  if (keys.length === 1 && keys[0] === 'etagMatches' && typeof onlyIf.etagMatches === 'string' && onlyIf.etagMatches) return {kind:'match', etag:onlyIf.etagMatches};
  if (keys.length === 1 && keys[0] === 'etagDoesNotMatch' && onlyIf.etagDoesNotMatch === '*') return {kind:'create'};
  throw new TypeError('Unsupported object condition');
}

function d1PrefixEnd(prefix) {
  const chars = Array.from(prefix);
  for (let index = chars.length - 1; index >= 0; index--) {
    const point = chars[index].codePointAt(0);
    if (point < 0x10ffff) return chars.slice(0,index).join('') + String.fromCodePoint(point + 1);
  }
  return null;
}

function d1Cursor(prefix, after) {
  const bytes = d1Encoder.encode(JSON.stringify({v:1,prefix,after}));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function d1CursorAfter(cursor, prefix) {
  if (cursor === undefined) return '';
  try {
    if (typeof cursor !== 'string' || cursor.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const binary = atob(cursor.replace(/-/g,'+').replace(/_/g,'/'));
    const value = JSON.parse(d1Decoder.decode(Uint8Array.from(binary,c => c.charCodeAt(0))));
    if (value.v !== 1 || value.prefix !== prefix || typeof value.after !== 'string' || !value.after.startsWith(prefix)) throw new Error();
    return d1Key(value.after);
  } catch {throw new TypeError('Invalid object cursor');}
}

export function createD1Bucket(db) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('D1 binding is unavailable');
  return {
    async get(key) {
      d1Key(key);
      const row = await db.prepare('SELECT ' + D1_HEAD_COLUMNS + ', body FROM claims_objects WHERE object_key = ?1').bind(key).first();
      if (!row) return null;
      const value = d1Object(row), bytes = d1ReadBytes(row.body);
      // Response gives the same single-use stream/text/json behavior as R2.
      const response = new Response(bytes);
      return {...value, body:response.body, get bodyUsed(){return response.bodyUsed;}, text:() => response.text(), json:() => response.json(), arrayBuffer:() => response.arrayBuffer()};
    },
    async head(key) {
      d1Key(key);
      return d1Object(await db.prepare('SELECT ' + D1_HEAD_COLUMNS + ' FROM claims_objects WHERE object_key = ?1').bind(key).first());
    },
    async headMany(keys) {
      if (!Array.isArray(keys) || keys.length > 64) throw new TypeError('Invalid metadata key list');
      keys.forEach(key => d1Key(key));
      if (!keys.length) return [];
      const result = await db.prepare('SELECT ' + D1_HEAD_COLUMNS + ' FROM claims_objects WHERE object_key IN (' + keys.map((_,index) => '?' + (index + 1)).join(',') + ')').bind(...keys).all();
      if (!result?.success || !Array.isArray(result.results)) throw new Error('Object metadata could not be read');
      const found = new Map(result.results.map(row => [row.object_key,row]));
      return keys.map(key => d1Object(found.get(key)));
    },
    async put(key, body, options = {}) {
      d1Key(key);
      const condition = d1Condition(options.onlyIf), bytes = d1WriteBytes(body), metadata = d1Metadata(options), etag = crypto.randomUUID();
      if (bytes.byteLength + d1Encoder.encode(key + etag + metadata).length > D1_OBJECT_MAX_BYTES) throw new RangeError('Object exceeds the private storage limit');
      // Every variant is one atomic statement. A failed CAS returns null and
      // cannot insert a missing object or overwrite a newer version.
      let statement;
      if (condition.kind === 'match') {
        statement = db.prepare('UPDATE claims_objects SET body = ?2, etag = ?3, metadata = ?4 WHERE object_key = ?1 AND etag = ?5').bind(key,bytes.buffer,etag,metadata,condition.etag);
      } else if (condition.kind === 'create') {
        statement = db.prepare('INSERT INTO claims_objects (object_key, body, etag, metadata) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(object_key) DO NOTHING').bind(key,bytes.buffer,etag,metadata);
      } else {
        statement = db.prepare('INSERT INTO claims_objects (object_key, body, etag, metadata) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(object_key) DO UPDATE SET body = excluded.body, etag = excluded.etag, metadata = excluded.metadata').bind(key,bytes.buffer,etag,metadata);
      }
      const result = await statement.run();
      if (!result?.success || !Number.isInteger(result.meta?.changes)) throw new Error('Object write could not be confirmed');
      return result.meta.changes === 0 ? null : d1Object({object_key:key,etag,metadata,size:bytes.byteLength});
    },
    async delete(key) {
      d1Key(key);
      const result = await db.prepare('DELETE FROM claims_objects WHERE object_key = ?1').bind(key).run();
      if (!result?.success) throw new Error('Object deletion could not be confirmed');
    },
    async list({prefix = '', cursor, limit = 1000} = {}) {
      d1Key(prefix,true);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new RangeError('Invalid object list limit');
      const after = d1CursorAfter(cursor,prefix), end = d1PrefixEnd(prefix);
      const result = await db.prepare('SELECT ' + D1_HEAD_COLUMNS + ' FROM claims_objects WHERE object_key >= ?1 AND (?2 IS NULL OR object_key < ?2) AND object_key > ?3 ORDER BY object_key LIMIT ?4').bind(prefix,end,after,limit + 1).all();
      if (!result?.success || !Array.isArray(result.results)) throw new Error('Object list could not be read');
      const truncated = result.results.length > limit, rows = result.results.slice(0,limit), objects = rows.map(d1Object);
      return {objects,truncated,delimitedPrefixes:[],...(truncated ? {cursor:d1Cursor(prefix,rows.at(-1).object_key)} : {})};
    }
  };
}
