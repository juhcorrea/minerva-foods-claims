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
 assert(screen.includes('Com correções'));assert(screen.includes('Recebido · USD'));assert(screen.includes('<strong>120</strong>'));assert(!screen.includes('<table'));assert(!screen.includes('Conferência financeira por claim'));assert(html.includes('data-correction-archive>'));assert.equal((html.match(/id="correctionOriginalToggle"/g)||[]).length,1);assert(html.includes('USD 600'));assert(html.includes('Diferença · soma O − AO'));assert(html.includes('-100'));
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
 assert.deepEqual(original.slice(2,6),[500,300,200,-100]);assert.deepEqual(corrected.slice(2,6),[600,400,200,-100]);assert.deepEqual(corrected.slice(7),['2','3, 4','Analista exemplo','500','Diferença demonstrativa']);
 assert.equal(JSON.stringify(m),before);
});
