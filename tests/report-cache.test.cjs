'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {createReportCache,reportQuery}=require('../dist/team.js');
const source=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const code=source.slice(source.indexOf('  async function loadReport(options)'),source.indexOf('  async function publishReport'));
const opts={years:[2026],asOf:'2026-11-09'};
const payload=(revision='r1',progress='p1',day='2026-11-09')=>({revision,model:{meta:{correctionProgressRevision:progress},procurementReport:{meta:{agingDate:day}}}});
const metadata=(revision='r1',progress='p1',day='2026-11-09')=>({reportMeta:{revision},correctionProgressRevision:progress,agingDate:day});
const lightPayload=()=>({revision:'r1',model:{meta:{reportView:'suppliers',correctionProgressRevision:'p1',agingDate:'2026-11-09'}}});
function harness(){
 const requests=[],applied=[],messages=[];let fresh=payload(),meta=metadata(),failMeta=false,pauseMeta=null;
 const context={reportCache:createReportCache(),reportQuery,session:{approved:true},reportController:null,loadVersion:0,loadingReport:false,publishedMeta:null,AbortController,
  global:{setTimeout:()=>1,clearTimeout(){}},refreshControls(){},showEmptyReport(){},canUpdateBases:()=>true,setMessage:(...args)=>messages.push(args),
  lockGate(_title,message){context.session=null;context.reportCache.clear();messages.push([message,true]);},
  app:{getOptions:()=>opts,setPublishedReport:value=>{applied.push(value);return true;}},
  api:async(url)=>{requests.push(url);if(url==='/api/report/meta'){if(failMeta)throw Object.assign(Error('Sem acesso'),{status:403});if(pauseMeta)return pauseMeta;return meta;}return fresh;}};
 vm.createContext(context);vm.runInContext(code,context);
 return {context,requests,applied,messages,load:(options=opts)=>context.loadReport(options),setFresh:value=>fresh=value,setMeta:value=>meta=value,deny:()=>failMeta=true,pause:value=>pauseMeta=value};
}

