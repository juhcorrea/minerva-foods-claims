'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(extra={})=>row(64,{0:'REPEATED',1:'2026-01-01',3:'ME',6:'EM ANÁLISE',10:'AVARIA',19:'BRA',22:'QA/1',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:100,...extra});
const run=(rows,options={})=>E.analyze([bh,...rows],[ch],{years:[2026],asOf:'2026-11-10',...options});

test('each filled SGR row counts across repeated identifiers, countries and stages; totals match drilldown rows',()=>{
 const rows=[claim(),claim({22:'QA/2'}),claim({6:'AGUARDANDO CUSTOS',22:'QA/3'}),claim({6:'EM NEGOCIAÇÃO - PROCEDENTE',22:'QA/4'}),claim({19:'URY',22:'QA/5'}),claim({0:'   ',22:'QA/EMPTY'}),claim({0:null,22:'QA/NULL'})],before=JSON.stringify(rows),model=run(rows),x=model.executiveReport;
 const bra=x.openByCountry.find(r=>r.country==='BRA'),ury=x.openByCountry.find(r=>r.country==='URY');
 assert.deepEqual({negotiating:bra.negotiating,inAnalysis:bra.inAnalysis,awaitingCosts:bra.awaitingCosts,total:bra.total,recordCount:bra.recordCount,rows:bra.rows},{negotiating:1,inAnalysis:2,awaitingCosts:1,total:4,recordCount:4,rows:[2,3,4,5]});
 assert.equal(ury.total,1);assert.equal(x.meta.totals.pipelineCases,5);assert.equal(x.meta.totals.pipelineRecords,5);
 for(const country of x.openByCountry){assert.equal(country.total,country.negotiating+country.inAnalysis+country.awaitingCosts);assert.equal(country.total,country.rows.length);assert.deepEqual(x.claimRows.filter(r=>country.rows.includes(r.row)).map(r=>r.row),country.rows);}
 assert.equal(new Set(x.openByCountry.flatMap(r=>r.rows)).size,5);assert(x.openByCountry.flatMap(r=>r.rows).every(id=>x.claimRows.find(r=>r.row===id)?.sgr.trim()));
 assert.equal(x.controlClaims.length,7,'Missing SGR source lines remain available in the operational source detail');assert.equal(JSON.stringify(rows),before);
});

test('pipeline preserves its existing status/date/global filters and external-interference exclusion',()=>{
 const rows=[claim(),claim({6:'RESSARCIMENTO ENCAMINHADO'}),claim({10:'INTERFERÊNCIA EXTERNA'}),claim({1:'2025-01-01'}),claim({1:'2026-12-01'}),claim({1:null}),claim({25:'COMERCIAL'}),claim({28:'Outro fornecedor'})],x=run(rows,{operation:'EXPORTAÇÃO - CTNR',supplier:'Fornecedor QA'}).executiveReport;
 assert.deepEqual(x.openByCountry[0].rows,[2]);assert.equal(x.meta.totals.pipelineCases,1);
 assert.equal(run(rows,{allYears:true,operation:'EXPORTAÇÃO - CTNR',supplier:'Fornecedor QA'}).executiveReport.meta.totals.pipelineCases,2);
});

test('changing only SGR duplicates to distinct values never changes monetary rankings or financial totals',()=>{
 const rows=[claim({6:'EM NEGOCIAÇÃO - PROCEDENTE'}),claim({6:'EM NEGOCIAÇÃO - PROCEDENTE',22:'QA/2'})],repeated=run(rows),distinct=run(rows.map((r,i)=>{const copy=[...r];copy[0]='SGR-'+i;return copy;}));
 assert.equal(repeated.summary.claimed,200);assert.equal(repeated.summary.claimed,distinct.summary.claimed);assert.equal(repeated.summary.negotiating,distinct.summary.negotiating);assert.equal(repeated.summary.received,distinct.summary.received);
 assert.equal(repeated.executiveReport.negotiationByCountry[0].amount,200);assert.equal(repeated.executiveReport.negotiationByCountry[0].count,1,'Monetary group count semantics are untouched');assert.equal(repeated.executiveReport.negotiationByCountry[0].recordCount,2);
 assert.deepEqual(repeated.executiveReport.openByCountry,distinct.executiveReport.openByCountry);assert.equal(repeated.executiveReport.meta.totals.pipelineCases,2);
});
