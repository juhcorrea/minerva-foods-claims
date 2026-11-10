'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const bd=(o={})=>Object.assign(Array(57).fill(null),{0:o.ref||'A',1:o.date||'2026-01-01',3:'ME',6:o.status||'RESSARCIMENTO ENCAMINHADO',10:o.reason||'AVARIA',22:o.ref||'A',24:o.nf||1,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier||'FORNECEDOR EXEMPLO',35:1000,56:'Analista fictício'});
const cr=(o={})=>Object.assign(Array(32).fill(null),{1:o.year===undefined?2026:o.year,3:'ME',7:o.ref||'A',10:o.supplier||'FORNECEDOR EXEMPLO',11:'Depósito',12:o.status===undefined?'Dentro do Prazo':o.status,13:o.due===undefined?'2026-12-01':o.due,14:o.amount===undefined?10:o.amount,17:o.comp||null,19:o.received||null,31:'Analista fictício'});
const run=(b,c,o={})=>E.analyze([bh,...b],[ch,...c],{years:[2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...o});
const own=(m,name='FORNECEDOR EXEMPLO')=>m.suppliers.find(s=>s.name===name);

test('supplier open ledger includes old and unknown claim years with each Control row counted once',()=>{
 const b=[bd({ref:'OLD',date:'2024-01-01'}),bd({ref:'NEW',nf:2})];
 const c=[cr({ref:'OLD',amount:10}),cr({ref:'NEW',amount:20,status:'Vencido'}),cr({ref:'UNLINKED',year:1900,amount:30}),cr({ref:'OLD; NEW',amount:40})];
 const before=JSON.stringify({b,c}),m=run(b,c),s=own(m);
 assert.equal(s.openBalance,100);assert.equal(s.overdueBalance,20);assert.equal(s.onTimeBalance,80);assert.equal(s.openCount,4);assert.equal(s.overdue,1);assert.equal(s.onTime,3);
 assert.deepEqual(s.openInstallments.map(x=>x.row),[2,3,4,5]);assert.equal(s.openInstallments[3].expected,40);assert.equal(s.openInstallments[3].bdRows.length,2);
 assert.equal(m.supplierOpenReport.meta.openBalance,100);assert.equal(m.supplierOpenReport.installments.length,4);assert.equal(JSON.stringify({b,c}),before);
 assert.equal(own(run(b,c,{years:[2025]})).openBalance,100,'Year selection does not remove old debt');
});

test('M is authoritative for supplier debt while existing Control reports keep date-derived status',()=>{
 const c=[cr({status:'  vencido  ',due:'2026-10-30',amount:7}),cr({status:'dentro  do prazo',due:'2020-01-01',amount:11}),cr({status:'Dentro do Prazo',due:'invalid date',amount:13}),cr({status:'',amount:100}),cr({status:'Cancelado',amount:100}),cr({status:'Pago',amount:100}),cr({status:'Prejuízo Minerva',amount:100})];
 const m=run([bd()],c),s=own(m);
 assert.equal(s.openBalance,31);assert.equal(s.overdueBalance,7);assert.equal(s.onTimeBalance,24);assert.equal(s.openCount,3);
 assert.equal(m.controlReport.allInstallments.find(r=>r.row===2).status,'Dentro do Prazo');assert.equal(s.openInstallments[0].status,'Vencido');
 assert.equal(m.controlReport.allInstallments.find(r=>r.row===3).status,'Vencido');assert.equal(s.openInstallments[1].status,'Dentro do Prazo');
 assert.equal(m.controlReport.allInstallments.find(r=>r.row===4).status,'Conferir previsão');assert.equal(s.openInstallments[2].status,'Dentro do Prazo');
 assert.equal(own(run([bd()],c,{asOf:'2027-01-01'})).overdueBalance,7,'Analysis date does not rewrite M');
});

test('open-only suppliers without claims or receipts are retained with zero financial metrics',()=>{
 const m=run([],[cr({ref:'NO LINK',supplier:'Fornecedor somente saldo',status:'Vencido',amount:25})]),s=own(m,'Fornecedor somente saldo');
 assert(s);assert.equal(s.claimed,0);assert.equal(s.received,0);assert.equal(s.receivedComparable,0);assert.equal(s.loss,0);assert.equal(s.comparableLoss,0);assert.equal(s.openBalance,25);assert.equal(s.overdueBalance,25);assert.equal(s.recoveryRate,null);assert.equal(s.comparableRecoveryRate,null);
 assert.deepEqual(s.receivedByClaimYear,Object.fromEntries([...m.meta.claimYearDisplayYears,'other','unknown'].map(year=>[year,0])));assert.equal(s.openInstallments[0].linkState,'unmatched');
});

test('global correction scenario and supplier filter govern attribution while M and O remain intact',()=>{
 const b=[bd({supplier:'Fornecedor validado'})],c=[cr({supplier:'Fornecedor original',amount:21,year:2024})];
 const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c);
 assert.equal(own(original,'Fornecedor original').openBalance,21);assert.equal(own(original,'Fornecedor validado').openBalance,0);
 assert.equal(own(corrected,'Fornecedor validado').openBalance,21);assert.equal(corrected.supplierOpenReport.installments[0].originalSupplier,'Fornecedor original');assert.equal(corrected.supplierOpenReport.installments[0].supplierSource,'BD AC — Negociação');
 assert.equal(original.supplierOpenReport.installments[0].year,2024);assert.equal(corrected.supplierOpenReport.installments[0].year,2026);assert.equal(corrected.supplierOpenReport.installments[0].originalYear,2024);
 assert.equal(run(b,c,{supplier:'Fornecedor original',correctionScenario:'original'}).supplierOpenReport.meta.openBalance,21);
 assert.equal(run(b,c,{supplier:'Fornecedor original'}).supplierOpenReport.meta.openBalance,0);
 assert.equal(run(b,c,{supplier:'Fornecedor validado'}).supplierOpenReport.meta.openBalance,21);
 assert.equal(run(b,[cr({ref:'A; UNKNOWN',supplier:'Fornecedor original',amount:21})]).supplierOpenReport.installments[0].supplier,'Fornecedor original','Incomplete links retain K');
});

