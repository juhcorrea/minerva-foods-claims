'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(size,values)=>Object.assign(Array(size).fill(null),values);
const bh=row(57,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(extra={})=>row(57,{0:'SGR-QA',1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/1',24:1,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100000,40:84000,...extra});
const installment=(extra={})=>row(32,{1:2026,3:'ME',7:'QA/1',10:'Fornecedor QA',11:'Boleto',12:'Dentro do Prazo',13:'2026-12-01',14:7000,17:null,19:null,20:100000,...extra});
const run=(claims,controls,options={})=>E.analyze([bh,...claims],[ch,...controls],{years:[2026],asOf:'2026-11-10',...options});

test('AO 84k equals all scheduled installments even with 5k partially received, including past payment years',()=>{
 const claims=[claim()],controls=Array.from({length:12},(_,i)=>installment(i===0?{7:'QA/1; 1',12:'Pago',17:'2024-02-01',19:5000}:{})),before=JSON.stringify({claims,controls}),m=run(claims,controls),a=m.claimValueAudit.rows[0];
 assert.equal(a.claimed,100000);assert.equal(a.originalClaimValue,100000,'Repeated U is never multiplied by twelve');assert.equal(a.bdReceived,84000);assert.equal(a.controlExpected,84000);assert.equal(a.deltaReceived,0);assert.equal(a.hasReceivedMismatch,false);assert.equal(a.hasClaimValueMismatch,false);assert.equal(a.status,'Conferido');
 assert.equal(a.receivedConfirmed,5000);assert.equal(a.remainingScheduled,79000);assert.equal(a.installmentCount,12);assert.equal(a.receivedConfirmedCount,1);assert.equal(a.pendingInstallmentCount,11);assert.equal(a.unconfirmedPaidCount,0);assert.equal(new Set(a.controlRows).size,12);
 assert.equal(m.summary.received,0,'Current-period financial cash keeps the selected year');assert.equal(m.summary.openBalance,77000,'Official M/O open balance remains independent');assert.equal(m.claimValueAudit.uCorrections.length,0);assert.equal(JSON.stringify({claims,controls}),before);
});

test('missing O, missing confirmed payment inputs and absent Control stay incomplete, never fabricated as zero',()=>{
 const variants=[{12:'Pago',17:null,19:5000},{12:'Pago',17:'bad',19:5000},{12:'Pago',17:'2026-01-01',19:null},{12:'Pago',17:'2026-01-01',19:0}];
 for(const invalid of variants){const a=run([claim({40:14000})],[installment({12:'Pago',17:'2026-01-01',19:1000}),installment(invalid)]).claimValueAudit.rows[0];assert.equal(a.receivedConfirmed,null);assert.equal(a.remainingScheduled,null);assert.equal(a.unconfirmedPaidCount,1);assert.equal(a.receivedConfirmedCount,1);assert.equal(a.hasReceivedMismatch,false);}
 const missingO=run([claim()],[installment({14:null})]).claimValueAudit.rows[0];assert.equal(missingO.controlExpected,null);assert.equal(missingO.receivedConfirmed,0);assert.equal(missingO.remainingScheduled,null);
 const absent=run([claim()],[]).claimValueAudit.rows[0];assert.equal(absent.receivedConfirmed,null);assert.equal(absent.remainingScheduled,null);assert.equal(absent.installmentCount,0);
});

test('shared references count cash once and incomplete links block the remaining total without allocating it',()=>{
 const claims=[claim({22:'QA/1',24:1,35:60000,40:42000}),claim({22:'QA/2',24:2,35:40000,40:42000})],controls=[installment({7:'QA/1; QA/2; 1; 2',14:42000,12:'Pago',17:'2026-02-01',19:5000}),installment({7:'QA/1; QA/2',14:42000})],a=run(claims,controls).claimValueAudit.rows[0];
 assert.equal(a.grouped,true);assert.equal(a.originalClaimValue,null);assert.equal(a.receivedConfirmed,5000);assert.equal(a.remainingScheduled,79000);assert.equal(a.installmentCount,2);assert.equal(a.receivedConfirmedCount,1);assert.equal(a.hasReceivedMismatch,false);
 const incomplete=run([claim({40:7000})],[installment({7:'QA/1; UNKNOWN',12:'Pago',17:'2026-02-01',19:5000})]).claimValueAudit.rows[0];assert.equal(incomplete.complete,false);assert.equal(incomplete.receivedConfirmed,5000);assert.equal(incomplete.remainingScheduled,null);assert.equal(incomplete.hasReceivedMismatch,false);
});

test('overpayment stays negative and cash diagnostics never create an AO-versus-T mismatch',()=>{
 const a=run([claim({40:7000})],[installment({12:'Pago',17:'2026-01-01',19:8000})]).claimValueAudit.rows[0];
 assert.equal(a.receivedConfirmed,8000);assert.equal(a.remainingScheduled,-1000);assert.equal(a.hasReceivedMismatch,false);assert.equal(a.deltaReceived,0);assert.equal(a.status,'Conferido');
});
