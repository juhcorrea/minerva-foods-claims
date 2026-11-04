'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(57).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const bd=(o={})=>Object.assign(Array(57).fill(null),{0:o.order||'CLAIM1',1:o.date===undefined?'2026-01-01':o.date,3:'ME',6:o.status||'RESSARCIMENTO ENCAMINHADO',10:o.reason||'AVARIA',22:o.order||'A/1',24:o.nf||123,25:o.operation||'EXPORTAÇÃO - CTNR',28:o.supplier||'ARMADOR',35:o.claimed===undefined?1000:o.claimed,56:'Analista BD'});
const cr=(o={})=>Object.assign(Array(32).fill(null),{1:o.entryYear===undefined?2026:o.entryYear,3:'ME',7:o.ref||'A/1',10:o.supplier||'NOME LONGO DO CONTROLE',11:'Depósito',12:o.status||'Pago',13:'2026-02-01',14:o.expected===undefined?50:o.expected,17:o.comp===undefined?'2026-02-01':o.comp,19:o.received===undefined?100:o.received,30:o.ae===undefined?2026:o.ae,31:'Analista Controle'});
const run=(b,c,o={})=>E.analyze([bh,...b],[ch,...c],{years:[2026],asOf:'2026-10-30',lossFormula:'subtract-negotiating',...o});

test('a 2024 claim paid in 2026 enters 2026 cash and is separated from same-year claims',()=>{
 const b=[bd({order:'NEW',nf:1}),bd({order:'OLD',nf:2,date:'2024-01-01'})],c=[cr({ref:'NEW',received:100}),cr({ref:'OLD',received:200,entryYear:2024})];
 const before=JSON.stringify({b,c}),m=run(b,c);
 assert.equal(m.summary.claimed,1000);assert.equal(m.summary.received,300);assert.equal(m.summary.receivedSameYear,100);assert.equal(m.summary.receivedDifferentYear,200);assert.equal(m.summary.receivedUnknownYear,0);assert.equal(m.summary.loss,700);assert.equal(m.summary.receivedLinkedClaims,100);
 assert.equal(m.suppliers[0].received,300);assert.equal(m.suppliers[0].recoveryRate,.3);assert.equal(m.annual[0].received,300);assert.equal(m.monthly.find(x=>x.month==='2026-02').received,300);
 assert.deepEqual(m.receiptCohorts.rows.map(x=>x.cohort),['same','different']);assert.deepEqual(m.receiptCohorts.rows[1].claimYears,[2024]);assert.equal(m.receiptCohorts.rows[1].claimYear,2024);
 assert(m.controlReport.installments.every(x=>x.includedInRealized));assert.equal(m.controlReport.processes.reduce((sum,p)=>sum+p.received,0),300);assert.equal(JSON.stringify({b,c}),before);
});

test('cash includes every BD status and atypical reason while claimed and negotiating keep their own rules',()=>{
 const statuses=['RESSARCIMENTO ENCAMINHADO','EM NEGOCIAÇÃO - PROCEDENTE','EM ANALISE','AGUARDANDO CUSTOS','RESPONDIDO - NÃO PROCEDE'];
 const b=statuses.map((status,i)=>bd({order:'S'+i,nf:i+1,status}));b.push(bd({order:'WAR',nf:99,reason:'INTERFERÊNCIA EXTERNA'}));
 const c=[...statuses.map((_,i)=>cr({ref:'S'+i,received:100})),cr({ref:'WAR',received:100})];
 const m=run(b,c);assert.equal(m.summary.claimed,2000);assert.equal(m.summary.negotiating,1000);assert.equal(m.summary.received,600);assert.equal(m.summary.loss,400);assert.equal(m.summary.receivedNegotiating,100);assert.equal(m.receiptCohorts.rows.length,6);
});