test('global operation rules include unknowns only without a specific filter and ignore claim eligibility',()=>{
 const b=[bd({ref:'CTNR',status:'EM ANALISE',reason:'INTERFERÊNCIA EXTERNA'}),bd({ref:'CAR',nf:2,operation:'EXPORTAÇÃO - CARRETA'}),bd({ref:'LOCAL',nf:3,operation:'COMERCIAL'})];
 const c=[cr({ref:'CTNR',amount:10}),cr({ref:'CAR',amount:20}),cr({ref:'LOCAL',amount:30}),cr({ref:'UNKNOWN',amount:40}),cr({ref:'CTNR; CAR',amount:50}),cr({ref:'CTNR; LOCAL',amount:60})];
 const m=run(b,c);assert.equal(own(m).openBalance,210);assert.equal(m.supplierOpenReport.excluded.length,0);
 const specific=run(b,c,{operation:'EXPORTAÇÃO - CTNR'});assert.equal(own(specific).openBalance,10);assert.equal(specific.supplierOpenReport.meta.openCount,1);
 assert.equal(own(run(b,c,{controlOperation:'COMERCIAL'})).openBalance,210,'Control tab filter does not leak into supplier balances');
 assert.equal(own(run(b,c,{operation:'COMERCIAL'})).openBalance,30,'Any explicit BD operation is supported');
});

test('missing O remains visible as incomplete and missing N never excludes explicit open status',()=>{
 const m=run([],[cr({ref:'NONE',amount:null,due:null}),cr({ref:'NONE',status:'Vencido',amount:8,due:''}),cr({ref:'NONE',amount:'not a number',due:null}),cr({ref:'NONE',amount:0,due:null})]),s=own(m);
 assert.equal(s.openCount,4);assert.equal(s.openBalance,8);assert.equal(s.noDueBalance,8);assert.equal(s.missingExpectedAmounts,2);assert.equal(s.openBalanceIncomplete,true);assert.equal(m.supplierOpenReport.meta.openBalanceIncomplete,true);
 assert.deepEqual(s.openInstallments.map(r=>r.expected),[null,8,null,0]);assert.equal(s.openInstallments[0].expectedMissing,true);assert.equal(s.openInstallments[3].expectedMissing,false);
});

test('fractional source amounts are summed before rounding and detail retains original precision',()=>{
 const m=run([],[cr({ref:'UNKNOWN',amount:.004}),cr({ref:'UNKNOWN',amount:.004}),cr({ref:'UNKNOWN',amount:.004})]),s=own(m);
 assert.equal(s.openBalance,.01);assert.equal(s.onTimeBalance,.01);assert.equal(m.supplierOpenReport.meta.openBalance,.01);assert(s.openInstallments.every(r=>r.expected===.004));
});

test('new open balance calculation preserves paid cash, comparable cash, losses and receipt cohorts',()=>{
 const b=[bd({ref:'OLD',date:'2024-01-01'}),bd({ref:'NEW',nf:2})];
 const paid=[cr({ref:'OLD',status:'Pago',comp:'2026-02-01',received:100}),cr({ref:'NEW',status:'Pago',comp:'2026-02-01',received:200})];
 const before=run(b,paid),after=run(b,[...paid,cr({ref:'OLD',status:'Vencido',amount:30}),cr({ref:'UNKNOWN',amount:40})]);
 for(const field of ['received','receivedComparable','receivedSameYear','receivedDifferentYear','receivedUnknownYear','receivedCount','claimed','negotiating','loss','comparableLoss']){assert.equal(after.summary[field],before.summary[field],field);assert.equal(own(after)[field],own(before)[field],field);}
 assert.deepEqual(after.receiptCohorts,before.receiptCohorts);assert.deepEqual(after.annual,before.annual);assert.deepEqual(after.monthly,before.monthly);assert.equal(own(after).openBalance,70);
});
