'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const {repository,identityKey}=require('../dist/saved-views.js');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),start=source.indexOf('  function sanitizeView('),end=source.indexOf('  window.MinervaApp=',start),yearHelpers=source.slice(source.indexOf('  function cleanYears'),source.indexOf('  function requestedYearScope')),scopeHelpers=source.slice(source.indexOf('  function tableOwner'),source.indexOf('  function setupSupplierStatuses')),code=yearHelpers+scopeHelpers+source.slice(start,end)+'\nthis.api={sanitizeView,captureView,restoreView};';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const years=[{value:'2025',checked:false},{value:'2026',checked:true}],nodes=new Map(),calls=[],renders=[],storedTables=[];
 const node=id=>{if(!nodes.has(id)){const el={value:'',options:[],multiple:false,add(option){this.options.push(option);}};Object.defineProperty(el,'selectedOptions',{get:()=>el.options.filter(o=>o.selected)});nodes.set(id,el);}return nodes.get(id);};
 for(const id of ['supplierFilter','operationFilter','typeFilter','statusFilter','analystFilter','correctionProgressFilter']){const el=node(id);el.multiple=true;el.options=[{value:'',selected:true}];}
 const applied={supplierSearch:'',installmentSearch:'',typeFilter:[],statusFilter:[],correctionSearch:'',analystFilter:[],correctionProgressFilter:[]},state={view:'claims',model:{meta:{},rows:[{secret:'RAW-MODEL-MARKER',amount:110}]},appliedGlobal:{years:[2026],asOf:'2026-11-06',suppliers:['Fornecedor A'],operations:['Operação A'],controlOperations:['Operação B'],correctionScenario:'original'},supplierMode:'summary',sort:'claimed',chartMonth:'2026-03'};
 let liveValue=110,claimState={claims:{country:['País A','País B'],query:'ABC'},procurement:{pending:['Aguardando']},supplier:'Fornecedor A'};
 const F={clear(){storedTables.length=0;},sanitizeState:input=>({tables:(input?.tables||[]).map(t=>({id:String(t.id),filters:(t.filters||[]).map(f=>({column:f.column,values:f.values})),sort:t.sort||null}))}),exportState:()=>({tables:[{id:'cc-claims-table',filters:[{column:1,values:['País A']}],sort:{column:6,direction:'desc'}}]}),importState:s=>storedTables.push(plain(s))};
 const c={state,applied,F,document:{querySelectorAll:()=>years},window:{MinervaClaimControl:{getViewState:()=>claimState,setViewState:v=>claimState=plain(v)},MinervaAnalysts:{getViewState:()=>({year:2026}),setViewState(){}},MinervaMeetings:{getViewState:()=>({year:2026,month:3}),setViewState(){}}},$:node,asList:value=>(Array.isArray(value)?value:value?[value]:[]).map(String),appliedGlobalValues:key=>state.appliedGlobal[key+'s'],currentScenario:()=>state.appliedGlobal.correctionScenario,Option:function(label,value){this.value=value;this.text=label;},populateOperations(){},setSelected:(id,values)=>{const el=typeof id==='string'?node(id):id;for(const o of el.options)o.selected=values.includes(o.value);},view:name=>{assert(state.restoringView);state.view=name;},async analyze(){calls.push({view:state.view,suppliers:node('supplierFilter').selectedOptions.map(x=>x.value),scenario:node('correctionScenario').value});state.model={meta:{},rows:[{amount:liveValue}]};},render:()=>renders.push(plain(state.model)),say(){}};
 c.document.querySelectorAll=selector=>selector.includes(':checked')?years.filter(year=>year.checked):years;c.populateClaimYears=()=>{};c.populateSupplierYears=()=>{c.supplierYearOptions=plain(state.supplierYears);};c.viewScopeMatches=()=>true;const analyze=c.analyze;c.analyze=async()=>{await analyze();return true;};
 vm.createContext(c);vm.runInContext(code,c);return{api:c.api,state,applied,calls,renders,storedTables,node,years,context:c,setLive:value=>liveValue=value,get claimState(){return claimState;}};
}
function memory(){const values=new Map();return{values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)};}
test('saved-view identity is stable, private and isolated between profiles',async()=>{
 const a=await identityKey({email:'person-a@example.invalid',name:'Example'},webcrypto),same=await identityKey({email:'PERSON-A@example.invalid'},webcrypto),b=await identityKey({email:'person-b@example.invalid'},webcrypto);assert.equal(a,same);assert.notEqual(a,b);assert(!a.includes('example'));assert.equal(await identityKey(null,webcrypto),null);assert.equal(await identityKey({id:'stable-example-id',name:'Before'},webcrypto),await identityKey({id:'stable-example-id',name:'After'},webcrypto));
});
test('save/update/delete persist only whitelisted configuration and keep accounts separate',async()=>{
 const f=fixture(),storage=memory();let key='profile-a',id=0;const repo=repository({storage,key:()=>key,capture:()=>({...f.api.captureView(),model:f.state.model,token:'TOKEN-MARKER'}),restore:f.api.restoreView,sanitize:f.api.sanitizeView,uuid:()=>String(++id),now:()=> '2026-11-06T15:00:00Z'});
 const first=await repo.save('  Minha   visão  ');assert.equal(first.updated,false);let raw=storage.getItem(key);assert(!raw.includes('RAW-MODEL'));assert(!raw.includes('TOKEN-MARKER'));assert(!raw.includes('amount'));assert(raw.includes('Fornecedor A'));assert.equal((await repo.list())[0].name,'Minha visão');
 const second=await repo.save('Minha visão');assert.equal(second.updated,true);assert.equal(second.id,first.id);assert.equal((await repo.list()).length,1);
 key='profile-b';assert.equal((await repo.list()).length,0);key=null;await assert.rejects(repo.list,/Entre no painel/);key='profile-a';await repo.remove(first.id);assert.equal((await repo.list()).length,0);
});
test('restoring a saved view reanalyzes current data then reapplies global/local and table settings',async()=>{
 const f=fixture();f.applied.statusFilter=['Pago','Vencido'];f.applied.analystFilter=['Analista A'];const saved=plain(f.api.captureView());saved.view='suppliers';f.setLive(970);f.applied.statusFilter=[];f.state.view='overview';
 await f.api.restoreView(saved);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{view:'suppliers',suppliers:['Fornecedor A'],scenario:'original'});assert.equal(f.renders.at(-1).rows[0].amount,970);assert.deepEqual(plain(f.applied.statusFilter),[],'A supplier saved view never changes receipt filters');assert.deepEqual(f.claimState.claims.country,['País A','País B']);assert.equal(f.storedTables[0].tables[0].sort.direction,'desc');assert.deepEqual(f.years.map(y=>y.checked),[false,true]);assert.equal(f.state.restoringSavedView,false);
});
test('invalid periods and concurrent analyses fail without applying a partial saved view',async()=>{
 const f=fixture(),saved=plain(f.api.captureView());saved.view='overview';saved.global.years=[2001];await assert.rejects(f.api.restoreView(saved),/período/);assert.equal(f.calls.length,0);f.state.analysisBusy=true;await assert.rejects(f.api.restoreView(f.api.captureView()),/Aguarde/);assert.equal(f.calls.length,0);
});

