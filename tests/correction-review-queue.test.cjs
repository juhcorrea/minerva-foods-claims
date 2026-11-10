'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');
const between=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)+start.length));
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const window={},document={addEventListener(){}};vm.runInNewContext(source,{window,document});return window.MinervaCorrectionImpact;
}
function synthetic(){
 const g1={id:'g1',reference:'Order A',references:['NF A'],supplier:'Supplier A',suppliers:['Supplier A'],analysts:['Ana'],rows:[3],bdRows:[2],rncDates:['2026-01-02'],changes:[{row:3,cell:'B3',field:'Ano Entrada',original:2025,corrected:2026,bdRows:[2]}],progress:{key:'g1',done:false}},g2={...g1,id:'g2',references:['Order A'],rows:[4],changes:[{row:4,cell:'U4',field:'Valor integral',original:10,corrected:50,bdRows:[2]}],progress:{key:'g2',done:true}},g3={id:'g3',reference:'Same text',supplier:'Supplier B',analysts:['Bruna'],rows:[8],bdRows:[9],changes:[],progress:{done:false}};
 const a1={id:'audit1',reference:'Order A',supplier:'Supplier A',analysts:['Ana'],bdRows:[2],connectedBdRows:[2],controlRows:[3,4],claimed:50,originalClaimValue:10,bdReceived:30,controlExpected:20,deltaReceived:-10,prejudice:20,originalPrejudice:-10,hasClaimValueMismatch:true,hasReceivedMismatch:true,complete:true,status:'Divergência de valores',reasons:['Synthetic reason']},a2={id:'audit2',reference:'Verified',supplier:'Supplier C',bdRows:[15],controlRows:[16],claimed:99,complete:true,status:'Conferido'},a3={id:'audit3',reference:'Zero',supplier:'Supplier Z',bdRows:[20],controlRows:[],claimed:0,uncertain:true,status:'Sem correspondência'};
 const issues=[{kind:'INVALID_RECEIPT_AMOUNT',row:3,reference:'Order A',supplier:'Supplier A',analysts:['Ana'],detail:'Check T3',amount:null},{kind:'CLAIM_WITHOUT_LINK',row:20,reference:'Zero',supplier:'Supplier Z',bdRows:[20],detail:'No link',amount:0},{kind:'AMBIGUOUS_LINK',row:99,reference:'Same text',supplier:'Supplier B',bdRows:[2,9],detail:'Ambiguous references',amount:500},{kind:'INVALID_DUE_DATE',row:99,reference:'Same text',supplier:'Supplier B',detail:'Check N99',amount:500},{kind:'RECEIVED_ABOVE_FORWARDED',row:null,reference:'Same text',supplier:'Supplier B',detail:'Supplier-level concern',amount:-50}];
 return {correctionGroups:[g1,g2,g3],claimValueAudit:{rows:[a1,a2,a3]},issues,claims:[]};
}
test('queue unifies only explicit source rows and preserves every correction/audit/issue object once',()=>{
 const api=fixture(),model=synthetic(),before=JSON.stringify(model),rows=api.buildQueue(model);
 assert.equal(rows.length,5);const linked=rows.find(row=>row.groups.some(g=>g.id==='g1'));
 assert.equal(linked.groups.length,2);assert.equal(linked.audits.length,1);assert.equal(linked.issues.length,1);assert.equal(linked.referenceAmount,50,'Repeated correction groups never repeat the audit amount');assert.deepEqual(plain(linked.controlRows),[3,4]);assert.equal(linked.doneCount,1);
 const standalone=rows.find(row=>row.controlRows.includes(99));assert.equal(standalone.groups.length,0);assert.equal(standalone.audits.length,0);assert.equal(standalone.issues.length,2,'Same actual source row can carry multiple issues');assert.equal(standalone.referenceAmount,null,'Payment amount is not presented as reclaimed value');
 assert.equal(rows.filter(row=>row.reference==='Same text').length,3,'Reference text alone never merges records or supplier-level issues');
 assert.equal(rows.find(row=>row.audits.some(a=>a.id==='audit3')).referenceAmount,0);
 assert.deepEqual(new Set(rows.flatMap(row=>row.groups)),new Set(model.correctionGroups));assert.deepEqual(new Set(rows.flatMap(row=>row.issues)),new Set(model.issues));assert.equal(rows.flatMap(row=>row.issues).length,model.issues.length);assert.equal(JSON.stringify(model),before);
});
test('all issue kinds use the correct sheet namespace, even with coincident Excel row numbers',()=>{
 const api=fixture();assert.equal(api.issueSource({kind:'MISSING_CLAIM_STATUS'}),'BD');assert.equal(api.issueSource({kind:'INVALID_RNC_DATE'}),'BD');assert.equal(api.issueSource({kind:'PAYMENT_ON_NEGOTIATING_CLAIM'}),'Controle');
 const model={correctionGroups:[{id:'g',bdRows:[2],rows:[3],changes:[]}],claimValueAudit:{rows:[]},issues:[{kind:'MISSING_CLAIM_STATUS',row:2},{kind:'INVALID_RECEIPT_AMOUNT',row:2}]},rows=api.buildQueue(model);assert.equal(rows.length,2);assert.equal(rows.find(row=>row.groups.length).issues[0].kind,'MISSING_CLAIM_STATUS');assert.equal(api.buildQueue(null).length,0);
});
function appFixture(){
 const api=fixture(),model=synthetic(),applied={},sheets={},details=[],document={addEventListener(){},createElement(){let html='';return {set innerHTML(value){html=value;},content:{querySelectorAll:()=>[],get textContent(){return html.replace(/<[^>]*>/g,'');}}};}},window={MinervaCorrectionImpact:api,addEventListener(){}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/table-filters.js'),'utf8'),{document,window,Intl});const F=window.MinervaTableFilters;
 const context={window,F,state:{model,controlName:'Synthetic.xlsx'},filterValue:id=>applied[id]||'',filterValues:id=>applied[id]||[],normalize:value=>String(value??'').toUpperCase(),esc:value=>String(value??'').replace(/</g,'&lt;'),money:String,moneyExact:value=>value==null?'—':String(value),integer:String,earliestDate:values=>(values||[]).slice().sort()[0]||null,date:String,correctionGroups:()=>model.correctionGroups,groupChanges:g=>g.changes||[],correctionProgressCell:g=>'MARK '+g.progress?.key,canMarkCorrections:()=>false,progressDate:String,worksheet:(_wb,name,headers,rows)=>sheets[name]={headers,rows},table:(headers,rows)=>JSON.stringify({headers,rows}),showDetail:(title,html)=>details.push({title,html}),activeDetail:null};
 vm.createContext(context);vm.runInContext([between(app,'  function analystNames','  function populateAnalysts'),between(app,'  const ISSUE_HEADERS','  function correctionRows'),between(app,'  function rowRanges','  function renderCorrections'),between(app,'  function correctionDetail','  function renderMethodExtra'),between(app,'  function correctionWorksheets','  function makeWorkbook')].join('\n'),context);return {context,model,applied,F,sheets,details};
}
test('one queue honors multi filters, exports only selected sources and keeps both financial values in detail',()=>{
 const h=appFixture();h.applied.analystFilter=['Ana','Bruna'];h.applied.correctionProgressFilter=['done','pending'];assert.equal(h.context.reviewRows().length,2);
 h.applied.correctionProgressFilter=['done'];const selected=h.context.reviewRows();assert.equal(selected.length,1);assert.equal(selected[0].groups.length,2);
 h.context.correctionWorksheets({});assert.equal(h.sheets['Fila de conferencia'].rows.length,1);assert.equal(h.sheets.Correcoes.rows.length,2);assert.equal(h.sheets['Auditoria correcoes'].rows.length,2);assert.equal(h.sheets.Conferencias.rows.length,1);
 h.context.correctionDetail(selected[0].id);const html=h.details[0].html;assert(html.includes('Integral U'));assert(html.includes('Integral AJ'));assert(html.includes('Acordado O'));assert(html.includes('Acordado AO'));assert(html.includes('Synthetic reason'));assert(html.includes('B3'));assert(html.includes('U4'));assert(html.includes('Check T3'));assert(html.includes('MARK g1'));assert(html.includes('MARK g2'));
 h.applied.analystFilter=[];h.applied.correctionProgressFilter=[];h.F.importState({tables:[{id:'correctionTable',filters:[{column:3,values:['0']}],sort:null}]});assert.equal(h.context.reviewRows().length,1);h.context.correctionWorksheets({});assert.equal(h.sheets.Correcoes.rows.length,0);assert.equal(h.sheets.Conferencias.rows.length,1);
 h.applied.correctionSearch='absent';assert.equal(h.context.reviewRows().length,0);h.context.correctionWorksheets({});assert.equal(h.sheets['Fila de conferencia'].rows.length,0);
});

test('source reconciliation remains pending even when every linked manual adjustment is marked done',()=>{
 const h=appFixture();h.model.correctionGroups.forEach(group=>group.progress.done=true);h.model.issues[0].reconciliation=true;const row=vm.runInContext('reviewQueue()',h.context).find(item=>item.controlRows.includes(3));h.context.testRow=row;
 assert.equal(vm.runInContext('reviewProgress(testRow)',h.context),'Conferir na origem');assert(h.context.reviewCells(row).at(-1).includes('Conferir na origem'));assert(!h.context.reviewCells(row).at(-1).includes('MARK'));
 h.applied.correctionProgressFilter=['pending'];assert(h.context.reviewRows().some(item=>item.id===row.id));h.applied.correctionProgressFilter=['done'];assert(!h.context.reviewRows().some(item=>item.id===row.id));h.applied.correctionProgressFilter=['pending'];h.context.correctionWorksheets({});assert(h.sheets['Fila de conferencia'].rows.some(cells=>cells.includes('Conferir na origem')));
});

test('missing operation is searchable by SGR or exact source cell and exports its trace without a guessed correction',()=>{
 const h=appFixture(),issue={kind:'BD_MISSING_OPERATION',type:'Operação em branco',source:'BD',row:2,bdRows:[2],controlRows:[],sourceCells:['BD!Z2'],sgr:'SGR-QA-001',order:'Order A',nf:'NF-QA-001',reference:'Order A',supplier:'Supplier A',analysts:['Ana'],reconciliation:true,amount:null,detail:'BD!Z2: operação em branco. Corrigir na BD e importar novamente.'};
 h.model.baseReconciliation={rows:[issue]};h.model.correctionGroups.forEach(group=>group.progress.done=true);
 for(const query of ['SGR-QA-001','BD!Z2','NF-QA-001','Operação em branco']){
  h.applied.correctionSearch=query;h.applied.correctionProgressFilter=['pending'];const rows=h.context.reviewRows();assert.equal(rows.length,1);assert.equal(rows[0].issues.filter(i=>i===issue).length,1);assert.equal(rows[0].referenceAmount,50,'Source warning never repeats or changes the amount');
 }
 const row=h.context.reviewRows()[0];assert(h.context.reviewCells(row)[0].includes('SGR-QA-001'));h.context.correctionDetail(row.id);assert(h.details[0].html.includes('SGR-QA-001'));assert(h.details[0].html.includes('BD!Z2'));assert(!h.details[0].html.includes('Operação sugerida'));
 h.context.correctionWorksheets({});const sheet=h.sheets.Conferencias,exported=sheet.rows.find(row=>row[0]==='Operação em branco');assert.equal(exported[sheet.headers.indexOf('SGR')],'SGR-QA-001');assert.equal(exported[sheet.headers.indexOf('NF')],'NF-QA-001');assert.equal(exported[sheet.headers.indexOf('Células de origem')],'BD!Z2');assert.equal(exported[sheet.headers.indexOf('Valor USD')],null);
 h.applied.correctionProgressFilter=['done'];assert.equal(h.context.reviewRows().length,0,'Manual marks cannot hide a blank source field');
});
