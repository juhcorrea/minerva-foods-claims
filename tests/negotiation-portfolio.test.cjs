'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const E = require('../dist/engine.js');
const row = (width, values) => Object.assign(Array(width).fill(null), values);
const bh = row(65, {
  0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',
  10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',
  35:'Reclamado (USD)',49:'Causador',56:'Analista'
});
const ch = row(32, {
  0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',
  11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',
  17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'
});
const claim = (id, date, amount, extra={}) => row(65, {
  0:id,1:date,3:'ME',5:'Aberto',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'',10:'AVARIA',
  19:'BRA',22:id,24:id,25:'COMERCIAL',28:'Fornecedor Alfa',35:amount,
  49:'Causador fictício',56:'Analista fictício',...extra
});
const bd = [bh,
  claim('QA-HISTORICAL','2020-02-01',100.125),
  claim('QA-PRIOR','2025-02-01',200.125,{25:'EXPORTAÇÃO - CTNR'}),
  claim('QA-REPEATED','2026-02-01',300.125),
  claim('QA-OTHER','2026-03-01',400.125,{28:'Fornecedor Beta'}),
  claim('QA-REPEATED','2020-03-01',50.125,{22:'QA-SECOND-ORDER'}),
  claim('QA-FUP','2025-04-01',600.125,{7:' Fúp   Suprimêntos '}),
  claim('QA-FUP-TEXT','2026-04-01',700.125,{7:'Retorno: FUP\nSUPRIMENTOS confirmado'}),
  claim('QA-NOT-PROCEDENT','2026-05-01',800.125,{6:'EM NEGOCIAÇÃO - NÃO PROCEDENTE'}),
  claim('QA-FORWARDED','2026-06-01',900.125,{6:'RESSARCIMENTO ENCAMINHADO'}),
  claim('QA-EXTERNAL','2020-06-01',1000.125,{10:'INTERFERÊNCIA EXTERNA'}),
  claim('QA-FUTURE','2027-01-01',1100.125),
  claim('QA-MISSING-DATE',null,1200.125),
  claim('QA-FUP-OTHER','2026-07-01',10.125,{7:'FUP'})
];
const receipt = (year, amount) => row(32, {
  0:'Setor fictício',1:year,3:'ME',7:'QA-UNLINKED-'+year,10:'Fornecedor Alfa',
  11:'Depósito',12:'Pago',13:year+'-06-01',14:amount,17:year+'-06-01',19:amount,
  30:year,31:'Analista fictício'
});
const control = [ch,receipt(2020,20.25),receipt(2025,25.5),receipt(2026,26.75),
  row(32,{1:2026,3:'ME',7:'QA-OPEN',10:'Fornecedor Alfa',12:'Dentro do Prazo',13:'2026-12-01',14:80}),
  row(32,{1:2026,3:'ME',7:'QA-OVERDUE',10:'Fornecedor Alfa',12:'Vencido',13:'2026-01-01',14:30})
];
const options = {years:[2026],asOf:'2026-11-11'};
const run = extra => E.analyze(bd,control,{...options,...extra});
const money = value => Math.round((value+Number.EPSILON)*100)/100;
const portfolioRows = [2,3,4,5,6,14];

function checkPortfolio(model, expectedRows, amount) {
  const p = model.executiveReport.negotiationPortfolio;
  assert(p,'the historical negotiation card has an independent model');
  assert.equal(p.allYears,true);
  assert.equal(p.amount,amount);
  assert.equal(p.count,expectedRows.length,'count source rows, including repeated SGR');
  assert.deepEqual([...p.rows].sort((a,b)=>a-b),expectedRows);
  assert.equal(new Set(p.rows).size,p.rows.length);
  const details = model.executiveReport.claimRows.filter(item=>p.rows.includes(item.row));
  assert.deepEqual(details.map(item=>item.row),expectedRows,'every historical row opens in the card detail');
  assert.equal(money(details.reduce((total,item)=>total+item.claimed,0)),amount);
  assert.deepEqual(p.years,[...new Set(details.map(item=>Number(item.rncDate.slice(0,4))))].sort((a,b)=>a-b));
  assert.deepEqual(p.byCountry.flatMap(item=>item.rows).sort((a,b)=>a-b),expectedRows,'country chart uses the historical portfolio');
  assert.equal(p.byCountry.reduce((total,item)=>total+item.count,0),expectedRows.length,'country counts source rows, including repeated SGR');
  return p;
}

