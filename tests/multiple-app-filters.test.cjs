'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),{reportQuery}=require('../dist/team.js');
const between=(start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at+start.length);assert(at>=0&&until>at,`Source boundary ${start}`);return source.slice(at,until);};
const code=[between('  const applied=','  const money ='),between('  const normalize =','  const state ='),between('  const amountRank =','  const loss ='),between('  const controlModel =','  function renderScenarioStatus'),between('  function options(','  async function readFile'),between('  function populateSuppliers()','  function supplierButton'),between('  async function selectChartSupplier','  function supplierAnnual'),between('  function installmentRows()','  const safeInstallment'),between('  function analystNames','  function populateAnalysts'),between('  function correctionRows()','  function issueRows'),between('  async function toggleCorrectionProgress','  const CORR_HEADERS'),between('  function applySection','  function addApply')].join('\n')+'\nthis.helpers={selectValues,setSelected,appliedGlobalValues,filterValues,filterLabel,progressLabel};';
const clone=value=>JSON.parse(JSON.stringify(value)),EX='EXPORTAÇÃO - CTNR',MI='COMERCIAL',IM='IMPORTAÇÃO - CTNR',UNKNOWN='SEM OPERAÇÃO IDENTIFICADA',A='Fornecedor A',B='Fornecedor B, Logística';
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
function fixture(){
 const nodes=new Map(),calls=[],marks=[],renders=[];
 const node=id=>{if(!nodes.has(id)){const el={id,hidden:false,multiple:false,options:[],_value:'',dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},closest(){return this;},add(option){this.options.push(option);}};Object.defineProperties(el,{selectedOptions:{get(){return this.options.filter(o=>o.selected);}},value:{get(){return this.options.length?this.selectedOptions[0]?.value||'':this._value;},set(value){this._value=value;if(this.options.length)for(const option of this.options)option.selected=option.value===value;}},innerHTML:{get(){return this._html||'';},set(value){this._html=value;if(/<option/.test(value))this.options=[...value.matchAll(/<option value="([^"]*)"([^>]*)>/g)].map(match=>({value:decode(match[1]),selected:/\bselected\b/.test(match[2])}));}}});nodes.set(id,el);}return nodes.get(id);};
 const makeSelect=(id,values)=>{const el=node(id);el.multiple=true;el.options=['',...values].map(value=>({value,selected:value===''}));return el;};
 makeSelect('operationFilter',[EX,MI,IM,UNKNOWN]);makeSelect('supplierFilter',[A,B]);makeSelect('typeFilter',['Boleto','Depósito','Rebate']);makeSelect('statusFilter',['Pago','Vencido','Dentro do Prazo','Sem previsão']);makeSelect('analystFilter',['Ana','Bruna','__missing__']);makeSelect('correctionProgressFilter',['done','pending']);
 node('asOf').value='2026-11-06';node('correctionScenario').value='corrected';
 const years=[{value:'2025',checked:false},{value:'2026',checked:true}],views=['overview','suppliers','installments','procurement','claims','analysts'].map(name=>node('view-'+name)),nav=views.map(el=>Object.assign(node('nav-'+el.id),{dataset:{view:el.id.slice(5)}}));
 const state={view:'overview',operation:'',controlOperation:'',chartMonth:'',bd:null,control:null,model:{meta:{allYears:false,years:[2026],asOf:'2026-11-06',correctionScenario:'corrected',operations:[],suppliers:[],controlOperations:[]},operationOptions:[EX,MI,IM],suppliers:[{name:A},{name:B}],claims:[],controlReport:{meta:{operations:[]},operationOptions:[EX,MI,IM,UNKNOWN],supplierOptions:[A,B],installments:[]},correctionGroups:[]},publishedMeta:{revision:'synthetic'}};
 const context={state,console,document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},querySelector:node,querySelectorAll(selector){if(selector==='input[name="year"]:checked')return years.filter(y=>y.checked);if(selector==='input[name="year"]')return years;if(selector==='[id^="view-"]')return views;if(selector==='[data-view]')return nav;return [];}},window:{MinervaTeam:{async setCorrectionProgress(value){marks.push(clone(value));return {progress:{key:value.key,done:value.done}};}}},Option:function(label,value){this.text=label;this.value=value;this.selected=false;},
  F:{prepare(_id,_headers,rows){return rows;}},setText(id,value){node(id).textContent=value;},say(){},notice(message){throw Error(message);},renderViewBody(){},renderRanking(){},renderCorrections(){renders.push('corrections');},
  async analyze(intent={}){const options=clone(context.options({useDesired:intent.fromNavigation===true}));calls.push(options);Object.assign(state.model.meta,options,{operation:options.operations.join(' · '),supplier:options.suppliers.join(' · '),controlOperation:options.controlOperations.join(' · ')});state.model.controlReport.meta.operations=options.controlOperations;state.appliedGlobal=options;return true;},
  INST_HEADERS:[],INST_SORT:{},installmentCells:()=>[],CORR_HEADERS:[],correctionCells:()=>[],correctionGroups:()=>state.model.correctionGroups,groupChanges:()=>[],originalValues:()=>'',earliestDate:()=>null,canMarkCorrections:()=>true};
 vm.createContext(context);vm.runInContext(code,context,{filename:'app-filters-from-production.js'});
 return {context,state,years,calls,marks,renders,node,set:(id,values)=>context.helpers.setSelected(id,values),values:id=>clone(context.helpers.selectValues(id)),apply:ids=>context.applySection(ids,()=>{})};
}

test('global options retain multiple selections within their own tab and isolate Control and suppliers scopes',()=>{
 const f=fixture();f.set('operationFilter',[EX,MI]);f.set('supplierFilter',[A,B]);
 let options=clone(f.context.options());assert.deepEqual(options.operations,[EX,MI]);assert.deepEqual(options.suppliers,[A,B]);assert.deepEqual(options.controlOperations,[]);assert.equal(Object.hasOwn(options,'operation'),false);
 f.context.view('installments');assert.deepEqual(f.values('operationFilter'),[]);f.set('operationFilter',[IM,UNKNOWN]);options=clone(f.context.options());assert.deepEqual(options.operations,[]);assert.deepEqual(options.controlOperations,[IM,UNKNOWN]);
 f.context.view('overview');assert.deepEqual(f.values('operationFilter'),[EX,MI]);assert.deepEqual(f.values('supplierFilter'),[A,B]);
 f.context.view('suppliers');assert.equal(f.calls.at(-1).allYears,true);assert.deepEqual(f.calls.at(-1).operations,[]);assert.deepEqual(f.calls.at(-1).controlOperations,[]);
 f.context.view('procurement');assert.equal(f.calls.at(-1).allYears,false);assert.deepEqual(f.calls.at(-1).suppliers,[]);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);
 f.context.view('installments');assert.deepEqual(f.values('operationFilter'),[IM,UNKNOWN]);
});

test('supplier repopulation and metadata preserve plural arrays without splitting labels or comma-containing names',()=>{
 const f=fixture();f.set('supplierFilter',[A,B]);f.context.populateSuppliers();assert.deepEqual(f.values('supplierFilter'),[A,B]);
 f.state.model.meta.suppliers=[A,B];f.state.model.meta.supplier=A+' · '+B;assert.deepEqual(clone(f.context.helpers.appliedGlobalValues('supplier')),[A,B]);
 f.state.model.meta.suppliers=[];assert.deepEqual(clone(f.context.helpers.appliedGlobalValues('supplier')),[],'Explicit all selection does not recover the legacy caption');
});

test('historical year dropdown drafts and all-years scopes stay isolated between overview and receipts',()=>{
 const f=fixture(),select=f.node('globalYearFilter');select.multiple=true;select.options=[2018,2020,2023,2026].map(year=>({value:String(year),selected:year===2026}));f.state.model.meta.availableYears=[2018,2020,2023,2026];
 f.context.options();f.set('globalYearFilter',['2020','2023']);assert.deepEqual(clone(f.context.options().years),[2020,2023]);
 f.context.view('installments');assert.deepEqual(f.values('globalYearFilter'),['2026']);f.set('globalYearFilter',['2018']);
 f.context.view('overview');assert.deepEqual(f.values('globalYearFilter'),['2023','2020']);f.set('globalYearFilter',[]);assert.equal(f.context.options().allYears,true);
 f.context.view('installments');assert.deepEqual(f.values('globalYearFilter'),['2018']);f.context.view('overview');assert.deepEqual(f.values('globalYearFilter'),[]);assert.equal(f.context.options().allYears,true);
});

test('month selection is canonical, applies only in overview and restores its unfinished draft without leaking to other tabs',async()=>{
 const f=fixture(),months=f.node('globalMonthFilter');months.multiple=true;months.options=Array.from({length:12},(_,i)=>({value:String(i+1),selected:false}));
 assert.deepEqual(clone(f.context.options().months),[]);f.set('globalMonthFilter',['11','2']);assert.deepEqual(clone(f.context.options().months),[2,11]);await f.context.analyze();
 f.context.view('installments');assert.deepEqual(f.calls.at(-1).months,[]);assert.equal(f.node('globalMonthField').hidden,true);assert.equal(f.node('asOf').hidden,false);assert.deepEqual(f.values('globalMonthFilter'),[]);
 f.context.view('overview');assert.deepEqual(f.values('globalMonthFilter'),['2','11']);assert.equal(f.node('globalMonthField').hidden,false);assert.equal(f.node('asOf').hidden,true);
 f.set('globalMonthFilter',['3']);f.context.view('claims');assert.deepEqual(f.calls.at(-1).months,[]);f.context.view('overview');assert.deepEqual(f.values('globalMonthFilter'),['3']);assert.deepEqual(f.calls.at(-1).months,[2,11],'navigation restores the previously applied scope, not the unfinished month');
 f.set('globalMonthFilter',Array.from({length:12},(_,i)=>String(i+1)));assert.deepEqual(clone(f.context.options().months),[],'marking all months retains the historical negotiation default');
 assert.deepEqual(clone(f.context.cleanMonths([0,13,'bad','11',2,2,1.5])),[2,11]);
});

test('month scope matching distinguishes applied months, chart refinement preserves them and overview uses today internally',async()=>{
 const f=fixture(),months=f.node('globalMonthFilter');months.multiple=true;months.options=Array.from({length:12},(_,i)=>({value:String(i+1),selected:false}));
 f.context.window.ClaimsEngine={today:()=> '2026-11-13'};f.state.model.meta.asOf='2026-11-13';f.state.model.meta.months=[2,11];f.context.options();
 f.set('globalMonthFilter',['9']);assert.equal(f.context.options().asOf,'2026-11-13');await f.context.selectChartSupplier(A);assert.deepEqual(f.calls.at(-1).months,[2,11],'chart click does not apply September draft');
 const scope=clone(f.context.options());assert(f.context.sameReportScope({...scope,months:[11,2]},scope));assert(!f.context.sameReportScope({...scope,months:[11]},scope));assert(!f.context.sameReportScope({...scope,months:[]},scope));
 assert.deepEqual(clone(f.context.appliedReportOptions().months),[2,11]);f.state.view='suppliers';assert.deepEqual(clone(f.context.appliedReportOptions().months),[]);assert.deepEqual(clone(f.context.options().months),[]);
});

test('clear on the analysis strip removes only this page global restrictions and applies once',async()=>{
 const f=fixture(),years=f.node('globalYearFilter'),months=f.node('globalMonthFilter');years.multiple=months.multiple=true;years.options=[{value:'2026',selected:true}];months.options=[{value:'11',selected:true}];f.set('supplierFilter',[A]);f.set('operationFilter',[EX]);f.context.options();
 f.context.filterScope('installments').draft.suppliers=[B];f.context.filterScope('installments').desired.suppliers=[B];f.node('correctionScenario').value='original';await f.context.clearAnalysisFilters();
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].allYears,true);assert.deepEqual(f.calls[0].years,[]);assert.deepEqual(f.calls[0].months,[]);assert.deepEqual(f.calls[0].suppliers,[]);assert.deepEqual(f.calls[0].operations,[]);assert.equal(f.calls[0].correctionScenario,'original');assert.deepEqual(clone(f.context.filterScope('installments').desired.suppliers),[B]);
});

