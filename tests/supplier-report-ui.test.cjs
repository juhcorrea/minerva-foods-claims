'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return source.slice(a,b);};
const plain=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const code=[between('  const applied=','  const $ ='),between('  function cleanYears','  function captureSupplierYears'),between('  function viewScopeMatches','  function refreshViewScope'),between('  function appliedReportOptions','  async function readFile'),between('  function acceptScenarioModel','  function refreshScopeWhenReady'),between('  function render(force','  function renderViewBody'),between('  async function openSupplierDetail','  const cohortLabel'),between('  function supplierAnnual','  function supplierRows'),between('  async function exportBook','  function demo')].join('\n');
function fixture(){
 const model={meta:{reportView:'suppliers',years:[2026],allYears:false,asOf:'2026-11-09',suppliers:['Fornecedor aplicado'],operations:['Operação aplicada'],controlOperations:[],claimStatuses:['EM NEGOCIAÇÃO - PROCEDENTE','RESSARCIMENTO ENCAMINHADO'],correctionScenario:'corrected',correctionQueueCount:7},summary:{reviewCount:11},supplierAnnual:[{name:'Fornecedor aplicado',year:2026,claimed:100,received:40,financialReceived:60,byYear:{2024:20,2025:0,2026:40},rate:.4}]};
 const state={view:'suppliers',model,supplierYears:[2026],operations:['Operação aplicada'],appliedGlobal:{...model.meta},chartMonth:'',sort:'claimed'},nodes=new Map(),calls=[],details=[],writes=[],errors=[],renders=[];
 const node=id=>{if(!nodes.has(id)){const el={id,value:'',options:[],open:false,disabled:false,hidden:false,classList:{toggle(){}},setAttribute(name,value){this[name]=value;},showModal(){this.open=true;},close(){this.open=false;}};Object.defineProperty(el,'selectedOptions',{get:()=>el.options.filter(option=>option.selected)});nodes.set(id,el);}return nodes.get(id);};
 node('operationFilter').options=[{value:'Operação aplicada',selected:true},{value:'Rascunho não aplicado',selected:false}];
 const context={state,document:{querySelectorAll:selector=>selector.includes('input[name="year"]')?[{value:'2026',checked:true}]:[]},window:{},$:node,integer:String,date:String,reviewQueue(){throw Error('Lean must not build the detailed correction queue');},renderScenarioStatus(){},populateSupplierYears(){},populateClaimYears(){},populateOperations(){for(const option of node('operationFilter').options)option.selected=state.operations.includes(option.value);},setText:(id,value)=>node(id).textContent=value,renderView(){renders.push(state.model);state.scopeRenderPending=false;},refreshViewScope(){},showDetail(name,content){node('detailDialog').open=true;node('detailContent').innerHTML=content;},supplierDetail:name=>details.push(name),makeWorkbook(){assert.notEqual(state.model.meta.reportView,'suppliers');return {full:true};},XLSX:{writeFile:book=>writes.push(book)},say(){},notice:message=>errors.push(message),F:{clear(){throw Error('Hydration must not clear table filters');}}};
 vm.createContext(context);vm.runInContext(code,context);
 state.serverLoader=opts=>{const job=deferred();calls.push({...job,opts:plain(opts)});return job.promise.then(value=>{if(!value)return false;if(!context.acceptScenarioModel(value))return false;context.render();return true;});};
 return {state,model,context,node,calls,details,writes,errors,renders,full:()=>({...model,meta:{...model.meta,reportView:'full'},claims:[],installments:[]})};
}
test('lean annual values and correction count render without detailed records',()=>{
 const f=fixture();f.context.render();assert.equal(f.node('correctionBadge').textContent,'7');assert.equal(f.node('correctionBadge').hidden,false);assert.equal(f.context.supplierAnnual({name:'Fornecedor aplicado'},2026),f.model.supplierAnnual[0]);assert.throws(()=>f.context.supplierAnnual({name:'Absent'},2026),/incompleto/);
});
test('full hydration coalesces callers and uses applied options while preserving unsubmitted operation drafts',async()=>{
 const f=fixture();f.node('operationFilter').options.forEach(option=>option.selected=option.value==='Rascunho não aplicado');
 const first=f.context.ensureFullModel(),second=f.context.ensureFullModel();assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].opts.operations,['Operação aplicada']);assert.deepEqual(f.calls[0].opts.suppliers,['Fornecedor aplicado']);assert.equal(f.calls[0].opts.reportView,'full');assert.deepEqual(f.calls[0].opts.claimStatuses,['EM NEGOCIAÇÃO - PROCEDENTE','RESSARCIMENTO ENCAMINHADO']);assert.equal(f.state.analysisBusy,undefined);
 f.context.reviewQueue=()=>Array(7).fill({});f.calls[0].resolve(f.full());assert.equal(await first,true);assert.equal(await second,true);assert.equal(f.node('operationFilter').selectedOptions[0].value,'Rascunho não aplicado');assert.equal(f.state.fullReportLoad,null);assert.equal(f.state.sort,'claimed');
});
test('an unsubmitted supplier year change stays a draft while full hydration retains the applied scope',async()=>{
 const f=fixture(),load=f.context.ensureFullModel();f.state.supplierYears=[2025];f.context.reviewQueue=()=>[];f.calls[0].resolve(f.full());assert.equal(await load,true);assert.deepEqual(f.state.model.meta.years,[2026]);assert.deepEqual(f.state.supplierYears,[2025]);assert.equal(f.state.scopeRefreshPending,false);assert.equal(f.calls.length,1);
});
test('detail hydration fills the latest supplier request and never reopens a closed dialog',async()=>{
 const f=fixture(),first=f.context.openSupplierDetail('Primeiro'),second=f.context.openSupplierDetail('Segundo');assert.equal(f.calls.length,1);assert.equal(f.node('detailDialog').open,true);assert.equal(f.details.length,0);f.context.reviewQueue=()=>[];f.calls[0].resolve(f.full());await Promise.all([first,second]);assert.deepEqual(f.details,['Segundo']);
 const g=fixture(),pending=g.context.openSupplierDetail('Fechado');g.node('detailDialog').close();g.context.reviewQueue=()=>[];g.calls[0].resolve(g.full());await pending;assert.equal(g.details.length,0);assert.equal(g.node('detailDialog').open,false);
});
test('failed, stale and revoked loads cannot open details or export partial workbooks',async()=>{
 const f=fixture(),detail=f.context.openSupplierDetail('Falha');f.calls[0].resolve(false);await detail;assert.equal(f.details.length,0);assert.match(f.node('detailContent').textContent,/Não foi possível/);
 const g=fixture(),stale=g.context.openSupplierDetail('Antigo');g.state.viewVersion=1;g.state.view='claims';g.context.reviewQueue=()=>[];g.calls[0].resolve(g.full());await stale;assert.equal(g.details.length,0);
 const h=fixture(),exporting=h.context.exportBook(false);h.state.model=null;h.calls[0].resolve(false);await exporting;assert.equal(h.writes.length,0);assert.equal(h.state.exportBookPending,false);
});
test('Excel waits for full data, suppresses duplicate clicks and fails closed in the synchronous API',async()=>{
 const f=fixture();vm.runInContext(between('  function makeWorkbook','  async function exportBook'),f.context);assert.throws(()=>f.context.makeWorkbook(),/dados|detalhes completos/);f.context.makeWorkbook=()=>{assert.notEqual(f.state.model.meta.reportView,'suppliers');return {full:true};};
 const first=f.context.exportBook(false),second=f.context.exportBook(false);assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);f.context.reviewQueue=()=>[];f.calls[0].resolve(f.full());await Promise.all([first,second]);assert.equal(f.writes.length,1);assert.equal(f.state.exportBookPending,false);assert.deepEqual(f.errors,[]);
});
test('a full report satisfies every view while a lean report can only display suppliers',()=>{
 const f=fixture();assert.equal(f.context.viewScopeMatches(),true);f.state.view='claims';f.context.filterScope().desired=f.context.normalizedFilters(f.model.meta);assert.equal(f.context.viewScopeMatches(),false);assert.equal(f.context.acceptScenarioModel(f.model),false);assert.equal(f.state.scopeRefreshPending,true);assert.equal(f.context.acceptScenarioModel(f.full()),true);f.state.scopeRenderPending=false;assert.equal(f.context.viewScopeMatches(),true);
});
