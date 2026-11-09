import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Adapt the retained build layout to the Sites portable packager.
// This copies compiled code and hosting metadata only, never private data.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const relative of ['server/index.js','.openai/hosting.json']){
 const source=path.join(root,'build',relative),destination=path.join(root,'dist',relative);
 if(!fs.statSync(source).isFile())throw new Error('Missing compiled artifact');
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 fs.copyFileSync(source,destination);
}
console.log(JSON.stringify({entry:'dist/server/index.js',privateDataIncluded:false}));
