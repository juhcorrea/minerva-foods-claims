'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);};
const renderCode=[between('  function renderView(','  function viewScopeMatches'),between('  function render(force','  function renderOverview'),between('  function prepareExportViews','  function makeWorkbook'),between('  function handleTableChange','  F.onChange(handleTableChange)')].join('\n');
function fixture(){
 const calls=[],models={},badge={hidden:true,setAttribute(name,value){this[name]=value;}},state={view:'suppliers',model:{meta:{allYears:true,years:[2025,2026],asOf:'2026-11-06'},summary:{reviewCount:0}},chartMonth:''};
 const record=name=>()=>{calls.push(name);models[name]=state.model;};
 const context={state,window:{MinervaExecutive:{renderClaims:record('executive-claims')},MinervaClaimControl:{render:record('claim-control')},MinervaCorrectionImpact:{render:record('impact')},MinervaAnalysts:{render:record('analysts')},MinervaMeetings:{render:record('meeting')},MinervaPortfolio:{render:record('portfolio')}},renderOverview:record('overview'),renderSuppliers:record('suppliers'),renderInstallments:record('installments'),renderCorrections:record('corrections'),renderMethodExtra:record('method'),renderScenarioStatus(){},populateOperations(){},setText(){},receiptScopeNote:()=>'',date:String,integer:String,correctionGroups:()=>[],refreshViewScope:()=>!state.scopeRenderPending,activeDetail:null};
 for(const name of ['MinervaClaimControl','MinervaCorrectionImpact','MinervaAnalysts','MinervaMeetings'])context.window[name].handlesTable=()=>false;
 context.$=id=>id==='correctionBadge'?badge:null;context.reviewQueue=()=>[{},{}];
 vm.createContext(context);vm.runInContext(renderCode,context);return{context,state,calls,models,badge};
}
test('supplier loading builds only its pane and the same model is reused until forced or replaced',()=>{
 const f=fixture(),first=f.state.model;f.context.render();assert.deepEqual(f.calls,['suppliers']);assert.equal(f.badge.hidden,false);assert.equal(f.badge['aria-label'],'2 referências para conferir');f.context.render();f.context.renderView('suppliers');assert.equal(f.calls.length,1);
 f.context.handleTableChange('supplier-summary');assert.deepEqual(f.calls,['suppliers','suppliers']);f.state.model={...first,summary:{reviewCount:1}};f.context.render();assert.equal(f.calls.length,3);
 f.state.model=first;f.context.render();assert.equal(f.calls.length,4,'The supplier DOM was replaced by the newer model');assert.equal(f.state.scopeRenderPending,false);
});
test('visiting an untouched pane renders once and local table changes affect only their owner',()=>{
 const f=fixture();f.context.render();f.context.renderView('installments');f.context.renderView('installments');assert.deepEqual(f.calls,['suppliers','installments']);
 f.context.handleTableChange('installmentTable');assert.deepEqual(f.calls,['suppliers','installments','installments']);f.context.handleTableChange('overviewTable');assert.equal(f.calls.at(-1),'overview');assert(!f.calls.includes('meeting'));assert(!f.calls.includes('corrections'));
});
test('shared executive and claim modules are refreshed before old cached panes can be used',()=>{
 const f=fixture(),a=f.state.model,b={...a,summary:{reviewCount:2}};f.context.renderView('overview');f.state.model=b;f.context.renderView('claims');f.state.model=a;f.context.renderView('overview');assert.deepEqual(f.calls,['overview','executive-claims','claim-control','overview']);
 f.context.renderView('procurement');f.state.model=b;f.context.renderView('claims');f.state.model=a;f.context.renderView('procurement');assert.equal(f.models['claim-control'],a);assert.equal(f.calls.at(-1),'claim-control');
});
test('complete export prepares every dependent module with the current model while scoped export stays scoped',()=>{
 const f=fixture();f.context.render();f.context.prepareExportViews(false);assert.deepEqual(f.calls,['suppliers','overview','executive-claims','claim-control','impact','corrections','installments','analysts','meeting']);
 for(const name of ['overview','claim-control','impact','analysts','meeting'])assert.equal(f.models[name],f.state.model);
 const g=fixture();g.context.prepareExportViews('control');assert.deepEqual(g.calls,['installments']);g.context.prepareExportViews('control');assert.equal(g.calls.length,1);
 const workbookCode=between('  function makeWorkbook','  function exportBook');vm.runInContext(workbookCode,g.context);let readyAtExport=false;g.context.viewScopeMatches=()=>true;g.context.window.MinervaMeetings.exportWorkbook=()=>{readyAtExport=g.models.meeting===g.state.model;return 'synthetic-workbook';};assert.equal(g.context.makeWorkbook('meeting'),'synthetic-workbook');assert(readyAtExport);
});
test('render failure leaves the scope guarded and does not stamp incomplete HTML as ready',()=>{
 const f=fixture();f.context.renderSuppliers=()=>{throw Error('Synthetic rendering failure');};assert.throws(()=>f.context.render(),/Synthetic/);assert.equal(f.state.scopeRenderPending,true);assert.equal(f.state.renderedViews.has('suppliers'),false);
 f.context.renderSuppliers=()=>f.calls.push('retry');f.context.render();assert.equal(f.calls.at(-1),'retry');assert.equal(f.state.scopeRenderPending,false);
});
test('annual supplier figures are memoized per model and keep the existing cohort arithmetic',()=>{
 const a={meta:{years:[2025,2026]},claims:[{supplier:'Synthetic A',year:2026,claimed:100},{supplier:'Synthetic A',year:2025,claimed:40},{supplier:'Synthetic B',year:2026,claimed:900}],receiptCohorts:{rows:[{supplier:'Synthetic A',compensationYear:2026,claimYear:2026,received:20},{supplier:'Synthetic A',compensationYear:2026,claimYear:2024,received:7},{supplier:'Synthetic B',compensationYear:2026,claimYear:2026,received:500}]}},state={model:a},context={state};vm.createContext(context);vm.runInContext(between('  function supplierAnnual','  function supplierRows'),context);
 const value=context.supplierAnnual({name:'Synthetic A'},2026);assert.equal(value.claimed,100);assert.equal(value.received,20);assert.equal(value.financialReceived,27);assert.equal(value.byYear[2024],7);assert.equal(value.rate,.2);assert.equal(context.supplierAnnual({name:'Synthetic A'},2026),value);
 state.model={...a,claims:[{supplier:'Synthetic A',year:2026,claimed:200}]};assert.equal(context.supplierAnnual({name:'Synthetic A'},2026).claimed,200);state.model=a;assert.equal(context.supplierAnnual({name:'Synthetic A'},2026),value);
});
test('cached formatters preserve Brazilian formatting for zero, negatives, fractions and missing values',()=>{
 const context={};vm.createContext(context);vm.runInContext(between('  const wholeFormatter','  const date =')+'\nthis.format={money,moneyExact,integer,pct};',context);
 const old={money:n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('pt-BR',{minimumFractionDigits:0,maximumFractionDigits:0}),moneyExact:n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}),integer:n=>Number(n||0).toLocaleString('pt-BR'),pct:n=>n==null||!Number.isFinite(Number(n))?'—':(n*100).toLocaleString('pt-BR',{maximumFractionDigits:0})+'%'};
 for(const value of [null,undefined,0,-0,1,-1234.567,0.025,1000000.5,'12.345','bad',NaN,Infinity])for(const name of Object.keys(old))assert.equal(context.format[name](value),old[name](value),name+' '+value);
});

for(const [file,view]of [['analysts.js','analysts'],['meetings.js','meeting']])test(file+' model notifications render only its active pane and clear on logout',()=>{
 const moduleSource=fs.readFileSync(require.resolve('../dist/'+file),'utf8'),line=moduleSource.split(/\r?\n/).find(line=>line.includes("document.addEventListener('minerva:model-updated'")),calls=[],global={MinervaApp:{state:{view:'suppliers',model:{synthetic:true}}}};let changed;
 vm.runInNewContext(line,{global,document:{addEventListener(_name,callback){changed=callback;}},render:model=>calls.push(model)});changed();assert.equal(calls.length,0);global.MinervaApp.state.view=view;changed();assert.equal(calls[0],global.MinervaApp.state.model);global.MinervaApp.state.model=null;global.MinervaApp.state.view='overview';changed();assert.equal(calls.at(-1),null);
});
