'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(o={})=>Object.assign(Array(57).fill(null),{0:o.sgr||'CLAIM1',1:o.date||'2025-11-06',3:o.market||'ME',6:o.status||'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:o.order||'ORDER/1',24:o.nf||123,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier||'ARMADOR',35:1000,56:'Analista BD'});
const installment=(o={})=>Object.assign(Array(32).fill(null),{1:o.year===undefined?2026:o.year,3:o.market===undefined?'MI':o.market,7:o.ref||'ORDER/1',10:o.supplier===undefined?'ARMADOR LTDA':o.supplier,11:'Depósito',12:o.status||'Pago',13:o.due===undefined?'2026-02-01':o.due,14:o.expected===undefined?50:o.expected,17:o.comp===undefined?'2026-02-01':o.comp,19:o.received===undefined?100:o.received,30:o.reportedYear===undefined?2026:o.reportedYear,31:'Analista Controle'});
const run=(b,c,opts={})=>E.analyze([bh,...b],[ch,...c],{years:[2025,2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...opts});
const amounts=groups=>groups.reduce((a,g)=>({received:a.received+g.received,openBalance:a.openBalance+g.openBalance}),{received:0,openBalance:0});

test('two views reclassify the same installments without multiplying claim or changing ledger totals',()=>{
 const b=[claim()],c=[installment({comp:'2025-12-01'}),installment({received:200}),installment({status:'Dentro do Prazo',received:0,due:null})],before=JSON.stringify({b,c});
 const m=run(b,c),i=m.correctionImpact;
 assert.equal(m.summary.claimed,1000);assert.equal(m.summary.received,300);
 assert.equal(i.summary.received,300);assert.equal(i.summary.receivedCount,2);assert.equal(i.summary.openBalance,50);assert.equal(i.summary.openCount,1);
 assert.equal(i.summary.rowCount,3);assert.equal(i.summary.orderCount,1);assert.equal(i.summary.changedRows,3);assert.equal(i.summary.changedOrders,1);assert.equal(i.summary.unresolvedRows,0);
 assert.deepEqual(amounts(i.original),amounts(i.corrected));assert.equal(i.original.length,1);assert.equal(i.corrected.length,1);
 assert.equal(i.original[0].supplier,'ARMADOR LTDA');assert.equal(i.original[0].yearEntry,2026);assert.equal(i.original[0].market,'MI');
 assert.equal(i.corrected[0].supplier,'ARMADOR');assert.equal(i.corrected[0].yearEntry,2025);assert.equal(i.corrected[0].market,'ME');
 assert.deepEqual(i.original[0].rows,[2,3,4]);assert.deepEqual(i.corrected[0].rows,[2,3,4]);assert.equal(i.corrected[0].orderCount,1);
 assert.equal(JSON.stringify({b,c}),before);assert.equal(i.summary.received,m.controlReport.meta.receivedConfirmed);assert.equal(i.summary.openBalance,m.controlReport.meta.openBalance);
});

test('incomplete references preserve every original field even when the matched subset is unique',()=>{
 const m=run([claim()],[installment({ref:'ORDER/1; UNKNOWN/2'})]),i=m.correctionImpact;
 assert.equal(m.controlReport.installments[0].year,2026,'Incomplete references retain original B in the active Control view too');
 assert.deepEqual(i.original,i.corrected);assert.equal(i.summary.changedRows,0);assert.equal(i.summary.unresolvedRows,1);assert.equal(i.summary.received,100);
 assert.equal(i.corrected[0].yearEntry,2026);assert.equal(i.corrected[0].supplier,'ARMADOR LTDA');assert.equal(i.corrected[0].market,'MI');
});

test('fully conflicting BD fields preserve originals; partial uniqueness is resolved field by field',()=>{
 const conflicts=[claim({order:'A/1',nf:1,supplier:'A'}),claim({order:'B/1',nf:2,supplier:'B',market:'MI',date:'2026-01-01'})];
 const original=installment({ref:'A/1; B/1',supplier:'FORNECEDOR ORIGINAL',year:2024,market:'MERCADO ORIGINAL'});
 const unresolved=run(conflicts,[original]).correctionImpact;
 assert.deepEqual(unresolved.original,unresolved.corrected);assert.equal(unresolved.summary.unresolvedRows,1);assert.equal(unresolved.summary.received,100);
 const partial=run([claim({order:'A/1',nf:1,supplier:'A'}),claim({order:'B/1',nf:2,supplier:'B'})],[original]).correctionImpact;
 assert.equal(partial.corrected[0].supplier,'FORNECEDOR ORIGINAL');assert.equal(partial.corrected[0].yearEntry,2025);assert.equal(partial.corrected[0].market,'ME');
 assert.equal(partial.summary.unresolvedRows,1);assert.equal(partial.summary.changedRows,1);assert.equal(partial.summary.changedOrders,2);assert.equal(partial.corrected[0].received,100);
});

test('only paid R years and all open years are included; both modes keep the same operation and supplier scope',()=>{
 const b=[claim({order:'MI/1',operation:'COMERCIAL',supplier:'CLIENTE MI'})];
 const c=[installment({ref:'MI/1',supplier:'CLIENTE MI LTDA',year:2024}),installment({ref:'MI/1',supplier:'CLIENTE MI LTDA',comp:'2025-02-01',received:200}),installment({ref:'MI/1',supplier:'CLIENTE MI LTDA',status:'Vencido',year:2020,comp:null,received:0,expected:75,due:'2020-01-01'}),installment({ref:'MI/1',supplier:'CLIENTE MI LTDA',comp:null,received:400}),installment({ref:'MI/1',supplier:'CLIENTE MI LTDA',status:'Prejuízo Minerva',received:0}),installment({ref:'UNLINKED',supplier:'OUTRO',received:900})];
 const m=run(b,c,{years:[2026],supplier:'CLIENTE MI',controlOperation:'COMERCIAL'}),i=m.correctionImpact;
 assert.equal(i.summary.rowCount,2);assert.equal(i.summary.received,100);assert.equal(i.summary.openBalance,75);assert.deepEqual(i.original.flatMap(g=>g.rows).sort(),[2,4]);assert.deepEqual(i.corrected.flatMap(g=>g.rows).sort(),[2,4]);
 assert.deepEqual(i.meta.years,[2026]);assert.equal(i.meta.supplier,'CLIENTE MI');assert.equal(i.meta.operation,'COMERCIAL');
 assert.equal(m.summary.claimed,0);assert.equal(m.summary.received,0,'Comparative export scope remains unchanged');
 assert.equal(run(b,c,{years:[2026],supplier:'CLIENTE MI LTDA',controlOperation:'COMERCIAL'}).correctionImpact.summary.received,100);
});

test('unlinked rows remain visible and missing expected amounts are explicit',()=>{
 const i=run([],[installment({ref:'UNKNOWN/1',supplier:'LOCAL',year:1900,market:'MERCADO INTERNO'}),installment({ref:'UNKNOWN/1',supplier:'LOCAL',year:1900,market:'MERCADO INTERNO',status:'Dentro do Prazo',comp:null,received:0,expected:null,due:null})]).correctionImpact;
 assert.deepEqual(i.original,i.corrected);assert.equal(i.summary.received,100);assert.equal(i.summary.openBalance,0);assert.equal(i.summary.openCount,1);assert.equal(i.summary.missingExpectedAmounts,1);assert.equal(i.summary.unresolvedRows,2);assert.equal(i.summary.changedRows,0);assert.equal(i.summary.orderCount,1);
});

test('source precision is retained before rounding and the shared total does not depend on grouping',()=>{
 const i=run([claim()],[installment({supplier:'ARMADOR A LTDA',received:.004}),installment({supplier:'ARMADOR B LTDA',received:.004})]).correctionImpact;
 assert.equal(i.summary.received,.01);assert.equal(i.corrected[0].received,.01);assert.equal(i.original.length,2);assert.equal(i.summary.receivedCount,2);assert.match(i.meta.rounding,/centavos/);
});

test('order and NF references count as the same order across installments',()=>{
 const i=run([claim()],[installment({ref:'ORDER/1'}),installment({ref:123,received:200})]).correctionImpact;
 assert.equal(i.summary.orderCount,1);assert.equal(i.summary.changedOrders,1);assert.equal(i.summary.received,300);assert.equal(i.corrected[0].orderCount,1);assert.deepEqual(i.corrected[0].references,['ORDER/1','123']);
});