test('Materials keeps the existing FUP and isolates each report global filter scope and unfinished edits',async()=>{
 const f=fixture();f.context.selectMaterials('fup');f.set('supplierFilter',[A]);await f.context.analyze();f.set('operationFilter',[EX]);
 f.context.selectMaterials('directors');assert.equal(f.state.view,'procurement');assert.equal(f.state.materialsTab,'directors');assert.deepEqual(f.values('supplierFilter'),[]);assert.deepEqual(f.values('operationFilter'),[]);assert.equal(f.node('procurementContent').hidden,true);assert.equal(f.node('materialsDirectors').hidden,false);assert.equal(f.node('materialsCarriers').hidden,true);assert.equal(f.node('appTitle').textContent,'Materiais');
 f.set('supplierFilter',[B]);await f.context.analyze();f.context.selectMaterials('carriers');assert.deepEqual(f.values('supplierFilter'),[]);assert.equal(f.node('materialsCarriers').hidden,false);assert.equal(f.node('materialsDirectors').hidden,true);
 f.context.selectMaterials('fup');assert.deepEqual(f.values('supplierFilter'),[A]);assert.deepEqual(f.values('operationFilter'),[EX],'unfinished FUP selection is retained');assert.deepEqual(f.calls.at(-1).operations,[],'unfinished filter remains unapplied');assert.deepEqual(f.calls.at(-1).suppliers,[A]);assert.equal(f.node('procurementContent').hidden,false);
 assert.equal(f.context.selectMaterials('invalid'),false);assert.equal(f.state.materialsTab,'fup');assert.deepEqual(f.calls.at(-1).months,[]);
});

