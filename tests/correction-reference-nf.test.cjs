'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const ui={window:{ClaimsEngine:E},document:{addEventListener(){}}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),ui);
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',2:'Setor',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(order,nf,extra={})=>Object.assign(Array(64).fill(null),{0:'EXEMPLO',1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:order,24:nf,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Exemplo',35:100,40:80,56:'Analista Exemplo'},extra);
const control=(reference,extra={})=>Object.assign(Array(32).fill(null),{1:2026,2:'SGR ME',3:'ME',7:reference,10:'Fornecedor Exemplo',11:'Depósito',12:'Pago',13:'2026-02-01',14:80,17:'2026-02-01',19:80,20:100,30:2026},extra);
const analyze=(bd,cr=[],opts={})=>E.analyze([bh,...bd],[ch,...cr],{allYears:true,asOf:'2026-11-24',...opts});
const queue=model=>ui.window.MinervaCorrectionImpact.buildQueue(model);

test('missing or placeholder BD order falls back to the existing NF in historical missing-Control warnings and queue',()=>{
 for(const order of [null,'','  ','NA','na','N/A',' N / A ','-','0']){
  const source=claim(order,'000123',{1:'2022-01-13'}),before=JSON.stringify(source),model=analyze([source],[],{years:[2026],allYears:false});
  const issue=model.baseReconciliation.rows.find(row=>row.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL');
  assert.equal(issue.reference,'000123',String(order));assert.equal(queue(model)[0].reference,'000123');assert.equal(queue(model)[0].bdRows[0],2);
  assert.equal(model.claims.length,0,'Historical diagnostic stays independent of financial years');assert.equal(JSON.stringify(source),before);
  assert.equal(E.normalizeRef(order),null);
 }
});

test('valid order remains the reference even when NF is available',()=>{
 const model=analyze([claim('SO/001-2','000123')],[],{allYears:false,years:[2024]});
 assert.equal(model.baseReconciliation.rows.find(row=>row.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL').reference,'SO/001-2');
 assert.equal(queue(model)[0].reference,'SO/001-2');
});

test('fallback uses only recorded NF, preserves formatting and excludes placeholder parts',()=>{
 const sources=[claim('NA','001.234-05'),claim('N/A','  000111; NA; 000222  ',{0:'EXEMPLO2'}),claim('NA','N/A',{0:'EXEMPLO3'})],model=analyze(sources,[],{allYears:false,years:[2024]});
 const issues=model.baseReconciliation.rows.filter(row=>row.kind==='CLAIM_FORWARDED_WITHOUT_CONTROL');
 assert.deepEqual(issues.map(row=>row.reference),['001.234-05','000111; 000222','']);
 const blank=queue(model).find(row=>row.bdRows.includes(4));assert.equal(blank.reference,'Sem referência');
 assert(!blank.references.includes('NA'));assert(!blank.references.includes('N/A'));
});

test('other BD diagnostics use the same valid NF while keeping raw order and exact source coordinates',()=>{
 const noOperation=analyze([claim('NA','000123',{25:''})]);
 const operation=noOperation.baseReconciliation.rows.find(row=>row.kind==='BD_MISSING_OPERATION');assert.equal(operation.reference,'000123');assert.equal(operation.order,'NA');assert.equal(operation.nf,'000123');assert.equal(operation.sourceCells[0],'BD!Z2');
 for(const [extra,kind] of [[{1:null},'INVALID_RNC_DATE'],[{35:null},'INVALID_CLAIM_AMOUNT'],[{6:''},'MISSING_CLAIM_STATUS'],[{},'CLAIM_WITHOUT_LINK']]){
  const model=analyze([claim('NA','000123',extra)]),issue=model.issues.find(row=>row.kind===kind);assert(issue,kind);assert.equal(issue.reference,'000123',kind);
 }
 const noReferences=analyze([claim('NA','N/A',{25:''})]);assert.equal(noReferences.baseReconciliation.rows.find(row=>row.kind==='BD_MISSING_OPERATION').reference,'EXEMPLO','Keep the existing SGR fallback when no order or NF exists');
});

test('NF display repair preserves matching, financial totals, correction keys and original sheets',()=>{
 const b=claim('NA','000123'),c=control('000123',{1:2025}),bd=[bh,b],cr=[ch,c],before=JSON.stringify({bd,cr}),model=analyze([b],[c]);
 assert.deepEqual(model.installments[0].bdRows,[2]);assert.equal(model.summary.received,80);assert.equal(model.claimValueAudit.rows[0].reference,'000123');assert.equal(model.claimValueAudit.rows[0].controlExpected,80);
 assert(model.correctionGroups.length);assert(model.correctionGroups.every(group=>group.references.includes('000123')));assert.equal(JSON.stringify({bd,cr}),before);
 const missing=analyze([b]),previousDisplay=structuredClone(missing);
 for(const issue of [...previousDisplay.issues,...previousDisplay.baseReconciliation.rows])if(issue.bdRows?.includes(2))issue.reference='NA';
 const keys=value=>E.correctionReviewTargets(value,bd,[ch]).map(target=>target.identity).sort();assert.deepEqual(keys(missing),keys(previousDisplay),'Acknowledgements use original source values, not the repaired reference label');
 const noLink=analyze([b],[control('NA')]);assert.equal(noLink.controlReport.allInstallments[0].bdRows.length,0,'NA never becomes a matching key');assert.equal(noLink.receiptReport.annual[0].received,80,'Unlinked confirmed payment remains in the receipt ledger');
});
