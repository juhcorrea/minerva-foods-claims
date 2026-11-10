'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',10:'Motivo',16:'Área negociação',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(id,extra={})=>row(64,{0:id,1:'2026-01-01',3:'ME',5:'Aberto',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',16:'CIA MARÍTIMA',22:id,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100,...extra});
const run=(bd,options={},header=bh)=>E.analyze([header,...bd],[ch],{years:[2026],asOf:'2026-11-10',...options});

test('operational history keeps literal F separate from G, old/unknown dates, insurance and excluded financial reasons',()=>{
 const bd=[claim('repeat',{1:'2020-01-01',5:'  fEchÁdo  ',6:'EM ANÁLISE'}),claim('repeat',{1:'2021-01-01',5:'ABERTO',6:'PROCEDENTE - SEGURO',16:'Seguro'}),claim('repeat',{1:'2025-01-01',5:'Aberto',10:'INTERFERÊNCIA EXTERNA'}),claim('current',{5:'Fechado'}),claim('no-date',{1:null,5:null,6:'EM NEGOCIAÇÃO - PROCEDENTE'}),claim('',{1:'2027-01-01',5:'Em revisão'})],before=JSON.stringify(bd),m=run(bd),rows=m.executiveReport.controlClaims;
 assert.equal(rows.length,6);assert.deepEqual(rows.map(r=>r.caseStatusKey),['closed','open','open','closed','unknown','unknown']);assert.equal(rows[0].caseStatus,'fEchÁdo');assert.equal(rows[0].status,'EM ANÁLISE');assert.equal(rows[4].caseStatus,'Não informado');assert.equal(rows[5].caseStatus,'Em revisão');assert.deepEqual(rows.map(r=>r.rncYear),[2020,2021,2025,2026,null,2027]);
 assert.equal(rows.filter(r=>r.sgr).length,5,'case count is one per filled SGR row, not unique SGR');assert.equal(rows.filter(r=>r.caseStatusKey==='open'&&r.sgr).length,2);assert.equal(rows.filter(r=>!r.sgr).length,1);
 assert.equal(m.summary.claimed,100);assert.equal(m.summary.occurrences,1);assert.match(rows[1].reasonExcluded,/fora do recorte financeiro/);assert.match(rows[2].reasonExcluded,/INTERFERÊNCIA/);assert.match(rows[4].reasonExcluded,/Data RNC ausente/);assert.match(rows[5].reasonExcluded,/posterior/);assert.equal(JSON.stringify(bd),before);
});

test('available case years are dynamic and stable across financial periods, lean mode and supplier/operation filters',()=>{
 const bd=[claim('old',{1:'2019-01-01'}),claim('recent'),claim('other',{1:'2022-01-01',25:'COMERCIAL',28:'Outro fornecedor'}),claim('unknown',{1:null})],full=run(bd),lean=run(bd,{reportView:'suppliers'}),filtered=run(bd,{years:[2023],operation:'COMERCIAL'}),all=run(bd,{allYears:true});
 for(const m of [full,lean,filtered,all])assert.deepEqual(m.meta.caseYears,[2019,2022,2026]);assert.deepEqual(full.executiveReport.caseYears,full.meta.caseYears);assert.equal(filtered.executiveReport.controlClaims.length,1);assert.equal(filtered.executiveReport.controlClaims[0].sgr,'other');assert.equal(full.executiveReport.controlClaims.length,all.executiveReport.controlClaims.length);assert.equal(run(bd,{supplier:'Fornecedor QA'}).executiveReport.controlClaims.length,3);
});

test('F values only affect operational classification and missing or unexpected headers never infer status from G',()=>{
 const bd=[claim('one'),claim('two',{5:'Fechado',6:'EM NEGOCIAÇÃO - PROCEDENTE'})],changed=bd.map(r=>{const copy=[...r];copy[5]='Fechado';return copy;}),a=run(bd),b=run(changed);
 for(const key of ['summary','suppliers','receiptCohorts','supplierOpenReport','baseReconciliation','claimValueAudit'])assert.deepEqual(a[key],b[key]);for(const key of ['monthlyReceipts','negotiationByCountry','openByCountry','reasonRanking','causeRanking','sectorReceipts','slaByMonth'])assert.deepEqual(a.executiveReport[key],b.executiveReport[key]);
 for(const headerValue of [null,'Campo sem relação']){const header=[...bh];header[5]=headerValue;const m=run(bd,{},header);assert.equal(m.executiveReport.meta.available.caseStatus,false);assert(m.executiveReport.controlClaims.every(r=>r.caseStatusKey==='unknown'&&r.caseStatus==='Não informado'));}
});