test('Claim saved views retain historical/all-year scopes and Status F while legacy views preserve their selected years',async()=>{
 const f=fixture();f.state.model.meta={allYears:false,years:[2020,2023]};f.context.window.MinervaClaimControl.setViewState({claims:{caseStatusKey:['closed'],country:['BRA']},procurement:{country:['ARG']}});const saved=plain(f.api.captureView());assert.deepEqual(saved.claimYears,[2020,2023]);assert.deepEqual(saved.claims.claims.caseStatusKey,['closed']);await f.api.restoreView(saved);assert.deepEqual(plain(f.state.claimYears),[2020,2023]);assert.deepEqual(f.claimState.claims.caseStatusKey,['closed']);assert.deepEqual(f.claimState.procurement.country,['ARG']);
 f.state.model.meta={allYears:true,years:[2020,2021,2026]};const all=plain(f.api.captureView());assert.deepEqual(all.claimYears,[]);await f.api.restoreView(all);assert.deepEqual(plain(f.state.claimYears),[]);const legacy={...saved,global:{...saved.global,years:[2025]}};delete legacy.claimYears;assert.deepEqual(plain(f.api.sanitizeView(legacy).claimYears),[2025]);
});
test('storage failure is reported and a changed profile cannot save or apply another profile view',async()=>{
 const f=fixture();const bad=repository({storage:{getItem:()=>null,setItem(){throw Error('quota');}},key:()=> 'a',capture:f.api.captureView,restore:f.api.restoreView,sanitize:f.api.sanitizeView,uuid:()=> 'id'});await assert.rejects(bad.save('Exemplo'),/armazenamento/);
 let n=0;const changed=repository({storage:memory(),key:()=>++n===1?'a':'b',capture:f.api.captureView,restore:f.api.restoreView,sanitize:f.api.sanitizeView,uuid:()=> 'id'});await assert.rejects(changed.save('Exemplo'),/conta mudou/);assert.equal(f.calls.length,0);
});
test('saved views enable after initial analysis finishes without polling',async()=>{
 const savedSource=fs.readFileSync(require.resolve('../dist/saved-views.js'),'utf8'),analyzeSource=source.slice(source.indexOf('  async function analyze('),source.indexOf('  async function performAnalysis(')),refreshSource=savedSource.match(/  function refresh\(\)\{[^\n]+/)[0];
 const state={model:null},button={disabled:true},history=[],context={state,button,app:{state},global:{MINERVA_HOSTED:false},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},options:()=>({}),refreshScopeWhenReady(){},refreshViewScope(){},$:()=>null};
 context.document={querySelectorAll:()=>[],dispatchEvent:event=>{if(['minerva:model-updated','minerva:analysis-state'].includes(event.type)){context.refresh();history.push({busy:Boolean(state.analysisBusy),disabled:button.disabled});}}};context.performAnalysis=async()=>{state.model={meta:{}};context.document.dispatchEvent({type:'minerva:model-updated'});};
 vm.createContext(context);vm.runInContext(refreshSource+'\n'+analyzeSource,context);await context.analyze();assert.equal(button.disabled,false);assert.deepEqual(history.map(row=>row.disabled),[true,true,false]);assert.equal(state.analysisBusy,false);
});

