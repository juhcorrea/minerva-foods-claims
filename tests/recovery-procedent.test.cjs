'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',10:'Motivo',16:'Área negociação',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(id,amount,status='RESSARCIMENTO ENCAMINHADO',extra={})=>row(65,{0:id,1:'2026-01-02',3:'ME',6:status,7:'',10:'AVARIA',16:'CIA MARÍTIMA',19:'BRA',22:id,24:id+'-NF',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Alfa',35:amount,56:'Analista fictício',...extra});
const payment=(ref,amount,extra={})=>row(32,{0:'Setor fictício',1:2026,3:'ME',7:ref,10:'Fornecedor Alfa',11:'Depósito',12:'Pago',13:'2026-06-01',14:amount,17:'2026-06-01',19:amount,30:2026,31:'Analista fictício',...extra});
const fixture=()=>({bd:[bh,
  claim('QA-NEG',1000,'  EM  NEGOCIAÇÃO-PROCEDENTE '),
  claim('QA-NO-COST',2000,'FINALIZADO SEM CUSTO'),
  claim('QA-LOSS',3000,'PREJUÍZO MINERVA'),
  claim('QA-INSURANCE',4000,'PROCEDENTE - SEGURO'),
  claim('QA-FORWARDED',5000),
  claim('QA-FUP',6000,'EM NEGOCIAÇÃO - PROCEDENTE',{7:'FUP SUPRIMENTOS'}),
  claim('QA-COSTS',7000,'AGUARDANDO CUSTOS'),
  claim('QA-ANALYSIS',8000,'EM ANÁLISE'),
  claim('QA-DENIED',9000,'RESPONDIDO - NÃO PROCEDE'),
  claim('QA-OTHER',10000,'EM NEGOCIAÇÃO - NÃO PROCEDENTE'),
  claim('QA-PRIOR',11000,'EM NEGOCIAÇÃO - PROCEDENTE',{1:'2025-01-02',19:'ARG'}),
  claim('QA-EXTERNAL',12000,'RESSARCIMENTO ENCAMINHADO',{10:'INTERFERÊNCIA EXTERNA'}),
  claim('QA-NO-DATE',13000,'RESSARCIMENTO ENCAMINHADO',{1:null}),
  claim('QA-FUTURE',14000,'RESSARCIMENTO ENCAMINHADO',{1:'2027-01-02'}),
  claim('QA-BETA',1500,'RESSARCIMENTO ENCAMINHADO',{28:'Fornecedor Beta',25:'COMERCIAL'})
],control:[ch,
  payment('QA-NEG',100),payment('QA-NO-COST',200),payment('QA-LOSS',300),
  payment('QA-INSURANCE',400),payment('QA-FORWARDED',500),payment('QA-FUP',600),
  payment('QA-COSTS',700),payment('QA-OTHER',1000),payment('QA-PRIOR',1100),
  payment('QA-NEG; QA-FORWARDED',75),payment('QA-NEG; QA-COSTS',80),
  payment('QA-NEG; QA-MISSING',90),payment('QA-MISSING',95),
  payment('QA-EXTERNAL',1200),payment('QA-BETA',150,{10:'Fornecedor Beta'}),
  payment('QA-FORWARDED',160,{17:'2025-06-01',30:2025}),
  payment('QA-FORWARDED',170,{12:'Dentro do Prazo'})
]});
const run=(input,options={})=>E.analyze(input.bd,input.control,{years:[2026],asOf:'2026-11-11',...options});
const money=value=>Math.round((value+Number.EPSILON)*100)/100;
const plain=value=>JSON.parse(JSON.stringify(value));

test('procedente aliases with or without hyphens and accents keep the same eligibility',()=>{
  const variants=[
    ['EM NEGOCIAÇÃO - PROCEDENTE',['em negociacao procedente',' EM  NEGOCIAÇÃO-PROCEDENTE ','EM NEGOCIAÇÃO–PROCEDENTE','Em negociação — procedente']],
    ['PROCEDENTE - SEGURO',['procedente seguro','PROCEDENTE-SEGURO','Procedente–Seguro']],
    ['PREJUÍZO MINERVA',['PREJUIZO MINERVA',' prejuízo   minerva ']],
    ['FINALIZADO SEM CUSTO',['finalizado sem custo',' FINALIZADO  SEM  CUSTO ']],
    ['RESSARCIMENTO ENCAMINHADO',['ressarcimento encaminhado',' RESSARCIMENTO  ENCAMINHADO ']]
  ];
  for(const [canonical,aliases] of variants)for(const alias of aliases){
    assert.equal(E.normalizeStatus(alias),E.normalizeStatus(canonical),alias);
    const input={bd:[bh,claim('QA-ALIAS',100,alias)],control:[ch,payment('QA-ALIAS',40)]};
    const m=run(input,{claimStatuses:[canonical]}),r=m.executiveReport.recoveryComparison;
    assert.equal(r.claimed,100,alias);assert.equal(r.received,40,alias);
    assert.equal(m.executiveReport.negotiationPortfolio.amount,canonical.startsWith('EM NEGOCIAÇÃO')?100:0,alias);
    if(canonical.startsWith('EM NEGOCIAÇÃO')){
      input.bd[1][7]='RETORNO FUP SUPRIMENTOS';
      const pending=run(input);assert.equal(pending.executiveReport.recoveryComparison.claimed,100);
      assert.equal(pending.executiveReport.negotiationPortfolio.amount,0,'the alias cannot bypass the FUP exclusion');
    }
  }
  for(const status of ['EM NEGOCIAÇÃO NÃO PROCEDENTE','EM NEGOCIAÇÃO - NÃO PROCEDENTE','NÃO PROCEDENTE SEGURO']){
    const m=run({bd:[bh,claim('QA-DENIED-ALIAS',100,status)],control:[ch]});
    assert.equal(m.executiveReport.recoveryComparison.claimed,0,status);assert.equal(m.executiveReport.negotiationPortfolio.amount,0,status);
  }
  assert.equal(E.normalizeStatus('EXPORTAÇÃO CTNR'),'EXPORTACAO CTNR','unrelated values are not given new aliases');
});

test('overview recovery includes exactly five procedente situations and leaves provisional costs out',()=>{
  const input=fixture(),before=JSON.stringify(input),model=run(input),r=model.executiveReport.recoveryComparison;
  assert.deepEqual(r.eligibleStatuses,['EM NEGOCIAÇÃO - PROCEDENTE','FINALIZADO SEM CUSTO','PREJUÍZO MINERVA','PROCEDENTE - SEGURO','RESSARCIMENTO ENCAMINHADO']);
  assert.deepEqual(r.years,[2026]);assert.equal(r.claimed,22500);
  assert.deepEqual(r.claimRows,[2,3,4,5,6,7,16]);
  assert.equal(r.received,2325);assert.equal(r.rate,2325/22500);
  assert.deepEqual(r.receiptRows,[2,3,4,5,6,7,11,16]);
  assert.equal(r.unallocatedReceived,4265);assert.deepEqual(r.unallocatedReceiptRows,[8,9,10,12,13,14,15]);
  assert.equal(model.summary.received,6590);assert.equal(r.received+r.unallocatedReceived,model.summary.received);
  assert.equal(model.summary.claimed,32500,'existing financial denominator includes its previous additional situations');
  assert.equal(model.summary.negotiating,1000,'FUP is excluded only from negotiation, not Reclamado procedente');
  assert(r.claimRows.every(id=>model.executiveReport.claimRows.some(item=>item.row===id)));
  assert(r.receiptRows.concat(r.unallocatedReceiptRows).every(id=>model.executiveReport.receiptRows.some(item=>item.row===id)));
  assert.equal(new Set(r.receiptRows.concat(r.unallocatedReceiptRows)).size,15,'each compensation appears once');
  assert.equal(JSON.stringify(input),before);
});

test('recovery and historical negotiation are additional projections; every pre-existing model remains identical',()=>{
  const source=fs.readFileSync(require.resolve('../dist/engine.js'),'utf8');
  const invocation='applyExecutiveReport(model, bdRows, controlRows, options);';
  assert.equal(source.split(invocation).length,2,'one executive projection boundary');
  const context={module:{exports:{}}};vm.runInNewContext(source.replace(invocation,'/* Compare against the same engine without the additional executive projection. */'),context);
  const input=fixture();
  for(const correctionScenario of ['corrected','original'])for(const years of [[2026],[2025,2026]])for(const months of [[],[1],[6]]){
    const options={years,months,asOf:'2026-11-11',correctionScenario};
    const {executiveReport,...actual}=E.analyze(input.bd,input.control,options);
    assert(executiveReport.recoveryComparison);assert(executiveReport.negotiationPortfolio.byCountry);
    const baseline=context.module.exports.analyze(input.bd,input.control,options);
    assert.deepEqual(plain(actual),plain(baseline),'cash, suppliers, annual, audits, links, procurement and all other reports retain their exact semantics');
  }
});

test('recovery respects applied years, supplier, operation and situation without changing confirmed cash',()=>{
  const input=fixture();
  const scenarios=[
    [{years:[2025]},11000,0,160],
    [{years:[2025,2026]},33500,3585,3165],
    [{suppliers:['Fornecedor Beta']},1500,150,0],
    [{operations:['COMERCIAL']},1500,150,0],
    [{claimStatuses:['RESSARCIMENTO ENCAMINHADO']},6500,650,1200],
    [{claimStatuses:['AGUARDANDO CUSTOS']},0,0,700],
    [{asOf:'2025-12-31'},0,0,6590]
  ];
  for(const [options,claimed,received,unallocated] of scenarios){
    const m=run(input,options),r=m.executiveReport.recoveryComparison;
    assert.equal(r.claimed,claimed,JSON.stringify(options));assert.equal(r.received,received,JSON.stringify(options));
    assert.equal(r.unallocatedReceived,unallocated,JSON.stringify(options));
    assert.equal(money(r.received+r.unallocatedReceived),m.summary.received);
    assert.equal(r.rate,claimed?received/claimed:null);
  }
});

test('one complete grouped payment is counted once, mixed or unresolved references are never prorated',()=>{
  const input={bd:[bh,claim('QA-A',100),claim('QA-B',200,'FINALIZADO SEM CUSTO'),claim('QA-OUT',300,'AGUARDANDO CUSTOS')],control:[ch,payment('QA-A; QA-B',40),payment('QA-A; QA-OUT',50),payment('QA-A; QA-MISSING',60)]};
  const m=run(input),r=m.executiveReport.recoveryComparison;
  assert.equal(r.claimed,300);assert.equal(r.received,40);assert.equal(r.unallocatedReceived,110);
  assert.deepEqual(r.receiptRows,[2]);assert.deepEqual(r.unallocatedReceiptRows,[3,4]);
  assert.equal(m.controlReport.meta.receivedConfirmed,150);assert.equal(m.summary.received,150);
  assert.deepEqual(m.receiptCohorts.rows.map(item=>item.received),[40,50,60]);
});

test('insurance area stays in the declared denominator without inventing a receipt link removed by reconciliation rules',()=>{
  const input={bd:[bh,claim('QA-INSURED',100,'PROCEDENTE - SEGURO',{16:'Seguro'})],control:[ch,payment('QA-INSURED',40)]};
  const m=run(input),r=m.executiveReport.recoveryComparison;
  assert.equal(r.claimed,100);assert.equal(r.received,0);assert.equal(r.rate,0);
  assert.equal(r.unallocatedReceived,40);assert.equal(m.summary.received,40);
  assert.deepEqual(r.claimRows,[2]);assert.deepEqual(r.receiptRows,[]);assert.deepEqual(r.unallocatedReceiptRows,[2]);
});

test('fractions remain in detail, cents reconcile to cash, duplicate SGR rows sum and recovery is not clamped',()=>{
  const input={bd:[bh,claim('QA-REPEAT',.006),claim('QA-REPEAT',.006,'FINALIZADO SEM CUSTO',{22:'QA-SECOND',24:'QA-SECOND-NF'})],control:[ch,payment('QA-REPEAT',.004),payment('QA-SECOND',.004),payment('QA-MISSING',.004)]};
  const m=run(input),r=m.executiveReport.recoveryComparison;
  assert.equal(r.claimed,.01);assert.deepEqual(r.claimRows,[2,3]);assert.equal(r.received,.01);assert.equal(r.unallocatedReceived,0);assert.equal(r.received+r.unallocatedReceived,m.summary.received);
  assert.deepEqual(m.executiveReport.claimRows.map(item=>item.claimed),[.006,.006]);
  assert.deepEqual(m.executiveReport.receiptRows.map(item=>item.received),[.004,.004,.004]);
  assert.equal(run({bd:[bh,claim('QA-OVER',10)],control:[ch,payment('QA-OVER',20)]}).executiveReport.recoveryComparison.rate,2);
  assert.equal(run({bd:[bh],control:[ch,payment('QA-MISSING',20)]}).executiveReport.recoveryComparison.rate,null);
});

test('portfolio country groups use the same historical rows as the card and count repeated SGR lines, while financial countries remain scoped',()=>{
  const input={bd:[bh,claim('QA-REPEAT',100.25,'EM NEGOCIAÇÃO - PROCEDENTE',{1:'2020-01-02'}),claim('QA-REPEAT',200.5,'EM NEGOCIAÇÃO - PROCEDENTE',{22:'QA-SECOND',24:'QA-SECOND-NF'}),claim('QA-ARG',50.75,'EM NEGOCIAÇÃO - PROCEDENTE',{1:'2025-01-02',19:'ARG'}),claim('QA-FUP',900,'EM NEGOCIAÇÃO - PROCEDENTE',{7:'Retorno FUP SUPRIMENTOS pendente'})],control:[ch]};
  for(const years of [[2020],[2025],[2026]]){
    const m=run(input,{years}),p=m.executiveReport.negotiationPortfolio;
    assert.equal(p.amount,351.5);assert.equal(p.count,3);
    assert.deepEqual(p.byCountry,[{country:'BRA',amount:300.75,rows:[2,3],count:2,recordCount:2},{country:'ARG',amount:50.75,rows:[4],count:1,recordCount:1}]);
    assert.deepEqual(p.byCountry.flatMap(item=>item.rows).sort((a,b)=>a-b),p.rows);
    assert.equal(p.byCountry.reduce((total,item)=>total+item.count,0),p.count);
    assert.equal(p.byCountry.reduce((total,item)=>total+item.amount,0),p.amount);
    assert.equal(m.executiveReport.negotiationByCountry.reduce((total,item)=>total+item.amount,0),m.summary.negotiating);
    assert.notEqual(m.summary.negotiating,p.amount);
  }
});