for(const correctionScenario of ['corrected','original']) {
  test('overview portfolio is stable across years while financial models keep their periods / '+correctionScenario,()=>{
    const before = JSON.stringify({bd,control});
    const cases = [
      {years:[2020],negotiating:150.25,claimed:150.25,received:20.25,rows:[2,6]},
      {years:[2025],negotiating:200.13,claimed:800.25,received:25.5,rows:[3]},
      {years:[2026],negotiating:710.38,claimed:3110.75,received:26.75,rows:[4,5,14]},
      {years:[2025,2026],negotiating:910.5,claimed:3911,received:52.25,rows:[3,4,5,14]}
    ];
    for(const expected of cases) {
      const scoped = {years:expected.years,correctionScenario};
      const model = run(scoped);
      const lean = run({...scoped,reportView:'suppliers'});
      checkPortfolio(model,portfolioRows,1060.75);
      assert.equal(model.summary.negotiating,expected.negotiating);
      assert.equal(model.summary.claimed,expected.claimed);
      assert.equal(model.summary.received,expected.received);
      assert.deepEqual(model.summary,lean.summary,'supplier financial model is not replaced by the portfolio');
      assert.deepEqual(model.suppliers.map(({openInstallments,...supplier})=>supplier),lean.suppliers);
      for(const key of ['receiptCohorts','supplierOpenReport','baseReconciliation']) {
        assert.deepEqual(model[key].meta,lean[key].meta,key+' is unchanged by the executive projection');
      }
      assert.deepEqual(Object.fromEntries(Object.keys(lean.controlReport.meta).map(key=>[key,model.controlReport.meta[key]])),lean.controlReport.meta);
      assert.equal(model.controlReport.meta.receivedConfirmed,expected.received);
      assert.equal(model.supplierOpenReport.meta.openBalance,110);
      assert.equal(model.supplierOpenReport.meta.overdueBalance,30);
      assert.deepEqual(model.annual.map(item=>item.year),expected.years);
      for(const item of model.annual) {
        const expectedYear = cases.find(entry=>entry.years.length===1&&entry.years[0]===item.year);
        assert.equal(item.negotiating,expectedYear.negotiating);
      }
      const report = model.executiveReport;
      assert.equal(report.meta.totals.negotiating,expected.negotiating);
      assert.equal(money(report.monthlyReceipts.reduce((total,item)=>total+item.received,0)),expected.received);
      assert.deepEqual(report.negotiationByCountry.flatMap(item=>item.rows).sort((a,b)=>a-b),expected.rows);
      assert.equal(money(report.negotiationByCountry.reduce((total,item)=>total+item.amount,0)),expected.negotiating);
      assert.equal(money(report.reasonRanking.reduce((total,item)=>total+item.amount,0)),expected.claimed);
      assert.equal(money(report.causeRanking.reduce((total,item)=>total+item.amount,0)),expected.claimed);
    }
    assert.equal(JSON.stringify({bd,control}),before);
  });
}

test('portfolio preserves supplier and operation selections without accepting FUP, non-procedent or external interference',()=>{
  const cases = [
    [{suppliers:['Fornecedor Alfa']},[2,3,4,6,14],660.63],
    [{suppliers:['Fornecedor Beta']},[5],400.13],
    [{operations:['COMERCIAL']},[2,4,5,6,14],860.63],
    [{suppliers:['Fornecedor Alfa'],operations:['EXPORTAÇÃO - CTNR']},[3],200.13],
    [{suppliers:['Fornecedor Alfa','Fornecedor Beta'],operations:['COMERCIAL','EXPORTAÇÃO - CTNR']},portfolioRows,1060.75],
    [{suppliers:['Fornecedor inexistente']},[],0]
  ];
  for(const [filters,rows,amount] of cases)checkPortfolio(run(filters),rows,amount);
});

