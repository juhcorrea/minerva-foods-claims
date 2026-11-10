import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {deflateRawSync} from 'node:zlib';
import {migrationZipChunks} from '../worker/zip.js';

// Only operational source directories. Never traverse work/private/.git,
// environment files, deployment output or customer exports.
const git=promisify(execFile);
const roots=['dist','worker','tests','migration','scripts'];
const topFiles=['.gitignore','.openai/hosting.json','README.md','build.mjs'];
const extensions=new Set(['.js','.mjs','.cjs','.css','.html','.md','.txt','.json','.sql','.webmanifest','.png','.woff2','.svg','.webp','.cs','.csproj']);
export async function buildMigrationSource(root) {
  let commitSha=null, tracked, priorHashes=null;
  if(fs.existsSync(path.join(root,'.git'))){
    const status=(await git('git',['status','--porcelain','--untracked-files=normal'],{cwd:root,encoding:'utf8'})).stdout.trim();
    if(!status)commitSha=(await git('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'})).stdout.trim();
    tracked=(await git('git',['ls-files','-z'],{cwd:root,encoding:'utf8'})).stdout.split('\0').filter(Boolean);
  }else{
    const provenance=path.join(root,'migration/SOURCE.json');
    if(!fs.existsSync(provenance))throw new Error('Source archive requires a Git checkout or migration/SOURCE.json.');
    const previous=JSON.parse(fs.readFileSync(provenance,'utf8'));
    commitSha=previous.commitSha||null;tracked=previous.files;priorHashes=previous.fileHashes;
    if(!Array.isArray(tracked)||tracked.some(name=>typeof name!=='string'))throw new Error('Invalid source inventory.');
  }
  const paths=tracked.filter(name=>topFiles.includes(name)||(
    roots.includes(name.split('/')[0])&&extensions.has(path.extname(name))&&
    name.split('/').every(part=>part&&!part.startsWith('.')&&!['bin','obj','server','node_modules','SOURCE.json'].includes(part))
  )).sort();
  for(const required of [...topFiles,'migration/restore-data.mjs','migration/RESTAURACAO.txt','migration/source-archive.mjs','worker/migration.js','worker/zip.js','worker/correction-progress.js'])if(!paths.includes(required))throw new Error('Required source must be tracked before building: '+required);
  const fileHashes={};
  const files=paths.map(name=>{
    const absolute=path.join(root,name);
    let cursor=root;for(const part of name.split('/')){cursor=path.join(cursor,part);if(fs.lstatSync(cursor).isSymbolicLink())throw new Error('Symlink not allowed: '+name);}
    let data=fs.readFileSync(absolute);
    if(name==='.openai/hosting.json'){
      const config=JSON.parse(data);delete config.project_id;
      data=Buffer.from(JSON.stringify(config,null,2)+'\n');
    }
    fileHashes[name]=createHash('sha256').update(data).digest('hex');
    if(priorHashes&&fileHashes[name]!==priorHashes[name])commitSha=null;
    return {name,data,deflated:deflateRawSync(data,{level:9})};
  });
  if(!fs.existsSync(path.join(root,'.git'))&&!priorHashes)commitSha=null;
  const data=Buffer.from(JSON.stringify({schemaVersion:1,commitSha,files:paths,fileHashes,credentialPolicy:'Configure new credentials in the destination; no environment values or sessions included.'},null,2)+'\n');
  files.push({name:'migration/SOURCE.json',data,deflated:deflateRawSync(data,{level:9})});
  const archive=Buffer.concat(migrationZipChunks(files));
  return {base64:archive.toString('base64'),commitSha,sha256:createHash('sha256').update(archive).digest('hex'),fileCount:files.length,restorationInstructions:fs.readFileSync(path.join(root,'migration/RESTAURACAO.txt'),'utf8')};
}
