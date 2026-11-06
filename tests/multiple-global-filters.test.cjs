'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(65).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',8:'Data ultima posição',9:'Data Fim Análise',10:'Motivo',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',49:'Causador',56:'Analista',57:'SLA 25 Dias',61:'Prazo Neg. Claims',62:'Media Abertura Claim'});
Object.assign(ch,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const EX='EXPORTAÇÃO - CTNR',MI='COMERCIAL',IM='IMPORTAÇÃO - CTNR';
const bd=(ref,supplier,operation,claimed=100,o={})=>Object.assign(Array(65).fill(null),{0:ref,1:o.rnc||'2026-01-01',3:'ME',6:o.status||'EM NEGOCIAÇÃO - PROCEDENTE',7:o.pending||'Aguardando retorno',8:'2026-03-01',9:'2026-03-01',10:'AVARIA',13:'2026-02-01',19:'BRA',22:ref,24:ref+'-NF',25:operation,28:supplier,35:claimed,49:'Causador fictício',56:'Analista fictício',57:1,61:10,62:20});
const cr=(ref,supplier,received,o={})=>Object.assign(Array(32).fill(null),{0:'Setor fictício',1:o.year||2026,3:'ME',7:ref,10:supplier,11:'Depósito',12:o.status||'Pago',13:'2026-12-01',14:o.expected??received,17:o.date===undefined?'2026-03-01':o.date,19:received,31:'Analista fictício'});
const fixture=()=>({b:[bh,bd('A','Fornecedor A',EX,100),bd('B','Fornecedor B',MI,200),bd('C','Fornecedor C',IM,300)],c:[ch,cr('A','Fornecedor A',10),cr('B','Fornecedor B',20),cr('C','Fornecedor C',30),cr('A; B','Consolidação fictícia',15),cr('UNKNOWN','Sem vínculo fictício',40),cr('A','Fornecedor A',0,{status:'Dentro do Prazo',expected:5,date:null}),cr('B','Fornecedor B',0,{status:'Vencido',expected:6,date:null}),cr('C','Fornecedor C',0,{status:'Vencido',expected:7,date:null}),cr('A; B','Consolidação fictícia',0,{status:'Dentro do Prazo',expected:8,date:null})]});
const run=({b,c},o={})=>E.analyze(b,c,{years:[2026],asOf:'2026-11-06',...o});

test('operation selections use OR and include a complete mixed-operation receipt once only when the set covers every operation',()=>{
 const input=fixture(),before=JSON.stringify(input),m=run(input,{operations:[EX,MI]});
 assert.equal(m.summary.claimed,300);assert.equal(m.summary.received,45);assert.equal(m.summary.receivedComparable,45);assert.equal(m.supplierOpenReport.meta.openBalance,19);
 assert.deepEqual(m.receiptCohorts.rows.map(row=>row.row),[2,3,5]);assert.equal(new Set(m.receiptCohorts.rows.map(row=>row.row)).size,3);
 assert.equal(run(input,{operations:[EX]}).summary.received,10);assert.equal(run(input,{operations:[MI]}).summary.received,20,'Mixed receipt is not allocated to either subset');
 assert.equal(m.receiptCohorts.meta.excludedUnknownOperationCount,1);assert.equal(run(input).summary.received,115,'Unknown operation remains included only in the general filter');
 assert.deepEqual(m.meta.operations,[EX,MI]);assert.deepEqual(m.executiveReport.meta.operations,[EX,MI]);assert.deepEqual(m.procurementReport.meta.operations,[EX,MI]);assert.equal(JSON.stringify(input),before);
});

test('supplier selections use OR and combine with operation selections using AND across reports',()=>{
 const input=fixture();input.b.push(bd('ANALYSIS','Fornecedor B',MI,40,{status:'EM ANÁLISE'}),bd('FUP','Fornecedor A',EX,500,{pending:'FUP SUPRIMENTOS'}),bd('LEGAL','JURÍDICO',MI,80));
 const m=run(input,{operations:[EX,MI],suppliers:['Fornecedor A','Fornecedor B']});
 assert.equal(m.summary.claimed,800);assert.equal(m.summary.received,30);assert.equal(m.supplierOpenReport.meta.openBalance,11);assert.deepEqual(m.executiveReport.controlClaims.map(row=>row.sgr),['A','B','ANALYSIS','FUP']);
 assert.equal(m.executiveReport.slaByMonth.find(row=>row.period==='2026-03').analysisCount,4);assert.equal(m.executiveReport.openByCountry[0].inAnalysis,1);
 assert.equal(m.procurementReport.negotiationTotal,300);assert.equal(m.procurementReport.legalTotal,0);assert.equal(m.procurementReport.meta.excludedFupCount,1);assert.deepEqual(m.procurementReport.rows.map(row=>row.sgr),['A','B']);
 const legal=run(input,{operations:[EX,MI],suppliers:['Fornecedor A','JURÍDICO']}).procurementReport;assert.equal(legal.negotiationTotal,100);assert.equal(legal.legalTotal,80);assert.equal(legal.grandTotal,180);
 assert.equal(run(input,{operations:[IM],suppliers:['Fornecedor A','Fornecedor B']}).summary.received,0);
});

test('independent Control operation selections preserve global totals and retain unknown operation by explicit choice',()=>{
 const input=fixture(),base=run(input,{operations:[EX,MI]}),m=run(input,{operations:[EX,MI],controlOperations:[MI,IM]});
 assert.deepEqual(m.summary,base.summary);assert.deepEqual(m.receiptCohorts,base.receiptCohorts);assert.deepEqual(m.supplierOpenReport,base.supplierOpenReport);
 assert.deepEqual(m.controlReport.installments.map(row=>row.row),[3,4,8,9]);assert.deepEqual(m.controlReport.meta.operations,[MI,IM]);assert.deepEqual(m.controlReport.meta.comparativeOperations,[EX,MI]);
 const unknown=run(input,{controlOperations:[MI,'SEM OPERAÇÃO IDENTIFICADA']});assert.deepEqual(unknown.controlReport.installments.map(row=>row.row),[3,5,6,8,10]);
});

test('single legacy strings, legacy arrays and plural arrays have identical financial results and correction scenarios',()=>{
 const input=fixture();for(const correctionScenario of ['original','corrected']){
  const strings=run(input,{operation:EX,supplier:'Fornecedor A',controlOperation:MI,correctionScenario});
  const arrays=run(input,{operation:[EX],supplier:['Fornecedor A'],controlOperation:[MI],correctionScenario});
  const plurals=run(input,{operations:[EX],suppliers:['Fornecedor A'],controlOperations:[MI],correctionScenario});
  assert.deepEqual(arrays,strings);assert.deepEqual(plurals,strings);
 }
 const options={operations:[EX,MI],suppliers:['Fornecedor A','Fornecedor B'],controlOperations:[IM]},copy=JSON.stringify(options);run(input,options);assert.equal(JSON.stringify(options),copy);
});

test('plural empty selections clear legacy filters; normalization deduplicates selections without duplicating money',()=>{
 const input=fixture(),base=run(input),empty=run(input,{operation:EX,supplier:'Fornecedor A',controlOperation:MI,operations:[],suppliers:[],controlOperations:[]});assert.deepEqual(empty,base);
 const options={operations:[EX,' exportacao–ctnr ',MI],suppliers:['Fornecedor A',' fornecedor   a ','Fornecedor B'],controlOperations:[MI,'comercial']},m=run(input,options),expected=run(input,{operations:[EX,MI],suppliers:['Fornecedor A','Fornecedor B'],controlOperations:[MI]});
 assert.deepEqual(m,expected);assert.equal(m.meta.operations.length,2);assert.equal(m.meta.suppliers.length,2);assert.equal(m.meta.controlOperations.length,1);
});

test('all-years and corrections remain independent of multi-selection, including original Control attribution',()=>{
 const input=fixture();input.b[1][1]='2020-01-01';input.c[1][1]=2021;input.c[1][10]='Nome original fictício';
 for(const correctionScenario of ['original','corrected']){
  const options={allYears:true,operations:[EX,MI],suppliers:['Fornecedor A','Fornecedor B','Nome original fictício'],correctionScenario},m=run(input,options);
  assert.equal(m.summary.claimed,300);assert.equal(m.summary.received,30);assert.equal(m.summary.receivedComparable,30);assert(m.meta.years.includes(2020));assert(m.meta.years.includes(2021));
  const paid=m.receiptCohorts.rows.find(row=>row.reference==='A');assert.equal(paid.supplier,correctionScenario==='original'?'Nome original fictício':'Fornecedor A');assert.equal(paid.claimYear,correctionScenario==='original'?2021:2020);
  assert.equal(m.procurementReport.negotiationTotal,300);
 }
});