test('missing or conflicting BD year falls back to original B, with unvalidated provenance',()=>{
 const b=[bd({order:'NO-DATE',nf:1,date:null}),bd({order:'ONE',nf:77,date:'2025-01-01'}),bd({order:'TWO',nf:77,date:'2026-01-01'})];
 const m=run(b,[cr({ref:'NO-DATE',received:120}),cr({ref:77,received:80})]);
 assert.equal(m.summary.received,200);assert.equal(m.summary.receivedUnknownYear,0);assert.equal(m.summary.receivedSameYear,200);assert.equal(m.summary.receivedDifferentYear,0);assert(m.receiptCohorts.rows.every(row=>row.cohort==='same'));assert.deepEqual(m.receiptCohorts.rows[1].bdClaimYears,[2025,2026]);assert.equal(m.receiptCohorts.rows[1].claimYear,2026);assert(m.receiptCohorts.rows.every(row=>row.yearSource==='Controle B (não validado na BD)'));
 assert.equal(m.meta.ambiguousReceived,0,'Unknown claim year is not excluded cash');
});

test('receipt-only suppliers are retained with zero claimed and complete totals',()=>{
 const m=run([bd({date:'2024-01-01',supplier:'HISTÓRICO'})],[cr({received:250})]);
 assert.equal(m.claims.length,0);assert.equal(m.suppliers.length,1);assert.equal(m.suppliers[0].name,'HISTÓRICO');assert.equal(m.suppliers[0].claimed,0);assert.equal(m.suppliers[0].received,250);assert.equal(m.suppliers[0].recoveryRate,null);assert.equal(m.suppliers[0].loss,-250);assert.equal(m.summary.received,250);
});

test('default includes export and unknown operations; explicit operation excludes unknown with visible totals',()=>{
 const b=[bd({order:'CTNR',nf:1}),bd({order:'CAR',nf:2,operation:'EXPORTAÇÃO - CARRETA'}),bd({order:'MI',nf:3,operation:'COMERCIAL'})];
 const c=[cr({ref:'CTNR',received:100}),cr({ref:'CAR',received:200}),cr({ref:'MI',received:300}),cr({ref:'UNKNOWN',received:400})];
 const m=run(b,c);assert.equal(m.summary.received,700);assert.equal(m.controlReport.meta.receivedConfirmed,1000);assert.equal(m.receiptReport.annual.find(x=>x.year===2026).received,1000);
 assert.equal(m.receiptCohorts.meta.outsideOperationAmount,300);assert.equal(m.receiptCohorts.meta.unresolvedAmount,400);
 assert.equal(run(b,c,{operation:'EXPORTAÇÃO - CARRETA'}).summary.received,200);const specific=run(b,c,{operation:'EXPORTAÇÃO - CTNR'});assert.equal(specific.summary.received,100);assert.equal(specific.receiptCohorts.meta.excludedUnknownOperationCount,1);assert.equal(specific.receiptCohorts.meta.excludedUnknownOperationAmount,400);
});

test('complete groups wholly within selected export operations count once without allocating the payment',()=>{
 const b=[bd({order:'CTNR',nf:1}),bd({order:'CAR',nf:2,operation:'EXPORTAÇÃO - CARRETA'})];
 const c=[cr({ref:'CTNR; CAR',received:300})];
 const m=run(b,c);assert.equal(m.summary.received,300);assert.equal(m.receiptCohorts.rows.length,1);assert.deepEqual(m.receiptCohorts.rows[0].bdRows,[2,3]);assert.equal(m.summary.claimed,2000);
 assert.equal(run(b,c,{operation:'EXPORTAÇÃO - CTNR'}).summary.received,0,'No arbitrary allocation to a single operation');
});

test('ambiguous suppliers and incomplete references retain actual Control K cash without invented attribution',()=>{
 const b=[bd({order:'A',nf:1,supplier:'A'}),bd({order:'B',nf:2,supplier:'B'})];
 for(const ref of ['A; B','A; UNKNOWN','A; CCO']){
  const m=run(b,[cr({ref,supplier:'A',received:500})]);assert.equal(m.summary.received,500);assert.equal(m.controlReport.meta.receivedConfirmed,500);assert.equal(m.receiptCohorts.meta.unresolvedAmount,500);assert.equal(m.receiptCohorts.rows[0].supplier,'A');assert.equal(m.receiptCohorts.rows[0].supplierSource,'Controle K');assert.equal(m.receiptCohorts.rows[0].validationState,ref==='A; B'?'partial':'control-only');
 }
});

