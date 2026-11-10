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
  assert.equal(missing[0].type,'Ressarcimento sem vínculo no Controle');assert.match(missing[0].detail,/sem ordem\/NF correspondente identificada no Controle/);assert.match(missing[0].detail,/referência divergente/);
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

test('missing BD operation is a global source-cell alert for every useful status and year',()=>{
 const bd=[claim('OLD/1',{0:'QA-SGR-1',24:'QA-NF-1',25:null}),claim('EXCLUDED/2',{1:'2020-01-01',6:'RESPONDIDO - NÃO PROCEDE',25:''}),claim('FUTURE/3',{1:'2027-01-01',6:'EM ANÁLISE',25:' \t '}),claim('WAR/4',{6:'AGUARDANDO CUSTOS',10:'INTERFERÊNCIA EXTERNA',25:null}),claim('',{0:'QA-SGR-ONLY',1:null,6:'',25:null}),claim('FILLED/6',{25:'COMERCIAL'}),Array(64).fill(null),Array(64).fill(' \t ')],before=JSON.stringify(bd);
 const variants=[{}, {allYears:true}, {years:[2026],supplier:'Different supplier',operation:'EXPORTAÇÃO - CTNR',claimStatuses:['RESSARCIMENTO ENCAMINHADO'],correctionScenario:'original'}];
 for(const selection of variants){
  const model=run(bd,[],selection),alerts=model.baseReconciliation.rows.filter(issue=>issue.kind==='BD_MISSING_OPERATION');
  assert.equal(model.baseReconciliation.meta.missingOperationRows,5);assert.deepEqual(alerts.map(issue=>issue.row),[2,3,4,5,6]);
  for(const issue of alerts){assert.equal(issue.source,'BD');assert.equal(issue.type,'Operação em branco');assert.deepEqual(issue.bdRows,[issue.row]);assert.deepEqual(issue.controlRows,[]);assert.deepEqual(issue.sourceCells,['BD!Z'+issue.row]);assert.equal(issue.cell,'Z'+issue.row);assert.equal(issue.field,'Operação');assert.equal(issue.amount,null);assert.equal(issue.status,'Conferir na origem');assert.equal(Object.hasOwn(issue,'corrected'),false);assert.equal(ui.window.MinervaCorrectionImpact.issueSource(issue),'BD');}
  assert.equal(alerts[0].sgr,'QA-SGR-1');assert.equal(alerts[0].order,'OLD/1');assert.equal(alerts[0].nf,'QA-NF-1');assert.equal(alerts[0].supplier,'Fornecedor QA');assert.equal(alerts[0].reference,'OLD/1');assert.deepEqual(alerts[0].rncDates,['2023-01-01']);assert.equal(alerts[2].originalOperation,' \t ');assert.equal(alerts[4].reference,'QA-SGR-ONLY');
  assert.equal(model.issues.filter(issue=>issue.kind==='BD_MISSING_OPERATION').length,0,'The warning has one global owner, not one copy per financial scope');
 }
 assert.equal(JSON.stringify(bd),before);
});

test('missing operation joins related corrections once and has the same full/lean warning count',()=>{
 const bd=[claim('QA/1',{0:'QA-SGR',25:null})],cr=[control('QA/1')],full=run(bd,cr),lean=run(bd,cr,{reportView:'suppliers'}),queue=ui.window.MinervaCorrectionImpact.buildQueue(full);
 const alerts=queue.flatMap(entry=>entry.issues).filter(issue=>issue.kind==='BD_MISSING_OPERATION');assert.equal(alerts.length,1);assert.equal(queue.length,1);assert(queue[0].types.includes('Operação em branco'));assert(queue[0].types.includes('Ano divergente'));assert.deepEqual(Array.from(queue[0].bdRows),[2]);
 assert.equal(lean.meta.correctionQueueCount,queue.length);assert.deepEqual(lean.baseReconciliation.meta,full.baseReconciliation.meta);assert.deepEqual(lean.summary,full.summary);
 assert.equal(full.corrections.some(change=>change.field==='Operação'),false);assert.equal(full.baseReconciliation.rows.filter(issue=>issue.kind==='BD_MISSING_OPERATION').length,1);
});

test('missing operation does not fill source data, remove claims or alter confirmed cash and open balances',()=>{
 const bd=[claim('QA/1',{1:'2026-01-01',25:null})],cr=[control('QA/1'),control('QA/1',{12:'Vencido',14:20,17:null,19:null})],before=JSON.stringify({bd,cr});
 for(const correctionScenario of ['original','corrected']){
  const model=run(bd,cr,{correctionScenario});assert.equal(model.summary.claimed,100);assert.equal(model.summary.received,10);assert.equal(model.summary.occurrences,1);assert.equal(model.supplierOpenReport.meta.openBalance,20);assert.equal(model.baseReconciliation.meta.missingOperationRows,1);assert.equal(model.claims[0].operation,'');
  const filtered=run(bd,cr,{correctionScenario,operation:'EXPORTAÇÃO - CTNR'});assert.equal(filtered.summary.claimed,0);assert.equal(filtered.baseReconciliation.meta.missingOperationRows,1);assert.equal(filtered.controlReport.meta.receivedConfirmed,10,'The integral cash ledger retains the confirmed Control receipt');
 }
 assert.equal(JSON.stringify({bd,cr}),before);
});
