'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido(USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',30:'Ano Compensação',31:'Analista'});
const claim=(o={})=>Object.assign(Array(57).fill(null),{0:o.sgr||'CLAIM1',1:o.date||'2025-11-06',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:o.order||'ORDER/1',24:o.nf||123,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier||'ARMADOR',35:o.claimed===undefined?1000:o.claimed,40:o.received===undefined?600:o.received,56:'Analista BD'});
const installment=(o={})=>Object.assign(Array(32).fill(null),{1:o.year===undefined?2025:o.year,3:'ME',7:o.ref||'ORDER/1',9:o.confession||'ACORDO 1',10:'ARMADOR',11:'Boleto',12:o.status||'Dentro do Prazo',13:o.due===undefined?null:o.due,14:o.expected===undefined?300:o.expected,17:o.comp===undefined?null:o.comp,19:o.received===undefined?0:o.received,20:o.integral===undefined?900:o.integral,21:o.agreed===undefined?600:o.agreed,30:2026,31:'Analista Controle'});
const run=(b,c,options={},headers={})=>E.analyze([headers.bd||bh,...b],[headers.control||ch,...c],{years:[2025,2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...options});

test('AO reconciles all O installments while U is checked once per claim and never substitutes actual T receipts',()=>{
 const b=[claim()],c=[installment({ref:'ORDER/1',year:2026}),installment({ref:123,status:'Vencido',due:'2020-01-01',year:2026})],before=JSON.stringify({b,c});
 const m=run(b,c),a=m.claimValueAudit,r=a.rows[0];
 assert.equal(r.claimed,1000);assert.equal(r.bdReceived,600);assert.equal(r.controlExpected,600);assert.equal(r.originalClaimValue,900);
 assert.equal(r.prejudice,400);assert.equal(r.originalPrejudice,300);assert.equal(r.deltaReceived,0);assert.equal(r.hasReceivedMismatch,false);assert.equal(r.hasClaimValueMismatch,true);
 assert.equal(a.summary.claimed,1000);assert.equal(a.summary.originalClaimValue,900);assert.equal(a.summary.claimValueCorrectionRows,2);assert.equal(m.summary.received,0);assert.equal(m.summary.loss,1000);
 assert.deepEqual(a.uCorrections.map(x=>x.cell),['U2','U3']);assert(a.uCorrections.every(x=>x.corrected===1000));
 const g=m.correctionGroups[0];assert.equal(m.correctionGroups.length,1);assert.equal(g.year.changes.length,2);assert.equal(g.claimValue.changes.length,2);assert.equal(g.market.changes.length,0);assert.equal(g.correctionCount,4);assert.equal(g.rowCount,2);assert.equal(m.summary.correctionCount,4);assert(g.changes.some(x=>x.cell==='U2'));
 assert.equal(JSON.stringify({b,c}),before,'Financial audit never edits original sheets');
});

test('all statuses and payment years contribute O exactly once, including compound order and NF aliases',()=>{
 const c=[installment({ref:'ORDER/1; 123',status:'Pago',comp:'2023-02-01',expected:100,received:888,integral:1000}),installment({ref:123,status:'Vencido',expected:200,received:0,integral:1000}),installment({ref:'ORDER/1',status:'Pago',comp:'2026-02-01',expected:300,received:111,integral:1000})];
 const m=run([claim()],c,{years:[2025,2026]}),r=m.claimValueAudit.rows[0];
 assert.equal(r.controlRows.length,3);assert.equal(r.controlExpected,600);assert.equal(r.bdReceived,600);assert.equal(r.hasReceivedMismatch,false);assert.equal(m.summary.received,111);
 assert.equal(m.claimValueAudit.summary.controlRows,3);assert.equal(m.claimValueAudit.uCorrections.length,0);assert.equal(r.prejudice,400);
});

test('connected multi-claim references aggregate every BD and Control row once without allocating U',()=>{
 const b=[claim({order:'A/1',nf:1,claimed:1000,received:600}),claim({order:'B/1',nf:2,claimed:500,received:200}),claim({order:'C/1',nf:3,claimed:300,received:100})];
 const c=[installment({ref:'A/1; B/1',expected:700,integral:1800}),installment({ref:'B/1; C/1',expected:200,integral:1800})];
 const a=run(b,c).claimValueAudit,r=a.rows[0];
 assert.equal(a.rows.length,1);assert.deepEqual(r.bdRows,[2,3,4]);assert.deepEqual(r.controlRows,[2,3]);assert.equal(r.claimed,1800);assert.equal(r.bdReceived,900);assert.equal(r.controlExpected,900);assert.equal(r.prejudice,900);assert.equal(r.deltaReceived,0);
 assert.equal(r.originalClaimValue,null);assert.equal(r.originalPrejudice,null);assert.equal(r.grouped,true);assert.equal(r.status,'Agrupado sem rateio');assert.equal(r.canCorrectClaimValue,false);assert.equal(a.uCorrections.length,0);assert.equal(a.summary.originalPrejudice,null);assert.equal(a.summary.missingAmounts.originalPrejudice,1);
});

test('unknown reference parts or linked BD claims outside selected scope block corrections and comparisons',()=>{
 const unknown=run([claim()],[installment({ref:'ORDER/1; UNKNOWN'})]).claimValueAudit;
 assert.equal(unknown.rows[0].complete,false);assert.equal(unknown.rows[0].uncertain,true);assert.equal(unknown.rows[0].controlExpected,300);assert.equal(unknown.rows[0].deltaReceived,null);assert.equal(unknown.rows[0].originalPrejudice,null);assert.equal(unknown.uCorrections.length,0);
 const cross=run([claim({order:'A/1',nf:1}),claim({order:'B/1',nf:2,date:'2024-01-01'})],[installment({ref:'A/1; B/1'})],{years:[2025]}).claimValueAudit;
 assert.deepEqual(cross.rows[0].bdRows,[2]);assert.deepEqual(cross.rows[0].outsideScopeBdRows,[3]);assert.equal(cross.rows[0].claimed,1000);assert.equal(cross.rows[0].canCorrectClaimValue,false);assert.equal(cross.uCorrections.length,0);assert.equal(cross.rows[0].status,'Conferir vínculo');
});

test('missing headers and monetary cells remain unavailable instead of being silently treated as zero',()=>{
 const bdHeader=[...bh],controlHeader=[...ch];bdHeader[40]='';controlHeader[20]='';
 const missing=run([claim()],[installment()],{}, {bd:bdHeader,control:controlHeader}).claimValueAudit;
 assert.equal(missing.meta.sourcesAvailability.AO,false);assert.equal(missing.meta.sourcesAvailability.U,false);assert.equal(missing.rows[0].bdReceived,null);assert.equal(missing.rows[0].originalClaimValue,null);assert.equal(missing.rows[0].prejudice,null);assert.equal(missing.summary.prejudice,null);assert.equal(missing.uCorrections.length,0);
 const bad=run([claim({received:null})],[installment({expected:null})]).claimValueAudit;
 assert.equal(bad.rows[0].bdReceived,null);assert.equal(bad.rows[0].controlExpected,null);assert.equal(bad.rows[0].deltaReceived,null);assert.equal(bad.rows[0].hasReceivedMismatch,false);assert.equal(bad.summary.controlExpected,null);assert.equal(bad.rows[0].status,'Dados incompletos');
 const noControls=run([claim()],[]).claimValueAudit;
 assert.equal(noControls.rows[0].controlExpected,null);assert.equal(noControls.rows[0].status,'Sem correspondência');
});

test('valid zero and negative prejudice are preserved, with received discrepancies above one cent flagged',()=>{
 const negative=run([claim({claimed:100,received:200})],[installment({expected:200,integral:100})]).claimValueAudit.rows[0];
 assert.equal(negative.prejudice,-100);assert.equal(negative.originalPrejudice,-100);assert.equal(negative.hasReceivedMismatch,false);
 const zero=run([claim({received:0})],[installment({expected:0,integral:1000})]).claimValueAudit.rows[0];assert.equal(zero.bdReceived,0);assert.equal(zero.controlExpected,0);assert.equal(zero.prejudice,1000);
 assert.equal(run([claim()],[installment({expected:600.01})]).claimValueAudit.rows[0].hasReceivedMismatch,false);
 assert.equal(run([claim()],[installment({expected:600.02})]).claimValueAudit.rows[0].hasReceivedMismatch,true);
});

test('an otherwise correct order receives its own U correction group; incomplete original U is not a fabricated before value',()=>{
 const m=run([claim()],[installment({integral:null}),installment({integral:900})]);
 assert.equal(m.correctionGroups.length,1);assert.equal(m.correctionGroups[0].hasClaimValueCorrection,true);assert.equal(m.correctionGroups[0].year.changes.length,0);assert.equal(m.correctionGroups[0].claimValue.changes.length,2);
 const a=m.claimValueAudit;assert.equal(a.rows[0].originalClaimValue,null);assert.equal(a.rows[0].originalPrejudice,null);assert.equal(a.uCorrections.length,2);assert.equal(a.summary.originalPrejudice,null);
});

test('fully agreed claim with thirteen unpaid installments is not a fully paid agreement',()=>{
 const c=Array.from({length:13},()=>installment({ref:'99103',integral:2600,agreed:2600,expected:1300/13,status:'Vencido',due:'2025-01-01'}));
 const m=run([],c),p=m.controlReport.processes[0];
 assert.equal(p.integralControl,2600);assert.equal(p.agreed,2600);assert.equal(p.agreementRate,1);assert.equal(p.agreementStatus,'100% do claim acordado');
 assert.equal(p.receivedAllYears,0);assert.equal(p.agreementBalance,2600);assert.equal(p.scheduledTotal,1300);assert.equal(p.total,13);assert.equal(p.paid,0);assert.equal(p.settled,false);assert.equal(p.received,0);assert.equal(p.agreementReview,false);
});

test('agreement balances retain all payment years and actual T amounts separately from scheduled O',()=>{
 const c=[installment({ref:'99103',status:'Pago',comp:'2025-02-01',integral:1000,agreed:1000,expected:400,received:350}),installment({ref:'99103',status:'Pago',comp:'2026-02-01',integral:1000,agreed:1000,expected:200,received:175}),installment({ref:'99103',integral:1000,agreed:1000,expected:400})];
 const m=run([],c,{years:[2026]}),p=m.controlReport.processes[0];
 assert.equal(m.controlReport.meta.receivedConfirmed,175);assert.equal(p.receivedAllYears,525);assert.equal(p.agreementBalance,475);assert.equal(p.scheduledTotal,1000);assert.equal(m.controlReport.meta.openBalance,400);assert.equal(p.paid,2);assert.equal(p.total,3);assert.equal(p.settled,false);
 const overpaid=run([],[installment({ref:'OVER',status:'Pago',comp:'2026-02-01',integral:100,agreed:100,received:120})]).controlReport.processes[0];assert.equal(overpaid.agreementBalance,-20);
});

test('conflicting or missing U/V do not sum repeated amounts or invent an agreement rate',()=>{
 const p=run([],[installment({ref:'CONFLICT',integral:1000,agreed:900}),installment({ref:'CONFLICT',integral:2000,agreed:800})]).controlReport.processes[0];
 assert.equal(p.integralControl,null);assert.equal(p.agreed,null);assert.equal(p.agreementRate,null);assert.equal(p.agreementBalance,null);assert.equal(p.agreementReview,true);assert(p.agreementReasons.length>=2);
 const controlHeader=[...ch];controlHeader[20]='';controlHeader[21]='';
 const missing=run([],[installment({ref:'NO-HEADERS'})],{}, {control:controlHeader}).controlReport.processes[0];assert.equal(missing.agreed,null);assert.equal(missing.integralControl,null);assert.equal(missing.agreementReview,true);
});

test('U-only corrections for distinct NF claims on the same order share one follow-up row',()=>{
 const b=[claim({order:'SAME/ORDER',nf:111,claimed:1000}),claim({order:'SAME/ORDER',nf:222,claimed:500})];
 const c=[installment({ref:111,integral:900}),installment({ref:222,integral:400})];
 const m=run(b,c);assert.equal(m.claimValueAudit.rows.length,2);assert.equal(m.claimValueAudit.uCorrections.length,2);assert.equal(m.correctionGroups.length,1);assert.equal(m.correctionGroups[0].reference,'SAME/ORDER');assert.deepEqual(m.correctionGroups[0].bdRows,[2,3]);assert.equal(m.correctionGroups[0].claimValue.changes.length,2);assert.equal(m.correctionGroups[0].hasConflictingCorrections,true,'Different per-claim targets remain visible instead of being merged into one amount');
});
