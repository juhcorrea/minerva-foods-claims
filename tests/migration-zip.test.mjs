import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {deflateRawSync} from 'node:zlib';
import {migrationZipChunks,migrationZipResponse} from '../worker/zip.js';

test('a standard independent ZIP reader accepts binary, UTF-8 and compressed source entries',async()=>{
 const binary=Uint8Array.from({length:4096},(_,i)=>i%256);
 const files=[{name:'dados/correções.json',data:'{"done":true,"name":"Conferência"}'},{name:'empty.txt',data:''},{name:'codigo.bin',data:binary,deflated:deflateRawSync(binary)}];
 const dir=mkdtempSync(path.join(tmpdir(),'claims-zip-'));
 try{
  const archive=path.join(dir,'archive.zip');writeFileSync(archive,Buffer.concat(migrationZipChunks(files)));
  const decoded=JSON.parse((await promisify(execFile)('python3',['-c','import zipfile,json,sys; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({"names":z.namelist(),"text":z.read("dados/correções.json").decode(),"binary":list(z.read("codigo.bin")),"empty":len(z.read("empty.txt"))}))',archive],{encoding:'utf8'})).stdout);
  assert.deepEqual(decoded.names,files.map(f=>f.name));assert.equal(decoded.text,files[0].data);assert.deepEqual(decoded.binary,Array.from(binary));assert.equal(decoded.empty,0);
  const response=migrationZipResponse(files);assert.equal(response.headers.get('Content-Type'),'application/zip');assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal((await response.arrayBuffer()).byteLength,Number(response.headers.get('Content-Length')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('ZIP writer rejects traversal and duplicate entry paths',()=>{
 for(const name of ['../secret','/secret','a/../secret','a\\secret','a//b'])assert.throws(()=>migrationZipChunks([{name,data:''}]));
 assert.throws(()=>migrationZipChunks([{name:'file',data:''},{name:'file',data:''}]));
});
