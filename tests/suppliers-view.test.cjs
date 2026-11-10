'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const ui={window:{},document:{addEventListener(){}}};
vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),ui);
const queue=model=>ui.window.MinervaCorrectionImpact.buildQueue(model);
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',30:'Ano Compensação',31:'Analista'});
const claim=(ref,changes={})=>Object.assign(Array(64).fill(null),{0:ref,1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:ref,24:ref,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Á',35:100.125,40:25.125,56:'Analista QA'},changes);
const receipt=(ref,changes={})=>Object.assign(Array(32).fill(null),{1:2026,3:'ME',7:ref,10:'Fornecedor A',11:'Depósito',12:'Pago',13:'2026-02-01',14:25.125,17:'2026-02-01',19:25.125,20:100.125,30:2026,31:'Analista Controle'},changes);
const bd=[bh,claim('QA/1'),claim('QA/2',{1:'2025-01-01',6:'EM NEGOCIAÇÃO - PROCEDENTE'}),claim('QA/3',{1:'2024-01-01',28:'Fornecedor B',25:'COMERCIAL'}),claim('QA/4',{28:'Fornecedor B',25:'COMERCIAL'}),claim('QA/5',{28:'Fornecedor B',25:'COMERCIAL',6:'EM ANÁLISE'}),claim('QA/6',{28:'Fornecedor C',1:'invalid'}),claim('QA/7',{28:'Fornecedor C'}),claim('QA/8',{28:'Fornecedor C',10:'INTERFERÊNCIA EXTERNA'})];
const control=[ch,receipt('QA/1',{1:2025,3:'MI',20:80}),receipt('QA/1',{19:0.1}),receipt('QA/2',{1:2024}),receipt('QA/3',{10:'Fornecedor B'}),receipt('QA/3; QA/4',{10:'Fornecedor B',14:33.333,19:33.333}),receipt('QA/5',{10:'Fornecedor B',12:'Dentro do Prazo',13:null,14:11.111,17:null,19:null}),receipt('QA/7; UNKNOWN',{10:'Fornecedor C',14:null}),receipt('UNMATCHED',{10:'Somente caixa',1:null,19:77.777}),receipt('UNMATCHED-OPEN',{10:'Somente saldo',12:'Vencido',14:12.125,13:'2027-01-01',17:null,19:null}),receipt('QA/4',{10:'Fornecedor B',12:'Pago',19:'invalid',17:'invalid'}),receipt('QA/8',{10:'Fornecedor C'})];
const options={years:[2026],asOf:'2026-11-09',correctionScenario:'corrected',lossFormula:'subtract-negotiating'};
function annualFromDetails(model){
  return model.suppliers.flatMap(supplier=>model.meta.years.map(year=>{
    const claims=model.claims.filter(claim=>claim.supplier===supplier.name&&claim.year===year),rows=model.receiptCohorts.rows.filter(row=>row.supplier===supplier.name&&row.compensationYear===year);
    const sum=rows=>rows.reduce((total,row)=>total+row.received,0),claimed=claims.reduce((total,claim)=>total+claim.claimed,0),received=sum(rows.filter(row=>model.meta.years.includes(row.claimYear)));
    return {name:supplier.name,year,claimed,received,financialReceived:sum(rows),byYear:Object.fromEntries([...model.meta.claimYearDisplayYears,'other','unknown'].map(origin=>[origin,sum(rows.filter(row=>origin==='unknown'?row.claimYear==null:origin==='other'?row.claimYear!=null&&!model.meta.claimYearDisplayYears.includes(row.claimYear):row.claimYear===origin))])),rate:claimed?received/claimed:null};
  }));
}
const scopes=[['all years',{allYears:true}],['current year',{}],['prior years',{years:[2024,2025]}],['empty year',{years:[2023]}],['original',{allYears:true,correctionScenario:'original'}],['operation',{allYears:true,operations:['EXPORTAÇÃO - CTNR']}],['multiple operations',{allYears:true,operations:['EXPORTAÇÃO - CTNR','COMERCIAL']}],['control operation',{allYears:true,controlOperations:['COMERCIAL']}],['supplier',{allYears:true,suppliers:['Fornecedor A']}],['original supplier',{allYears:true,suppliers:['Fornecedor A'],correctionScenario:'original'}],['multiple suppliers',{allYears:true,suppliers:['Fornecedor A','Fornecedor B']}],['open-only supplier',{suppliers:['Somente saldo']}],['pending formula',{lossFormula:'pending'}],['alternate formula',{lossFormula:'add-negotiating'}]];
for(const [name,scope] of scopes)test('supplier projection preserves '+name,()=>{
  const before=JSON.stringify({bd,control}),opt={...options,...scope},full=E.analyze(bd,control,opt),lean=E.analyze(bd,control,{...opt,reportView:'suppliers'});
  assert.deepEqual(lean.summary,full.summary);
  assert.deepEqual(lean.suppliers,full.suppliers.map(({openInstallments,...supplier})=>supplier));
  assert.deepEqual(lean.supplierAnnual,annualFromDetails(full));
  assert.deepEqual(lean.receiptCohorts.meta,full.receiptCohorts.meta);
  assert.deepEqual(lean.supplierOpenReport.meta,full.supplierOpenReport.meta);
  assert.deepEqual(lean.operationOptions,full.operationOptions);
  assert.deepEqual(lean.controlReport.operationOptions,full.controlReport.operationOptions);
  assert.deepEqual(lean.controlReport.supplierOptions,full.controlReport.supplierOptions);
  for(const [key,value] of Object.entries(lean.controlReport.meta))assert.deepEqual(value,full.controlReport.meta[key],key);
  assert.equal(lean.meta.correctionQueueCount,queue(full).length);
  const {reportView,agingDate,correctionQueueCount,...meta}=lean.meta;
  assert.deepEqual(meta,full.meta);assert.equal(reportView,'suppliers');assert.equal(agingDate,E.today());
  assert.equal(JSON.stringify({bd,control}),before);
});
test('supplier projection is explicit, omits drill-down records and leaves full report unchanged',()=>{
  const full=E.analyze(bd,control,options),explicit=E.analyze(bd,control,{...options,reportView:'full'}),lean=E.analyze(bd,control,{...options,reportView:'suppliers'});
  assert.deepEqual(explicit,full);assert(full.executiveReport&&full.procurementReport&&full.claims.length);
  for(const key of ['claims','installments','corrections','correctionGroups','issues','receiptReport','claimValueAudit','correctionImpact','executiveReport','procurementReport','bd','control'])assert(!Object.hasOwn(lean,key),key);
  assert(!Object.hasOwn(lean.controlReport,'installments'));assert(!Object.hasOwn(lean.receiptCohorts,'rows'));assert(lean.suppliers.every(supplier=>!Object.hasOwn(supplier,'openInstallments')));
  assert(lean.meta.correctionQueueCount>0);assert(lean.supplierAnnual.some(row=>row.claimed%1!==0),'Annual source precision is retained');
});

test('negotiating supplier amount excludes FUP SUPRIMENTOS but preserves claimed and paid source totals',()=>{
 const rows=[bh,claim('NEG/1',{6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'Aguardando retorno',35:100}),claim('NEG/2',{6:'EM NEGOCIAÇÃO - PROCEDENTE',7:' retorno · fup   suprimentos ',35:200}),claim('NEG/3',{6:'RESSARCIMENTO ENCAMINHADO',35:300}),claim('NEG/4',{6:'EM NEGOCIAÇÃO - NÃO PROCEDENTE',35:400})];
 const payments=[ch,receipt('NEG/2',{14:40,19:40})];
 for(const reportView of ['full','suppliers']){
  const model=E.analyze(rows,payments,{...options,reportView});
  assert.equal(model.suppliers[0].negotiating,100);
  assert.equal(model.summary.negotiating,100);
  assert.equal(model.summary.claimed,1000);
  assert.equal(model.summary.received,40);
 }
});
