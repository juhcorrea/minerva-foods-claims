'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(date='2026-01-01')=>row(64,{0:'SGR-QA',1:date,3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/1',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100});
const control=(extra={})=>row(32,{1:2026,3:'ME',7:'QA/1',10:'Fornecedor QA',11:'Depósito',12:'Dentro do Prazo',13:null,14:25,17:null,19:null,30:1900,...extra});
const run=(claims,controls,options={})=>E.analyze([bh,...claims],[ch,...controls],{allYears:true,asOf:'2026-11-10',...options});

test('cached YEAR of blank/zero payment dates cannot create year 1900, while actual years remain available',()=>{
 const claims=[claim('2020-01-01'),claim()],controls=[control({1:1900}),control({1:'1900',13:0}),control({1:2018}),control({1:2027,13:'2027-01-01'}),control({1:2028,13:'2028-01-01'})],before=JSON.stringify({claims,controls});
 for(const reportView of ['full','suppliers']){const model=run(claims,controls,{reportView});assert.deepEqual(model.meta.years,[2018,2020,2026,2027,2028]);assert.deepEqual(model.meta.caseYears,[2020,2026]);assert.equal(model.summary.occurrences,2);}
 assert.equal(JSON.stringify({claims,controls}),before,'Raw dates and cached years stay untouched');
});

test('removing a phantom year preserves M/R/T cash, open balances and the original B cell for reconciliation',()=>{
 const claims=[claim()],controls=[control({1:1900}),control({1:1900,12:'Pago',17:'2026-02-01',19:40})];
 for(const correctionScenario of ['original','corrected']){
  const all=run(claims,controls,{correctionScenario}),selected=run(claims,controls,{allYears:false,years:[2026],correctionScenario});
  assert.deepEqual(all.summary,selected.summary);assert.deepEqual(all.suppliers,selected.suppliers);assert.deepEqual(all.supplierOpenReport,selected.supplierOpenReport);
  assert.equal(all.summary.receivedConfirmed,40);assert.equal(all.summary.openBalance,25);assert.deepEqual(all.installments.map(item=>item.originalYear),[1900,1900]);
  assert(all.baseReconciliation.rows.some(item=>item.kind==='CONTROL_RNC_YEAR_MISMATCH'&&item.row===2));
 }
});

test('genuine civil dates in 1900 remain valid independent sources, rather than a blanket year cutoff',()=>{
 assert.equal(E.parseDate('1900-06-15'),'1900-06-15');
 assert.deepEqual(run([claim('1900-06-15')],[]).meta.years,[1900]);
 assert.deepEqual(run([],[control({1:null,12:'Pago',17:'1900-06-15',19:40})]).meta.years,[1900]);
 assert.deepEqual(run([],[control({1:1900,13:'1900-06-15'})]).meta.years,[1900]);
});

test('blank dates and zero Excel caches stay missing instead of becoming a date in the 1900 calendar',()=>{
 for(const value of [null,undefined,'',' ',0,-0,'0',false,NaN])assert.equal(E.parseDate(value),null,String(value));
 assert.equal(E.parseDate(46023),'2026-01-01');assert.equal(E.parseDate('2024-02-29'),'2024-02-29');assert.equal(E.parseDate('2026-02-29'),null);
});
