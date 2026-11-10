'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(ref,status,amount)=>Object.assign(Array(64).fill(null),{0:ref,1:'2026-01-01',3:'ME',6:status,10:'AVARIA',22:ref,25:'COMERCIAL',28:'Fornecedor QA',35:amount});
const paid=(ref,value)=>Object.assign(Array(32).fill(null),{1:2026,3:'ME',7:ref,10:'Fornecedor QA',12:'Pago',14:value,17:'2026-02-01',19:value});
const open=(ref,value)=>Object.assign(paid(ref,0),{12:'Vencido',14:value,17:null,19:null});
const forwarded='RESSARCIMENTO ENCAMINHADO',negotiating='EM NEGOCIAÇÃO - PROCEDENTE';
const bd=[bh,claim('QA/1',forwarded,100),claim('QA/2',negotiating,200),claim('QA/3','EM ANÁLISE',300),claim('QA/4','AGUARDANDO CUSTOS',400),claim('QA/5','RESPONDIDO - NÃO PROCEDE',500)];
const control=[ch,paid('QA/1',10),paid('QA/2',20),paid('QA/1; QA/2',30),paid('QA/1; AUSENTE',40),paid('AUSENTE',50),open('QA/1',60),open('QA/2',70),open('QA/1; QA/2',80),open('AUSENTE',90)];
const opts={years:[2026],asOf:'2026-11-10'};
test('multiple BD situations use OR, recalculate supplier money and count each grouped payment once',()=>{
 const full=E.analyze(bd,control,{...opts,claimStatuses:[forwarded,negotiating]}),lean=E.analyze(bd,control,{...opts,claimStatuses:[forwarded,negotiating],reportView:'suppliers'});
 assert.equal(full.summary.claimed,300);assert.equal(full.summary.received,60);assert.equal(full.summary.negotiating,200);
 assert.equal(full.suppliers[0].openBalance,210);assert.equal(full.suppliers[0].overdueBalance,210);
 assert.deepEqual(full.receiptCohorts.rows.map(row=>row.row),[2,3,4]);
 assert.deepEqual(full.supplierOpenReport.installments.map(row=>row.row),[7,8,9]);
 assert.deepEqual(lean.summary,full.summary);assert.deepEqual(lean.suppliers,full.suppliers.map(({openInstallments,...rest})=>rest));
 assert.deepEqual(lean.claimStatusOptions,full.claimStatusOptions);assert.equal(full.claimStatusOptions.length,5);
});
test('single situation does not assign or split a mixed or incomplete installment',()=>{
 const model=E.analyze(bd,control,{...opts,claimStatuses:[forwarded]});
 assert.equal(model.summary.claimed,100);assert.equal(model.summary.received,10);assert.equal(model.summary.negotiating,0);
 assert.equal(model.suppliers[0].openBalance,60);assert.deepEqual(model.receiptCohorts.rows.map(row=>row.row),[2]);
 assert.deepEqual(model.controlReport.allInstallments.map(row=>row.row),[2,7]);
});
test('clearing situations restores confirmed unmatched receipts and unlinked open balances',()=>{
 const before=JSON.stringify({bd,control}),full=E.analyze(bd,control,opts),cleared=E.analyze(bd,control,{...opts,claimStatuses:[]});
 assert.deepEqual(cleared,full);assert.equal(full.summary.received,150);assert.equal(full.suppliers[0].openBalance,300);
 assert.equal(JSON.stringify({bd,control}),before);
});
test('all BD situations remain selectable; default financial exclusions still apply',()=>{
 const model=E.analyze(bd,control,{...opts,claimStatuses:['EM ANÁLISE','AGUARDANDO CUSTOS']});
 assert.equal(model.summary.claimed,0);assert.equal(model.summary.received,0);
 assert(model.claimStatusOptions.includes('RESPONDIDO - NÃO PROCEDE'));
 assert.deepEqual(model.meta.claimStatuses,['EM ANÁLISE','AGUARDANDO CUSTOS']);
});