test('removed saved suppliers and analysts remain explicit selections after current options are rebuilt',async()=>{const f=fixture();f.state.view='corrections';f.applied.analystFilter=['Analista ausente'];const saved=plain(f.api.captureView());f.context.render=()=>{f.node('supplierFilter').options=[{value:'',selected:true}];f.node('analystFilter').options=[{value:'',selected:true}];};await f.api.restoreView(saved);assert.deepEqual(f.node('supplierFilter').selectedOptions.map(o=>o.value),['Fornecedor A']);assert.deepEqual(f.node('analystFilter').selectedOptions.map(o=>o.value),['Analista ausente']);});

test('saved views accept a revalidated cached model and invalidate hidden pane stamps for restored filters',async()=>{
 const f=fixture();f.state.view='suppliers';const previous=f.state.model,saved=plain(f.api.captureView());f.context.analyze=async()=>true;f.state.renderedViews=new Map([['claims',1],['suppliers',1]]);saved.local.supplierSearch='Synthetic filter';await f.api.restoreView(saved);
 assert.equal(f.state.model,previous);assert.equal(f.applied.supplierSearch,'Synthetic filter');assert.deepEqual([...f.state.renderedViews.keys()],['claims']);assert.equal(f.renders.length,1);
 f.context.analyze=async()=>false;await assert.rejects(f.api.restoreView(saved),/Não foi possível atualizar/);
});

test('supplier saved views retain their applied years independently of the other tabs and legacy defaults remain all years',async()=>{
 const f=fixture();f.state.view='suppliers';f.state.model.meta={allYears:false,years:[2021,2025]};f.state.supplierYears=[2026];f.state.appliedGlobal.years=[2021,2025];
 const saved=plain(f.api.captureView());assert.deepEqual(saved.supplierYears,[2021,2025]);assert.deepEqual(saved.global.years,[2026]);f.state.supplierYears=[];await f.api.restoreView(saved);assert.deepEqual(plain(f.state.supplierYears),[2021,2025]);assert.deepEqual(f.context.supplierYearOptions,[2021,2025]);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);
 delete saved.supplierYears;await f.api.restoreView(saved);assert.deepEqual(plain(f.state.supplierYears),[]);assert.deepEqual(f.context.supplierYearOptions,[]);
 assert.deepEqual(plain(f.api.sanitizeView({supplierYears:['2026',2025,2026,'bad',1999,2201]}).supplierYears),[2025,2026]);
 f.state.model.meta={allYears:true,years:[2021,2025,2026]};assert.deepEqual(plain(f.api.captureView().supplierYears),[]);
});

test('supplier situation selections are saved from the applied scope, sanitized and restored only in suppliers',async()=>{
 const f=fixture();f.state.view='suppliers';f.state.model.meta={allYears:true,years:[2025,2026]};f.state.appliedGlobal.claimStatuses=['EM ANÁLISE','RESSARCIMENTO ENCAMINHADO'];f.state.claimStatuses=['Rascunho'];const saved=plain(f.api.captureView());assert.deepEqual(saved.global.claimStatuses,['EM ANÁLISE','RESSARCIMENTO ENCAMINHADO']);
 await f.api.restoreView(saved);assert.deepEqual(plain(f.state.claimStatuses),saved.global.claimStatuses);delete saved.global.claimStatuses;await f.api.restoreView(saved);assert.deepEqual(plain(f.state.claimStatuses),[],'Legacy views default to every situation');
 assert.deepEqual(plain(f.api.sanitizeView({global:{claimStatuses:['EM ANÁLISE','EM ANÁLISE']}}).global.claimStatuses),['EM ANÁLISE']);f.context.viewScopeMatches=()=>false;assert.throws(()=>f.api.captureView(),/atualização desta aba/);
});

test('restoring a claim view preserves procurement choices and does not finish on a different tab',async()=>{
 const f=fixture(),saved=plain(f.api.captureView());saved.claims.claims.country=['Novo país'];saved.claims.procurement.pending=['Não aplicar'];saved.claims.supplier='Não aplicar';await f.api.restoreView(saved);assert.deepEqual(f.claimState.claims.country,['Novo país']);assert.deepEqual(f.claimState.procurement.pending,['Aguardando']);assert.equal(f.claimState.supplier,'Fornecedor A');
 f.context.analyze=async()=>{f.state.view='overview';f.state.viewVersion=1;return true;};await assert.rejects(f.api.restoreView(saved),/Não foi possível atualizar/);assert.equal(f.state.restoringSavedView,false);
});
