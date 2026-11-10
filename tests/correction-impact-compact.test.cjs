'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/correction-impact.js'),'utf8');
const XLSX=require('../dist/vendor/xlsx.full.min.js');
function setup(){
 const listeners={},host={innerHTML:'',replaceChildren(){this.innerHTML='';}},active=new Set();
 const document={getElementById:id=>id==='correctionImpact'?host:null,addEventListener:(event,fn)=>listeners[event]=fn};
 const window={XLSX,MinervaTableFilters:{prepare:(id,headers,rows)=>rows,heading:(id,column,label)=>label,ariaSort:()=> 'none',has:id=>active.has(id),hasSort:()=>false,summary:()=>'<div class="table-filter-summary">Filtro ativo<button>Limpar filtros</button></div>'}};
 vm.runInNewContext(source,{window,document});return{api:window.MinervaCorrectionImpact,host,listeners,active};
}
function model(){
 const group={supplier:'Fornecedor exemplo',yearEntry:2026,market:'ME',received:120,receivedCount:1,openBalance:80,openCount:1,orderCount:1,unresolvedRows:0};
 return{meta:{correctionScenario:'corrected'},correctionImpact:{meta:{years:[2026],supplier:'Fornecedor exemplo',operation:'Exportação'},summary:{received:120,changedRows:2,changedOrders:1},original:[{...group,supplier:'Fornecedor original'}],corrected:[group]},claimValueAudit:{rows:[{reference:'ORDEM-DEMO',supplier:'Fornecedor exemplo',originalClaimValue:500,claimed:600,controlExpected:300,bdReceived:400,originalPrejudice:200,prejudice:200,deltaReceived:-100,status:'A conferir',bdRows:[2],controlRows:[3,4],reasons:['Diferença demonstrativa'],analysts:['Analista exemplo'],originalClaimValues:[500]}],uCorrections:[]}};
}
const visible=html=>html.split('<details class="correction-audit-archive"')[0];
test('unified review keeps a compact scenario strip and collapses complementary audit tables',()=>{
 const h=setup(),m=model();h.api.render(m);const html=h.host.innerHTML,screen=visible(html);
 assert.equal((html.match(/data-correction-criteria=/g)||[]).length,2);assert(!/data-correction-criteria="[^"]+" open/.test(html));
 assert(screen.includes('Com correções'));assert(screen.includes('Recebido · USD'));assert(screen.includes('<strong>120</strong>'));assert(!screen.includes('<table'));assert(!screen.includes('Conferência financeira por claim'));assert(html.includes('data-correction-archive>'));assert.equal((html.match(/id="correctionOriginalToggle"/g)||[]).length,1);assert(html.includes('USD 600'));assert(html.includes('Diferença parcelas − BD · USD'));assert(!/prejuízo/i.test(html));assert(html.includes('-100'));
 assert(!screen.includes('Este cenário vale também'));assert(!screen.includes('O valor acordado inclui'));assert(!screen.includes('Filtre e ordene pelas setas'));assert(!screen.includes('table-filter-summary'));
 assert(html.includes('As parcelas O e os pagamentos T não são substituídos automaticamente.'));assert(html.includes('Ano e mês do recebido vêm de R'));
 h.active.add('correction-impact-corrected');h.api.handleFilter();assert(h.host.innerHTML.includes('Filtro ativo'));assert(h.host.innerHTML.includes('Limpar filtros'));
 m.correctionImpact.summary.missingExpectedAmounts=2;h.api.render(m);assert(visible(h.host.innerHTML).includes('Saldo incompleto · 2 parcelas'));
});
test('criteria preserve independent choices and print includes full methodology without changing totals',()=>{
 const h=setup();h.api.render(model());h.listeners.toggle({target:{dataset:{correctionCriteria:'distribution'},open:true}});h.api.render();
 assert(h.host.innerHTML.includes('data-correction-criteria="distribution" open'));assert(!h.host.innerHTML.includes('data-correction-criteria="financial" open'));
 h.api.beforePrint();assert.equal((h.host.innerHTML.match(/data-correction-criteria="[^"]+" open/g)||[]).length,2);assert(h.host.innerHTML.includes('USD 120'));assert(h.host.innerHTML.includes('data-correction-archive open'));
 h.api.afterPrint();assert(h.host.innerHTML.includes('data-correction-criteria="distribution" open'));assert(!h.host.innerHTML.includes('data-correction-criteria="financial" open'));
 h.api.clear();h.api.render(model());assert(!/data-correction-criteria="[^"]+" open/.test(h.host.innerHTML));
});
test('Excel retains both financial scenarios, source rows and audit reasons',()=>{
 const h=setup(),m=model(),before=JSON.stringify(m);h.api.render(m);const wb=XLSX.utils.book_new();h.api.addWorksheets(wb);
 assert.deepEqual(wb.SheetNames,['Cenario original','Cenario corrigido','Claim original','Claim corrigido','Ajustes valor integral U']);
 const original=XLSX.utils.sheet_to_json(wb.Sheets['Claim original'],{header:1})[1],corrected=XLSX.utils.sheet_to_json(wb.Sheets['Claim corrigido'],{header:1})[1];
 assert.deepEqual(original.slice(2,5),[500,300,-100]);assert.deepEqual(corrected.slice(2,5),[600,400,-100]);assert.deepEqual(corrected.slice(8),['2','3, 4','Analista exemplo','500','Diferença demonstrativa']);for(const name of ['Claim original','Claim corrigido'])assert(!XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1})[0].some(header=>/prejuízo/i.test(header)));
 assert.equal(JSON.stringify(m),before);
});
test('correction Excel shows cents for cash, balances, claim comparisons and U changes, without formatting years or counts as money',()=>{
 const h=setup(),m=model();m.correctionImpact.original[0].received=120.125;m.correctionImpact.corrected[0].openBalance=80.456;m.claimValueAudit.rows[0].bdReceived=400.789;m.claimValueAudit.uCorrections=[{row:3,cell:'U3',reference:'DEMO/1',original:500.125,corrected:600.345,bdRows:[2]}];const before=JSON.stringify(m);h.api.render(m);const wb=XLSX.utils.book_new();h.api.addWorksheets(wb);
 for(const name of ['Cenario original','Cenario corrigido'])for(const col of ['D','F'])assert.equal(wb.Sheets[name][col+'2'].z,'#,##0.00');for(const name of ['Claim original','Claim corrigido'])for(const col of ['C','D','E'])assert.equal(wb.Sheets[name][col+'2'].z,'#,##0.00');for(const col of ['G','H'])assert.equal(wb.Sheets['Ajustes valor integral U'][col+'2'].z,'#,##0.00');
 assert.equal(wb.Sheets['Cenario original'].D2.v,120.125);assert.equal(wb.Sheets['Cenario corrigido'].F2.v,80.456);assert.equal(wb.Sheets['Claim corrigido'].D2.v,400.789);assert.equal(wb.Sheets['Ajustes valor integral U'].H2.v,600.345);assert.notEqual(wb.Sheets['Cenario original'].B2.z,'#,##0.00');assert.notEqual(wb.Sheets['Cenario original'].E2.z,'#,##0.00');assert.equal(JSON.stringify(m),before);
});

