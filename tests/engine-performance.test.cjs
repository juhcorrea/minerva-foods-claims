'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(64).fill(null),ch=Array(32).fill(null);
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(order,analyst,supplier='Fornecedor Á',status='RESSARCIMENTO ENCAMINHADO')=>Object.assign(Array(64).fill(null),{0:order,1:'2026-01-01',3:'ME',6:status,10:'AVARIA',22:order,24:order,25:'EXPORTAÇÃO - CTNR',28:supplier,35:100,56:analyst});
const receipt=(ref,received=300)=>Object.assign(Array(32).fill(null),{1:2026,3:'ME',7:ref,10:'Fornecedor A',11:'Depósito',12:'Pago',13:'2026-02-01',14:received,17:'2026-02-01',19:received,30:2026,31:'Analista Controle'});
const options={years:[2026],asOf:'2026-11-09',correctionScenario:'corrected',lossFormula:'subtract-negotiating'};

test('supplier indexes keep analyst order, normalized aliases and per-supplier issue counts',()=>{
  const bd=[bh,claim('QA/1','Ana'),claim('QA/2','Bruno',' FORNECEDOR A '),claim('QA/3','Carla','Fornecedor A','EM ANALISE'),claim('QA/4','Davi','Fornecedor B')];
  const control=[ch,receipt('QA/1; QA/2')],original=JSON.stringify({bd,control});
  const model=E.analyze(bd,control,options),warning=model.issues.find(item=>item.kind==='RECEIVED_ABOVE_FORWARDED');
  assert(warning);assert.deepEqual(warning.analysts,['Ana','Bruno']);
  assert.deepEqual(model.claims.filter(row=>row.order==='QA/1'||row.order==='QA/2').map(row=>row.linkState),['grouped','grouped']);
  assert.equal(model.claims.find(row=>row.order==='QA/4').linkState,'unmatched');
  for(const supplier of model.suppliers)assert.equal(supplier.reviewCount,model.issues.filter(item=>E.normalizeSupplier(item.supplier)===E.normalizeSupplier(supplier.name)).length);
  assert.equal(JSON.stringify({bd,control}),original);
});

test('repeated analyses use edited source cells and headers after a validation failure',()=>{
  const header=[...bh];header[19]='País';const row=claim('QA/1','Ana');row[19]='BRA';
  const bd=[header,row],control=[ch,receipt('QA/1',50)];
  const first=E.analyze(bd,control,options);assert.equal(first.summary.claimed,100);assert.equal(first.claims[0].country,'BRA');
  header[1]='Invalid header';assert.throws(()=>E.analyze(bd,control,options),/colunas esperadas/);
  header[1]='Data RNC';header[19]='Coluna diferente';row[28]='Fornecedor B';row[35]=200;row[1]='2025-01-01';
  const current=E.analyze(bd,control,options);assert.equal(current.summary.claimed,0);
  const historical=E.analyze(bd,control,{...options,allYears:true});assert.equal(historical.summary.claimed,200);assert.equal(historical.claims[0].country,'Não informado');assert.equal(historical.claims[0].supplier,'Fornecedor B');
  assert.equal(first.summary.claimed,100);assert.equal(first.claims[0].country,'BRA');
});

test('date memoization distinguishes numeric Excel serials from numeric text and mutable Date objects',()=>{
  const numeric=claim('QA/N','Ana'),text=claim('QA/T','Bruno');numeric[1]=46023;text[1]='46023';
  const model=E.analyze([bh,numeric,text],[ch],options);assert.equal(model.claims.length,1);assert.equal(model.claims[0].order,'QA/N');
  assert(model.issues.some(item=>item.kind==='INVALID_RNC_DATE'&&item.reference==='QA/T'));
  const mutableDate=new Date('2026-01-01T12:00:00Z'),dated=claim('QA/D','Ana');dated[1]=mutableDate;
  assert.equal(E.analyze([bh,dated],[ch],options).claims.length,1);mutableDate.setUTCFullYear(2025);
  assert.equal(E.analyze([bh,dated],[ch],options).claims.length,0);
});
