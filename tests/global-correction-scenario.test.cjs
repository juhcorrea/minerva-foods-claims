'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido(USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',30:'Ano Compensação',31:'Analista'});
const claim=(o={})=>Object.assign(Array(57).fill(null),{0:o.sgr||'CLAIM1',1:o.date===undefined?'2025-11-06':o.date,3:'ME',6:o.status||'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:o.order||'ORDER/1',24:o.nf||123,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier||'ARMADOR ALFA',35:o.claimed===undefined?1000:o.claimed,40:900,56:'Analista BD'});
const installment=(o={})=>Object.assign(Array(32).fill(null),{1:o.year===undefined?2026:o.year,3:o.market===undefined?'MI':o.market,7:o.ref||'ORDER/1',9:'ACORDO 1',10:o.supplier===undefined?'ARMADOR ALFA SHIPPING':o.supplier,11:'Boleto',12:o.status||'Pago',13:'2026-01-01',14:450,17:o.comp===undefined?'2026-02-01':o.comp,19:o.received===undefined?100:o.received,20:o.integral===undefined?900:o.integral,21:900,30:2026,31:'Analista Controle'});
const run=(b,c,options={},headers={})=>E.analyze([headers.bd||bh,...b],[headers.control||ch,...c],{years:[2025,2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...options});

test('global original and corrected scenarios change supplier attribution and cohort year while preserving claim and cash totals',()=>{
 const b=[claim()],c=[installment()],before=JSON.stringify({b,c});
 const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c,{correctionScenario:'corrected'});
 assert.equal(original.meta.correctionScenario,'original');assert.equal(corrected.meta.correctionScenario,'corrected');assert.match(original.meta.correctionScenarioNote,/ano de entrada B/);
 assert.equal(original.summary.claimed,1000);assert.equal(corrected.summary.claimed,1000);assert.equal(original.summary.received,100);assert.equal(corrected.summary.received,100);assert.equal(original.summary.loss,900);assert.equal(corrected.summary.loss,900);
 assert.equal(original.summary.receivedSameYear,100);assert.equal(original.summary.receivedDifferentYear,0);assert.equal(corrected.summary.receivedSameYear,0);assert.equal(corrected.summary.receivedDifferentYear,100);
 assert.equal(original.suppliers.find(s=>s.name==='ARMADOR ALFA').received,0);assert.equal(original.suppliers.find(s=>s.name==='ARMADOR ALFA SHIPPING').received,100);assert.equal(original.suppliers.find(s=>s.name==='ARMADOR ALFA SHIPPING').claimed,0);
 assert.equal(corrected.suppliers.length,1);assert.equal(corrected.suppliers[0].name,'ARMADOR ALFA');assert.equal(corrected.suppliers[0].received,100);assert.equal(corrected.suppliers[0].recoveryRate,.1);
 assert.equal(original.receiptCohorts.rows[0].claimYear,2026);assert.equal(corrected.receiptCohorts.rows[0].claimYear,2025);assert.equal(original.annual.find(x=>x.year===2026).receivedSameYear,100);assert.equal(corrected.annual.find(x=>x.year===2026).receivedDifferentYear,100);
 assert.equal(original.monthly.find(x=>x.month==='2026-02').received,corrected.monthly.find(x=>x.month==='2026-02').received);assert.equal(JSON.stringify({b,c}),before);
});

test('supplier filters use the active scenario attribution so recovery and loss visibly differ for the same selected BD supplier',()=>{
 const b=[claim()],c=[installment()];
 const original=run(b,c,{correctionScenario:'original',supplier:'ARMADOR ALFA'}),corrected=run(b,c,{correctionScenario:'corrected',supplier:'ARMADOR ALFA'});
 assert.equal(original.summary.claimed,1000);assert.equal(corrected.summary.claimed,1000);assert.equal(original.summary.received,0);assert.equal(corrected.summary.received,100);assert.equal(original.summary.loss,1000);assert.equal(corrected.summary.loss,900);assert.equal(original.controlReport.installments.length,0);assert.equal(corrected.controlReport.installments.length,1);
 assert.equal(run(b,c,{correctionScenario:'original',supplier:'ARMADOR ALFA SHIPPING'}).summary.received,100);
 assert.equal(run(b,c,{supplier:'ARMADOR ALFA SHIPPING'}).controlReport.meta.receivedConfirmed,100,'Existing corrected Control alias filtering remains supported');
});

test('Control rows and agreement integral use B/D/K/U originally and safely resolved BD values after correction',()=>{
 const b=[claim()],c=[installment()];const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c);
 const before=original.controlReport.installments[0],after=corrected.controlReport.installments[0];
 assert.equal(before.year,2026);assert.equal(before.market,'MI');assert.equal(before.supplier,'ARMADOR ALFA SHIPPING');assert.equal(after.year,2025);assert.equal(after.market,'ME');assert.equal(after.supplier,'ARMADOR ALFA');
 const p=original.controlReport.processes[0],q=corrected.controlReport.processes[0];
 assert.equal(p.integralControl,900);assert.equal(q.integralControl,1000);assert.equal(p.originalIntegralControl,900);assert.equal(q.originalIntegralControl,900);assert.equal(p.integralSource,'Controle!U');assert.equal(q.integralSource,'BD!AJ');assert.deepEqual(q.integralCorrectedRows,[2]);
 assert.equal(p.agreed,900);assert.equal(q.agreed,900);assert.equal(p.agreementRate,1);assert.equal(q.agreementRate,.9);assert.equal(p.agreementBalance,800);assert.equal(q.agreementBalance,800);assert.equal(p.receivedAllYears,100);assert.equal(q.receivedAllYears,100);assert.equal(p.scheduledTotal,450);assert.equal(q.scheduledTotal,450);
 assert.equal(original.receiptReport.rows[0].supplier,'ARMADOR ALFA SHIPPING');assert.equal(corrected.receiptReport.rows[0].supplier,'ARMADOR ALFA');assert.equal(original.receiptReport.rows[0].yearEntry,2026);assert.equal(corrected.receiptReport.rows[0].yearEntry,2025);
});

test('audit before/after values and grouped correction signatures stay identical regardless of active scenario',()=>{
 const b=[claim(),claim({order:'NEG',nf:22,status:'EM NEGOCIAÇÃO - PROCEDENTE',claimed:500})],c=[installment()];
 const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c);
 assert.deepEqual(original.claims,corrected.claims);assert.equal(original.summary.negotiating,500);assert.equal(corrected.summary.negotiating,500);
 assert.deepEqual(original.corrections,corrected.corrections);assert.deepEqual(original.correctionGroups,corrected.correctionGroups);assert.deepEqual(original.claimValueAudit,corrected.claimValueAudit);assert.deepEqual(original.correctionImpact,corrected.correctionImpact);
 assert.deepEqual(original.receiptReport.annual,corrected.receiptReport.annual);assert.deepEqual(original.receiptReport.analysts,corrected.receiptReport.analysts);
});