test('paid date R is the cash year and neither AE nor entry-year corrections move the payment',()=>{
 const m=run([bd({date:'2025-01-01'})],[cr({comp:'2026-05-01',ae:2025,entryYear:1900,received:333}),cr({comp:'2025-05-01',ae:2026,received:222}),cr({comp:null,received:444}),cr({status:'Dentro do Prazo',received:555})]);
 assert.equal(m.summary.received,333);assert.equal(m.summary.receivedDifferentYear,333);assert.equal(m.receiptCohorts.rows[0].compensationYear,2026);assert.equal(m.receiptCohorts.rows[0].claimYear,2025);assert.equal(m.monthly.find(x=>x.month==='2026-05').received,333);
});

test('canonical supplier spelling is shared by main rows, receipt details and annual cohorts',()=>{
 const m=run([bd({order:'OLD',nf:1,date:'2024-01-01',supplier:'armador'}),bd({order:'NEW',nf:2,supplier:'ARMADOR'})],[cr({ref:'OLD',received:50}),cr({ref:'NEW',received:100})]);
 assert.equal(m.suppliers.length,1);assert.equal(m.suppliers[0].name,'ARMADOR');assert(m.receiptCohorts.rows.every(row=>row.supplier==='ARMADOR'));assert.equal(m.receiptCohorts.suppliers[0].name,'ARMADOR');assert.equal(m.summary.received,150);
});

test('same, different and unknown cohorts cover every counted payment without duplication',()=>{
 const b=[bd({order:'S',nf:1}),bd({order:'D',nf:2,date:'2024-01-01'}),bd({order:'U',nf:3,date:null})],c=[cr({ref:'S',received:111.11}),cr({ref:'D',received:222.22}),cr({ref:'U',received:333.33,entryYear:null})];
 const m=run(b,c),s=m.summary;assert.equal(s.received,666.66);assert.equal(Math.round((s.receivedSameYear+s.receivedDifferentYear+s.receivedUnknownYear)*100),Math.round(s.received*100));assert.equal(new Set(m.receiptCohorts.rows.map(row=>row.row)).size,3);assert.equal(s.receivedCount,3);
 const a=m.annual[0];assert.equal(a.received,666.66);assert.equal(a.receivedSameYear,111.11);assert.equal(a.receivedDifferentYear,222.22);assert.equal(a.receivedUnknownYear,333.33);assert.equal(m.receiptCohorts.annual[0].received,666.66);
});

test('fractional-cent cohort rounding conserves the total without assigning money to empty buckets',()=>{
 const b=[bd({order:'S',nf:1}),bd({order:'D',nf:2,date:'2024-01-01'}),bd({order:'U',nf:3,date:null})];
 for(const value of [.004,.006]){
  const m=run(b,[cr({ref:'S',received:value}),cr({ref:'D',received:value}),cr({ref:'U',received:value,entryYear:null})]);
  const cents=value=>Math.round(value*100),s=m.summary;
  assert.equal(cents(s.receivedSameYear)+cents(s.receivedDifferentYear)+cents(s.receivedUnknownYear),cents(s.received));
  assert.equal(s.received,Math.round(value*3*100)/100);assert(m.receiptCohorts.rows.every(row=>row.received===value));
  for(const group of [...m.receiptCohorts.suppliers,...m.receiptCohorts.annual,...m.receiptCohorts.monthly])assert.equal(cents(group.sameYear)+cents(group.differentYear)+cents(group.unknownYear),cents(group.received));
 }
 const one=run(b,[cr({ref:'D',received:.016})]);assert.equal(one.summary.received,.02);assert.equal(one.summary.receivedSameYear,0);assert.equal(one.summary.receivedUnknownYear,0);assert.equal(one.summary.receivedDifferentYear,.02);assert.match(one.receiptCohorts.meta.rounding,/maior grupo/);
});