test('chart supplier refinement restores applied operation sets and does not apply unrelated draft selections',async()=>{
 const f=fixture();Object.assign(f.state.model.meta,{operations:[EX,MI],controlOperations:[MI,IM],suppliers:[],operation:EX+' · '+MI,supplier:''});f.state.model.controlReport.meta.operations=[MI,IM];
 f.set('operationFilter',[IM]);f.set('supplierFilter',[B]);f.years[0].checked=true;
 await f.context.selectChartSupplier(A);const options=f.calls.at(-1);assert.deepEqual(options.operations,[EX,MI]);assert.deepEqual(options.controlOperations,[MI,IM]);assert.deepEqual(options.suppliers,[A]);assert.deepEqual(options.years,[2026]);assert.deepEqual(f.values('supplierFilter'),[A]);assert.equal(f.state.chartSupplierBusy,false);
});

test('supplier chart refinement preserves its applied years without changing the other tabs year selection',async()=>{
 const f=fixture();f.state.view='suppliers';f.state.model.meta.years=[2025];f.state.supplierYears=[2026];
 await f.context.selectChartSupplier(A);assert.deepEqual(f.calls.at(-1).years,[2025]);assert.equal(f.calls.at(-1).allYears,false);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);assert.deepEqual(clone(f.state.supplierYears),[2025]);
});

