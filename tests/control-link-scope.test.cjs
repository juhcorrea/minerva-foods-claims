'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const ui={window:{ClaimsEngine:E},document:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),ui);
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',16:'Área negociação',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(id,extra={})=>row(64,{0:'QA-'+id,1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',16:'CIA MARÍTIMA',22:id,24:'NF-'+id,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100,40:50,56:'Analista QA',...extra});
const control=(reference,extra={})=>row(32,{1:2026,3:'ME',7:reference,10:'Fornecedor QA',11:'Depósito',12:'Pago',13:'2026-02-01',14:50,17:'2026-02-01',19:25,20:999,30:2026,31:'Analista QA',...extra});
const run=(bd,controls=[],options={})=>E.analyze([bh,...bd],[ch,...controls],{years:[2026],asOf:'2026-11-10',lossFormula:'subtract-negotiating',...options});

test('only forwarded claims outside insurance require Control and insurance history generates no source corrections',()=>{
 const bd=[claim('required'),claim('insurance-forwarded',{16:'  sÉguRo  ',25:null}),claim('insurance-processed',{6:'PROCEDENTE - SEGURO',16:'SEGURO'}),claim('negotiating',{6:'EM NEGOCIAÇÃO - PROCEDENTE',16:'PRIMÁRIA'}),claim('closed',{6:'FINALIZADO SEM CUSTO',16:'PRIMÁRIA'}),claim('supplier-label',{16:'PRIMÁRIA',28:'SEGURO'}),claim('different-area',{16:'SEGURADORA'})],before=JSON.stringify(bd);
 const model=run(bd),required=[2,7,8];
 assert.deepEqual(model.issues.filter(issue=>issue.kind==='CLAIM_WITHOUT_LINK').map(issue=>issue.row),required);
 assert.deepEqual(model.baseReconciliation.rows.filter(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL').map(issue=>issue.row),required);
 assert.deepEqual(model.claimValueAudit.rows.map(audit=>audit.bdRows[0]).sort((a,b)=>a-b),required);
 assert.equal(model.summary.unmatchedClaims,3);assert.equal(model.summary.claimed,700);assert.equal(model.summary.occurrences,7);assert.equal(model.summary.negotiating,100);
 assert.equal(model.claims.find(value=>value.row===3).controlLinkRequired,false);assert.equal(model.claims.find(value=>value.row===7).controlLinkRequired,true,'AC supplier name does not define insurance');
 assert.equal(model.baseReconciliation.meta.missingOperationRows,0);assert.equal(model.baseReconciliation.rows.some(issue=>issue.kind==='BD_MISSING_OPERATION'),false);
 const queue=ui.window.MinervaCorrectionImpact.buildQueue(model);
 assert.equal(queue.some(entry=>entry.bdRows.includes(3)),false,'Insurance history is outside all base corrections');
 assert.equal(queue.some(entry=>entry.audits.some(audit=>audit.bdRows.some(value=>[3,4,5,6].includes(value)))),false);
 const filtered=run(bd,[],{years:[2020],supplier:'Different',operation:'COMERCIAL'});assert.deepEqual(filtered.baseReconciliation.rows.filter(issue=>issue.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL').map(issue=>issue.row),required);assert.equal(filtered.baseReconciliation.meta.missingOperationRows,0);
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

test('same order shared by a real claim and Q insurance binds only the real claim and preserves every cash installment',()=>{
 const bd=[claim('QA/SHARED',{16:'PORTUÁRIO',28:'PORT QA',40:100}),claim('QA/SHARED',{16:'  sÉGuRo  ',28:'INSURANCE QA',35:275,40:275,1:'2025-01-01',3:'MI',25:null})];
 const controls=[control('QA/SHARED',{10:'PORT QA',14:40,19:40,20:100}),control('QA/SHARED',{10:'PORT QA',14:60,19:60,20:100})],before=JSON.stringify({bd,controls});
 for(const options of [{allYears:true},{years:[2026]},{allYears:true,suppliers:['PORT QA']},{allYears:true,operations:['EXPORTAÇÃO - CTNR']},{allYears:true,claimStatuses:['RESSARCIMENTO ENCAMINHADO']},{allYears:true,correctionScenario:'original'}]){
  const model=run(bd,controls,options);assert.equal(model.summary.received,100);assert.equal(model.receiptReport.meta.receivedWithoutMonthlyDate,0);assert.equal(model.receiptCohorts.rows.length,2);assert(model.receiptCohorts.rows.every(row=>row.bdRows.length===1&&row.bdRows[0]===2));assert(model.controlReport.allInstallments.every(row=>row.bdRows.length===1&&row.bdRows[0]===2));
  assert(!model.issues.some(issue=>issue.kind==='AMBIGUOUS_LINK'));assert(!E.buildCorrectionReviewItems(model).some(item=>item.bdRows.includes(3)));assert.equal(model.claimValueAudit.rows[0].claimed,100);assert.equal(model.claimValueAudit.rows[0].controlExpected,100);assert.equal(model.claimValueAudit.rows[0].hasReceivedMismatch,false);
 }
 const complete=run(bd,controls,{allYears:true});assert.equal(complete.summary.claimed,375);assert.equal(complete.summary.occurrences,2);assert.equal(complete.executiveReport.controlClaims.length,2);assert.equal(JSON.stringify({bd,controls}),before);
});

test('insurance-only references and malformed insurance source cells create no correction while cash and open balance remain',()=>{
 const bd=[claim('QA/INSURANCE',{16:'Seguro',1:null,6:null,25:null,35:null,40:null}),claim('',{0:'QA-NO-REF',16:'SEGURO',22:null,24:null,25:null})],controls=[control('QA/INSURANCE',{10:'CONTROL SUPPLIER',19:25}),control('QA/INSURANCE',{10:'CONTROL SUPPLIER',12:'Vencido',14:30,17:null,19:0})];
 const model=run(bd,controls,{allYears:true});assert.equal(E.buildCorrectionReviewItems(model).length,0);assert.equal(model.summary.received,25);assert.equal(model.receiptCohorts.rows[0].supplier,'CONTROL SUPPLIER');assert.equal(model.controlReport.meta.receivedConfirmed,25);assert.equal(model.supplierOpenReport.meta.openBalance,30);assert.equal(model.executiveReport.controlClaims.length,2);assert.equal(model.corrections.length,0);assert.equal(model.claimValueAudit.rows.length,0);
});

test('only Q exactly Seguro excludes candidates; supplier, cause and situation labels never substitute it',()=>{
 for(const extra of [{28:'SEGURO'},{49:'SEGURO'},{6:'PROCEDENTE - SEGURO'},{16:'SEGURADORA'},{16:'SEGURO TRANSPORTE'},{16:null}]){
  const model=run([claim('QA/LABEL',extra)],[control('QA/LABEL')]);assert.deepEqual(model.controlReport.allInstallments[0].bdRows,[2]);
 }
});

test('insurance-only payment diagnostics remain in the operational Control without entering base corrections',()=>{
 for(const extra of [{17:null},{19:null},{19:'invalid'},{23:'Prejuízo Minerva'}]){
  const model=run([claim('QA/INS-ONLY',{16:'SEGURO'})],[control('QA/INS-ONLY',extra)]);
  assert.equal(E.buildCorrectionReviewItems(model).length,0,JSON.stringify(extra));assert(model.controlReport.issues.length||model.controlReport.allInstallments.some(row=>row.status.startsWith('Conferir')),'Operational receipt diagnostics are preserved '+JSON.stringify(extra));
  assert.equal(model.summary.received,extra[17]===null||extra[19]===null||extra[19]==='invalid'?0:25);
 }
});

test('different real and insurance tokens remain unallocated and explain the mixed reference with exact sources',()=>{
 const bd=[claim('QA/REAL'),claim('QA/INS',{16:'SEGURO',28:'INSURANCE QA'})],controls=[control('QA/REAL; QA/INS',{14:500,19:75})],model=run(bd,controls,{allYears:true}),warning=model.baseReconciliation.rows.find(issue=>issue.kind==='INSURANCE_MIXED_REFERENCE');
 assert(warning);assert.deepEqual(warning.claimBdRows,[2]);assert.deepEqual(warning.insuranceBdRows,[3]);assert.deepEqual(warning.insuranceReferences,['QA/INS']);assert(warning.sourceCells.includes('BD!Q3'));assert.match(warning.detail,/Confira a qual registro pertence o recebimento/);assert.equal(model.summary.received,75);assert.equal(model.claimValueAudit.rows.length,0);assert.equal(model.corrections.length,0);assert.equal(model.controlReport.allInstallments[0].linkState,'review');assert.equal(model.installments[0].linkState,'review');assert.equal(model.installments[0].includedInConfirmed,false);assert.equal(model.summary.receivedLinkedClaims,0);assert.equal(model.receiptCohorts.rows[0].supplierSource,'Controle K');
 const item=E.buildCorrectionReviewItems(model).find(item=>item.issues.includes(warning)),key=E.correctionReviewIdentity(item,[bh,...bd],[ch,...controls]),previous=E.correctionReviewIdentity({...item,issues:item.issues.filter(issue=>issue!==warning)},[bh,...bd],[ch,...controls]);assert.notEqual(key,previous,'New mixed attribution diagnosis cannot inherit an unrelated old acknowledgement');
 const filtered=run(bd,controls,{years:[2020],suppliers:['UNKNOWN']});assert(filtered.baseReconciliation.rows.some(issue=>issue.kind==='INSURANCE_MIXED_REFERENCE'));
 const unknown=run(bd,[control('QA/REAL; QA/INS; QA/UNKNOWN')]);assert(unknown.baseReconciliation.rows.some(issue=>issue.kind==='CONTROL_PARTIAL_LINK'&&issue.unknownReferences.includes('QA/UNKNOWN')));assert(unknown.baseReconciliation.rows.some(issue=>issue.kind==='INSURANCE_MIXED_REFERENCE'));
});

test('generic, missing and genuinely duplicate real claims still require review and retain their source rows',()=>{
 const bd=[claim('QA/DUP',{28:'REAL A'}),claim('QA/DUP',{28:'REAL B'}),claim('QA/DUP',{16:'SEGURO',28:'INSURANCE'})],model=run(bd,[control('QA/DUP')]);
 const issue=model.issues.find(issue=>issue.kind==='AMBIGUOUS_LINK');assert(issue);assert.deepEqual(issue.bdRows,[2,3]);assert.match(issue.detail,/Mais de um fornecedor na BD/);assert(!issue.bdRows.includes(4));assert.deepEqual(E.buildCorrectionReviewItems(model).find(item=>item.issues.includes(issue)).bdRows,[2,3]);
 const generic=run([claim('QA/INS',{16:'SEGURO'})],[control('CCO')]);assert(generic.baseReconciliation.rows.some(issue=>issue.kind==='CONTROL_WITHOUT_BD'));assert.equal(generic.summary.received,25);
});

test('adding missing BD trace to an unchanged standalone issue preserves its existing acknowledgement identity',()=>{
 const bd=[claim('QA/TRACE',{6:'EM NEGOCIAÇÃO - PROCEDENTE',28:'REAL A'}),claim('QA/TRACE',{6:'FINALIZADO SEM CUSTO',28:'REAL B'})],controls=[control('QA/TRACE')],model=run(bd,controls),issue=model.issues.find(issue=>issue.kind==='AMBIGUOUS_LINK'),item=E.buildCorrectionReviewItems(model).find(item=>item.issues.includes(issue));
 assert.deepEqual(item.bdRows,[2,3]);assert.deepEqual(item.identityBdRows,[]);assert.equal(item.groups.length,0);assert.equal(item.audits.length,0);
 const legacy={...item,bdRows:[]};delete legacy.identityBdRows;assert.equal(E.correctionReviewIdentity(item,[bh,...bd],[ch,...controls]),E.correctionReviewIdentity(legacy,[bh,...bd],[ch,...controls]));
});