test('a bulk reference of 12 orders is one payment, retained without BD in both scenarios',()=>{
 const c=[cr({ref:'12 ordens',supplier:'ARMADOR BETA',received:1200,entryYear:2026})];
 for(const correctionScenario of ['original','corrected']){
  const m=run([],c,{correctionScenario}),r=m.receiptCohorts.rows[0];
  assert.equal(m.summary.received,1200);assert.equal(m.summary.receivedCount,1);assert.equal(m.summary.receivedSameYear,1200);assert.equal(m.summary.receivedWithoutClaimDetail,1200);assert.equal(m.summary.receivedWithoutClaimDetailCount,1);
  assert.equal(m.suppliers.length,1);assert.equal(m.suppliers[0].name,'ARMADOR BETA');assert.equal(m.suppliers[0].claimed,0);assert.equal(m.suppliers[0].received,1200);assert.equal(m.suppliers[0].receivedWithoutClaimDetail,1200);
  assert.equal(r.reference,'12 ordens');assert.equal(r.validationState,'control-only');assert.equal(r.supplierSource,'Controle K');assert.equal(r.operationSource,'Não identificada');assert.deepEqual(r.bdRows,[]);assert.equal(r.claimYear,2026);
  assert.equal(m.controlReport.installments[0].year,2026);assert.equal(m.controlReport.installments[0].market,'ME');assert.equal(m.controlReport.installments[0].includedInRealized,true);
  assert.equal(m.annual[0].received,1200);assert.equal(m.annual[0].receivedWithoutClaimDetail,1200);assert.equal(m.monthly.find(x=>x.month==='2026-02').received,1200);
 }
 const filtered=run([],c,{operation:'EXPORTAÇÃO - CTNR'});assert.equal(filtered.summary.received,0);assert.equal(filtered.controlReport.meta.receivedConfirmed,1200);assert.equal(filtered.receiptCohorts.meta.excludedUnknownOperationAmount,1200);
});

test('unknown references preserve literal supplier names without fuzzy alias inference',()=>{
 const b=[bd({supplier:'ARMADOR ALFA'})],c=[cr({supplier:'ARMADOR ALFA SHIPPING'}),cr({ref:'SEM REFERÊNCIA',supplier:'ARMADOR ALFA SHIPPING',received:50})];
 const m=run(b,c);assert.equal(m.suppliers.find(x=>x.name==='ARMADOR ALFA').received,100);assert.equal(m.suppliers.find(x=>x.name==='ARMADOR ALFA SHIPPING').received,50);assert.equal(m.summary.received,150);
 assert.equal(run(b,c,{supplier:'ARMADOR ALFA'}).summary.received,100);assert.equal(run(b,c,{supplier:'ARMADOR ALFA SHIPPING'}).summary.received,50);
});

test('a fully linked group mixing export and commercial is excluded without allocating its cash',()=>{
 const b=[bd({order:'EXPORT',nf:1}),bd({order:'LOCAL',nf:2,operation:'COMERCIAL'})],c=[cr({ref:'EXPORT; LOCAL',received:300})];
 const m=run(b,c);assert.equal(m.summary.received,0);assert.equal(m.receiptCohorts.meta.outsideOperationAmount,300);assert.equal(m.receiptCohorts.meta.excludedUnknownOperationAmount,0);assert.equal(m.controlReport.meta.receivedConfirmed,300);
});

