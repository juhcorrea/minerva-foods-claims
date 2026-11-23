'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',2:'Setor',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(ref,extra={})=>Object.assign(Array(64).fill(null),{0:ref,1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:ref,24:ref,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Exemplo',35:100,40:100,56:'Analista Exemplo'},extra);
const control=(ref,extra={})=>Object.assign(Array(32).fill(null),{1:2026,2:'SGR ME',3:'ME',7:ref,10:'Fornecedor Exemplo',11:'Depósito',12:'Pago',13:'2026-07-01',14:100,17:'2026-07-01',19:100,20:100,30:2026,31:'Analista Exemplo'},extra);
const options={allYears:true,asOf:'2026-11-23',correctionScenario:'corrected'};
const run=(b,c,o={})=>E.analyze([bh,...b],[ch,...c],{...options,...o});
const queue=model=>E.buildCorrectionReviewItems(model),view=model=>E.getCorrectionReviewModel(model);

test('only Control column C identifies Gado and all corrections surfaces exclude its rows',()=>{
 const b=[],c=[control('GADO/1',{2:' Gado '}),control('GADO/2',{2:'gádo\u00a0 vivo'}),control('GADO/3',{2:'GADO-VIVO'}),control('NORMAL/1',{0:'GADO',2:'SGR ME'}),control('NORMAL/2',{2:'LEGADO'})],before=JSON.stringify({b,c}),model=run(b,c),projected=view(model);
 assert.deepEqual(projected.meta.correctionScope.excludedControlRows,[2,3,4]);
 assert.deepEqual(queue(model).flatMap(item=>item.controlRows).sort(),[5,6]);
 assert.equal(projected.baseReconciliation.meta.controlWithoutBd,2);assert.equal(projected.correctionImpact.summary.rowCount,2);assert.equal(projected.correctionImpact.summary.received,200);
 assert.equal(model.baseReconciliation.meta.controlWithoutBd,5);assert.equal(model.correctionImpact.summary.received,500);assert.equal(model.receiptReport.annual[0].received,500);assert.equal(model.controlReport.meta.receivedConfirmed,500);
 assert.equal(JSON.stringify({b,c}),before);assert.equal(view(projected),projected);
});

test('exclusive Gado links disappear from correction only, including audits and source diagnostics',()=>{
 const model=run([claim('A/1',{25:'',35:100,40:80})],[control('A/1',{2:'GADO',1:2025,20:30,14:80,19:200})]),projected=view(model);
 assert(model.correctionGroups.length);assert(model.baseReconciliation.rows.some(row=>row.kind==='BD_MISSING_OPERATION'));assert(model.claimValueAudit.rows.length);
 assert.equal(queue(model).length,0);assert.equal(projected.corrections.length,0);assert.equal(projected.correctionGroups.length,0);assert.equal(projected.claimValueAudit.rows.length,0);assert.equal(projected.baseReconciliation.rows.length,0);
 assert.equal(model.receiptReport.annual[0].received,200);assert.equal(model.controlReport.meta.receivedConfirmed,200);assert.equal(model.controlReport.allInstallments.length,1);
 assert.equal(E.correctionReviewTargets(model,[bh,claim('A/1')],[ch,control('A/1')]).length,0);
});

test('mixed references retain normal row corrections and independent BD issues without a partial monetary comparison',()=>{
 const model=run([claim('MIX/1',{25:''})],[control('MIX/1',{2:'GADO',1:2024,20:10,14:60,19:60}),control('MIX/1',{1:2025,14:40,19:40})]),projected=view(model),items=queue(model);
 assert.equal(model.claimValueAudit.rows[0].controlExpected,100);assert.equal(model.claimValueAudit.rows[0].hasReceivedMismatch,false);
 assert.equal(projected.claimValueAudit.rows.length,0,'Do not compare BD AO to just the remaining partial O sum');
 assert(items.length>0);assert(items.every(item=>!item.controlRows.includes(2)));assert(items.some(item=>item.issues.some(issue=>issue.kind==='BD_MISSING_OPERATION')));
 assert(projected.correctionGroups.every(group=>group.rows.every(row=>row===3)&&group.changes.every(change=>change.row===3)));
 assert.deepEqual(projected.correctionGroups.flatMap(group=>group.year.changes.map(change=>change.original)),[2025]);
 assert.equal(projected.correctionImpact.summary.received,40);assert.equal(model.correctionImpact.summary.received,100);
 assert(!items.flatMap(item=>item.audits).some(audit=>audit.hasReceivedMismatch));
 const explicit=queue({...model});assert.deepEqual(explicit.map(item=>item.controlRows),items.map(item=>item.controlRows));
 assert(E.buildCorrectionReviewItems(model,model.correctionGroups).every(item=>!item.controlRows.includes(2)));
});

test('Gado receipt dates do not activate a normal correction in a month outside its own reference period',()=>{
 const b=[claim('MIX/1')],c=[control('MIX/1',{2:'GADO',1:2024,14:60,19:60,17:'2026-08-01'}),control('MIX/1',{1:2025,14:40,19:40,17:'2026-07-01'})];
 const august=run(b,c,{allYears:false,years:[2026],months:[8]}),july=run(b,c,{allYears:false,years:[2026],months:[7]});
 assert.equal(queue(august).length,0);assert(queue(july).some(item=>item.controlRows.includes(3)));assert.equal(august.receiptReport.annual[0].received,60);
});

test('rejected numeric Gado coincidences do not hide unrelated BD missing-Control problems',()=>{
 const model=run([claim('ORDER/1',{24:777})],[control(777,{2:'GADO',3:'MI',10:'Outro Produtor'})]),items=queue(model);
 assert(items.some(item=>item.issues.some(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL')));assert(items.every(item=>!item.controlRows.includes(2)));
 assert.equal(model.receiptReport.annual[0].received,100);
});

test('supplier aggregate warnings no longer include excluded Gado payments',()=>{
 const clean=run([claim('MIX/1')],[control('MIX/1',{2:'GADO',19:100,14:100}),control('MIX/1',{19:50,14:50})]);
 assert(clean.issues.some(issue=>issue.kind==='RECEIVED_ABOVE_FORWARDED'));assert(!view(clean).issues.some(issue=>issue.kind==='RECEIVED_ABOVE_FORWARDED'));assert.equal(clean.summary.received,150);
 const warned=run([claim('MIX/1')],[control('MIX/1',{2:'GADO',19:100,14:100}),control('MIX/1',{19:150,14:150})]);
 assert.equal(view(warned).issues.find(issue=>issue.kind==='RECEIVED_ABOVE_FORWARDED').amount,-50);assert.equal(warned.summary.received,250);
});

test('full and lean correction counts agree for every period/scenario while financial summaries stay equal',()=>{
 const b=[claim('A/1'),claim('B/1')],c=[control('A/1',{2:'GADO',1:2024,20:5}),control('B/1',{1:2025,20:50}),control('UNKNOWN/1',{2:'GADO VIVO',12:'Vencido',14:30,19:null,17:null})];
 for(const o of [{},{correctionScenario:'original'},{allYears:false,years:[2026],months:[7]},{supplier:'Fornecedor Exemplo'},{supplier:'Missing Supplier'}]){
  const full=run(b,c,o),lean=run(b,c,{...o,reportView:'suppliers'});assert.equal(lean.meta.correctionQueueCount,queue(full).length);assert.equal(full.meta.correctionQueueCount,queue(full).length);assert.deepEqual(lean.summary,full.summary);
  const projected=view(full);assert(!projected.correctionGroups.flatMap(group=>group.rows).some(row=>[2,4].includes(row)));assert.equal(full.controlReport.meta.openBalance,o.supplier==='Missing Supplier'?0:30);
 }
});

test('no Gado keeps the original model and acknowledgement identities unchanged',()=>{
 const b=[claim('A/1')],c=[control('A/1',{1:2025})],model=run(b,c);assert.equal(view(model),model);assert(!Object.hasOwn(model,'correctionReview'));assert.equal(queue(model).length,1);
 const source=[bh,...b],controls=[ch,...c],target=E.correctionReviewTargets(model,source,controls)[0].identity;
 const withGado=run(b,[...c,control('GADO/UNKNOWN',{2:'GADO'})]);assert.equal(E.correctionReviewTargets(withGado,source,[...controls,control('GADO/UNKNOWN',{2:'GADO'})])[0].identity,target);
});