test('portfolio ignores the situation selector but keeps the fixed procedural rule, analysis date and valid dates',()=>{
  const filtered = run({claimStatuses:['RESSARCIMENTO ENCAMINHADO']});
  checkPortfolio(filtered,portfolioRows,1060.75);
  assert.equal(filtered.summary.negotiating,0);
  assert.equal(filtered.summary.claimed,900.13);
  assert.deepEqual(filtered.executiveReport.negotiationByCountry,[]);
  checkPortfolio(run({asOf:'2025-12-31'}),[2,3,6],350.38);
  const future = run({asOf:'2027-12-31'});
  checkPortfolio(future,[2,3,4,5,6,12,14],2160.88);
  assert(!future.executiveReport.negotiationPortfolio.rows.includes(13),'missing Data RNC does not become a valid historical claim');
});

function executive() {
  const host = () => ({innerHTML:'',events:{},addEventListener(name,callback){this.events[name]=callback;}});
  const dashboard = host();
  const content = {innerHTML:'',querySelector:()=>({addEventListener(){}})};
  const title = {};
  const nodes = {executiveDashboard:dashboard,detailContent:content,detailTitle:title,detailDialog:{showModal(){}}};
  const document = {getElementById:id=>nodes[id]};
  const window = {document};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/executive.js'),'utf8'),{window,document});
  return {dashboard,content,title,api:window.MinervaExecutive,click(id){
    dashboard.events.click({target:{closest:()=>({dataset:{execDetail:id}})}});
  }};
}