test('the two comparison outcomes are independent, preserve zero and do not validate a multi-claim integral',()=>{
 const h=setup(),base={complete:true,grouped:false,bdRows:[2],controlRows:[3,4],claimed:700.25,originalClaimValue:700.25,bdReceived:0,controlExpected:500.35,deltaReceived:500.35,hasClaimValueMismatch:false,hasReceivedMismatch:true,uncertain:false},before=JSON.stringify(base),result=row=>JSON.parse(JSON.stringify(h.api.auditComparisons(row)));
 assert.deepEqual(result(base),{claimValue:'Confere',installments:'Divergência'});assert.deepEqual(result({...base,bdReceived:null,deltaReceived:null,hasReceivedMismatch:false,uncertain:true}),{claimValue:'Confere',installments:'A conferir'});
 assert.deepEqual(result({...base,originalClaimValue:null,hasClaimValueMismatch:true,bdReceived:500.35,deltaReceived:0,hasReceivedMismatch:false,uncertain:true}),{claimValue:'A conferir',installments:'Confere'});
 assert.deepEqual(result({...base,grouped:true,connectedBdRows:[2,5],hasClaimValueMismatch:true}),{claimValue:'A conferir',installments:'Divergência'});assert.deepEqual(result({...base,complete:false}),{claimValue:'A conferir',installments:'A conferir'});assert.deepEqual(result({...base,claimed:0,originalClaimValue:0,bdReceived:0,controlExpected:0,deltaReceived:0,hasReceivedMismatch:false}),{claimValue:'Confere',installments:'Confere'});
 assert.equal(JSON.stringify(base),before);const m=model();m.claimValueAudit.rows=[{...m.claimValueAudit.rows[0],...base}];h.api.render(m);assert(!/prejuízo/i.test(h.host.innerHTML));assert(h.host.innerHTML.includes('Reclamado × integral'));assert(h.host.innerHTML.includes('Total registrado × parcelas'));assert(h.host.innerHTML.includes('>Confere</span>'));assert(h.host.innerHTML.includes('>Divergência</span>'));
 const wb=XLSX.utils.book_new();h.api.addWorksheets(wb);for(const name of ['Claim original','Claim corrigido']){const [headers,row]=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1});assert(!headers.some(header=>/prejuízo/i.test(header)));assert.equal(row[headers.indexOf('Reclamado × integral')],'Confere');assert.equal(row[headers.indexOf('Total registrado × parcelas')],'Divergência');}
});
