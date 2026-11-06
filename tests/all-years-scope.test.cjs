'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const bd=(ref,date,amount,supplier='Fornecedor fictício',operation='EXPORTAÇÃO - CTNR')=>Object.assign(Array(57).fill(null),{0:ref,1:date,3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:ref,24:ref+'-NF',25:operation,28:supplier,35:amount});
const cr=(ref,origin,date,amount,supplier='Fornecedor fictício')=>Object.assign(Array(32).fill(null),{1:origin,3:'ME',7:ref,10:supplier,11:'Depósito',12:'Pago',14:amount,17:date,19:amount,31:'Analista fictício'});
const input=()=>({b:[bh,bd('OLD','2018-01-01',100),bd('NEW','2026-01-01',200)],c:[ch,cr('OLD',2017,'2019-02-01',20),cr('OLD',2017,'2026-02-01',30),cr('UNMATCHED',2016,'2026-02-01',40)]});
const run=(b,c,options={})=>E.analyze(b,c,{years:[2026],asOf:'2026-11-06',...options});

test('all years resolves RNC, original entry and cash years through the same finance path',()=>{
 const {b,c}=input(),before=JSON.stringify({b,c});
 for(const correctionScenario of ['original','corrected']){
  const p=run(b,c,{allYears:true,correctionScenario}),explicit=run(b,c,{years:[2016,2017,2018,2019,2026],correctionScenario});
  assert.deepEqual(p.meta.years,[2016,2017,2018,2019,2026]);assert.equal(p.meta.allYears,true);assert.equal(p.meta.yearScope,'all');
  assert.equal(p.summary.claimed,300);assert.equal(p.summary.received,90);assert.equal(p.summary.receivedComparable,90);
  for(const key of ['summary','suppliers','claims','corrections','correctionGroups','receiptCohorts','supplierOpenReport','claimValueAudit'])assert.deepEqual(p[key],explicit[key],key);
  assert.equal(new Set(p.receiptCohorts.rows.map(r=>r.row)).size,3);
 }
 assert.equal(JSON.stringify({b,c}),before);
});

test('switching all years off restores the selected year without mutating options or source',()=>{
 const {b,c}=input(),options={years:[2026],asOf:'2026-11-06',allYears:true},before=run(b,c);
 E.analyze(b,c,options);assert.deepEqual(options.years,[2026]);
 const after=run(b,c,{allYears:false});assert.deepEqual(after,before);assert.equal(after.meta.allYears,false);assert.equal(after.meta.yearScope,'selected');
 assert.equal(after.summary.claimed,200);assert.equal(after.summary.received,70);assert.equal(after.summary.receivedComparable,0);
});

test('all years retains global supplier and operation filters plus original correction behavior',()=>{
 const {b,c}=input();b.push(bd('MI','2020-01-01',500,'Outro fictício','COMERCIAL'));c.push(cr('MI',2020,'2020-02-01',50,'Outro fictício'));
 assert.equal(run(b,c,{allYears:true}).summary.claimed,800);
 assert.equal(run(b,c,{allYears:true,operation:'COMERCIAL'}).summary.claimed,500);
 assert.equal(run(b,c,{allYears:true,operation:'COMERCIAL'}).summary.received,50);
 assert.equal(run(b,c,{allYears:true,supplier:'Fornecedor fictício'}).summary.claimed,300);
 assert.equal(run(b,c,{allYears:true,operation:'EXPORTAÇÃO - CTNR'}).summary.received,50,'Unknown Control operation is excluded only from specific operation');
});

test('year discovery ignores invalid and implausible source years and has a current-year empty fallback',()=>{
 const b=[bh,bd('BAD','not a date',10),bd('FAR','2200-01-01',10)],c=[ch,cr('BAD','wrong','not a date',10),cr('FAR',2200,'2200-02-01',10)];
 const p=run(b,c,{allYears:true});assert.deepEqual(p.meta.years,[Number(E.today().slice(0,4))]);assert.equal(p.summary.received,0);assert.equal(p.summary.claimed,0);
 const empty=E.analyze([bh],[ch]);assert.deepEqual(empty.meta.years,[Number(E.today().slice(0,4))]);assert.equal(empty.meta.allYears,false);
});