test('proceeding claims and recovery cards share their precise denominator, linked receipts, drilldowns and exports',()=>{
  const ui=executive(),model=run({years:[2026]}),statuses=['EM NEGOCIAÇÃO - PROCEDENTE','FINALIZADO SEM CUSTO','PREJUÍZO MINERVA','PROCEDENTE - SEGURO','RESSARCIMENTO ENCAMINHADO'];
  model.summary.claimed=90000;model.summary.receivedComparable=90000;
  Object.assign(model.executiveReport,{
    monthlyReceipts:[{year:2026,month:11,period:'2026-11',received:333.55,count:3,rows:[21,22,23]}],
    claimRows:[{row:11,sgr:'QA-DENOM-FUP',supplier:'Fornecedor Alfa',status:statuses[0],pending:'FUP SUPRIMENTOS',rncDate:'2026-02-01',claimed:800.44},{row:12,sgr:'QA-DENOM-FORWARDED',supplier:'Fornecedor Alfa',status:statuses[4],rncDate:'2026-02-01',claimed:100.22},{row:13,sgr:'QA-COSTS',supplier:'Fornecedor Alfa',status:'AGUARDANDO CUSTOS',rncDate:'2026-02-01',claimed:999}],
    receiptRows:[{row:21,reference:'QA-RECEIPT-A',supplier:'Fornecedor Alfa',compDate:'2026-11-01',received:100.11},{row:22,reference:'QA-RECEIPT-B',supplier:'Fornecedor Alfa',compDate:'2026-11-02',received:200.11},{row:23,reference:'QA-UNALLOCATED',supplier:'Fornecedor Alfa',compDate:'2026-11-03',received:33.33}],
    recoveryComparison:{claimed:900.66,received:300.22,rate:1/3,claimRows:[11,12],receiptRows:[21,22],unallocatedReceived:33.33,unallocatedReceiptRows:[23],eligibleStatuses:statuses,years:[2026]}
  });
  const before=JSON.stringify(model);ui.api.render(model);
  const card=label=>[...ui.dashboard.innerHTML.matchAll(/<article class="exec-kpi [^"]*">[\s\S]*?<\/article>/g)].map(item=>item[0]).find(item=>item.includes('<div class="exec-kpi-label">'+label));
  const claimed=card('Reclamado procedente'),recovery=card('Recuperação');assert(claimed);assert(recovery);
  assert.match(claimed,/>901<\/button>/);assert.match(claimed,/USD · 2026/);assert.equal(card('Recebido no mês'),undefined);
  for(const status of statuses)assert(claimed.includes(status));assert.match(claimed,/Pendência FUP SUPRIMENTOS não é excluída/);
  assert.match(recovery,/>33,3%<\/button>/);assert.match(recovery,/US\$ 300,22 recebido vinculado ÷ US\$ 900,66/);assert.match(recovery,/fora desta comparação: US\$ 33,33/);assert.match(recovery,/Não há rateio de referências mistas ou incompletas/);
  ui.click(claimed.match(/data-exec-detail="([^"]+)"/)[1]);assert.match(ui.content.innerHTML,/2 de 2 linhas/);assert.match(ui.content.innerHTML,/QA-DENOM-FUP/);assert.match(ui.content.innerHTML,/QA-DENOM-FORWARDED/);assert.match(ui.content.innerHTML,/800,44/);assert.doesNotMatch(ui.content.innerHTML,/QA-COSTS/);
  ui.click(recovery.match(/data-exec-detail="([^"]+)"/)[1]);assert.match(ui.title.textContent,/Recebimentos dos claims procedentes/);assert.match(ui.content.innerHTML,/2 de 2 linhas/);assert.match(ui.content.innerHTML,/QA-RECEIPT-A/);assert.match(ui.content.innerHTML,/200,11/);assert.doesNotMatch(ui.content.innerHTML,/QA-UNALLOCATED/);
  const sheets=new Map();ui.api.worksheets({},(_book,name,_headers,rows)=>sheets.set(name,rows));
  assert.deepEqual(Array.from(sheets.get('Recuperação procedentes')[0]),['2026',900.66,300.22,1/3,33.33]);
  assert.deepEqual(Array.from(sheets.get('Reclamado procedente'),row=>row[0]),[11,12]);assert.equal(sheets.get('Reclamado procedente')[0][5],800.44);
  assert.deepEqual(Array.from(sheets.get('Recebimentos procedentes'),row=>row[0]),[21,22]);assert.equal(sheets.get('Recebimentos procedentes')[1][4],200.11);
  assert.equal(JSON.stringify(model),before,'render, details and export preserve unrounded calculation inputs');
});

test('overview negotiation card, country chart, drilldowns and exports share the historical portfolio across year filters',()=>{
  for(const year of [2020,2025,2026]) {
    const model = run({years:[year]});
    const before = JSON.stringify(model);
    const ui = executive();
    ui.api.render(model);
    const card = ui.dashboard.innerHTML.match(/<article class="exec-kpi [^"]*">(?:(?!<\/article>)[\s\S])*?Em negociação(?:(?!<\/article>)[\s\S])*?<\/article>/)?.[0];
    assert(card);
    assert.match(card,/>1\.061<\/button>/,'round only the visual value');
    assert.match(card,/todos os anos/i);
    const detail = card.match(/data-exec-detail="([^"]+)"/);
    assert(detail);
    ui.click(detail[1]);
    assert.match(ui.title.textContent,/todos os anos/i);
    assert.match(ui.content.innerHTML,/6 de 6 linhas/);
    assert.match(ui.content.innerHTML,/QA-HISTORICAL/);
    assert.match(ui.content.innerHTML,/QA-PRIOR/);
    assert.match(ui.content.innerHTML,/QA-OTHER/);
    assert.match(ui.content.innerHTML,/100,13/,'detail preserves decimal values');
    assert.doesNotMatch(ui.content.innerHTML,/QA-FUP-TEXT|QA-NOT-PROCEDENT|QA-EXTERNAL|QA-FUTURE|QA-MISSING-DATE/);
    assert.match(ui.dashboard.innerHTML,/Em negociação procedente por país · Todos os anos/);
    assert.match(ui.dashboard.innerHTML,/<footer class="exec-source-foot">BASE: BD<\/footer>/);
    const country = ui.dashboard.innerHTML.match(/class="exec-country" data-exec-detail="([^"]+)"/);
    assert(country);
    ui.click(country[1]);
    const selectedIds = model.executiveReport.negotiationPortfolio.byCountry.flatMap(item=>item.rows);
    assert.match(ui.content.innerHTML,new RegExp(selectedIds.length+' de '+selectedIds.length+' linhas'));
    for(const reference of ['QA-HISTORICAL','QA-PRIOR','QA-OTHER'])assert(ui.content.innerHTML.includes(reference),'country detail retains all eligible historical claims');
    assert.doesNotMatch(ui.content.innerHTML,/QA-FUP-TEXT|QA-NOT-PROCEDENT|QA-EXTERNAL|QA-FUTURE|QA-MISSING-DATE/);
    const sheets = new Map();
    ui.api.worksheets({},(_book,name,_headers,rows)=>sheets.set(name,rows));
    const exported = sheets.get('Negociação por país');
    assert.equal(money(exported.reduce((total,item)=>total+item[1],0)),model.executiveReport.negotiationPortfolio.amount);
    assert.deepEqual(Array.from(exported).flatMap(item=>String(item[3]).split('; ').filter(Boolean).map(Number)).sort((a,b)=>a-b),selectedIds.sort((a,b)=>a-b));
    const historicalExport = sheets.get('Carteira em negociação');
    assert(historicalExport,'historical card has its own worksheet');
    assert.deepEqual(Array.from(historicalExport,item=>item[0]).sort((a,b)=>a-b),portfolioRows);
    assert.equal(money(historicalExport.reduce((total,item)=>total+item[7],0)),1060.75);
    for(const item of historicalExport)assert.equal(item[7],bd[item[0]-1][35],'Excel retains original precision before aggregation');
    assert.equal(JSON.stringify(model),before);
  }
});