test('blank original supplier and invalid original year stay explicit instead of borrowing BD attribution',()=>{
 const b=[claim()],c=[installment({supplier:'',year:'inválido'})];
 const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c);
 assert.equal(original.receiptCohorts.rows[0].supplier,'(SEM FORNECEDOR)');assert.equal(original.receiptCohorts.rows[0].claimYear,null);assert.equal(original.summary.receivedUnknownYear,100);assert.equal(corrected.receiptCohorts.rows[0].supplier,'ARMADOR ALFA');assert.equal(corrected.summary.receivedDifferentYear,100);
 assert.equal(original.controlReport.installments[0].year,'inválido');assert.equal(corrected.controlReport.installments[0].year,2025);
});

test('both scenarios retain Control cash while unresolved references do not gain unsafe BD attribution',()=>{
 const b=[claim({order:'A',nf:1}),claim({order:'B',nf:2,supplier:'OUTRO'})];
 for(const ref of ['A; B','A; UNKNOWN','A; CCO']){
  const c=[installment({ref})],before=run(b,c,{correctionScenario:'original'}),after=run(b,c);
  assert.equal(before.summary.received,100);assert.equal(after.summary.received,100);assert.equal(before.receiptCohorts.rows[0].supplier,'ARMADOR ALFA SHIPPING');assert.equal(after.receiptCohorts.rows[0].supplier,'ARMADOR ALFA SHIPPING');assert.equal(after.receiptCohorts.rows[0].supplierSource,'Controle K');assert.equal(after.receiptCohorts.rows[0].claimYear,ref==='A; B'?2025:2026);assert.equal(after.controlReport.installments[0].market,ref==='A; B'?'ME':'MI');assert.equal(before.controlReport.meta.receivedConfirmed,100);assert.equal(after.controlReport.meta.receivedConfirmed,100);assert.equal(before.receiptCohorts.meta.unresolvedAmount,100);assert.equal(after.receiptCohorts.meta.unresolvedAmount,100);
 }
});

test('U correction is applied only to complete unique claims, retaining original data and unresolved totals',()=>{
 const b=[claim({order:'A',nf:1}),claim({order:'B',nf:2})];
 const grouped=run(b,[installment({ref:'A; B'})]).controlReport.processes[0];assert.equal(grouped.integralControl,900);assert.equal(grouped.integralSource,'Controle!U');assert.deepEqual(grouped.integralCorrectedRows,[]);
 const partial=run(b,[installment({ref:'A; UNKNOWN'})]).controlReport.processes[0];assert.equal(partial.integralControl,900);assert.deepEqual(partial.integralCorrectedRows,[]);
 const header=[...ch];header[20]='';const noHeader=run([claim()],[installment()],{},{control:header}).controlReport.processes[0];assert.equal(noHeader.integralControl,null);
 const c=[installment({integral:900}),installment({integral:800})],before=run([claim()],c,{correctionScenario:'original'}).controlReport.processes[0],after=run([claim()],c).controlReport.processes[0];
 assert.equal(before.integralControl,null);assert.equal(after.integralControl,1000);assert.equal(after.originalIntegralControl,null);assert.equal(after.agreed,900);assert.deepEqual(after.integralCorrectedRows,[2,3]);
});

test('default is corrected and fractional-cent cohort conservation holds in both scenarios',()=>{
 const b=[claim({order:'A',nf:1,date:'2026-01-01'}),claim({order:'B',nf:2,date:'2025-01-01'}),claim({order:'C',nf:3,date:null})],c=[installment({ref:'A',year:2026,received:.004}),installment({ref:'B',year:2025,received:.004}),installment({ref:'C',year:null,received:.004})];
 assert.deepEqual(run(b,c),run(b,c,{correctionScenario:'corrected'}));
 for(const scenario of ['original','corrected']){
  const s=run(b,c,{correctionScenario:scenario}).summary;assert.equal(s.received,.01);assert.equal(Math.round(s.receivedSameYear*100)+Math.round(s.receivedDifferentYear*100)+Math.round(s.receivedUnknownYear*100),Math.round(s.received*100));
 }
});