test('origin-year columns preserve all cash while comparison includes claim and payment years in the selected set',()=>{
 const b=[bd({order:'OLD24',nf:1,date:'2024-01-01'}),bd({order:'YEAR25',nf:2,date:'2025-01-01'}),bd({order:'YEAR26',nf:3,date:'2026-01-01'}),bd({order:'NEG26',nf:4,claimed:400,status:'EM NEGOCIAÇÃO - PROCEDENTE'})];
 const c=[cr({ref:'OLD24',received:50}),cr({ref:'YEAR25',comp:'2025-02-01',received:100}),cr({ref:'YEAR25',received:200}),cr({ref:'YEAR26',received:300}),cr({ref:'UNKNOWN',entryYear:null,received:25}),cr({ref:'12 ordens',supplier:'ARMADOR BETA',received:40})];
 const m=run(b,c,{years:[2025,2026]}),s=m.summary,armador=m.suppliers.find(x=>x.name==='ARMADOR');
 assert.deepEqual(s.receivedByClaimYear,{2024:50,2025:300,2026:340,other:25});assert.equal(s.received,715);assert.equal(s.receivedComparable,640);assert.equal(s.receivedSameYear,440);assert.equal(s.comparableRecoveryRate,640/2400);assert.equal(s.comparableLoss,1360);assert.equal(s.comparableLossRate,1360/2400);assert.equal(s.loss,1285,'Legacy financial cash loss remains available unchanged');assert.equal(s.claimed,2400);assert.equal(s.negotiating,400);
 assert.equal(armador.received,650);assert.equal(armador.receivedComparable,600);assert.deepEqual(armador.receivedByClaimYear,{2024:50,2025:300,2026:300,other:0});assert.equal(armador.comparableLoss,1400);
 const y25=m.annual.find(x=>x.year===2025),y26=m.annual.find(x=>x.year===2026);assert.equal(y25.receivedComparable,100);assert.equal(y26.receivedComparable,540);assert.deepEqual(y26.receivedByClaimYear,{2024:50,2025:200,2026:340,other:25});assert.equal(y26.comparableLoss,460);
 const month=m.monthly.find(x=>x.month==='2026-02');assert.equal(month.received,615);assert.equal(month.receivedComparable,540);assert.deepEqual(month.receivedByClaimYear,y26.receivedByClaimYear);assert.equal(month.comparableLoss,null,'No monthly claim denominator is invented');assert.equal(month.comparableRecoveryRate,null);
 assert.equal(m.controlReport.meta.receivedConfirmed,715);assert.equal(m.receiptCohorts.rows.length,6);assert.equal(m.receiptCohorts.rows.filter(r=>r.reference==='12 ordens').length,1);
 const late=m.receiptCohorts.rows.find(r=>r.reference==='YEAR25'&&r.compensationYear===2026);assert.equal(late.claimYear,2025);assert.equal(late.cohort,'different');assert.equal(late.received,200);
 const only26=run(b,c,{years:[2026]});assert.equal(only26.summary.received,615);assert.equal(only26.summary.receivedComparable,340);assert.equal(only26.summary.receivedByClaimYear[2025],200,'Old-origin payment stays visible outside the selected-origin total');
});

test('origin-year groups follow the active correction scenario and conserve fractional cents',()=>{
 const b=[bd({order:'A',nf:1,date:'2025-01-01'}),bd({order:'B',nf:2,date:'2024-01-01'}),bd({order:'C',nf:3,date:null})],c=[cr({ref:'A',entryYear:2026,received:.004}),cr({ref:'B',entryYear:2026,received:.004}),cr({ref:'C',entryYear:null,received:.004})];
 const original=run(b,c,{correctionScenario:'original'}),corrected=run(b,c);
 assert.equal(original.summary.received,.01);assert.equal(corrected.summary.received,.01);assert.equal(original.summary.receivedByClaimYear[2025],0);assert.equal(corrected.summary.receivedByClaimYear[2026],0);
 for(const m of [original,corrected])for(const group of [m.summary,...m.suppliers,...m.annual,...m.monthly,...m.receiptCohorts.suppliers,...m.receiptCohorts.annual,...m.receiptCohorts.monthly])assert.equal(Object.values(group.receivedByClaimYear).reduce((total,amount)=>total+Math.round(amount*100),0),Math.round(group.received*100));
});