function virtualTimers(h){
 let now=0,serial=0;const timers=new Map();
 h.context.global.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:now+delay});return id;};
 h.context.global.clearTimeout=id=>timers.delete(id);
 return {timers,advance(ms){const end=now+ms;for(;;){const next=[...timers.entries()].filter(([,job])=>job.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}};
}

test('browser initial loading survives slow multipart transfer past 30 seconds and gets a separate calculation deadline',async()=>{
 const h=harness(),clock=virtualTimers(h);h.context.session.analysisMode='browser';let complete,job;
 const visibleStatus={textContent:''};h.context.global.document={getElementById:id=>id==='sidebarLoadLabel'?visibleStatus:null};
 h.context.global.MinervaClientAnalysis={load:(_options,options)=>{job=options;options.onProgress({phase:'manifest'});return new Promise((resolve,reject)=>{complete=resolve;options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'})));});}};
 const result=h.load();job.onProgress({phase:'download',loaded:0,total:231});
 for(let loaded=1;loaded<=231;loaded++){clock.advance(700);job.onProgress({phase:'download',loaded,total:231});}
 assert.equal(job.signal.aborted,false,'161.7 second transfer is allowed, unlike the previous 30 second limit');assert.match(h.messages.at(-1)[0],/231 de 231 partes conferidas/);assert.equal(visibleStatus.textContent,'Carregando 231/231 partes');assert.equal(h.applied.length,0);
 job.onProgress({phase:'analysis'});clock.advance(59000);assert.equal(job.signal.aborted,false,'Calculation receives its own bounded deadline');assert.match(h.messages.at(-1)[0],/Calculando/);assert.equal(visibleStatus.textContent,'Calculando relatório…');
 complete(payload());assert.equal(await result,true);assert.equal(h.applied.length,1);assert.equal(clock.timers.size,0);
});

test('browser progress cannot extend the download or calculation deadlines indefinitely',async()=>{
 for(const phase of ['download','analysis']){
  const h=harness(),clock=virtualTimers(h);h.context.session.analysisMode='browser';let job;
  h.context.global.MinervaClientAnalysis={load:(_options,options)=>{job=options;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'}))));}};
  const result=h.load();if(phase==='analysis')job.onProgress({phase});
  clock.advance(phase==='download'?179000:59000);job.onProgress(phase==='download'?{phase,loaded:230,total:231}:{phase});clock.advance(1000);
  assert.equal(await result,false);assert.equal(job.signal.aborted,true);assert.equal(h.applied.length,0);assert.match(h.messages.at(-1)[0],phase==='download'?/3 minutos/:/1 minuto/);assert.equal(clock.timers.size,0);assert.equal(h.context.loadingReport,false);
 }
});

test('late progress and completion from an aborted browser load cannot replace the latest scope',async()=>{
 const h=harness(),clock=virtualTimers(h),jobs=[];h.context.session.analysisMode='browser';
 h.context.global.MinervaClientAnalysis={load:(_options,options)=>new Promise(resolve=>jobs.push({...options,resolve}))};
 const first=h.load(),second=h.load({...opts,allYears:true});assert.equal(jobs[0].signal.aborted,true);jobs[1].onProgress({phase:'download',loaded:20,total:231});const count=h.messages.length;
 jobs[0].onProgress({phase:'analysis'});assert.equal(h.messages.length,count);jobs[0].resolve(payload('stale'));assert.equal(await first,false);assert.equal(h.applied.length,0);
 jobs[1].resolve(payload('latest'));assert.equal(await second,true);assert.equal(h.applied[0].revision,'latest');assert.equal(clock.timers.size,0);
});
test('returning to a visited scope checks only metadata and reuses the matching model',async()=>{
 const h=harness();await h.load();await h.load({...opts,allYears:true});await h.load();
 assert.equal(h.requests.length,3);assert.equal(h.requests[2],'/api/report/meta');assert.equal(h.applied[2],h.applied[0]);
});

test('supplier request has a distinct cache key and validates lightweight aging',async()=>{
 const h=harness(),lean=lightPayload();h.setFresh(lean);
 assert.notEqual(reportQuery(opts),reportQuery({...opts,reportView:'suppliers'}));
 assert.equal(reportQuery(opts),reportQuery({...opts,reportView:'full'}));
 await h.load({...opts,reportView:'suppliers'});await h.load({...opts,reportView:'suppliers'});
 assert(h.requests[0].endsWith('view=suppliers'));assert.equal(h.requests[1],'/api/report/meta');assert.equal(h.applied[1],lean);
 h.setMeta(metadata('r1','p1','2026-11-10'));await h.load({...opts,reportView:'suppliers'});assert.equal(h.requests.length,4);
});

test('complete model serves supplier comparison after access and revision validation',async()=>{
 const h=harness();await h.load();await h.load({...opts,reportView:'suppliers'});
 assert.equal(h.requests[1],'/api/report/meta');assert.equal(h.applied[1],h.applied[0]);
 assert.equal(h.context.reportCache.get(reportQuery({...opts,reportView:'suppliers'})),undefined);
});

test('upgrading supplier data fetches full report and retains the other cached scope',async()=>{
 const h=harness();await h.load();const initial=h.applied[0],scope={...opts,allYears:true};
 h.setFresh(lightPayload());await h.load({...scope,reportView:'suppliers'});
 const full=payload();h.setFresh(full);await h.load(scope);
 assert.equal(h.requests.length,3);assert(!h.requests[2].includes('view=suppliers'));assert.equal(h.applied[2],full);
 assert.equal(h.context.reportCache.get(reportQuery({...scope,reportView:'suppliers'})),undefined);
 assert.equal(h.context.reportCache.get(reportQuery(scope)),full);
 await h.load();assert.equal(h.requests[3],'/api/report/meta');assert.equal(h.applied[3],initial);
});
for(const [label,changed] of [['published bases',metadata('r2')],['manual correction progress',metadata('r1','p2')],['daily claim aging',metadata('r1','p1','2026-11-10')]])test('cache invalidates after '+label,async()=>{
 const h=harness();await h.load();h.setMeta(changed);const next=payload(changed.reportMeta.revision,changed.correctionProgressRevision,changed.agingDate);h.setFresh(next);await h.load();
 assert.equal(h.requests.length,3);assert.equal(h.applied.at(-1),next);
});
test('changed filters do not reuse a differently filtered report',async()=>{
 const h=harness();await h.load();await h.load({...opts,operations:['EXPORTAÇÃO - CTNR']});
 assert.equal(h.requests.length,2);assert(h.requests.every(url=>url.startsWith('/api/report?')));
});
test('equivalent filter sets share one query and all-years ignores inactive year choices',async()=>{
 const first={...opts,years:[2026,2025,2026],suppliers:['B','A','A'],operations:['Y','X'],controlOperations:['V','U']};
 const second={...opts,years:[2025,2026],suppliers:['A','B'],operations:['X','Y'],controlOperations:['U','V']};
 assert.equal(reportQuery(first),reportQuery(second));
 assert.equal(reportQuery({...first,allYears:true}),reportQuery({...second,years:[2020],allYears:true}));
 const h=harness();await h.load(first);await h.load(second);assert.equal(h.requests[1],'/api/report/meta');assert.equal(h.applied[1],h.applied[0]);
});
test('metadata access failure never displays the cached report',async()=>{
 const h=harness();await h.load();h.deny();assert.equal(await h.load(),false);assert.equal(h.applied.length,1);assert.equal(h.context.loadingReport,false);assert.equal(h.messages.at(-1)[1],true);
});
test('browser mode delegates calculation and still revalidates cached models with the server',async()=>{
 const h=harness(),jobs=[];h.context.session.analysisMode='browser';h.context.global.MinervaClientAnalysis={load:async(options,{api,signal})=>{jobs.push({options,api,signal});return payload();}};
 assert.equal(await h.load(),true);assert.equal(jobs.length,1);assert.equal(jobs[0].api,h.context.api);assert.equal(jobs[0].signal.aborted,false);assert.equal(h.requests.length,0);
 assert.equal(await h.load(),true);assert.deepEqual(h.requests,['/api/report/meta']);assert.equal(jobs.length,1);assert.equal(h.applied[1],h.applied[0]);
 h.setMeta(metadata('r2'));await h.load();assert.equal(jobs.length,2);assert(!h.requests.some(url=>url.startsWith('/api/report?')));
});
test('browser worker access loss locks the gate and does not apply a model',async()=>{
 const h=harness();h.context.session.analysisMode='browser';h.context.global.MinervaClientAnalysis={load:async()=>{throw Object.assign(Error('Acesso encerrado'),{status:403});}};
 assert.equal(await h.load(),false);assert.equal(h.context.session,null);assert.equal(h.applied.length,0);assert.equal(h.context.loadingReport,false);assert.equal(h.messages.at(-1)[1],true);
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
 assert.match(source,/session = null;\s*sessionVersion\+\+;\s*reportCache.clear\(\)/);assert.match(source,/refresh:\(\) => \{reportCache.clear\(\)/);
});

test('projection changes invalidate and replace all models even when report revision and dates stay unchanged',()=>{
 const c=createReportCache(),old={...payload(),projectionVersion:2},fresh={...payload(),projectionVersion:3},current={...metadata(),reportMeta:{revision:'r1',projectionVersion:3}};
 c.put('old',old);assert.equal(c.valid(old,current),false);assert.equal(c.valid(fresh,current),true);assert.equal(c.valid(payload(),current),false);
 c.put('new',fresh);assert.equal(c.get('old'),undefined);assert.equal(c.get('new'),fresh);
});
test('outdated cached metadata delegates to the browser upgrade with current admin authorization and never applies the old model',async()=>{
 const h=harness(),jobs=[],old={...payload(),projectionVersion:2},fresh={...payload(),projectionVersion:3};h.context.session={approved:true,role:'admin',analysisMode:'browser'};
 h.context.reportCache.put(reportQuery(opts),old);
 h.context.api=async url=>{h.requests.push(url);throw Object.assign(Error('Preparar leitura'),{status:409,code:'REPORT_PROJECTION_OUTDATED'});};
 h.context.global.MinervaClientAnalysis={load:async(_opts,job)=>{jobs.push(job);assert.equal(job.canUpgrade(),true);return fresh;}};
 assert.equal(await h.load(),true);assert.deepEqual(h.requests,['/api/report/meta']);assert.equal(h.applied.length,1);assert.equal(h.applied[0],fresh);assert.equal(h.context.reportCache.get(reportQuery(opts)),fresh);
 h.context.session.role='editor';assert.equal(jobs[0].canUpgrade(),false);h.context.session=null;assert.equal(jobs[0].canUpgrade(),false);
});
test('projection preparation gets its own bounded deadline and completion restarts the download budget',async()=>{
 const h=harness(),clock=virtualTimers(h);h.context.session={approved:true,role:'admin',analysisMode:'browser'};let job,complete;
 const status={textContent:''};h.context.global.document={getElementById:()=>status};
 h.context.global.MinervaClientAnalysis={load:(_opts,options)=>{job=options;return new Promise(resolve=>complete=resolve);}};
 const loading=h.load();job.onProgress({phase:'projection',loaded:0,total:231});
 clock.advance(599000);job.onProgress({phase:'projection',loaded:231,total:231});assert.equal(job.signal.aborted,false);assert.match(status.textContent,/Preparando leitura 231\/231/);assert.match(h.messages.at(-1)[0],/Nenhuma importação/);
 job.onProgress({phase:'manifest'});clock.advance(179000);assert.equal(job.signal.aborted,false);job.onProgress({phase:'analysis'});clock.advance(59000);complete({...payload(),projectionVersion:3});assert.equal(await loading,true);assert.equal(clock.timers.size,0);
});
test('preparation timeout releases controls and explains resumability instead of requesting a new import',async()=>{
 const h=harness(),clock=virtualTimers(h);h.context.session={approved:true,role:'admin',analysisMode:'browser'};let job;
 h.context.global.MinervaClientAnalysis={load:(_opts,options)=>{job=options;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(Error('Cancelled'),{name:'AbortError'}))));}};
 const loading=h.load();job.onProgress({phase:'projection',loaded:12,total:231});clock.advance(599000);job.onProgress({phase:'projection',loaded:120,total:231});clock.advance(1000);
 assert.equal(await loading,false);assert.equal(job.signal.aborted,true);assert.equal(h.context.loadingReport,false);assert.match(h.messages.at(-1)[0],/10 minutos.*preservadas.*retomar/);assert.equal(h.applied.length,0);assert.equal(clock.timers.size,0);
});
