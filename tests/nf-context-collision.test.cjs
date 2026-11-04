'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido(USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',30:'Ano Compensação',31:'Analista'});
const bd=(o={})=>Object.assign(Array(57).fill(null),{0:o.order||'CLAIM1',1:'2025-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:o.order||'SO/100-1',24:o.nf||99104,25:'EXPORTAÇÃO - CTNR',28:o.supplier||'ARMADOR ALFA',35:1000,40:900,56:'Analista BD'});
const cr=(o={})=>Object.assign(Array(32).fill(null),{0:o.sector===undefined?'GADO VIVO':o.sector,1:o.year===undefined?2026:o.year,2:o.area===undefined?'GADO':o.area,3:o.market||'MERCADO INTERNO',7:o.ref||99104,10:o.supplier||'TRANSPORTADORA DELTA LTDA',11:'Depósito',12:'Pago',13:'2026-02-01',14:50,17:'2026-02-01',19:o.received===undefined?100:o.received,20:800,21:800,23:o.x||'Reembolsado',30:2026,31:'Analista Controle'});
const run=(b,c,o={})=>E.analyze([bh,...b],[ch,...c],{years:[2025,2026],asOf:'2026-11-03',lossFormula:'subtract-negotiating',...o});

test('numeric NF collision in independent livestock context preserves Control classification and cash across every matching path',()=>{
 const b=[bd()],c=[cr()],before=JSON.stringify({b,c}),m=run(b,c),r=m.controlReport.installments[0],cash=m.receiptCohorts.rows[0];
 assert.equal(m.suppliers.find(s=>s.name==='ARMADOR ALFA').receivedComparable,0);assert.equal(m.summary.received,100);assert.equal(m.summary.receivedComparable,100);assert.equal(m.controlReport.meta.receivedConfirmed,100);
 assert.equal(r.supplier,c[0][10]);assert.equal(r.year,2026);assert.equal(r.market,'MERCADO INTERNO');assert.deepEqual(r.bdRows,[]);assert.deepEqual(r.rejectedBdRows,[2]);assert.equal(r.contextCollision,true);
 assert.equal(cash.supplier,c[0][10]);assert.equal(cash.claimYear,2026);assert.equal(cash.yearSource,'Controle B (não validado na BD)');assert.equal(cash.operationSource,'Não identificada');assert.equal(cash.validationState,'control-only');assert.match(cash.validationReasons.join(' '),/Coincidência numérica/);
 assert.equal(m.corrections.length,0);assert.equal(m.claimValueAudit.uCorrections.length,0);assert.deepEqual(m.claimValueAudit.rows[0].controlRows,[]);assert.equal(m.claimValueAudit.rows[0].controlExpected,null);assert.equal(m.correctionImpact.summary.changedRows,0);assert.deepEqual(m.correctionImpact.original[0].supplier,m.correctionImpact.corrected[0].supplier);assert.equal(m.controlReport.processes[0].integralControl,800);
 assert(m.issues.some(i=>i.kind==='NF_CONTEXT_COLLISION'&&i.row===2));assert(m.controlReport.issues.some(i=>i.kind==='NF_CONTEXT_COLLISION'));assert.equal(JSON.stringify({b,c}),before);
});

test('market discrepancy alone and supplier short names still allow valid NF corrections',()=>{
 for(const options of [{sector:'SGR MI',area:'EXPORTAÇÃO'},{supplier:'ARMADOR ALFA LINE TRANSPORTES LTDA'},{market:'ME'}]){
  const m=run([bd()],[cr(options)]),r=m.controlReport.installments[0];assert.equal(r.contextCollision,false);assert.equal(r.supplier,'ARMADOR ALFA');assert.equal(r.year,2025);assert.equal(r.market,'ME');assert.equal(m.suppliers.find(s=>s.name==='ARMADOR ALFA').received,100);assert.equal(m.controlReport.processes[0].integralControl,1000);
 }
});

test('explicit BD order, including numeric orders, is stronger evidence than a conflicting NF context',()=>{
 for(const order of ['99104','SO/100-1']){const m=run([bd({order})],[cr({ref:order})]);assert.equal(m.receiptCohorts.rows[0].contextCollision,false);assert.deepEqual(m.receiptCohorts.rows[0].bdRows,[2]);assert.equal(m.receiptCohorts.rows[0].supplier,'ARMADOR ALFA');}
});

test('generic transport tokens do not establish supplier identity, while carrier keeps its original 2021 origin',()=>{
 const m=run([bd({supplier:'TRANSPORTADORA ÉPSILON LTDA'})],[cr({supplier:'TRANSPORTADORA ÔMEGA LTDA',year:2021,received:123.456789})]);
 assert.equal(m.receiptCohorts.rows[0].contextCollision,true);assert.equal(m.receiptCohorts.rows[0].claimYear,2021);assert.equal(m.summary.received,123.46);assert.equal(m.summary.receivedComparable,0);assert.equal(m.summary.receivedByClaimYear.other,123.46);assert.equal(m.corrections.length,0);
});

test('generic 12-order receipt remains counted and M paid with X awaiting is diagnostic only',()=>{
 const m=run([bd()],[cr({ref:'12 ordens',supplier:'ARMADOR BETA',received:1200}),cr({ref:'SO/100-1',supplier:'ARMADOR ALFA',received:625.25,x:'AGUARDANDO PAGAMENTO'})]);
 assert.equal(m.summary.received,1825.25);assert.equal(m.receiptCohorts.rows.length,2);assert.equal(m.receiptCohorts.rows[0].contextCollision,false);assert.equal(m.receiptCohorts.rows[0].received,1200);assert.equal(m.receiptCohorts.rows[1].received,625.25);assert.equal(m.controlReport.installments[1].status,'Pago');assert(m.controlReport.issues.some(i=>i.kind==='CONFLICTING_PAYMENT_FIELD'&&i.row===3));
});