test('late chart and scenario callbacks cannot overwrite another tabs unfinished filter edits',async()=>{
 const f=fixture();let done;f.context.analyze=()=>new Promise(resolve=>done=resolve);const chart=f.context.selectChartSupplier(A);f.state.view='claims';f.state.viewVersion=1;f.set('supplierFilter',[B]);done(false);await chart;assert.deepEqual(f.values('supplierFilter'),[B]);assert.equal(f.state.chartSupplierBusy,false);
 vm.runInContext(between('  async function setCorrectionScenario','  function openImports'),f.context);f.context.renderScenarioStatus=()=>{};const scenario=f.context.setCorrectionScenario('original');f.state.view='suppliers';f.state.viewVersion=2;f.node('correctionScenario').value='Unsubmitted';done(false);await scenario;assert.equal(f.node('correctionScenario').value,'Unsubmitted');
});

test('reportQuery repeats each selected value and explicit empty plurals override every legacy filter',()=>{
 const query=new URLSearchParams(reportQuery({operations:[EX,MI],suppliers:[A,B],controlOperations:[IM,UNKNOWN],years:[2026],allYears:true,correctionScenario:'original'}));assert.deepEqual(query.getAll('operation'),[EX,MI].sort());assert.deepEqual(query.getAll('supplier'),[A,B].sort());assert.deepEqual(query.getAll('controlOperation'),[IM,UNKNOWN].sort());assert.equal(query.get('allYears'),'1');assert.equal(query.get('correctionScenario'),'original');
 const empty=new URLSearchParams(reportQuery({operations:[],suppliers:[],controlOperations:[],operation:EX,supplier:A,controlOperation:MI}));for(const key of ['operation','supplier','controlOperation'])assert.equal(empty.has(key),false);
 assert.deepEqual(new URLSearchParams(reportQuery({operation:[EX,MI],supplier:A})).getAll('operation'),[EX,MI].sort());assert.deepEqual(new URLSearchParams(reportQuery({operation:EX})).getAll('operation'),[EX]);
});

