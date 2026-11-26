'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',2:'Área',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(ref,extra={})=>Object.assign(Array(64).fill(null),{0:ref,1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:ref,24:ref,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Exemplo',35:100,40:100,56:'Analista Exemplo'},extra);
const control=(ref,extra={})=>Object.assign(Array(32).fill(null),{1:2026,2:'SGR ME',3:'ME',7:ref,10:'Fornecedor Exemplo',11:'Depósito',12:'Pago',13:'2026-07-01',14:100,17:'2026-07-01',19:100,20:100,30:2026,31:'Analista Exemplo'},extra);
const run=(b,c,o={})=>E.analyze([bh,...b],[ch,...c],{allYears:true,asOf:'2026-11-26',correctionScenario:'corrected',...o});
const queue=model=>E.buildCorrectionReviewItems(model),view=model=>E.getCorrectionReviewModel(model);

test('only the normalized Reembolso label in Control C is excluded from correction, while cash and sources stay intact',()=>{
 const b=[],c=[control('REF/1',{2:'REEMBOLSO'}),control('REF/2',{2:'  reembolso\u00a0 '}),control('REF/3',{2:'Réembolso'}),control('REF/4',{2:'SGR ME',10:'REEMBOLSO',11:'Reembolso'}),control('REF/5',{2:'REEMBOLSOS'}),control('REF/6',{2:'REEMBOLSO PARCIAL'}),control('REF/7',{2:'Gado Vivo'})],before=JSON.stringify({b,c}),model=run(b,c),projected=view(model);
 assert.deepEqual(projected.meta.correctionScope.excludedControlRows,[2,3,4,8]);
 assert.deepEqual(projected.meta.correctionScope.excludedReembolsoControlRows,[2,3,4]);assert.deepEqual(projected.meta.correctionScope.excludedGadoControlRows,[8]);
 assert.deepEqual(queue(model).flatMap(item=>item.controlRows).sort(),[5,6,7]);
 assert.equal(projected.baseReconciliation.meta.controlWithoutBd,3);assert.equal(projected.correctionImpact.summary.rowCount,3);assert.equal(projected.correctionImpact.summary.received,300);
 assert.equal(model.baseReconciliation.meta.controlWithoutBd,7);assert.equal(model.correctionImpact.summary.received,700);assert.equal(model.receiptReport.annual[0].received,700);assert.equal(model.controlReport.meta.receivedConfirmed,700);
 assert.equal(JSON.stringify({b,c}),before);
});

test('historical Reembolso without BD does not produce a missing-BD warning or progress target, and a genuine missing receipt stays visible',()=>{
 const b=[claim('CLAIM/UNPAID')],c=[control('HISTORICAL/1',{2:'REEMBOLSO'}),control('ORDINARY/1')],model=run(b,c),items=queue(model);
 assert(items.some(item=>item.issues.some(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL')));
 assert(items.some(item=>item.controlRows.includes(3)));assert(items.every(item=>!item.controlRows.includes(2)));
 const targets=E.correctionReviewTargets(model,[bh,...b],[ch,...c]);assert.equal(targets.length,items.length);assert(targets.every(target=>!target.item.controlRows.includes(2)));
 assert.equal(model.receiptReport.annual[0].received,200);
});

test('exclusive Reembolso links are removed from review audits and corrections without rewriting the financial model',()=>{
 const model=run([claim('REF/1',{25:'',35:100,40:80})],[control('REF/1',{2:'REEMBOLSO',1:2025,20:30,14:80,19:200})]),projected=view(model);
 assert(model.correctionGroups.length);assert(model.baseReconciliation.rows.some(row=>row.kind==='BD_MISSING_OPERATION'));assert(model.claimValueAudit.rows.length);
 assert.equal(queue(model).length,0);assert.equal(projected.corrections.length,0);assert.equal(projected.correctionGroups.length,0);assert.equal(projected.claimValueAudit.rows.length,0);assert.equal(projected.baseReconciliation.rows.length,0);
 assert.equal(projected.claimValueAudit.meta.excludedGadoGroups,0);assert.equal(projected.claimValueAudit.meta.excludedReembolsoGroups,1);assert.equal(projected.claimValueAudit.meta.excludedScopeGroups,1);
 assert.equal(model.receiptReport.annual[0].received,200);assert.equal(model.controlReport.meta.receivedConfirmed,200);assert.equal(model.controlReport.allInstallments.length,1);
});

test('mixed Reembolso and regular installments retain regular corrections but never compare a partial sum with the full BD amount',()=>{
 const model=run([claim('MIX/1',{25:''})],[control('MIX/1',{2:'REEMBOLSO',1:2024,20:10,14:60,19:60}),control('MIX/1',{1:2025,14:40,19:40})]),projected=view(model),items=queue(model);
 assert.equal(model.claimValueAudit.rows[0].controlExpected,100);assert.equal(model.claimValueAudit.rows[0].hasReceivedMismatch,false);assert.equal(projected.claimValueAudit.rows.length,0);
 assert(items.length>0);assert(items.every(item=>!item.controlRows.includes(2)));assert(items.some(item=>item.issues.some(issue=>issue.kind==='BD_MISSING_OPERATION')));
 assert(projected.correctionGroups.every(group=>group.rows.every(row=>row===3)&&group.changes.every(change=>change.row===3)));
 assert.deepEqual(projected.correctionGroups.flatMap(group=>group.year.changes.map(change=>change.original)),[2025]);assert.equal(projected.correctionImpact.summary.received,40);assert.equal(model.correctionImpact.summary.received,100);
 assert(E.buildCorrectionReviewItems(model,model.correctionGroups).every(item=>!item.controlRows.includes(2)));
});

test('Reembolso period and supplier excess warnings cannot activate a correction for a regular receipt',()=>{
 const b=[claim('MIX/1')],c=[control('MIX/1',{2:'REEMBOLSO',1:2024,19:100,14:100,17:'2026-08-01'}),control('MIX/1',{1:2025,19:50,14:50,17:'2026-07-01'})];
 const full=run(b,c),august=run(b,c,{allYears:false,years:[2026],months:[8]}),july=run(b,c,{allYears:false,years:[2026],months:[7]});
 assert(full.issues.some(issue=>issue.kind==='RECEIVED_ABOVE_FORWARDED'));assert(!view(full).issues.some(issue=>issue.kind==='RECEIVED_ABOVE_FORWARDED'));assert.equal(full.summary.received,150);
 assert.equal(queue(august).length,0);assert(queue(july).some(item=>item.controlRows.includes(3)));assert.equal(august.receiptReport.annual[0].received,100);
});

test('full and lean views agree on Reembolso correction scope in every scenario, preserving open balances',()=>{
 const b=[claim('REF/1'),claim('REF/2')],c=[control('REF/1',{2:'REEMBOLSO',1:2024,20:5}),control('REF/2',{1:2025,20:50}),control('HISTORICAL/1',{2:'REEMBOLSO',12:'Vencido',14:30,19:null,17:null})];
 for(const o of [{},{correctionScenario:'original'},{allYears:false,years:[2026],months:[7]},{supplier:'Fornecedor Exemplo'},{supplier:'Missing Supplier'}]){
  const full=run(b,c,o),lean=run(b,c,{...o,reportView:'suppliers'});assert.equal(lean.meta.correctionQueueCount,queue(full).length);assert.equal(full.meta.correctionQueueCount,queue(full).length);assert.deepEqual(lean.summary,full.summary);
  assert(!view(full).correctionGroups.flatMap(group=>group.rows).some(row=>[2,4].includes(row)));assert.equal(full.controlReport.meta.openBalance,o.supplier==='Missing Supplier'?0:30);
 }
});

test('adding an unrelated Reembolso preserves ordinary acknowledgement identities and original models',()=>{
 const b=[claim('REF/1')],c=[control('REF/1',{1:2025})],model=run(b,c);assert.equal(view(model),model);assert(!Object.hasOwn(model,'correctionReview'));
 const source=[bh,...b],controls=[ch,...c],target=E.correctionReviewTargets(model,source,controls)[0].identity;
 const extra=control('HISTORICAL/1',{2:'REEMBOLSO'}),withReembolso=run(b,[...c,extra]);assert.equal(E.correctionReviewTargets(withReembolso,source,[...controls,extra])[0].identity,target);
});
