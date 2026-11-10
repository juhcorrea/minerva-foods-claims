'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const ui={window:{},document:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),ui);
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',16:'Área negociação',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(id,extra={})=>row(64,{0:'QA-'+id,1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',16:'CIA MARÍTIMA',22:id,24:'NF-'+id,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100,40:50,56:'Analista QA',...extra});
const control=(reference,extra={})=>row(32,{1:2026,3:'ME',7:reference,10:'Fornecedor QA',11:'Depósito',12:'Pago',13:'2026-02-01',14:50,17:'2026-02-01',19:25,20:999,30:2026,31:'Analista QA',...extra});
const run=(bd,controls=[],options={})=>E.analyze([bh,...bd],[ch,...controls],{years:[2026],asOf:'2026-11-10',lossFormula:'subtract-negotiating',...options});

test('only forwarded claims outside insurance require Control, while operation blanks remain independent',()=>{
 const bd=[claim('required'),claim('insurance-forwarded',{16:'  sÉguRo  ',25:null}),claim('insurance-processed',{6:'PROCEDENTE - SEGURO',16:'SEGURO'}),claim('negotiating',{6:'EM NEGOCIAÇÃO - PROCEDENTE',16:'PRIMÁRIA'}),claim('closed',{6:'FINALIZADO SEM CUSTO',16:'PRIMÁRIA'}),claim('supplier-label',{16:'PRIMÁRIA',28:'SEGURO'}),claim('different-area',{16:'SEGURADORA'})],before=JSON.stringify(bd);
 const model=run(bd),required=[2,7,8];
 assert.deepEqual(model.issues.filter(issue=>issue.kind==='CLAIM_WITHOUT_LINK').map(issue=>issue.row),required);
 assert.deepEqual(model.baseReconciliation.rows.filter(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL').map(issue=>issue.row),required);
 assert.deepEqual(model.claimValueAudit.rows.map(audit=>audit.bdRows[0]).sort((a,b)=>a-b),required);
 assert.equal(model.summary.unmatchedClaims,3);assert.equal(model.summary.claimed,700);assert.equal(model.summary.occurrences,7);assert.equal(model.summary.negotiating,100);
 assert.equal(model.claims.find(value=>value.row===3).controlLinkRequired,false);assert.equal(model.claims.find(value=>value.row===7).controlLinkRequired,true,'AC supplier name does not define insurance');
 assert.equal(model.baseReconciliation.meta.missingOperationRows,1);assert.equal(model.baseReconciliation.rows.find(issue=>issue.kind==='BD_MISSING_OPERATION').row,3);
 const queue=ui.window.MinervaCorrectionImpact.buildQueue(model);
 for(const entry of queue.filter(entry=>entry.bdRows.includes(3)))assert(entry.issues.every(issue=>issue.kind==='BD_MISSING_OPERATION'),'Insurance can still have a separate source-cell issue');
 assert.equal(queue.some(entry=>entry.audits.some(audit=>audit.bdRows.some(value=>[3,4,5,6].includes(value)))),false);
 const filtered=run(bd,[],{years:[2020],supplier:'Different',operation:'COMERCIAL'});assert.deepEqual(filtered.baseReconciliation.rows.filter(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL').map(issue=>issue.row),required);assert.equal(filtered.baseReconciliation.meta.missingOperationRows,1);
 assert.equal(JSON.stringify(bd),before);
});

test('insurance and other non-forwarded statuses never create incomplete value audits even with actual Control entries',()=>{
 for(const [status,area] of [['RESSARCIMENTO ENCAMINHADO','SeGuRo'],['PROCEDENTE - SEGURO','CIA MARÍTIMA'],['EM NEGOCIAÇÃO - PROCEDENTE','PRIMÁRIA'],['FINALIZADO SEM CUSTO','LOGÍSTICA'],['PREJUIZO MINERVA','COMERCIAL']]){
  const bd=[claim('outside',{6:status,16:area,40:null})],controls=[control('outside',{14:70,20:null}),control('outside',{12:'Vencido',14:30,17:null,19:null})],before=JSON.stringify({bd,controls});
  for(const correctionScenario of ['original','corrected']){
   const model=run(bd,controls,{correctionScenario});assert.equal(model.claimValueAudit.rows.length,0);assert.equal(model.claimValueAudit.summary.uncertainGroups,0);assert.equal(model.claimValueAudit.uCorrections.length,0);assert.equal(model.corrections.some(change=>change.field==='Valor Integral Claim'),false);
   assert.equal(model.summary.claimed,100);assert.equal(model.summary.received,25);assert.equal(model.summary.receivedComparable,25);assert.equal(model.summary.occurrences,1);assert.equal(model.supplierOpenReport.meta.openBalance,30);assert.equal(model.baseReconciliation.meta.bdWithoutControl,0);
  }
  assert.equal(JSON.stringify({bd,controls}),before);
 }
});

test('mixed required and exempt components preserve payments once without partial O/AO comparison or U correction',()=>{
 for(const second of [{16:'SEGURO'},{6:'EM NEGOCIAÇÃO - PROCEDENTE'}]){
  const bd=[claim('required'),claim('exempt',{...second,40:null})],controls=[control('required; exempt',{14:500,19:75})],full=run(bd,controls),lean=run(bd,controls,{reportView:'suppliers'});
  assert.equal(full.claimValueAudit.rows.length,0);assert.equal(full.claimValueAudit.summary.excludedMixedGroups,1);assert.deepEqual(full.claimValueAudit.meta.excludedMixedComponents[0].requiredBdRows,[2]);assert.deepEqual(full.claimValueAudit.meta.excludedMixedComponents[0].exemptBdRows,[3]);assert.deepEqual(full.claimValueAudit.meta.excludedMixedComponents[0].controlRows,[2]);
  assert.equal(full.claimValueAudit.uCorrections.length,0);assert.equal(full.summary.received,75);assert.equal(full.summary.claimed,200);assert.equal(full.summary.occurrences,2);assert.equal(full.baseReconciliation.meta.bdWithoutControl,0);assert.deepEqual(lean.summary,full.summary);assert.equal(lean.meta.correctionQueueCount,ui.window.MinervaCorrectionImpact.buildQueue(full).length);
 }
});

test('required claims still report incomplete or absent Control and legacy optional Q headers remain supported',()=>{
 const noControl=run([claim('required',{16:null,40:null})]);assert.equal(noControl.claimValueAudit.rows[0].status,'Sem correspondência');assert.equal(noControl.claimValueAudit.rows[0].uncertain,true);assert.equal(noControl.baseReconciliation.meta.controlRequiredBdRows,1);
 const partial=run([claim('required')],[control('required; unknown')]);assert.equal(partial.claimValueAudit.rows[0].status,'Conferir vínculo');assert.equal(partial.claimValueAudit.uCorrections.length,0);assert.equal(partial.summary.received,25);
 const legacy=[...bh];legacy[16]=null;assert.doesNotThrow(()=>E.validateHeaders([legacy,claim('legacy')],'BD'));
});
