import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inflateRawSync} from 'node:zlib';
import {buildMigrationSource} from '../migration/source-archive.mjs';

const required=['.gitignore','.openai/hosting.json','README.md','build.mjs','migration/restore-data.mjs','migration/RESTAURACAO.txt','migration/source-archive.mjs','worker/migration.js','worker/zip.js','worker/correction-progress.js'];
const materials=['dist/materials.css','dist/materials.js','dist/materials-data.js'];
const excluded=['dist/private/snapshot.json','dist/Private/snapshot.json','tests/dados/snapshot.json','dist/material-inputs-v1.json','tests/Material-Inputs-v1.json','dist/report-latest-v1.json','tests/access-v3.json','dist/correction-progress-v1.json','work/private/state.json','dist/.env','dist/source.xlsx'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'claims-source-inventory-'));
 t.after(()=>{const relative=path.relative(os.tmpdir(),directory);assert(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));fs.rmSync(directory,{recursive:true,force:true});});
 const write=(file,value)=>{const target=path.join(directory,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,value);};
 for(const file of [...required,...materials,...excluded])write(file,excluded.includes(file)?'PRIVATE-SNAPSHOT-MARKER':file==='.openai/hosting.json'?JSON.stringify({project_id:'PRIVATE-PROJECT-ID',name:'Synthetic source'}):'Synthetic source '+file);
 const inventory=files=>write('migration/SOURCE.json',JSON.stringify({schemaVersion:1,commitSha:'a'.repeat(40),files}));inventory([...required,...materials,...excluded]);
 return {directory,inventory};
}
function unzip(source){
 const bytes=Buffer.from(source.base64,'base64'),files=new Map();let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){const method=bytes.readUInt16LE(offset+8),length=bytes.readUInt32LE(offset+18),nameLength=bytes.readUInt16LE(offset+26),extraLength=bytes.readUInt16LE(offset+28),start=offset+30+nameLength+extraLength,name=bytes.subarray(offset+30,offset+30+nameLength).toString('utf8'),payload=bytes.subarray(start,start+length);assert([0,8].includes(method));files.set(name,method===8?inflateRawSync(payload):payload);offset=start+length;}
 assert.equal(bytes.readUInt32LE(offset),0x02014b50);assert.equal(hash(bytes),source.sha256);assert.equal(files.size,source.fileCount);return files;
}
test('migration source includes each Materials asset but never operational snapshots or their private directories',async t=>{
 const f=fixture(t),source=await buildMigrationSource(f.directory),files=unzip(source);
 for(const file of materials)assert.equal(files.get(file).toString(),'Synthetic source '+file);
 for(const file of excluded)assert.equal(files.has(file),false,file);
 assert.doesNotMatch([...files.values()].map(bytes=>bytes.toString()).join('\n'),/PRIVATE-SNAPSHOT-MARKER|PRIVATE-PROJECT-ID/);
 const provenance=JSON.parse(files.get('migration/SOURCE.json'));assert(materials.every(file=>provenance.files.includes(file)));assert(excluded.every(file=>!provenance.files.includes(file)));assert.equal(provenance.commitSha,null,'Unverified source inventories do not claim a Git commit');
 for(const file of provenance.files)assert.equal(provenance.fileHashes[file],hash(files.get(file)),file);
});
test('migration source cannot silently omit an untracked Materials dependency',async t=>{
 const f=fixture(t);for(const missing of materials){f.inventory([...required,...materials.filter(file=>file!==missing)]);await assert.rejects(buildMigrationSource(f.directory),error=>error.message.includes('Required source must be tracked')&&error.message.includes(missing));}
});
