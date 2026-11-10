'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const ui={window:{},document:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),ui);
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(ref,extra={})=>Object.assign(Array(64).fill(null),{0:ref,1:'2023-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:ref,24:ref,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100,40:10,56:'Analista BD'},extra);
const control=(ref,extra={})=>Object.assign(Array(32).fill(null),{1:2026,3:'ME',7:ref,10:'Fornecedor QA',11:'Depósito',12:'Pago',13:'2026-02-01',14:10,17:'2026-02-01',19:10,20:100,30:2026,31:'Analista Controle'},extra);
const opts={years:[2026],asOf:'2026-11-09',correctionScenario:'corrected',lossFormula:'subtract-negotiating'};
const run=(bd,cr,options={})=>E.analyze([bh,...bd],[ch,...cr],{...opts,...options});
test('historical grouped claims produce one year correction per Control row in every financial scope',()=>{
  const bd=[claim('OLD/1'),claim('OLD/2')],cr=[control('OLD/1; OLD/2',{1:2025}),control('OLD/1; OLD/2',{1:2027})],before=JSON.stringify({bd,cr});
  const models=[run(bd,cr),run(bd,cr,{allYears:true}),run(bd,cr,{supplier:'different',operation:'COMERCIAL',years:[2020],correctionScenario:'original'})];
  for(const model of models){assert.equal(model.baseReconciliation.meta.yearDifferences,2);assert.deepEqual(model.corrections.filter(c=>c.field==='Ano Entrada').map(c=>[c.cell,c.original,c.corrected]),[['B2',2025,2023],['B3',2027,2023]]);assert.equal(model.correctionGroups.length,1);assert.deepEqual(model.correctionGroups[0].bdRows,[2,3]);assert(model.baseReconciliation.rows.every(issue=>issue.sourceCells.includes('BD!B2')&&issue.sourceCells.includes('BD!B3')));}
  assert.equal(models[0].summary.claimed,0);assert.equal(models[0].summary.received,20);assert.equal(JSON.stringify({bd,cr}),before);
});
test('BD missing-Control alerts require forwarded status and keep exact rows with no inferred analyst',()=>{
  const model=run([claim('FWD/1',{56:null}),claim('NEG/1',{6:'EM NEGOCIAÇÃO - PROCEDENTE'}),claim('NO/1',{6:'RESPONDIDO - NÃO PROCEDE'}),claim('FWD/2',{1:'2027-01-01'})],[]);
  const missing=model.baseReconciliation.rows.filter(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL');
  assert.deepEqual(missing.map(issue=>issue.bdRows),[[2],[5]]);assert.equal(missing[0].amount,null);assert.deepEqual(missing[0].analysts,['Não identificado']);assert.equal(ui.window.MinervaCorrectionImpact.issueSource(missing[0]),'BD');assert.deepEqual(missing[0].sourceCells,['BD!G2','BD!W2','BD!Y2']);
});
test('Control missing or partial references remain explicit and confirmed payments stay counted once',()=>{
  const bd=[claim('A/1',{1:'2026-01-01'})],cr=[control('MISSING/1'),control('A/1; MISSING/2'),control(null),control('NA')],model=run(bd,cr);
  assert.equal(model.summary.received,40);assert.equal(model.baseReconciliation.meta.controlWithoutBd,3);assert.equal(model.baseReconciliation.meta.partialLinks,1);
  const partial=model.baseReconciliation.rows.find(issue=>issue.kind==='CONTROL_PARTIAL_LINK');assert.deepEqual(partial.unknownReferences,['MISSING/2']);assert.deepEqual(partial.bdRows,[2]);assert.deepEqual(partial.controlRows,[3]);assert.equal(model.baseReconciliation.meta.bdWithoutControl,0);
  assert.equal(model.corrections.filter(change=>change.field==='Ano Entrada').length,0);
  const queue=ui.window.MinervaCorrectionImpact.buildQueue(model);for(const issue of model.baseReconciliation.rows)assert.equal(queue.flatMap(entry=>entry.issues).filter(value=>value===issue).length,1);assert(queue.some(entry=>entry.types.includes('Controle sem BD')));
  for(const entry of queue.filter(entry=>!entry.audits.length))assert.equal(entry.referenceAmount,null,'Never substitute payment T/O for a claim reference amount');
});
test('same numeric NF with rejected livestock context does not become a false master match',()=>{
  const model=run([claim('ORDER/1',{24:777})],[control(777,{0:'GADO',3:'MI',10:'Produtor diferente'})]);
  assert.equal(model.baseReconciliation.meta.controlWithoutBd,1);assert.equal(model.baseReconciliation.meta.bdWithoutControl,1);assert.equal(model.baseReconciliation.meta.yearDifferences,0);assert.equal(model.summary.received,10);
  assert(model.baseReconciliation.rows.some(issue=>/contexto incompatível/.test(issue.detail)));
});
test('mixed or invalid RNC years never produce an unsafe year correction',()=>{
  for(const secondDate of ['2024-01-01','invalid']){
    const model=run([claim('A/1'),claim('A/2',{1:secondDate})],[control('A/1; A/2')]);
    assert.equal(model.baseReconciliation.meta.partialLinks,1);assert.equal(model.baseReconciliation.meta.yearDifferences,0);assert.equal(model.corrections.filter(c=>c.field==='Ano Entrada').length,0);assert.equal(model.summary.received,10);
  }
});
test('master alerts join the existing correction group and lean count equals the complete review queue',()=>{
  const bd=[claim('A/1',{1:'2025-01-01'})],cr=[control('A/1',{1:2026})],full=run(bd,cr),lean=run(bd,cr,{reportView:'suppliers'}),queue=ui.window.MinervaCorrectionImpact.buildQueue(full);
  assert.equal(queue.length,1);assert.equal(queue[0].groups.length,1);assert(queue[0].issues.some(issue=>issue.reconciliation));assert(queue[0].types.includes('Ano divergente'));assert.deepEqual(Array.from(queue[0].rncDates),['2025-01-01']);
  assert.equal(lean.meta.correctionQueueCount,queue.length);assert.deepEqual(lean.baseReconciliation.meta,full.baseReconciliation.meta);assert(!Object.hasOwn(lean.baseReconciliation,'rows'));assert.deepEqual(lean.summary,full.summary);
  full.correctionGroups[0].progress={done:true};assert(ui.window.MinervaCorrectionImpact.buildQueue(full)[0].issues.some(issue=>issue.reconciliation),'Manual completion cannot remove source alerts');
});
