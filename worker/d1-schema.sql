-- Private storage only. Bind the database as DB; never expose a public SQL API.
-- The API writes bounded chunks and metadata, not a whole analyzed report.
CREATE TABLE IF NOT EXISTS claims_objects (
  object_key TEXT PRIMARY KEY NOT NULL,
  body BLOB NOT NULL CHECK (typeof(body) = 'blob'),
  etag TEXT NOT NULL,
  metadata TEXT NOT NULL,
  CHECK (length(body) + length(CAST(object_key AS BLOB))
    + length(CAST(etag AS BLOB)) + length(CAST(metadata AS BLOB)) <= 1000000)
) WITHOUT ROWID;
