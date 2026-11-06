'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../dist/engine.js');

const bh = Array(66).fill(null);
Object.assign(bh, {0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch = Array(32).fill(null);
Object.assign(ch, {1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
function bd(o = {}) {
  const r = Array(66).fill(null);
  Object.assign(r, {0:o.sgr ?? 'SGR1',1:o.date ?? '2025-11-06',3:o.market ?? 'ME',6:o.status ?? 'RESSARCIMENTO ENCAMINHADO',10:o.reason ?? 'AVARIA',22:o.order ?? 'O/100-1',24:o.nf ?? 123,25:o.operation ?? 'EXPORTAÇÃO - CTNR',28:o.supplier ?? 'ARMADOR A',35:o.value ?? 1000,56:o.analyst === undefined ? 'Ana' : o.analyst});
  return r;
}
function cr(o = {}) {
  const r = Array(32).fill(null);
  Object.assign(r, {1:o.year ?? 2026,3:o.market ?? 'MERCADO EXTERNO',7:o.ref ?? 'O/100-1',9:o.confession ?? 'CONF. 1',10:o.supplier ?? 'ARMADOR A LTDA',11:o.type ?? 'Boleto',12:o.status ?? 'Pago',13:o.due === undefined ? '2026-02-01' : o.due,14:o.expected ?? 100,17:o.comp === undefined ? '2026-02-01' : o.comp,19:o.value ?? 100,23:o.payment ?? 'Reembolsado',30:o.compensationYear === undefined ? 2026 : o.compensationYear,31:o.receiptAnalyst === undefined ? 'Analista B' : o.receiptAnalyst});
  return r;
}
const run = (b, c, opt = {}) => E.analyze([bh,...b],[ch,...c],{years:[2025,2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...opt});

test('preserves installments and sums receipts once without multiplying claim', () => {
  const x = run([bd()],[cr(),cr({comp:'2026-03-01'}),cr({comp:'2026-04-01'})]);
  assert.equal(x.summary.claimed,1000); assert.equal(x.summary.received,300);
  assert.equal(x.summary.installments,3); assert.equal(x.summary.paid,3);
  assert.equal(x.processes[0].settled,true); assert.equal(x.summary.occurrences,1);
});
test('one reference matched by W and Y does not duplicate receipt', () => {
  const x = run([bd({order:'123',nf:123})],[cr({ref:123})]);
  assert.equal(x.summary.received,100); assert.deepEqual(x.installments[0].bdRows,[2]);
});
test('complete compound reference credits one supplier once, without claim allocation', () => {
  const x = run([bd({order:'A/1',nf:null}),bd({sgr:'SGR2',order:'A/2',nf:222,value:2000})],[cr({ref:'A/1; A/2',value:500})]);
  assert.equal(x.summary.claimed,3000); assert.equal(x.summary.received,500);
  assert.equal(x.installments[0].linkState,'grouped'); assert.equal(x.processes.length,1);
  assert.equal(x.processes[0].total,1); assert.equal(x.claims[0].received,undefined);
});
test('partial compound reference preserves the Control cash once without allocating it to the partial BD link', () => {
  const x = run([bd({order:'A/1'})],[cr({ref:'A/1; A/2'})]);
  assert.equal(x.summary.received,100); assert.equal(x.meta.ambiguousReceived,0);
  assert.equal(x.installments[0].linkState,'review'); assert.equal(x.claims[0].linkState,'review');
  assert.equal(x.receiptCohorts.rows.length,1); assert.equal(x.receiptCohorts.rows[0].supplier,'ARMADOR A LTDA');
  assert.equal(x.receiptCohorts.rows[0].validationState,'control-only'); assert.equal(x.claims[0].received,undefined);
  const generic = run([bd({order:'A/1'})],[cr({ref:'A/1; CCO; COURO'})]);
  assert.equal(generic.summary.received,100); assert.equal(generic.installments[0].linkState,'review');
  assert.equal(generic.receiptCohorts.rows.length,1);
  assert(generic.issues.some(i=>i.kind==='AMBIGUOUS_LINK'));
  assert.equal(generic.receiptCohorts.rows[0].validationState,'control-only');
});
test('war expurgo removes claimed value but does not remove a safely attributed receipt', () => {
  const x = run([bd({order:'A/1',nf:1}),bd({order:'A/2',nf:2,reason:'INTERFERÊNCIA EXTERNA',value:200})],[cr({ref:'A/1; A/2'})]);
  assert.equal(x.summary.claimed,1000); assert.equal(x.summary.excludedWar,1);
  assert.equal(x.summary.excludedWarAmount,200); assert.equal(x.summary.received,100);
  assert.equal(x.receiptCohorts.rows.length,1); assert.deepEqual(x.receiptCohorts.rows[0].bdRows,[2,3]);
  assert.equal(x.summary.loss,900); assert.equal(x.corrections.length,0);
});
test('same NF across claim years preserves the receipt using original B without inventing a BD year correction', () => {
  const x = run([bd({order:'A/1',nf:10}),bd({order:'A/2',nf:10,date:'2024-01-01'})],[cr({ref:10})]);
  assert.equal(x.summary.received,100); assert.equal(x.installments[0].year,null);
  assert.equal(x.receiptCohorts.rows.length,1); assert.equal(x.receiptCohorts.rows[0].cohort,'same');
  assert.equal(x.receiptCohorts.rows[0].claimYear,2026); assert.deepEqual(x.receiptCohorts.rows[0].bdClaimYears,[2025,2024]);
  assert.equal(x.receiptCohorts.rows[0].yearSource,'Controle B (não validado na BD)');
  assert.equal(x.summary.receivedUnknownYear,0); assert.equal(x.summary.receivedSameYear,100); assert.equal(x.summary.receivedDifferentYear,0);
  assert.equal(x.corrections.filter(c=>c.field==='Ano Entrada').length,0);
});
test('same reference with competing BD suppliers keeps the original Control supplier and counts cash once', () => {
  const x = run([bd({order:'A/1',nf:1}),bd({order:'A/1',nf:2,supplier:'ARMADOR B'})],[cr({ref:'A/1'})]);
  assert.equal(x.summary.received,100); assert.equal(x.installments[0].supplier,'(VÍNCULO A CONFERIR)');
  assert.equal(x.receiptCohorts.rows.length,1); assert.equal(x.receiptCohorts.rows[0].supplier,'ARMADOR A LTDA');
  assert.equal(x.receiptCohorts.rows[0].supplierSource,'Controle K');
  assert.equal(x.suppliers.find(s=>s.name==='ARMADOR A').received,0); assert.equal(x.suppliers.find(s=>s.name==='ARMADOR B').received,0);
});
test('mixed claim statuses retain one cash receipt without allocating it across claims', () => {
  const x = run([bd({order:'A/1',nf:1}),bd({order:'A/2',nf:2,status:'EM NEGOCIAÇÃO - PROCEDENTE',value:200})],[cr({ref:'A/1; A/2'})]);
  assert.equal(x.summary.claimed,1200); assert.equal(x.summary.received,100); assert.equal(x.summary.negotiating,200);
  assert.equal(x.receiptCohorts.rows.length,1); assert(x.claims.every(claim=>claim.received===undefined));
  assert.equal(x.summary.loss,1200-(100+200));
});
test('paid negotiating claim belongs to received and retains negotiation as a diagnostic subset', () => {
  const x = run([bd({status:'EM NEGOCIAÇÃO - PROCEDENTE',value:200})],[cr({value:100})]);
  assert.equal(x.summary.received,100); assert.equal(x.summary.receivedNegotiating,100);
  assert.equal(x.summary.receivedConfirmed,100); assert.equal(x.summary.negotiating,200);
  assert.equal(x.summary.loss,200-(100+200)); assert(x.issues.some(i=>i.kind==='PAYMENT_ON_NEGOTIATING_CLAIM'));
});
test('RNC year correction preserves payment dates and uses equivalence for market', () => {
  const c = cr(); const source = structuredClone(c);
  const x = run([bd()],[c]);
  assert.equal(x.corrections.length,1); assert.equal(x.corrections[0].cell,'B2');
  assert.equal(x.corrections[0].original,2026); assert.equal(x.corrections[0].corrected,2025);
  assert.equal(x.installments[0].compDate,'2026-02-01'); assert.deepEqual(c,source);
});
test('market divergence records cell and replacement, abbreviations do not', () => {
  const x = run([bd()],[cr({market:'MERCADO INTERNO',year:2025})]);
  assert.equal(x.corrections.length,1); assert.equal(x.corrections[0].cell,'D2');
  assert.equal(x.corrections[0].corrected,'ME');
  assert.equal(E.normalizeMarket('MERCADO EXTERNO'),E.normalizeMarket('ME'));
});
test('all installments use claim year but receipts distribute by compensation year', () => {
  const x = run([bd({date:'2025-01-01'})],[cr({comp:'2025-12-01',compensationYear:2025}),cr({comp:'2026-01-01',value:200})]);
  assert.equal(x.annual[0].claimed,1000); assert.equal(x.annual[1].claimed,0);
  assert.equal(x.annual[0].received,100); assert.equal(x.annual[1].received,200);
  assert.equal(x.monthly.find(x=>x.month==='2026-01').received,200);
  assert.equal(x.annual.reduce((s,a)=>s+a.received,0),x.summary.received);
});
test('claimed uses RNC years while received uses payment years even for an older claim', () => {
  const x = run([bd({order:'A/1',nf:1}),bd({order:'A/2',nf:2,date:'2024-01-01'})],[cr({ref:'A/1',comp:'2024-01-01',compensationYear:2024}),cr({ref:'A/2'})]);
  assert.equal(x.summary.claimed,1000); assert.equal(x.summary.received,100);
  assert.equal(x.summary.receivedDifferentYear,100); assert.equal(x.receiptCohorts.rows[0].reference,'A/2');
  assert.equal(x.receiptCohorts.rows[0].claimYear,2024); assert.equal(x.receiptCohorts.rows[0].compensationYear,2026);
  assert.equal(x.meta.receivedOutsidePeriod,100); assert.equal(x.meta.outsideScopeControlRows,1);
});
test('future compensation is flagged but R and Pago govern receipts; unpaid due today remains on time', () => {
  const x = run([bd()],[cr({comp:'2026-10-31',due:'2026-10-30'}),cr({comp:null,value:0,status:'Dentro do Prazo',due:'2026-10-30'})]);
  assert.equal(x.summary.received,100); assert.equal(x.installments[0].status,'Pago');
  assert.equal(x.installments[1].status,'Dentro do Prazo');
  assert.equal(x.summary.openBalance,100); assert(x.issues.some(i=>i.kind==='FUTURE_COMPENSATION'));
  assert.equal(x.monthly.find(m=>m.month==='2026-10').received,100);
  assert.equal(x.receiptReport.annual[0].received,100);
});
test('blank due date is on time without forecast; invalid text is not blank', () => {
  const x = run([bd()],[cr({due:null,comp:null,value:0,status:'Dentro do Prazo'}),cr({due:'não sei',comp:null,value:0,status:'Dentro do Prazo'})]);
  assert.equal(x.installments[0].status,'Dentro do Prazo'); assert.equal(x.installments[0].noDueDate,true);
  assert.equal(x.installments[1].status,'Conferir previsão'); assert.equal(x.summary.noDueBalance,100);
  assert.equal(x.summary.openBalance,100);
});
test('24 installments include 14 overdue, 10 on time, none settled', () => {
  const rows = Array.from({length:24},(_,i)=>cr({comp:null,value:0,status:i<14?'Vencido':'Dentro do Prazo',due:i<14?'2026-01-01':'2026-12-01',expected:50}));
  const x = run([bd({value:1200})],rows);
  assert.equal(x.summary.installments,24); assert.equal(x.summary.overdue,14); assert.equal(x.summary.onTime,10);
  assert.equal(x.summary.openBalance,1200); assert.equal(x.summary.overdueBalance,700);
  assert.equal(x.summary.onTimeBalance,500); assert.equal(x.processes[0].settled,false);
});
test('loss is residual and distinct from unpaid installment balance', () => {
  const x = run([bd({value:1000}),bd({order:'A/2',nf:2,status:'EM NEGOCIAÇÃO - PROCEDENTE',value:300})],[cr({value:100}),cr({comp:null,value:0,status:'Vencido',expected:150})]);
  assert.equal(x.summary.claimed,1300); assert.equal(x.summary.negotiating,300);
  assert.equal(x.summary.loss,900); assert.equal(x.summary.openBalance,150);
  assert.equal(x.summary.lossRate,900/1300);
});
test('explicit loss installment never makes a process settled', () => {
  const x = run([bd()],[cr(),cr({comp:null,value:0,status:'Prejuízo Minerva',expected:80})]);
  assert.equal(x.summary.explicitLoss,80); assert.equal(x.summary.loss,900);
  assert.equal(x.summary.openBalance,0); assert.equal(x.processes[0].settled,false);
});
test('receipts above forwarded are exposed with negative residual and alert', () => {
  const x = run([bd({value:100})],[cr({value:110})]);
  assert.equal(x.summary.loss,-10); assert.equal(x.summary.recoveryRate,1.1);
  assert(x.issues.some(i=>i.kind==='RECEIVED_ABOVE_FORWARDED'));
});
test('zero denominator yields null not Infinity', () => {
  const x = run([bd({value:0})],[cr()]);
  assert.equal(x.summary.recoveryRate,null); assert.equal(x.suppliers[0].lossRate,null);
});
test('distinct SGR counts cases without removing financial rows', () => {
  const x = run([bd({order:'A/1',nf:1,value:100}),bd({order:'A/2',nf:2,value:200})],[]);
  assert.equal(x.summary.occurrences,1); assert.equal(x.summary.recordCount,2);
  assert.equal(x.summary.claimed,300); assert.equal(x.suppliers[0].occurrences,1);
});
test('paid without a positive received amount is review', () => {
  const x = run([bd()],[cr({comp:null,value:0}),cr({value:0})]);
  assert.equal(x.summary.received,0); assert.equal(x.summary.paid,0);
  assert(x.installments.every(i=>i.status==='Conferir pagamento'));
});
test('dates, civil-day boundary and reference normalization are deterministic', () => {
  assert.equal(E.parseDate('06/11/2025'),'2025-11-06');
  assert.equal(E.parseDate('2025-02-29'),null); assert.equal(E.parseDate('2024-02-29'),'2024-02-29');
  assert.equal(E.parseDate(45967),'2025-11-06');
  assert.deepEqual(E.tokenizeRefs(' o/100-1 ; SO/25-2\n123 / 456'),['O/100-1','SO/25-2','123','456']);
  assert.deepEqual(E.tokenizeRefs('UO/99102 - UO/99102H'),['UO/99102','UO/99102H']);
  assert.equal(E.normalizeRef('NA'),null); assert.equal(E.normalizeRef(' NAO ACIONADO '),null);
  assert.equal(E.normalizeRef('00123'),'00123'); assert.equal(E.normalizeRef('123.0'),'123');
});
test('rejects incorrect sheet headers rather than shifting columns silently', () => {
  const bad = [...bh]; bad[35] = 'Valor BRL';
  assert.throws(()=>E.analyze([bad,bd()],[ch,cr()]),/Reclamado/);
  const wrongUSD = [...ch]; wrongUSD[14] = 'Valor R$';
  assert.throws(()=>E.analyze([bh,bd()],[wrongUSD,cr()]),/Valor USD/);
  const wrongAnalyst = [...bh]; wrongAnalyst[56] = 'Responsável';
  assert.throws(()=>E.analyze([wrongAnalyst,bd()],[ch,cr()]),/Analista/);
  const wrongYear = [...ch]; wrongYear[30] = 'Ano Entrada';
  assert.throws(()=>E.analyze([bh,bd()],[wrongYear,cr()]),/Ano Compensação/);
  const wrongReceiptAnalyst = [...ch]; wrongReceiptAnalyst[31] = 'Responsável';
  assert.throws(()=>E.analyze([bh,bd()],[wrongReceiptAnalyst,cr()]),/Analista/);
});
test('loss formula supports explicit plus and pending without changing open installments', () => {
  const b = [bd({value:1000}),bd({order:'A/2',nf:2,status:'EM NEGOCIAÇÃO - PROCEDENTE',value:300})];
  const c = [cr({value:100}),cr({comp:null,value:0,status:'Vencido',expected:150})];
  const plus = run(b,c,{lossFormula:'add-negotiating'});
  assert.equal(plus.summary.loss,1500); assert.equal(plus.summary.openBalance,150);
  const pending = run(b,c,{lossFormula:'pending'});
  assert.equal(pending.summary.loss,null); assert.equal(pending.suppliers[0].loss,null);
  assert.equal(pending.summary.lossRate,null); assert.equal(pending.summary.openBalance,150);
});
test('receipt totals aggregate source precision before rounding by supplier', () => {
  const x = run([bd({order:'A/1',nf:1}),bd({order:'B/1',nf:2,supplier:'ARMADOR B'})],[cr({ref:'A/1',value:0.004}),cr({ref:'B/1',value:0.004})]);
  assert.equal(x.summary.received,0.01);
  assert.equal(x.annual.find(a=>a.year===2026).received,0.01);
  assert.equal(x.monthly.find(m=>m.month==='2026-02').received,0.01);
});
test('missing or invalid expected USD in pending installments is flagged, never silently zero', () => {
  const a = cr({comp:null,value:0,status:'Dentro do Prazo',due:null}); a[14] = null;
  const b = cr({comp:null,value:0,status:'Vencido'}); b[14] = '#VALUE!';
  const c = cr({comp:null,value:0,status:'Vencido',expected:50});
  const x = run([bd()],[a,b,c]);
  assert.equal(x.summary.openBalance,50); assert.equal(x.summary.missingExpectedAmounts,2);
  assert.equal(x.summary.openBalanceIncomplete,true); assert.equal(x.suppliers[0].missingExpectedAmounts,2);
  assert.equal(x.issues.filter(i=>i.kind==='MISSING_EXPECTED_AMOUNT').length,2);
  assert.equal(x.installments[0].expected,null); assert.equal(x.installments[0].expectedMissing,true);
});
test('claimed uses the three-status exclusion rule and negotiating stays exclusive', () => {
  const statuses = ['RESSARCIMENTO ENCAMINHADO', ' EM   NEGOCIAÇÃO-PROCEDENTE ', 'PROCEDENTE - SEGURO', 'PREJUÍZO MINERVA', 'FINALIZADO SEM CUSTO', ' em   análise ', 'aguardando   custos', 'RESPONDIDO-NÃO PROCEDE'];
  const rows = statuses.map((status,i)=>bd({status,order:`A/${i}`,nf:i+100,sgr:`SGR${i}`,value:100}));
  const x = run(rows,[]);
  assert.equal(x.summary.claimed,500); assert.equal(x.summary.forwarded,100);
  assert.equal(x.summary.negotiating,100); assert.equal(x.summary.otherClaimed,300);
  assert.equal(x.summary.recordCount,5); assert.equal(x.summary.loss,400);
  assert.equal(x.meta.excludedStatuses.length,3);
});
test('other claim statuses remain diagnostic subsets of the received total', () => {
  const b = [bd({order:'A/1',nf:1,value:1000}),bd({order:'B/1',nf:2,value:500,status:'PROCEDENTE - SEGURO'})];
  const c = [cr({ref:'A/1',value:200}),cr({ref:'B/1',value:100})];
  const x = run(b,c);
  assert.equal(x.summary.claimed,1500); assert.equal(x.summary.received,300);
  assert.equal(x.summary.receivedOtherStatuses,100); assert.equal(x.summary.receivedConfirmed,300);
  assert.equal(x.summary.receivedNegotiating,0); assert.equal(x.summary.negotiating,0);
  assert.equal(x.summary.loss,1200);
  assert.equal(x.installments[1].includedInRealized,true); assert.equal(x.installments[1].includedInConfirmed,true);
  assert.equal(x.annual.find(a=>a.year===2026).receivedOtherStatuses,100);
  assert.equal(x.monthly.find(m=>m.month==='2026-02').received,300);
  assert(x.issues.some(i=>i.kind==='PAYMENT_ON_OTHER_CLAIM_STATUS'));
});
test('excluded claim status does not exclude cash resolved to one supplier and operation', () => {
  const x = run([bd({order:'A/1',nf:10}),bd({order:'A/2',nf:10,status:'RESPONDIDO - NÃO PROCEDE'})],[cr({ref:10})]);
  assert.equal(x.summary.claimed,1000); assert.equal(x.summary.received,100);
  assert.equal(x.receiptCohorts.rows.length,1); assert.deepEqual(x.receiptCohorts.rows[0].bdRows,[2,3]);
  assert.equal(x.installments[0].linkState,'review'); assert.equal(x.installments[0].includedInRealized,true);
  assert.equal(x.corrections.length,0);
});
test('correction groups merge order and NF references while preserving every changed cell', () => {
  const x = run([bd({order:'SO/DEMO-4',nf:99101})],[cr({ref:'SO/DEMO-4',year:2026,market:'MI'}),cr({ref:99101,year:2027,market:'NACIONAL'})]);
  assert.equal(x.corrections.length,4); assert.equal(x.correctionGroups.length,1);
  const g = x.correctionGroups[0];
  assert.equal(g.reference,'SO/DEMO-4'); assert.deepEqual(g.rows,[2,3]);
  assert.deepEqual(g.year.originalValues,[2026,2027]); assert.deepEqual(g.year.correctedValues,[2025]);
  assert.deepEqual(g.market.originalValues,['MI','NACIONAL']); assert.deepEqual(g.market.correctedValues,['ME']);
  assert.equal(g.changes.length,4); assert.equal(g.hasYearCorrection,true); assert.equal(g.hasMarketCorrection,true);
  assert.equal(g.hasVaryingOriginals,true); assert.equal(g.hasConflictingCorrections,false);
  assert.deepEqual(g.references,['SO/DEMO-4','99101']);
});
test('correction groups preserve differing target years and markets for parcels of an order', () => {
  const b = [bd({order:'A/1',nf:10,date:'2025-01-01',market:'ME'}),bd({order:'A/1',nf:20,date:'2026-02-01',market:'MI'})];
  const x = run(b,[cr({ref:10,year:2027,market:'NACIONAL'}),cr({ref:20,year:2027,market:'NACIONAL'})]);
  const g=x.correctionGroups[0];
  assert.equal(x.correctionGroups.length,1); assert.deepEqual(g.year.correctedValues,[2025,2026]);
  assert.deepEqual(g.market.correctedValues,['ME','MI']); assert.equal(g.hasConflictingCorrections,true);
  assert.equal(g.changes.length,4); assert.deepEqual(g.rncDates,['2025-01-01','2026-02-01']);
});
test('other claimed statuses do not hide executive receipts exceeding forwarded', () => {
  const x = run([bd({order:'A/1',nf:1,value:100}),bd({order:'A/2',nf:2,value:500,status:'PREJUÍZO MINERVA'})],[cr({ref:'A/1',value:110})]);
  assert.equal(x.summary.loss,490); assert.equal(x.summary.forwarded,100);
  const warning=x.issues.find(i=>i.kind==='RECEIVED_ABOVE_FORWARDED');
  assert(warning); assert.equal(warning.amount,-10);
});
test('analysts from all linked BD rows are retained in corrections, groups and issues', () => {
  const b = [bd({order:'A/1',nf:1,analyst:'Analista A'}),bd({order:'A/2',nf:2,analyst:'Analista B'})];
  const x = run(b,[cr({ref:'A/1; A/2',year:2026,market:'MI',comp:null,value:0})]);
  assert.deepEqual(x.claims.map(c=>c.analyst),['Analista A','Analista B']);
  assert(x.corrections.every(c=>c.analysts.join(',')==='Analista A,Analista B'));
  assert.deepEqual(x.correctionGroups[0].analysts,['Analista A','Analista B']);
  assert(x.correctionGroups[0].changes.every(c=>c.analysts.length===2));
  assert.deepEqual(x.installments[0].analysts,['Analista A','Analista B']);
  assert(x.issues.every(i=>i.analysts.join(',')==='Analista A,Analista B'));
});
test('missing BD analyst is explicit and does not infer a Control author', () => {
  const x = run([bd({analyst:null})],[cr({year:2026,market:'MI'})]);
  assert.equal(x.claims[0].analyst,'Não informado');
  assert.deepEqual(x.corrections[0].analysts,['Não informado']);
  assert.deepEqual(x.correctionGroups[0].analysts,['Não informado']);
  assert(x.meta.analystDefinition.includes('Não identifica'));
  const y = run([bd({analyst:'  '})],[]);
  assert.deepEqual(y.issues.find(i=>i.kind==='CLAIM_WITHOUT_LINK').analysts,['Não informado']);
});
test('R determines receipt year and month despite conflicting AE without mutating the source', () => {
  const c=cr({compensationYear:'2025',comp:'2026-02-01',value:140});
  const source=structuredClone(c), x=run([bd()],[c]);
  assert.equal(x.summary.received,140); assert.equal(x.annual[0].received,0); assert.equal(x.annual[1].received,140);
  assert.equal(x.installments[0].compensationYear,2026); assert.equal(x.installments[0].compensationMonth,'2026-02');
  assert.equal(x.meta.receivedWithoutMonthlyDate,0); assert.equal(x.meta.confirmedReceivedWithoutMonthlyDate,0);
  assert.equal(x.monthly.find(m=>m.month==='2026-02').received,140);
  assert.equal(x.receiptReport.annual[0].monthlyUnallocated,0);
  assert(x.issues.some(i=>i.kind==='COMPENSATION_YEAR_MISMATCH'));
  assert(x.corrections.every(c=>!c.cell.startsWith('AE')&&!c.cell.startsWith('R'))); assert.deepEqual(c,source);
  assert.equal(run([bd()],[c],{years:[2025]}).controlReport.meta.receivedConfirmed,0);
  assert.equal(run([bd()],[c],{years:[2026]}).controlReport.meta.receivedConfirmed,140);
});
test('Pago with valid AE and T is excluded when R is absent or invalid', () => {
  const x=run([bd()],[cr({comp:null,value:120}),cr({comp:'data inválida',value:80})]);
  assert.equal(x.summary.received,0); assert.equal(x.summary.paid,0); assert.equal(x.processes[0].settled,false);
  assert.equal(x.meta.excludedYearUnknownAmount,200); assert.equal(x.meta.excludedYearUnknownCount,2);
  assert.equal(x.receiptReport.rows.length,0); assert.equal(x.receiptReport.meta.excludedYearUnknownAmount,200);
  assert(x.installments.every(i=>i.status==='Conferir pagamento'));
  assert(x.issues.some(i=>i.kind==='MISSING_COMPENSATION_DATE')); assert(x.issues.some(i=>i.kind==='INVALID_COMPENSATION_DATE'));
});
test('missing or invalid AE is diagnostic only when R supplies a valid payment date', () => {
  const x=run([bd()],[cr({compensationYear:null,value:120}),cr({compensationYear:'2026?',value:80})]);
  assert.equal(x.summary.received,200); assert.equal(x.summary.paid,2);
  assert.equal(x.meta.excludedYearUnknownAmount,0); assert.equal(x.meta.excludedYearUnknownCount,0);
  assert.equal(x.receiptReport.rows.length,2); assert.equal(x.receiptReport.meta.excludedYearUnknownAmount,0);
  assert.equal(x.receiptReport.monthly.find(m=>m.month==='2026-02').received,200);
  assert.equal(x.issues.filter(i=>i.kind==='INVALID_COMPENSATION_YEAR').length,2);
  assert(x.installments.every(i=>i.status==='Pago'));
});
test('R and T never realize a non-Pago row; unpaid classification still follows N', () => {
  const x=run([bd()],[cr({status:'Dentro do Prazo',due:null,value:90}),cr({status:'Vencido',due:'2026-01-01',value:60})]);
  assert.equal(x.summary.received,0); assert.equal(x.summary.paid,0); assert.equal(x.summary.openBalance,200);
  assert.equal(x.summary.onTime,1); assert.equal(x.summary.overdue,1); assert.equal(x.summary.noDueBalance,100);
  assert.equal(x.meta.incompatibleStatusExcludedAmount,150); assert.equal(x.receiptReport.meta.incompatibleStatusExcludedAmount,150);
  assert.equal(x.receiptReport.rows.length,0); assert.equal(x.issues.filter(i=>i.kind==='PAYMENT_STATUS_NOT_PAID').length,2);
});
test('normalized M Pago is authoritative even when X says loss', () => {
  const x=run([bd()],[cr({status:'  pAgO  ',payment:'PREJUÍZO MINERVA',comp:'2026-02-01',value:125})]);
  assert.equal(x.summary.received,125); assert.equal(x.summary.explicitLoss,0); assert.equal(x.installments[0].status,'Pago');
  assert(x.issues.some(i=>i.kind==='CONFLICTING_PAYMENT_FIELD'));
});
test('Control integral and default comparison retain unlinked cash while analyst totals stay independent of comparison filters', () => {
  const b=[bd({order:'A/1',nf:1}),bd({order:'A/2',nf:2,reason:'INTERFERÊNCIA EXTERNA'}),bd({order:'A/3',nf:3,date:'2024-01-01'})];
  const c=[cr({ref:'A/1',value:100,receiptAnalyst:'Analista B'}),cr({ref:'A/2',value:200,receiptAnalyst:'Analista C'}),cr({ref:'A/3',value:300,receiptAnalyst:'Analista B'}),cr({ref:'MISSING/4',value:400,compensationYear:2025,comp:'2025-03-01',receiptAnalyst:'NA'})];
  const x=run(b,c), filtered=run(b,c,{years:[2026],supplier:'OUTRO FORNECEDOR'});
  assert.equal(x.summary.received,1000); assert.equal(filtered.summary.received,0);
  assert.equal(x.receiptCohorts.rows.length,4); assert.equal(x.receiptCohorts.meta.unresolvedAmount,400);
  assert.equal(x.receiptCohorts.meta.receivedWithoutClaimDetail,400);
  assert.deepEqual(x.receiptReport,filtered.receiptReport);
  assert.deepEqual(x.receiptReport.years,[2025,2026]); assert.equal(x.receiptReport.annual[1].received,600); assert.equal(x.receiptReport.annual[1].count,3);
  assert.equal(x.receiptReport.annual[0].received,400); assert.equal(x.receiptReport.rows.length,4);
  assert.equal(x.receiptReport.analysts.find(a=>a.year===2026&&a.name==='Analista B').received,400);
});
test('AF receipt analyst stays independent of BE and preserves literal NA or missing name', () => {
  const x=run([bd({analyst:'Analista da BD'})],[cr({receiptAnalyst:'  Analista B  '}),cr({receiptAnalyst:null}),cr({receiptAnalyst:'NA'})]);
  assert.equal(x.claims[0].analyst,'Analista da BD'); assert.equal(x.installments[0].receiptAnalyst,'Analista B');
  assert.deepEqual(x.installments[0].analysts,['Analista da BD']);
  assert.deepEqual(x.receiptReport.rows.map(r=>r.receiptAnalyst),['Analista B','Não informado','NA']);
  assert.equal(x.correctionGroups[0].analysts[0],'Analista da BD');
});
test('Control annual and analyst totals aggregate raw precision before independent rounding', () => {
  const x=run([], [cr({ref:'A/1',receiptAnalyst:'Analista B',value:0.004}),cr({ref:'B/1',receiptAnalyst:'Analista A',value:0.004})]);
  assert.equal(x.receiptReport.annual[0].received,0.01); assert.equal(x.receiptReport.monthly[0].received,0.01);
  assert.equal(x.receiptReport.analysts.reduce((s,a)=>s+a.received,0),0);
  assert.equal(x.receiptReport.rows.reduce((s,r)=>s+r.received,0),0.008);
});


test('all operations are the default while a separate Control filter leaves global metrics unchanged', () => {
  const b = [
    bd({order:'EXP/1',nf:1}),
    bd({order:'IMP/1',nf:2,operation:'IMPORTAÇÃO - CTNR',supplier:'IMPORTADOR'}),
    bd({order:'MI/1',nf:3,operation:'COMERCIAL',market:'MI',supplier:'CLIENTE MI'}),
    bd({order:'TR/1',nf:4,operation:'TRANSFERÊNCIA ARMAZENAGEM',market:'MI',supplier:'ARMAZÉM'}),
    bd({order:'AIR/1',nf:5,operation:'EXPORTAÇÃO - AEREO',supplier:'AEREO'}),
    bd({order:'ALIAS/1',nf:6,operation:' importacao - ctnr ',supplier:'IMPORTADOR'}),
  ];
  const c = ['EXP/1','IMP/1','MI/1','TR/1','AIR/1','ALIAS/1'].map((ref,index)=>cr({ref,value:(index+1)*100}));
  const x = run(b,c), filtered = run(b,c,{controlOperation:'COMERCIAL'});
  const omitControl = ({controlReport,correctionImpact,meta,...main})=>{const {controlOperation,controlOperations,...globalMeta}=meta;return {...main,meta:globalMeta};};
  assert.deepEqual(omitControl(x),omitControl(filtered));
  assert.equal(x.summary.received,2100); assert.equal(x.installments.length,6);
  assert.equal(x.controlReport.installments.length,6);
  assert.equal(x.controlReport.installments.filter(i=>i.includedInConfirmed).reduce((n,i)=>n+i.received,0),2100);
  assert.equal(x.controlReport.installments.filter(i=>i.includedInRealized).reduce((n,i)=>n+i.received,0),2100);
  assert.equal(x.controlReport.processes.reduce((n,p)=>n+p.received,0),2100);
  assert.deepEqual(x.controlReport.operationOptions,['COMERCIAL','EXPORTAÇÃO - AEREO','EXPORTAÇÃO - CTNR','IMPORTAÇÃO - CTNR','TRANSFERÊNCIA ARMAZENAGEM']);
  assert(x.controlReport.supplierOptions.includes('CLIENTE MI'));
  assert.deepEqual(x.controlReport.installments.find(i=>i.reference==='ALIAS/1').operations,['IMPORTAÇÃO - CTNR']);
  assert.equal(filtered.controlReport.installments.length,1);
  assert.equal(filtered.controlReport.installments[0].reference,'MI/1');
  assert.equal(filtered.controlReport.installments[0].includedInRealized,true);
  assert.equal(filtered.controlReport.meta.operation,'COMERCIAL');
  assert.equal(filtered.controlReport.receiptReport,undefined);
  assert.deepEqual(x.receiptReport,filtered.receiptReport);
});

test('integral Control ignores BD years, excluded situations and war, preserving explicit filters and R/M/T', () => {
  const b = [
    bd({order:'MI/2025',nf:1,operation:'COMERCIAL',date:'2025-01-01',supplier:'CLIENTE MI'}),
    bd({order:'MI/2026',nf:2,operation:'COMERCIAL',date:'2026-01-01',supplier:'CLIENTE MI'}),
    bd({order:'OTHER/1',nf:3,operation:'IMPORTAÇÃO - CTNR',date:'2025-01-01',supplier:'OUTRO'}),
    bd({order:'WAR/1',nf:4,operation:'COMERCIAL',reason:'INTERFERÊNCIA EXTERNA',supplier:'CLIENTE MI'}),
    bd({order:'ANALYSIS/1',nf:5,operation:'COMERCIAL',status:'EM ANALISE',supplier:'CLIENTE MI'}),
  ];
  const c = [
    cr({ref:'MI/2025',value:100,comp:null,compensationYear:2025}),
    cr({ref:'MI/2025',value:200,comp:'2025-05-01',compensationYear:2026}),
    cr({ref:'MI/2025',value:300,status:'Dentro do Prazo',due:null}),
    cr({ref:'MI/2025',value:400,compensationYear:null}),
    ...['MI/2026','OTHER/1','WAR/1','ANALYSIS/1'].map(ref=>cr({ref,value:1000,comp:'2025-02-01',compensationYear:2025})),
  ];
  const x = run(b,c,{years:[2025],supplier:'CLIENTE MI',controlOperation:'comercial'});
  assert.deepEqual([...new Set(x.controlReport.installments.map(i=>i.reference))],['MI/2025','MI/2026','WAR/1','ANALYSIS/1']);
  assert.equal(x.controlReport.installments.filter(i=>i.includedInConfirmed).reduce((n,i)=>n+i.received,0),3200);
  assert.deepEqual(x.controlReport.installments.map(i=>i.status),['Conferir pagamento','Pago','Dentro do Prazo','Pago','Pago','Pago']);
  assert.equal(x.controlReport.installments[2].noDueDate,true);
  assert.equal(x.controlReport.meta.isIntegral,true);
  assert.equal(x.controlReport.meta.operation,'COMERCIAL');
  assert.equal(x.controlReport.meta.receivedOutsidePeriod,400);
  assert.equal(x.controlReport.meta.excludedYearUnknownAmount,100);
  assert.equal(x.controlReport.meta.incompatibleStatusExcludedAmount,300);
  assert.equal(x.summary.claimed,1000,'Default global scope includes the eligible commercial claim from the selected RNC year');
});

test('compound operations enter the default comparison once but are not allocated to a specific operation', () => {
  const x=run([bd({order:'EXP/1',nf:1}),bd({order:'MI/1',nf:2,operation:'COMERCIAL'})],[cr({ref:'EXP/1; MI/1',value:200})]);
  assert.equal(x.installments[0].linkState,'grouped'); assert.equal(x.summary.received,200);
  assert.equal(x.controlReport.installments[0].linkState,'grouped');
  assert.equal(x.controlReport.installments[0].includedInConfirmed,true);
  assert.equal(x.controlReport.installments[0].includedInRealized,true);
  assert.equal(x.controlReport.processes[0].received,200);
  const filtered=run([bd({order:'EXP/1',nf:1}),bd({order:'MI/1',nf:2,operation:'COMERCIAL'})],[cr({ref:'EXP/1; MI/1',value:200})],{controlOperation:'COMERCIAL'});
  assert.equal(filtered.controlReport.installments.length,0,'Mixed operations are not automatically attributed to an individual operation');
  assert.deepEqual(x.controlReport.installments[0].operations,['SEM OPERAÇÃO IDENTIFICADA']);
});


test('integral Control includes unlinked paid receipts and every unpaid year while R selects only paid rows', () => {
  const source=[
    cr({ref:'UNLINKED',value:400,compensationYear:2026}),
    cr({ref:'O/100-1',value:200,compensationYear:2026}),
    cr({ref:'OLD-PAID',value:300,comp:'2025-02-01',compensationYear:2025}),
    cr({ref:'OLD-OPEN',status:'Vencido',value:0,expected:50,year:2020,due:'2020-01-01',compensationYear:2020}),
    cr({ref:'FUTURE-OPEN',status:'Dentro do Prazo',value:0,expected:60,year:2027,due:'2027-01-01',compensationYear:2027}),
    cr({ref:'NO-DATE',status:'Dentro do Prazo',value:0,expected:70,year:2019,due:null,compensationYear:null}),
  ];
  const before=JSON.stringify(source),x=run([bd({date:'2024-01-01',reason:'INTERFERÊNCIA EXTERNA'})],source,{years:[2026]}),c=x.controlReport;
  assert.equal(c.meta.receivedConfirmed,600);assert.equal(c.meta.paidCount,2);
  assert.equal(c.meta.openBalance,180);assert.equal(c.meta.openCount,3);
  assert.equal(c.installments.length,5);assert(c.installments.every(i=>i.isControlRecord));
  assert.equal(c.installments.find(i=>i.reference==='UNLINKED').linkState,'unmatched');
  assert.equal(c.installments.find(i=>i.reference==='UNLINKED').includedInConfirmed,true);
  assert.equal(c.installments.find(i=>i.reference==='OLD-OPEN').status,'Vencido');
  assert.equal(c.installments.find(i=>i.reference==='NO-DATE').status,'Dentro do Prazo');
  assert.equal(x.summary.received,600);assert.equal(x.summary.receivedDifferentYear,200);assert.equal(x.summary.receivedSameYear,400);assert.equal(x.summary.claimed,0);
  assert.equal(x.receiptCohorts.meta.unresolvedAmount,400);assert.equal(JSON.stringify(source),before);
  assert.equal(x.receiptReport.annual.find(a=>a.year===2026).received,c.meta.receivedConfirmed);
});

test('agreement settlement retains paid history from other years without adding it to selected-year receipts', () => {
  const c=[cr({ref:'HISTORY',comp:'2025-02-01',compensationYear:2025,value:100}),cr({ref:'HISTORY',compensationYear:2026,value:200})];
  const x=run([],c,{years:[2026]}).controlReport,p=x.processes[0];
  assert.equal(x.installments.length,1);assert.equal(x.allInstallments.length,2);
  assert.equal(x.meta.receivedConfirmed,200);assert.equal(p.total,2);assert.equal(p.paid,2);assert.equal(p.settled,true);assert.equal(p.claimed,null);
  const open=run([],[c[0],cr({ref:'HISTORY',status:'Dentro do Prazo',value:0,expected:200,due:null})],{years:[2026]}).controlReport;
  assert.equal(open.installments.length,1);assert.equal(open.allInstallments.length,2);assert.equal(open.processes[0].paid,1);assert.equal(open.processes[0].settled,false);assert.equal(open.meta.openBalance,200);
});

test('invalid Pago remains review and never becomes an open installment; prejudice remains separate', () => {
  const c=run([],[cr({ref:'BAD-R',comp:null,value:100,expected:100}),cr({ref:'BAD-T',value:0,expected:200}),cr({ref:'LOSS',status:'Prejuízo Minerva',value:0,expected:300})],{years:[2026]}).controlReport;
  assert.equal(c.meta.receivedConfirmed,0);assert.equal(c.meta.openBalance,0);assert.equal(c.meta.openCount,0);
  assert.deepEqual(c.installments.map(i=>i.status),['Conferir pagamento','Conferir pagamento','Prejuízo Minerva']);
  assert.equal(c.processes.every(p=>!p.settled),true);
});

test('supplier filters accept original Control names and safe BD names; unknown links never disappear from all operations', () => {
  const b=[bd({supplier:'ARMADOR A'})],c=[cr({supplier:'ARMADOR A LTDA',value:100}),cr({ref:'UNKNOWN',supplier:'TRANSPORTADOR LOCAL',value:200})];
  const full=run(b,c,{years:[2026]}).controlReport;
  assert(full.supplierOptions.includes('ARMADOR A LTDA'));assert(full.supplierOptions.includes('TRANSPORTADOR LOCAL'));
  assert.equal(run(b,c,{years:[2026],supplier:'ARMADOR A LTDA'}).controlReport.meta.receivedConfirmed,100);
  assert.equal(run(b,c,{years:[2026],supplier:'ARMADOR A'}).controlReport.meta.receivedConfirmed,100);
  const unknown=run(b,c,{years:[2026],controlOperation:'SEM OPERAÇÃO IDENTIFICADA'}).controlReport;
  assert.equal(unknown.meta.receivedConfirmed,200);assert.equal(unknown.installments[0].reference,'UNKNOWN');
});

test('generic references are not fused and distinct confessions keep separate agreements', () => {
  const c=run([],[cr({ref:null,status:'Dentro do Prazo',value:0}),cr({ref:'CCO',status:'Dentro do Prazo',value:0}),cr({ref:'ORDER',confession:'A'}),cr({ref:'ORDER',confession:'B'})]).controlReport;
  assert.equal(c.processes.length,4);assert.equal(c.processes.every(p=>p.total===1),true);
});


test('safe order and NF aliases share one agreement history', () => {
  const c=run([bd({order:'ORDER/1',nf:123})],[cr({ref:'ORDER/1',comp:'2025-02-01',compensationYear:2025}),cr({ref:123,status:'Dentro do Prazo',value:0,due:null})],{years:[2026]}).controlReport;
  assert.equal(c.processes.length,1);assert.equal(c.allInstallments.length,2);assert.equal(c.processes[0].total,2);assert.equal(c.processes[0].paid,1);assert.equal(c.processes[0].settled,false);
});
