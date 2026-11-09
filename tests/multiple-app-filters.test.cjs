'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),{reportQuery}=require('../dist/team.js');
const between=(start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at+start.length);assert(at>=0&&until>at,`Source boundary ${start}`);return source.slice(at,until);};
const code=[between('  const applied=','  const money ='),between('  const normalize =','  const state ='),between('  const amountRank =','  const loss ='),between('  const controlModel =','  function renderScenarioStatus'),between('  function options()','  async function readFile'),between('  function populateSuppliers()','  function supplierButton'),between('  async function selectChartSupplier','  function supplierAnnual'),between('  function installmentRows()','  const safeInstallment'),between('  function analystNames','  function populateAnalysts'),between('  function correctionRows()','  function issueRows'),between('  async function toggleCorrectionProgress','  const CORR_HEADERS'),between('  function applySection','  function addApply')].join('\n')+'\nthis.helpers={selectValues,setSelected,appliedGlobalValues,filterValues,filterLabel,progressLabel};';
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
  async analyze(){const options=clone(context.options());calls.push(options);Object.assign(state.model.meta,options,{operation:options.operations.join(' · '),supplier:options.suppliers.join(' · '),controlOperation:options.controlOperations.join(' · ')});state.model.controlReport.meta.operations=options.controlOperations;state.appliedGlobal=options;return true;},
  INST_HEADERS:[],INST_SORT:{},installmentCells:()=>[],CORR_HEADERS:[],correctionCells:()=>[],correctionGroups:()=>state.model.correctionGroups,groupChanges:()=>[],originalValues:()=>'',earliestDate:()=>null,canMarkCorrections:()=>true};
 vm.createContext(context);vm.runInContext(code,context,{filename:'app-filters-from-production.js'});
 return {context,state,years,calls,marks,renders,node,set:(id,values)=>context.helpers.setSelected(id,values),values:id=>clone(context.helpers.selectValues(id)),apply:ids=>context.applySection(ids,()=>{})};
}

test('global options retain multiple selections across global and Control views and all-years supplier scope',()=>{
 const f=fixture();f.set('operationFilter',[EX,MI]);f.set('supplierFilter',[A,B]);
 let options=clone(f.context.options());assert.deepEqual(options.operations,[EX,MI]);assert.deepEqual(options.suppliers,[A,B]);assert.deepEqual(options.controlOperations,[]);assert.equal(Object.hasOwn(options,'operation'),false);
 f.context.view('installments');assert.deepEqual(f.values('operationFilter'),[]);f.set('operationFilter',[IM,UNKNOWN]);options=clone(f.context.options());assert.deepEqual(options.operations,[EX,MI]);assert.deepEqual(options.controlOperations,[IM,UNKNOWN]);
 f.context.view('overview');assert.deepEqual(f.values('operationFilter'),[EX,MI]);assert.deepEqual(f.values('supplierFilter'),[A,B]);
 f.context.view('suppliers');assert.equal(f.calls.at(-1).allYears,true);assert.deepEqual(f.calls.at(-1).operations,[EX,MI]);assert.deepEqual(f.calls.at(-1).controlOperations,[IM,UNKNOWN]);
 f.context.view('procurement');assert.equal(f.calls.at(-1).allYears,false);assert.deepEqual(f.calls.at(-1).suppliers,[A,B]);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);
 f.context.view('installments');assert.deepEqual(f.values('operationFilter'),[IM,UNKNOWN]);
});

test('supplier repopulation and metadata preserve plural arrays without splitting labels or comma-containing names',()=>{
 const f=fixture();f.set('supplierFilter',[A,B]);f.context.populateSuppliers();assert.deepEqual(f.values('supplierFilter'),[A,B]);
 f.state.model.meta.suppliers=[A,B];f.state.model.meta.supplier=A+' · '+B;assert.deepEqual(clone(f.context.helpers.appliedGlobalValues('supplier')),[A,B]);
 f.state.model.meta.suppliers=[];assert.deepEqual(clone(f.context.helpers.appliedGlobalValues('supplier')),[],'Explicit all selection does not recover the legacy caption');
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
 await f.context.toggleCorrectionProgress({dataset:{correctionProgress:'synthetic-key'},disabled:false,setAttribute(){},removeAttribute(){}});
 assert.equal(f.marks.length,1);assert.equal(f.marks[0].options.correctionScenario,'original');assert.deepEqual(f.marks[0].options.operations,[EX,MI]);assert.deepEqual(f.marks[0].options.suppliers,[A,B]);assert.deepEqual(f.marks[0].options.controlOperations,[IM]);assert.equal(f.marks[0].options.allYears,true);
});