test('a chosen month shows the same year-month negotiation scope in cards, country detail and Excel, with historical scope restored by Todos',()=>{
 const ui=executive(),model=run({years:[2026],months:[2]});ui.api.render(model);
 const html=ui.dashboard.innerHTML,card=[...html.matchAll(/<article class="exec-kpi [^"]*">[\s\S]*?<\/article>/g)].map(item=>item[0]).find(item=>item.includes('<div class="exec-kpi-label">Em negociação'));
 assert.match(card,/>300<\/button>/);assert.match(card,/USD · 2026 · Fev/);assert.doesNotMatch(card,/Todos os anos|Carteira de todos os anos/);
 assert.match(html,/<h3>Em negociação procedente por país · 2026 · Fev<\/h3>/);assert.match(html,/<h3>Recebimento mensal · 2026 · Fev<\/h3>/);assert.match(html,/<h3>Recebimento em aberto por fornecedor · 2026 · Fev<\/h3>/);assert.doesNotMatch(html,/data-exec-year|data-exec-month/,'overview uses only the top period controls');
 ui.click(card.match(/data-exec-detail="([^"]+)"/)[1]);assert.match(ui.title.textContent,/2026 · Fev/);assert.match(ui.content.innerHTML,/1 de 1 linhas/);assert.match(ui.content.innerHTML,/300,13/);assert.doesNotMatch(ui.content.innerHTML,/QA-HISTORICAL|QA-PRIOR|QA-OTHER/);
 const country=html.match(/class="exec-country" data-exec-detail="([^"]+)"/);assert(country);ui.click(country[1]);assert.match(ui.content.innerHTML,/1 de 1 linhas/);
 const sheets=new Map();ui.api.worksheets({},(_wb,name,_headers,rows)=>sheets.set(name,rows));assert.equal(sheets.get('Negociação por país')[0][1],300.13);assert.deepEqual(Array.from(sheets.get('Carteira em negociação'),row=>row[0]),[4]);assert.equal(sheets.get('Carteira em negociação')[0][7],300.125);
 ui.api.render(run({years:[2026],months:Array.from({length:12},(_,i)=>i+1)}));assert.match(ui.dashboard.innerHTML,/Em negociação procedente por país · Todos os anos/);assert.match(ui.dashboard.innerHTML,/>1\.061<\/button>/);
});