test('local receipt types and statuses use OR within each filter and AND across filters without changing model rows',()=>{
 const f=fixture(),rows=[{row:1,type:'Boleto',status:'Pago',received:10},{row:2,type:'Depósito',status:'Vencido',expected:50},{row:3,type:'Rebate',status:'Pago',received:90},{row:4,type:'Depósito',status:'Dentro do Prazo',expected:20,noDueDate:true},{row:5,type:'Boleto',status:'Dentro do Prazo',expected:30,noDueDate:false}].map(row=>({...row,reference:'ORDER-'+row.row,supplier:A,compensationMonth:'2026-03'}));f.state.model.controlReport.installments=rows;const before=JSON.stringify(rows);
 f.set('typeFilter',['Boleto','Depósito']);f.set('statusFilter',['Pago','Vencido']);f.apply(['typeFilter','statusFilter']);assert.deepEqual(Array.from(f.context.installmentRows(),row=>row.row),[2,1]);
 f.set('statusFilter',['Pago','Sem previsão']);f.apply(['statusFilter']);assert.deepEqual(Array.from(f.context.installmentRows(),row=>row.row),[4,1]);
 f.set('statusFilter',[]);f.apply(['statusFilter']);assert.deepEqual(Array.from(f.context.installmentRows(),row=>row.row),[2,5,4,1]);
 f.set('typeFilter',[]);f.apply(['typeFilter']);assert.equal(f.context.installmentRows().length,5);assert.equal(JSON.stringify(rows),before);
});

test('multiple analyst and correction progress selections preserve OR semantics and missing analyst selection',()=>{
 const f=fixture();f.state.model.correctionGroups=[{reference:'A',analysts:['Ana'],progress:{done:true}},{reference:'B',analysts:['Bruna'],progress:{done:false}},{reference:'C',analysts:[],progress:{done:false}},{reference:'D',analysts:['Outra'],progress:{done:true}}];
 f.set('analystFilter',['Ana','Bruna']);f.set('correctionProgressFilter',['done','pending']);f.apply(['analystFilter','correctionProgressFilter']);assert.deepEqual(Array.from(f.context.correctionRows(),row=>row.reference),['A','B']);
 f.set('analystFilter',['Ana','__missing__']);f.set('correctionProgressFilter',['pending']);f.apply(['analystFilter','correctionProgressFilter']);assert.deepEqual(Array.from(f.context.correctionRows(),row=>row.reference),['C']);
 f.set('analystFilter',[]);f.set('correctionProgressFilter',[]);f.apply(['analystFilter','correctionProgressFilter']);assert.equal(f.context.correctionRows().length,4);
});

test('correction progress carries the applied original scenario and plural scope rather than form drafts',async()=>{
 const f=fixture();Object.assign(f.state.model.meta,{allYears:true,years:[2021,2026],correctionScenario:'original',operations:[EX,MI],suppliers:[A,B],controlOperations:[IM]});f.state.model.correctionGroups=[{progress:{key:'synthetic-key',done:false}}];f.set('operationFilter',[IM]);f.set('supplierFilter',[]);
 f.context.activeDetail=null;f.context.reviewQueue=()=>f.state.model.correctionGroups.map(group=>({progress:group.reviewProgress||group.progress,groups:[group],audits:[],issues:[]}));
 await f.context.toggleCorrectionProgress({dataset:{correctionProgress:'synthetic-key'},disabled:false,setAttribute(){},removeAttribute(){}});
 assert.equal(f.marks.length,1);assert.equal(f.marks[0].options.correctionScenario,'original');assert.deepEqual(f.marks[0].options.operations,[EX,MI]);assert.deepEqual(f.marks[0].options.suppliers,[A,B]);assert.deepEqual(f.marks[0].options.controlOperations,[IM]);assert.equal(f.marks[0].options.allYears,true);
});
