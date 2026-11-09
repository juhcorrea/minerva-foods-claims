'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createReportCache,reportQuery}=require('../dist/team.js');
const source=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const code=source.slice(source.indexOf('  async function loadReport(options)'),source.indexOf('  async function publishReport'));
const opts={years:[2026],asOf:'2026-11-09'};
const payload=(revision='r1',progress='p1',day='2026-11-09')=>({revision,model:{meta:{correctionProgressRevision:progress},procurementReport:{meta:{agingDate:day}}}});
const metadata=(revision='r1',progress='p1',day='2026-11-09')=>({reportMeta:{revision},correctionProgressRevision:progress,agingDate:day});
function harness(){
 const requests=[],applied=[],messages=[];let fresh=payload(),meta=metadata(),failMeta=false,pauseMeta=null;
 const context={reportCache:createReportCache(),reportQuery,session:{approved:true},reportController:null,loadVersion:0,loadingReport:false,publishedMeta:null,AbortController,
  global:{setTimeout:()=>1,clearTimeout(){}},refreshControls(){},showEmptyReport(){},canUpdateBases:()=>true,setMessage:(...args)=>messages.push(args),
  app:{getOptions:()=>opts,setPublishedReport:value=>{applied.push(value);return true;}},
  api:async(url)=>{requests.push(url);if(url==='/api/report/meta'){if(failMeta)throw Object.assign(Error('Sem acesso'),{status:403});if(pauseMeta)return pauseMeta;return meta;}return fresh;}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,requests,applied,messages,load:(options=opts)=>context.loadReport(options),setFresh:value=>fresh=value,setMeta:value=>meta=value,deny:()=>failMeta=true,pause:value=>pauseMeta=value};
}
test('returning to a visited scope checks only metadata and reuses the matching model',async()=>{
 const h=harness();await h.load();await h.load({...opts,allYears:true});await h.load();
 assert.equal(h.requests.length,3);assert.equal(h.requests[2],'/api/report/meta');assert.equal(h.applied[2],h.applied[0]);
});
for(const [label,changed] of [['published bases',metadata('r2')],['manual correction progress',metadata('r1','p2')],['daily claim aging',metadata('r1','p1','2026-11-10')]])test('cache invalidates after '+label,async()=>{
 const h=harness();await h.load();h.setMeta(changed);const next=payload(changed.reportMeta.revision,changed.correctionProgressRevision,changed.agingDate);h.setFresh(next);await h.load();
 assert.equal(h.requests.length,3);assert.equal(h.applied.at(-1),next);
});
test('changed filters do not reuse a differently filtered report',async()=>{
 const h=harness();await h.load();await h.load({...opts,operations:['EXPORTAÇÃO - CTNR']});
 assert.equal(h.requests.length,2);assert(h.requests.every(url=>url.startsWith('/api/report?')));
});
test('metadata access failure never displays the cached report',async()=>{
 const h=harness();await h.load();h.deny();assert.equal(await h.load(),false);assert.equal(h.applied.length,1);assert.equal(h.context.loadingReport,false);assert.equal(h.messages.at(-1)[1],true);
});
test('stale metadata response cannot replace a more recent navigation',async()=>{
 const h=harness();await h.load();let resolve;h.pause(new Promise(done=>resolve=done));const older=h.load();await Promise.resolve();
 const newer=payload('r2');h.setFresh(newer);await h.load({...opts,allYears:true});resolve(metadata());await older;
 assert.equal(h.applied.length,2);assert.equal(h.applied.at(-1),newer);
});
for(const kind of ['revoked session','aborted request'])test('a resolved metadata response cannot restore '+kind,async()=>{
 const h=harness();await h.load();let resolve;h.pause(new Promise(done=>resolve=done));const pending=h.load();await Promise.resolve();
 if(kind==='revoked session')h.context.session=null;else h.context.reportController.abort();
 resolve(metadata());assert.equal(await pending,false);assert.equal(h.applied.length,1);
});
test('cache retains only two models, clears old publications and supports explicit refresh/logout clearing',()=>{
 const c=createReportCache();c.put('a',payload());c.put('b',payload());c.put('c',payload());assert.equal(c.get('a'),undefined);
 c.put('d',payload('r2'));assert.equal(c.get('b'),undefined);assert.equal(c.get('c'),undefined);c.clear();assert.equal(c.get('d'),undefined);
 assert.match(source,/session = null;\s*reportCache.clear\(\)/);assert.match(source,/refresh:\(\) => \{reportCache.clear\(\)/);
});
