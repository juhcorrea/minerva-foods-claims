'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',9:'Data Fim Análise',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',49:'Causador',56:'Analista',57:'SLA 25 Dias'});
const ch=row(32,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(id,date,amount,extra={})=>row(65,{0:id,1:date,3:'ME',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'',9:date,10:'AVARIA',19:'BRA',22:id,24:id+'-NF',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Alfa',35:amount,49:'Causador fictício',56:'Analista fictício',57:1,...extra});
const paid=(ref,date,amount,extra={})=>row(32,{0:'Setor fictício',1:2026,3:'ME',7:ref,10:'Fornecedor Alfa',11:'Depósito',12:'Pago',13:'2026-11-10',14:amount,17:date,19:amount,30:2026,31:'Analista fictício',...extra});
const open=(date,amount,status)=>paid('QA-FORWARDED',null,null,{12:status,13:date,14:amount});
const fixture=()=>({bd:[bh,
  claim('QA-NOV','2026-11-02',100),claim('QA-OCT','2026-10-02',200),
  claim('QA-PRIOR','2025-11-02',300,{19:'ARG'}),claim('QA-HISTORY','2020-11-02',400,{19:'URY'}),
  claim('QA-FORWARDED','2026-11-03',500,{6:'RESSARCIMENTO ENCAMINHADO'}),
  claim('QA-FUP','2026-11-04',600,{7:'FUP SUPRIMENTOS'}),
  claim('QA-OTHER','2026-11-05',700,{6:'EM NEGOCIAÇÃO - NÃO PROCEDENTE'}),
  claim('QA-COSTS','2026-11-06',800,{6:'AGUARDANDO CUSTOS'}),
  claim('QA-EXTERNAL','2026-11-07',900,{10:'INTERFERÊNCIA EXTERNA'}),
  claim('QA-BETA','2026-11-08',1000,{28:'Fornecedor Beta',25:'COMERCIAL'}),
  claim('QA-DEC','2026-12-02',1100),claim('QA-NO-DATE',null,1200)
],control:[ch,
  paid('QA-NOV','2026-11-04',10),paid('QA-OCT','2026-11-05',20),paid('QA-PRIOR','2026-11-06',30),
  paid('QA-HISTORY','2025-11-07',40),paid('QA-FORWARDED','2026-10-08',50),paid('QA-FORWARDED','2026-11-09',60),
  paid('QA-NOV; QA-FORWARDED','2026-11-10',70),paid('QA-UNKNOWN','2026-11-11',80),
  paid('QA-BETA','2026-11-12',90,{10:'Fornecedor Beta'}),
  open('2026-11-01',100,'Dentro do Prazo'),open('2026-11-20',200,'Vencido'),
  open('2026-10-01',300,'Vencido'),open('2025-11-01',400,'Vencido'),
  open(null,500,'Dentro do Prazo'),open('invalid',600,'Dentro do Prazo'),open('2026-12-01',700,'Dentro do Prazo'),
  paid('QA-OCT','2026-12-01',100),paid('QA-NOV','invalid',110)
]});
const run=(input,options={})=>E.analyze(input.bd,input.control,{years:[2026],asOf:'2026-12-31',...options});
const sum=(items,key)=>items.reduce((total,item)=>total+(item[key]||0),0);

test('no months and all twelve months preserve historical negotiation and all-year open stock',()=>{
  const input=fixture(),before=JSON.stringify(input),base=run(input);
  assert.equal(base.executiveReport.negotiationPortfolio.amount,3100);assert.equal(base.executiveReport.negotiationPortfolio.allYears,true);
  assert.equal(base.supplierOpenReport.meta.openBalance,2800);assert.equal(base.summary.claimed,4200);assert.equal(base.summary.received,510);
  for(const months of [[],Array.from({length:12},(_,i)=>i+1),[0,13,1.5,null,'bad',true]]){
    const next=run(input,{months});assert.deepEqual(next,base);assert.deepEqual(next.meta.months,[]);
  }
  assert.equal(JSON.stringify(input),before);
});

test('November 2026 filters RNC, compensation and due dates independently and keeps every view consistent',()=>{
  const input=fixture(),before=JSON.stringify(input),m=run(input,{months:[11]}),x=m.executiveReport,p=x.negotiationPortfolio,r=x.recoveryComparison;
  assert.deepEqual(m.meta.months,[11]);assert.deepEqual(x.months,[11]);assert.deepEqual(p.months,[11]);assert.equal(p.allYears,false);
  assert.deepEqual(p.years,[2026]);assert.deepEqual(p.rows,[2,11]);assert.equal(p.amount,1100);assert.equal(sum(p.byCountry,'amount'),1100);
  assert.equal(m.summary.claimed,2900);assert.equal(m.summary.negotiating,1100);assert.equal(m.summary.received,360);
  assert.equal(m.annual[0].claimed,2900);assert.equal(m.annual[0].received,360);
  assert.equal(sum(m.suppliers,'claimed'),2900);assert.equal(sum(m.suppliers,'received'),360);
  assert.equal(sum(x.reasonRanking,'amount'),2900);assert.equal(sum(x.causeRanking,'amount'),2900);assert.equal(sum(x.sectorReceipts,'amount'),360);
  assert.equal(r.claimed,2200);assert.equal(r.received,230);assert.equal(r.unallocatedReceived,130);assert.equal(r.rate,230/2200);
  assert.deepEqual(r.months,[11]);assert.deepEqual(r.claimRows,[2,6,7,11]);
  assert.deepEqual(m.receiptCohorts.rows.map(item=>item.row),[2,3,4,7,8,9,10]);
  assert.deepEqual(x.receiptRows.map(item=>item.row),m.receiptCohorts.rows.map(item=>item.row));
  assert.equal(m.controlReport.meta.receivedConfirmed,360);assert.equal(sum(m.controlReport.installments.filter(item=>item.includedInConfirmed),'received'),360);
  assert.equal(x.monthlyReceipts.find(item=>item.period==='2026-11').received,360);
  assert(x.monthlyReceipts.filter(item=>item.month!==11).every(item=>item.received===0));
  assert(m.receiptReport.rows.every(item=>item.compDate.startsWith('2026-11')));
  assert.equal(x.slaByMonth.find(item=>item.period==='2026-10').analysisCount,0);
  assert.equal(m.supplierOpenReport.meta.openBalance,300);assert.equal(m.supplierOpenReport.meta.overdueBalance,200);assert.equal(m.supplierOpenReport.meta.onTimeBalance,100);
  assert.deepEqual(m.supplierOpenReport.installments.map(item=>item.row),[11,12]);
  assert.equal(m.supplierOpenReport.installments[0].status,'Dentro do Prazo','the month filter must not replace the original M status with a date-derived status');
  assert.equal(m.supplierOpenReport.meta.excludedDueDateCount,2);assert.equal(m.supplierOpenReport.meta.excludedDueDateAmount,1100);
  assert.equal(m.supplierOpenReport.meta.excludedDuePeriodCount,3);assert.equal(m.supplierOpenReport.meta.excludedDuePeriodAmount,1400);
  assert.equal(m.controlReport.meta.openBalance,300);assert.equal(m.supplierOpenReport.meta.allYears,false);
  assert.equal(JSON.stringify(input),before);
});

test('multiple months are OR selections, combined with selected years, suppliers and operations',()=>{
  const input=fixture();
  const cases=[
    [{months:['11',10,11,0,13]},[10,11],3100,1300,410,600,300],
    [{months:[11],years:[2025,2026]},[11],3200,1400,400,700,260],
    [{months:[11],suppliers:['Fornecedor Alfa']},[11],1900,100,270,300,140],
    [{months:[11],operations:['EXPORTAÇÃO - CTNR']},[11],1900,100,190,300,140],
    [{months:[11],suppliers:['Fornecedor Beta'],operations:['COMERCIAL']},[11],1000,1000,90,0,90],
    [{months:[2]},[2],0,0,0,0,0]
  ];
  for(const [options,months,claimed,negotiating,received,openBalance,recovered] of cases){
    const m=run(input,options),label=JSON.stringify(options);
    assert.deepEqual(m.meta.months,months);assert.equal(m.summary.claimed,claimed,label);assert.equal(m.summary.received,received,label);
    assert.equal(m.executiveReport.negotiationPortfolio.amount,negotiating,label);
    assert.equal(m.supplierOpenReport.meta.openBalance,openBalance,label);assert.equal(m.executiveReport.recoveryComparison.received,recovered,label);
  }
});

test('lean suppliers and full financial output agree for monthly requests in original and corrected scenarios',()=>{
  const input=fixture();
  for(const correctionScenario of ['original','corrected'])for(const months of [[11],[10,11],[]]){
    const options={months,correctionScenario},full=run(input,options),lean=run(input,{...options,reportView:'suppliers'});
    assert.deepEqual(full.summary,lean.summary);assert.deepEqual(full.suppliers.map(({openInstallments,...item})=>item),lean.suppliers);
    assert.deepEqual(full.receiptCohorts.meta,lean.receiptCohorts.meta);assert.deepEqual(full.supplierOpenReport.meta,lean.supplierOpenReport.meta);
    assert.deepEqual(lean.meta.months,months);
  }
});

test('clearing the month selection restores original results without retaining the previous request state',()=>{
  const input=fixture(),before=run(input,{months:[]});run(input,{months:[11]});run(input,{months:[10],years:[2025]});
  assert.deepEqual(run(input,{months:[]}),before);assert.deepEqual(run(input),before);
});
