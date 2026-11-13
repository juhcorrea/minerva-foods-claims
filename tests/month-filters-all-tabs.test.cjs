'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const row=(size,fields)=>Object.assign(Array(size).fill(null),fields);
const bh=row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',10:'Motivo',16:'Área negociação',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
const ch=row(32,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',30:'Ano Compensação',31:'Analista'});
const claim=(id,date,amount,extra={})=>row(65,{0:id,1:date,3:'ME',5:'ABERTO',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'',10:'AVARIA',16:'CLAIM',19:'BRA',22:id,24:id+'-NF',25:'COMERCIAL',28:'Fornecedor fictício',35:amount,40:0,56:'Analista fictício',...extra});
const control=(id,status,compDate,dueDate,amount=10,extra={})=>row(32,{0:'Setor fictício',1:2026,3:'ME',7:id,10:'Fornecedor fictício',11:'Depósito',12:status,13:dueDate,14:amount,17:compDate,19:status==='Pago'?amount:null,20:100,21:84,30:2026,31:'Analista fictício',...extra});
const analyze=(bd,controls,options={})=>E.analyze(bd,controls,{years:[2026],asOf:'2026-12-31',...options});
const ids=(queue,key)=>[...new Set(queue.flatMap(item=>item[key]))].sort((a,b)=>a-b);

test('FUP monthly requests use RNC year/month and keep legal separate, suppliers and FUP eligibility intact',()=>{
  const bd=[bh,claim('QA-HISTORY','2020-11-01',100),claim('QA-OCT','2026-10-01',200),claim('QA-NOV','2026-11-01',300),claim('QA-PRIOR','2025-11-01',400),claim('QA-FUP','2026-11-01',500,{7:'Retorno FUP SUPRIMENTOS'}),claim('QA-LEGAL','2026-11-01',600,{28:'Jurídico fictício'}),claim('QA-BETA','2026-11-01',700,{28:'Fornecedor Beta',25:'EXPORTAÇÃO - CTNR'}),claim('QA-MISSING',null,800),claim('QA-FUTURE','2027-11-01',900)];
  const original=JSON.stringify(bd),all=analyze(bd,[ch]),nov=analyze(bd,[ch],{months:[11]}).procurementReport;
  assert.equal(all.procurementReport.meta.allYears,true);assert.equal(all.procurementReport.negotiationTotal,3400);
  assert.equal(nov.meta.allYears,false);assert.deepEqual(nov.meta.months,[11]);assert.deepEqual(nov.meta.years,[2026]);
  assert.equal(nov.negotiationTotal,1000);assert.equal(nov.legalTotal,600);assert.equal(nov.grandTotal,1600);
  assert.deepEqual(nov.rows.map(item=>item.row),[4,8]);assert.equal(nov.meta.excludedFupRecords,1);
  assert(!JSON.stringify(nov.rows).includes('QA-LEGAL'),'legal remains aggregate only');
  const scoped=analyze(bd,[ch],{months:[11],suppliers:['Fornecedor fictício'],operations:['COMERCIAL']}).procurementReport;
  assert.equal(scoped.negotiationTotal,300);assert.equal(scoped.legalTotal,0);assert.deepEqual(scoped.rows.map(item=>item.row),[4]);
  const both=analyze(bd,[ch],{years:[2025,2026],months:[10,11]}).procurementReport;
  assert.equal(both.negotiationTotal,1600);assert.deepEqual(both.rows.map(item=>item.row),[3,4,5,8]);
  assert.deepEqual(analyze(bd,[ch],{months:[]}),all);assert.deepEqual(analyze(bd,[ch],{months:Array.from({length:12},(_,i)=>i+1)}),all);
  assert.equal(JSON.stringify(bd),original);
});

test('correction queue selects by BD RNC OR paid compensation/unpaid forecast without substituting missing dates',()=>{
  const bd=[bh,
    claim('QA-BD-NOV','2026-11-01',100,{6:'EM ANÁLISE',25:''}),
    claim('QA-BD-OCT','2026-10-01',200,{6:'EM ANÁLISE',25:''}),
    claim('QA-BD-NODATE',null,300,{6:'EM ANÁLISE',25:''})
  ];
  const controls=[ch,
    control('QA-R-NOV','Pago','2026-11-03','2026-12-01'),
    control('QA-PAID-DUE-NOV','Pago','2026-10-03','2026-11-01'),
    control('QA-PAID-MISSING-R','Pago',null,'2026-11-01'),
    control('QA-N-NOV','Dentro do Prazo','2026-10-03','2026-11-01'),
    control('QA-OPEN-R-NOV','Dentro do Prazo','2026-11-03','2026-10-01'),
    control('QA-OPEN-MISSING-N','Dentro do Prazo','2026-11-03',null),
    control('QA-PRIOR-NOV','Pago','2025-11-03','2026-11-01'),
    control('QA-BD-OCT','Pago','2026-11-03','2026-10-01')
  ];
  const before=JSON.stringify({bd,controls}),full=analyze(bd,controls),monthly=analyze(bd,controls,{months:[11]}),queue=E.buildCorrectionReviewItems(monthly);
  assert.deepEqual(monthly.meta.correctionPeriod.bdRows,[2]);assert.deepEqual(monthly.meta.correctionPeriod.controlRows,[2,5,9]);
  assert.deepEqual(ids(queue,'bdRows'),[2,3],'a clean paid link in November still selects its BD warning from October');
  assert.deepEqual(ids(queue,'controlRows'),[2,5],'the clean linked payment is not invented as a new correction');
  assert(E.buildCorrectionReviewItems(full).some(item=>item.bdRows.includes(4)),'missing RNC remains visible with all months');
  assert(E.buildCorrectionReviewItems(full).some(item=>item.controlRows.includes(4)),'missing compensation remains visible with all months');
  assert.deepEqual(monthly.baseReconciliation.rows,full.baseReconciliation.rows,'raw review findings are preserved; only the queue is scoped');
  const lean=analyze(bd,controls,{months:[11],reportView:'suppliers'});
  assert.equal(lean.meta.correctionQueueCount,queue.length,'lazy supplier badge uses the same monthly queue count');
  assert.equal(JSON.stringify({bd,controls}),before);
});

test('a monthly correction reference retains every installment and its full agreement comparison',()=>{
  const bd=[bh,claim('QA-SPLIT','2026-11-01',100,{6:'RESSARCIMENTO ENCAMINHADO',40:84})];
  const controls=[ch,
    control('QA-SPLIT','Pago','2026-11-02','2026-11-01',5,{20:99}),
    control('QA-SPLIT','Dentro do Prazo',null,'2026-10-01',40,{20:99}),
    control('QA-SPLIT','Dentro do Prazo',null,'2025-11-01',39,{20:99})
  ];
  const full=analyze(bd,controls),monthly=analyze(bd,controls,{months:[11]}),audit=monthly.claimValueAudit.rows[0],queue=E.buildCorrectionReviewItems(monthly);
  assert.equal(audit.controlExpected,84);assert.equal(audit.bdReceived,84);assert.equal(audit.receivedConfirmed,5);assert.equal(audit.hasReceivedMismatch,false);
  assert.deepEqual(audit.controlRows,[2,3,4]);assert.equal(audit.installmentCount,3);assert.deepEqual(audit,full.claimValueAudit.rows[0]);
  assert.equal(queue.length,1);assert.deepEqual(queue[0].controlRows,[2,3,4]);assert.deepEqual(queue[0].bdRows,[2]);
  assert.equal(monthly.summary.received,5);assert.equal(monthly.supplierOpenReport.meta.openBalance,0,'financial month remains scoped without shrinking the audit');
  assert.equal(E.correctionReviewIdentity(queue[0],bd,controls),E.correctionReviewIdentity(E.buildCorrectionReviewItems(full)[0],bd,controls),'acknowledgement identity retains the complete source component');
});

test('clearing monthly correction filters restores every historical item and does not retain prior request state',()=>{
  const bd=[bh,claim('QA-NOV','2026-11-01',100,{25:''}),claim('QA-PRIOR','2020-02-01',200,{25:''})],controls=[ch,control('QA-MISSING','Pago',null,null)];
  const full=analyze(bd,controls),fullQueue=E.buildCorrectionReviewItems(full);
  assert.equal(E.buildCorrectionReviewItems(analyze(bd,controls,{months:[11]})).length,1);
  assert.equal(E.buildCorrectionReviewItems(analyze(bd,controls,{months:[7]})).length,0);
  const cleared=analyze(bd,controls,{months:[]});assert.equal(cleared.meta.correctionPeriod,undefined);assert.deepEqual(cleared,full);assert.deepEqual(E.buildCorrectionReviewItems(cleared),fullQueue);
});
