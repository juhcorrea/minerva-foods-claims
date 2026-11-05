// ZIP32, UTF-8 filenames, stored entries. Streaming keeps report payloads out of
// a second contiguous buffer. No libraries, filesystem or storage side effects.
const migrationZipEncoder = new TextEncoder();
const migrationCrcTable = Uint32Array.from({length:256}, (_, n) => {
  for (let i=0;i<8;i++) n = (n & 1) ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function migrationCrc32(bytes) {
  let crc=0xffffffff;
  for (const byte of bytes) crc=migrationCrcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export function migrationZipChunks(files) {
  if (!Array.isArray(files) || files.length > 65535) throw new Error('Invalid ZIP entry count');
  const chunks=[], central=[], names=new Set();
  let offset=0, centralSize=0;
  for (const file of files) {
    if (typeof file.name !== 'string' || /(^\/|\\|\x00)/.test(file.name) || file.name.split('/').some(p=>!p||p==='.'||p==='..') || names.has(file.name)) throw new Error('Invalid ZIP entry path');
    names.add(file.name);
    const name=migrationZipEncoder.encode(file.name);
    const raw=typeof file.data==='string'?migrationZipEncoder.encode(file.data):file.data;
    if (!(raw instanceof Uint8Array)) throw new Error('Invalid ZIP data');
    const bytes=file.deflated instanceof Uint8Array?file.deflated:raw;
    const method=bytes===raw?0:8;
    if (name.length>65535 || raw.length>0xffffffff || offset+bytes.length>0xffffffff) throw new Error('ZIP32 limit exceeded');
    const crc=migrationCrc32(raw), local=new Uint8Array(30+name.length), lv=new DataView(local.buffer);
    lv.setUint32(0,0x04034b50,true); lv.setUint16(4,20,true); lv.setUint16(6,0x800,true); lv.setUint16(8,method,true);
    lv.setUint16(12,33,true); // 1980-01-01, deterministic archive metadata.
    lv.setUint32(14,crc,true); lv.setUint32(18,bytes.length,true); lv.setUint32(22,raw.length,true); lv.setUint16(26,name.length,true); local.set(name,30);
    chunks.push(local,bytes);
    const directory=new Uint8Array(46+name.length), dv=new DataView(directory.buffer);
    dv.setUint32(0,0x02014b50,true); dv.setUint16(4,20,true); dv.setUint16(6,20,true); dv.setUint16(8,0x800,true); dv.setUint16(10,method,true); dv.setUint16(14,33,true);
    dv.setUint32(16,crc,true); dv.setUint32(20,bytes.length,true); dv.setUint32(24,raw.length,true); dv.setUint16(28,name.length,true); dv.setUint32(42,offset,true); directory.set(name,46);
    central.push(directory); centralSize+=directory.length; offset+=local.length+bytes.length;
  }
  if(offset+centralSize>0xffffffff)throw new Error('ZIP32 limit exceeded');
  const end=new Uint8Array(22), ev=new DataView(end.buffer);
  ev.setUint32(0,0x06054b50,true); ev.setUint16(8,files.length,true); ev.setUint16(10,files.length,true); ev.setUint32(12,centralSize,true); ev.setUint32(16,offset,true);
  return [...chunks,...central,end];
}
export function migrationZipResponse(files) {
  const chunks=migrationZipChunks(files);
  let index=0;
  return new Response(new ReadableStream({pull(controller){
    if(index<chunks.length)controller.enqueue(chunks[index++]);
    else controller.close();
  }}),{headers:{
    'Content-Type':'application/zip',
    'Content-Disposition':'attachment; filename="Minerva-Claims-Migracao-Privada.zip"',
    'Content-Length':String(chunks.reduce((total,bytes)=>total+bytes.length,0)),
    'Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff',
  }});
}
