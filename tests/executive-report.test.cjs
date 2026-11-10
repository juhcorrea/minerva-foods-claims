'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(65).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',8:'Data ultima posição',9:'Data Fim Análise',10:'Motivo',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',31:'Cia Maritima',35:'Reclamado (USD)',49:'Causador',56:'Analista',57:'SLA 25 Dias',61:'Prazo Neg. Claims',62:'Media Abertura Claim'});
Object.assign(bh,{7:'Pendência',63:'Dias Sem Atualização'});
Object.assign(ch,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const bd=(o={})=>Object.assign(Array(65).fill(null),{0:o.sgr===undefined?o.ref||'CASE-1':o.sgr,1:o.rnc===undefined?'2026-01-01':o.rnc,3:'ME',6:o.status||'RESSARCIMENTO ENCAMINHADO',8:o.positionDate,9:o.analysisDate,10:o.reason===undefined?'AVARIA':o.reason,13:o.openingDate,19:o.country===undefined?'BRA':o.country,22:o.ref||'REF-1',24:o.nf===undefined?123:o.nf,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier===undefined?'Fornecedor exemplo':o.supplier,31:o.armador===undefined?'Armador exemplo':o.armador,35:o.claimed===undefined?100:o.claimed,49:o.cause===undefined?'Causador exemplo':o.cause,56:'Analista fictício',57:o.analysisRate,61:o.negotiationDays,62:o.openingDays});
const cr=(o={})=>Object.assign(Array(32).fill(null),{0:o.sector===undefined?'Setor exemplo':o.sector,1:o.year===undefined?2026:o.year,3:'ME',7:o.ref||'REF-1',10:o.supplier===undefined?'Fornecedor exemplo':o.supplier,11:'Depósito',12:o.status||'Pago',13:'2026-12-01',14:o.expected===undefined?10:o.expected,17:o.date===undefined?'2026-06-01':o.date,19:o.received===undefined?10:o.received,30:o.reportedYear===undefined?2026:o.reportedYear,31:'Analista fictício'});
const run=(b=[],c=[],o={})=>E.analyze([bh,...b],[ch,...c],{years:[2026],asOf:'2026-10-30',...o});
const round=n=>Math.round((n+Number.EPSILON)*100)/100;

test('executive projection keeps existing financial totals and reuses confirmed cash rows once',()=>{
 const m=run([bd({ref:'OLD',rnc:'2024-01-01',claimed:700}),bd({ref:'NEG',nf:124,status:'EM NEGOCIAÇÃO - PROCEDENTE',claimed:200,country:'URY'}),bd({ref:'NEW',nf:125,claimed:300,reason:'ATRASO',cause:'Outro causador'})],[cr({ref:'OLD; NEW',received:25}),cr({ref:'NEG',received:15,sector:'Outro setor'}),cr({ref:'UNKNOWN',received:20,sector:null}),cr({ref:'NEW',status:'Dentro do Prazo',received:500}),cr({ref:'NEW',date:'bad',received:500})]);
 const x=m.executiveReport;
 assert.equal(m.summary.claimed,500);assert.equal(m.summary.negotiating,200);assert.equal(m.summary.received,60);
 assert.equal(x.meta.totals.received,m.summary.received);assert.equal(x.meta.totals.claimed,m.summary.claimed);assert.equal(x.meta.totals.negotiating,m.summary.negotiating);
 assert.equal(x.receiptRows.length,3);assert.deepEqual(x.receiptRows.map(r=>r.row),m.receiptCohorts.rows.map(r=>r.row));
 assert.equal(x.monthlyReceipts.length,12);assert.equal(x.monthlyReceipts.find(r=>r.period==='2026-06').received,60);assert.equal(x.monthlyReceipts.find(r=>r.period==='2026-06').count,3);
 assert.equal(x.sectorReceipts.reduce((s,r)=>s+r.amount,0),60);assert.equal(x.reasonRanking.reduce((s,r)=>s+r.amount,0),500);assert.equal(x.causeRanking.reduce((s,r)=>s+r.amount,0),500);assert.equal(x.negotiationByCountry.reduce((s,r)=>s+r.amount,0),200);
 assert.equal(x.receiptRows.find(r=>r.row===4).sector,'Não informado');assert.equal(x.claimRows.find(r=>r.row===4).cause,'Outro causador');assert.equal(m.claims.find(r=>r.row===4).armador,'Armador exemplo');
});

test('operational pipeline includes analysis and costs without changing financial eligibility',()=>{
 const rows=[bd({sgr:'A',status:'EM ANÁLISE'}),bd({sgr:'B',status:'AGUARDANDO CUSTOS'}),bd({sgr:'C',status:'EM NEGOCIAÇÃO - PROCEDENTE'}),bd({sgr:'C',status:'EM NEGOCIAÇÃO - PROCEDENTE'}),bd({sgr:'D',status:'RESPONDIDO - NÃO PROCEDE'}),bd({sgr:'E',status:'EM ANÁLISE',rnc:'2025-01-01'}),bd({sgr:'F',status:'EM ANÁLISE',rnc:'2026-12-01'}),bd({sgr:'G',status:'EM ANÁLISE',reason:'INTERFERÊNCIA EXTERNA'}),bd({sgr:'H',status:'EM ANÁLISE',operation:'COMERCIAL'}),bd({sgr:null,status:'EM ANÁLISE',country:null})];
 const m=run(rows),x=m.executiveReport,bra=x.openByCountry.find(r=>r.country==='BRA');
 assert.equal(m.claims.length,2);assert.equal(m.summary.claimed,200);assert.equal(m.summary.negotiating,200);
 assert.deepEqual({negotiating:bra.negotiating,inAnalysis:bra.inAnalysis,awaitingCosts:bra.awaitingCosts,total:bra.total,recordCount:bra.recordCount},{negotiating:2,inAnalysis:2,awaitingCosts:1,total:5,recordCount:5});
 assert.equal(x.openByCountry.find(r=>r.country==='Não informado'),undefined);assert.equal(x.meta.totals.pipelineCases,5);assert.equal(x.meta.totals.pipelineRecords,5);
 assert.equal(x.negotiationByCountry[0].count,1);assert.equal(x.negotiationByCountry[0].recordCount,2);assert.deepEqual(x.negotiationByCountry[0].rows,[4,5]);
 assert(x.claimRows.some(r=>r.status==='AGUARDANDO CUSTOS'));assert(!m.claims.some(r=>r.status==='AGUARDANDO CUSTOS'));
});

test('source cause is distinct from supplier and source country/reason retain unknown groups',()=>{
 const m=run([bd({cause:null,country:null,reason:null}),bd({sgr:'2',ref:'2',cause:'Fornecedor independente',supplier:'Outro fornecedor'})]);
 assert(m.executiveReport.causeRanking.some(r=>r.name==='Não informado'));assert(!m.executiveReport.causeRanking.some(r=>r.name==='Fornecedor exemplo'));
 assert(m.executiveReport.reasonRanking.some(r=>r.name==='Não informado'));assert.equal(m.claims[0].country,'Não informado');assert.equal(m.claims[0].cause,'Não informado');
});

test('SLA uses event months, includes zero and excludes missing/invalid values without a claim-year gate',()=>{
 const m=run([
  bd({rnc:'2024-01-01',analysisDate:'2026-09-01',analysisRate:0,positionDate:'2026-08-01',negotiationDays:0,openingDate:'2026-07-01',openingDays:0}),
  bd({rnc:'2024-01-01',analysisDate:'2026-09-20',analysisRate:1,positionDate:'2026-08-02',negotiationDays:10,openingDate:'2026-07-02',openingDays:8}),
  bd({analysisDate:'2026-09-10',analysisRate:null,positionDate:'2026-08-03',negotiationDays:'bad',openingDate:'2026-07-03',openingDays:-1}),
  bd({analysisDate:'2026-09-11',analysisRate:2,positionDate:'2026-08-04',negotiationDays:-2,openingDate:'2026-07-04',openingDays:null}),
  bd({analysisDate:'2026-09-12',analysisRate:-1,positionDate:'2026-08-05',negotiationDays:40,status:'EM NEGOCIAÇÃO - PROCEDENTE'}),
  bd({analysisDate:'bad',analysisRate:1,positionDate:'2026-12-01',negotiationDays:100,openingDate:'2025-07-02',openingDays:100})
 ]);
 const x=m.executiveReport,sep=x.slaByMonth.find(r=>r.period==='2026-09'),aug=x.slaByMonth.find(r=>r.period==='2026-08'),jul=x.slaByMonth.find(r=>r.period==='2026-07');
 assert.equal(sep.analysisRate,.5);assert.equal(sep.analysisCount,2);assert.deepEqual(sep.analysisRows,[2,3]);assert.equal(aug.negotiationDays,5);assert.equal(aug.negotiationCount,2);assert.equal(jul.openingDays,4);assert.equal(jul.openingCount,2);
 assert.equal(x.slaByMonth.find(r=>r.period==='2026-06').analysisRate,null);assert.equal(x.slaByMonth.find(r=>r.period==='2026-12').negotiationCount,0);
 assert.equal(x.claimRows.find(r=>r.row===2).rncDate,'2024-01-01');assert.deepEqual(x.claimRows.find(r=>r.row===2).analysisEvent,{date:'2026-09-01',value:0});
});

test('future compensation is preserved exactly as in existing cohorts; SLA future events are excluded',()=>{
 const m=run([bd({analysisDate:'2026-12-01',analysisRate:1})],[cr({date:'2026-12-01',received:23})]);
 assert.equal(m.summary.received,23);assert.equal(m.executiveReport.monthlyReceipts.find(r=>r.period==='2026-12').received,23);assert.equal(m.executiveReport.slaByMonth.find(r=>r.period==='2026-12').analysisCount,0);
});

test('global operation/supplier filters apply and control-tab operation stays independent',()=>{
 const b=[bd({ref:'A',supplier:'One',analysisDate:'2026-09-01',analysisRate:1,status:'EM NEGOCIAÇÃO - PROCEDENTE'}),bd({ref:'B',nf:124,supplier:'Two',operation:'EXPORTAÇÃO - CARRETA',analysisDate:'2026-09-01',analysisRate:0,status:'EM NEGOCIAÇÃO - PROCEDENTE'}),bd({ref:'C',nf:125,supplier:'Three',operation:'COMERCIAL',analysisDate:'2026-09-01',analysisRate:0,status:'EM NEGOCIAÇÃO - PROCEDENTE'})];
 const c=[cr({ref:'A',supplier:'One',received:10}),cr({ref:'B',supplier:'Two',received:20}),cr({ref:'C',supplier:'Three',received:30}),cr({ref:'UNKNOWN',supplier:'One',received:40})];
 const base=run(b,c),separate=run(b,c,{controlOperation:'COMERCIAL'}),one=run(b,c,{operation:'EXPORTAÇÃO - CTNR',supplier:'One'});
 assert.deepEqual(separate.executiveReport,base.executiveReport);
 assert.equal(one.executiveReport.meta.totals.received,10);assert.equal(one.executiveReport.meta.totals.negotiating,100);assert.equal(one.executiveReport.openByCountry[0].total,1);assert.equal(one.executiveReport.slaByMonth.find(r=>r.period==='2026-09').analysisRate,1);assert(one.executiveReport.claimRows.every(r=>r.supplier==='One'));
});

test('original/corrected scenarios reuse their existing safe receipt attribution',()=>{
 const b=[bd({ref:'A',supplier:'Validated',rnc:'2024-01-01'})],c=[cr({ref:'A',supplier:'Original',year:2026,received:30}),cr({ref:'UNMATCHED',supplier:'Original',received:20})];
 for(const correctionScenario of ['original','corrected'])for(const supplier of ['', 'Original','Validated']){
  const m=run(b,c,{correctionScenario,supplier}),x=m.executiveReport;
  assert.deepEqual(x.receiptRows.map(r=>[r.row,r.supplier,r.received]),m.receiptCohorts.rows.map(r=>[r.row,r.supplier,r.received]));assert.equal(x.meta.totals.received,m.summary.received);assert.equal(round(x.receiptRows.reduce((s,r)=>s+r.received,0)),m.summary.received);assert.equal(x.meta.correctionScenario,correctionScenario);
 }
});

test('optional missing headers do not reinterpret unrelated columns as executive metrics',()=>{
 const missing=[...bh];for(const i of [19,31,49,57,61,62])missing[i]='Another field';
 const c=[...ch];c[0]='Another sector field';
 const m=E.analyze([missing,bd({analysisDate:'2026-09-01',analysisRate:1})],[c,cr()],{years:[2026],asOf:'2026-10-30'}),x=m.executiveReport;
 assert.equal(x.meta.available.analysis,false);assert.equal(x.meta.available.country,false);assert.equal(x.meta.available.sector,false);assert.equal(x.slaByMonth.find(r=>r.period==='2026-09').analysisCount,0);assert.equal(x.claimRows[0].country,'Não informado');assert.equal(x.claimRows[0].cause,'Não informado');assert.equal(x.receiptRows[0].sector,'Não informado');
});

test('empty data returns explicit zero amounts and null SLA denominators without mutation',()=>{
 const b=[bh],c=[ch],before=JSON.stringify({b,c});const m=E.analyze(b,c,{years:[2025,2026],asOf:'2026-10-30'}),x=m.executiveReport;
 assert.equal(x.monthlyReceipts.length,24);assert(x.monthlyReceipts.every(r=>r.received===0&&r.count===0));assert(x.slaByMonth.every(r=>r.analysisRate===null&&r.negotiationDays===null&&r.openingDays===null));assert.equal(x.receiptRows.length,0);assert.equal(x.claimRows.length,0);assert.equal(x.meta.totals.received,0);assert.equal(JSON.stringify({b,c}),before);
});

test('financial calculations remain identical when executive source fields are absent',()=>{
 const b=[bd({analysisDate:'2026-09-01',analysisRate:1,status:'EM NEGOCIAÇÃO - PROCEDENTE'}),bd({ref:'B',nf:124,claimed:250})],c=[cr({received:70}),cr({ref:'B',received:80}),cr({ref:'B',status:'Vencido',expected:10})],before=JSON.stringify({b,c});
 const m=run(b,c),without=E.analyze([bh.map((h,i)=>[19,31,49,57,61,62].includes(i)?'':h),...b],[ch,...c],{years:[2026],asOf:'2026-10-30'});
 for(const key of ['summary','suppliers','annual','monthly','receiptCohorts','supplierOpenReport'])assert.deepEqual(m[key],without[key],key);
 assert.equal(JSON.stringify({b,c}),before);
});

test('every known Claim operation is available and filterable while default retains unknown receipts',()=>{
 const operations=['EXPORTAÇÃO - CTNR','EXPORTAÇÃO - CARRETA','EXPORTAÇÃO - AEREO','IMPORTAÇÃO - CTNR','IMPORTAÇÃO - CARRETA','TRANSFERÊNCIA ARMAZENAGEM','COMERCIAL','TRANSFERÊNCIA'];
 const b=operations.map((operation,i)=>bd({ref:'OP'+i,nf:i+1,operation,status:'EM NEGOCIAÇÃO - PROCEDENTE',analysisDate:'2026-09-01',analysisRate:1}));
 const c=operations.map((operation,i)=>cr({ref:'OP'+i,received:(i+1)*10}));c.push(cr({ref:'UNLINKED',received:100}));
 for(const correctionScenario of ['original','corrected']){
  const m=run(b,c,{correctionScenario});
  assert.equal(m.summary.claimed,800);assert.equal(m.summary.received,460);assert.equal(m.meta.allOperationsDefault,true);assert.equal(m.meta.operationScope,'all');assert.deepEqual(new Set(m.operationOptions),new Set(operations));assert(!m.operationOptions.includes('SEM OPERAÇÃO IDENTIFICADA'));
  assert.equal(m.executiveReport.meta.totals.pipelineCases,8);assert.equal(m.executiveReport.slaByMonth.find(r=>r.period==='2026-09').analysisCount,8);
  assert.equal(m.summary.received,m.controlReport.meta.receivedConfirmed);assert.equal(m.summary.received,m.receiptReport.annual.find(r=>r.year===2026).received);
  operations.forEach((operation,i)=>{const f=run(b,c,{correctionScenario,operation});assert.equal(f.summary.claimed,100);assert.equal(f.summary.received,(i+1)*10);assert.equal(f.meta.operationScope,'selected');assert.equal(f.executiveReport.controlClaims.length,1);assert.equal(f.executiveReport.slaByMonth.find(r=>r.period==='2026-09').analysisCount,1);assert.equal(f.receiptCohorts.meta.excludedUnknownOperationCount,1);});
 }
});

test('operational Claim control retains excluded financial rows and literal source fields',()=>{
 const source=[
  Object.assign(bd({ref:'ANALYSIS',status:'EM ANÁLISE',claimed:null,operation:'COMERCIAL'}),{7:'FUP SUPRIMENTOS — EXEMPLO',8:'2026-10-01',13:'2026-09-10',63:0}),
  Object.assign(bd({ref:'WAR',reason:'INTERFERÊNCIA EXTERNA',country:null}),{7:'Outra pendência',8:'bad date',63:15}),
  Object.assign(bd({ref:'GOOD',claimed:30}),{63:-1}),
  bd({ref:'FUTURE',rnc:'2026-12-01'}),bd({ref:'OLD',rnc:'2025-01-01'}),bd({ref:'INVALID',rnc:'bad'})
 ];
 const before=JSON.stringify(source),m=run(source),rows=m.executiveReport.controlClaims;
 assert.deepEqual(rows.map(r=>r.row),[2,3,4,5,6,7]);assert.equal(m.claims.length,1);assert.equal(m.summary.claimed,30);
 assert.equal(rows[0].financialEligible,false);assert.match(rows[0].reasonExcluded,/Situação/);assert.equal(rows[0].pending,'FUP SUPRIMENTOS — EXEMPLO');assert.equal(rows[0].claimed,null);assert.equal(rows[0].daysWithoutUpdate,0);assert.equal(rows[0].lastUpdateDate,'2026-10-01');assert.equal(rows[0].openingDate,'2026-09-10');assert.equal(rows[0].order,'ANALYSIS');assert.equal(rows[0].analyst,'Analista fictício');
 assert.equal(rows[1].financialEligible,false);assert.match(rows[1].reasonExcluded,/INTERFERÊNCIA/);assert.equal(rows[1].country,'Não informado');assert.equal(rows[1].lastUpdateDate,null);assert.equal(rows[1].daysWithoutUpdate,15);
 assert.equal(rows[2].financialEligible,true);assert.equal(rows[2].reasonExcluded,'');assert.equal(rows[2].daysWithoutUpdate,null,'Negative source duration is not interpreted as valid');
 assert.match(rows[3].reasonExcluded,/posterior/);assert.match(rows[4].reasonExcluded,/fora do recorte financeiro/);assert.match(rows[5].reasonExcluded,/ausente ou inválida/);
 assert.equal(run(source,[],{operation:'COMERCIAL'}).executiveReport.controlClaims.length,1);assert.equal(JSON.stringify(source),before);
});
