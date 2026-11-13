'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),M=require('../dist/materials-data.js'),E=require('../dist/engine.js');
const claim=(row,date,claimed,extra={})=>({row,sgr:'QA-'+row,rncDate:date,claimed,status:'EM NEGOCIAÇÃO - PROCEDENTE',pending:'',reason:'AVARIA',country:'BRA',supplier:'Fornecedor fictício',armador:'Armador Alfa',order:'QA-ORDER-'+row,container:'QA-CONT-'+row,nf:'QA-NF-'+row,invoiceDate:'2026-01-01',openingDate:'2026-02-01',daysOpen:12,agingDate:'2026-02-13',...extra});
const fixture=()=>({meta:{years:[2026],asOf:'2026-11-13',suppliers:[],operations:[]},executiveReport:{controlClaims:[
  claim(2,'2020-11-01',100),claim(3,'2025-11-01',200,{armador:'Armador Beta',country:'ARG'}),
  claim(4,'2026-11-01',300,{armador:'Armador Gama'}),claim(5,'2026-10-01',50),
  claim(6,'2026-11-01',400,{supplier:'Jurídico',armador:'Armador Jurídico'}),
  claim(7,'2026-11-01',500,{pending:'Retorno: Fúp   Suprimêntos',armador:'Armador FUP'}),
  claim(8,'2026-11-01',600,{status:'RESSARCIMENTO ENCAMINHADO'}),
  claim(9,'2026-11-01',700,{status:'FINALIZADO SEM CUSTO'}),
  claim(10,'2026-11-01',800,{status:'PREJUÍZO MINERVA'}),
  claim(11,'2026-11-01',900,{status:'PROCEDENTE SEGURO'}),
  claim(12,'2026-11-01',1000,{status:'AGUARDANDO CUSTOS'}),
  claim(13,'2026-11-01',1100,{status:'RESPONDIDO - NÃO PROCEDE'}),
  claim(14,'2026-11-01',1200,{reason:'Interferência externa'}),
  claim(15,null,1300),claim(16,'2027-11-01',1400),
  claim(17,'2026-11-01',150,{armador:''}),
  claim(18,'2026-11-01',160,{armador:'Não informado',supplier:'Transportadora fictícia'}),
  claim(19,'2026-11-01',10,{sgr:''}),claim(20,'2026-11-01',20,{sgr:'QA-4'})
]}});

test('directors uses exactly the approved five situations in its own period and preserves source/detail fields',()=>{
  const model=fixture(),before=JSON.stringify(model),r=M.build(model,{years:[2026],months:[11],tab:'directors'}),d=r.directors;
  assert.equal(d.total,4540);assert.equal(d.claimedProcedent,4540);assert.equal(d.recordCount,11);assert.equal(d.count,10);
  assert.equal(d.rows.filter(row=>row.sgr==='QA-4').length,2,'same SGR on separate source rows counts twice');
  assert(d.rows.some(row=>row.row===6),'Jurídico remains in the approved denominator');
  assert(d.rows.some(row=>row.row===7),'FUP exclusion applies to negotiation, not the declared denominator');
  assert.deepEqual(r.approvedRows,d.rows);assert.equal(d.rows[0].row,11);
  for(const key of ['order','container','nf','invoiceDate','openingDate','daysOpen','agingDate'])assert.equal(d.rows[0][key],model.executiveReport.controlClaims.find(row=>row.row===11)[key]);
  assert.equal(d.byCountry.reduce((sum,group)=>sum+group.total,0),4540);
  assert.equal(d.byReason.reduce((sum,group)=>sum+group.count,0),10);
  assert.deepEqual(r.meta.yearsAvailable,[2020,2025,2026]);
  assert.equal(JSON.stringify(model),before,'the existing model is not changed');
  d.rows[0].claimed=1;assert.equal(model.executiveReport.controlClaims.find(row=>row.row===11).claimed,900,'returned rows are clones');
});

test('negotiation ignores years with all months, keeps legal aggregate only, and shares the top3 carrier scope',()=>{
  for(const years of [[2020],[2025],[2026]]){
    const r=M.build(fixture(),{years}),n=r.negotiation;
    assert.equal(n.total,990);assert.equal(n.count,7);assert.equal(n.recordCount,8);assert.equal(n.legalTotal,400);assert.equal(n.grandTotal,1390);
    assert.equal(n.allYears,true);assert.deepEqual(n.years,[2020,2025,2026]);
    assert.equal(n.bySupplier.reduce((sum,group)=>sum+group.total,0),990);
    assert.equal(n.byCountry.reduce((sum,group)=>sum+group.count,0),7);
    assert(!JSON.stringify(n).includes('Armador Jurídico'));assert(!n.rows.some(row=>row.row===6));
    assert(!n.rows.some(row=>[7,8,9,10,11,12,13,14,15,16].includes(row.row)));
    assert.deepEqual(r.carriers.map(group=>[group.name,group.total]),[['Armador Gama',300],['Armador Beta',200],['Armador Alfa',180]]);
    assert(r.carriers.every(group=>group.rows.every(row=>row.armador===group.name)));
    assert.equal(r.meta.missingCarrierCount,2);assert.equal(r.meta.missingCarrierAmount,310);
  }
});

test('specific months combine with selected years, clearing them restores historical negotiation',()=>{
  const model=fixture(),nov=M.build(model,{years:[2026],months:[11]}),oct=M.build(model,{years:[2026],months:[10]}),both=M.build(model,{years:[2026],months:[10,11]});
  assert.equal(nov.negotiation.total,640);assert.equal(nov.negotiation.legalTotal,400);assert.equal(nov.negotiation.allYears,false);
  assert.deepEqual(nov.negotiation.years,[2026]);assert.deepEqual(nov.negotiation.months,[11]);
  assert.equal(nov.directors.total,4540);assert.equal(oct.directors.total,50);assert.equal(both.directors.total,4590);
  assert.equal(both.negotiation.total,690);assert.equal(oct.negotiation.total,50);
  assert.equal(M.build(model,{years:[2025,2026],months:[11]}).negotiation.total,840);
  assert.equal(M.build(model,{years:[],months:[11]}).negotiation.total,940);
  assert.equal(M.build(model,{years:[2026],months:[]}).negotiation.total,990);
  assert.deepEqual(M.build(model,{years:[2026],months:Array.from({length:12},(_,i)=>i+1)}),M.build(model,{years:[2026],months:[]}));
});

test('status aliases, accents and FUP exclusion are consistent without accepting nonprocedente statuses',()=>{
  const model={meta:{years:[2026],asOf:'2026-11-13'},executiveReport:{controlClaims:[
    claim(2,'2026-11-01',100,{status:' em negociacao procedente '}),
    claim(3,'2026-11-01',200,{status:'procedente seguro'}),
    claim(4,'2026-11-01',300,{status:'EM NEGOCIAÇÃO–PROCEDENTE',pending:'FUP\nSUPRIMENTOS'}),
    claim(5,'2026-11-01',400,{status:'EM NEGOCIAÇÃO NÃO PROCEDENTE'})
  ]}};
  const r=M.build(model,{months:[11]});assert.equal(r.directors.total,600);assert.equal(r.negotiation.total,100);assert.equal(r.negotiation.excludedFupCount,1);
});

test('only genuine carrier field participates; ranked by pending negotiation USD instead of claim volume',()=>{
  const model={meta:{years:[2026],asOf:'2026-11-13'},executiveReport:{controlClaims:[
    claim(2,'2026-11-01',10,{armador:'Armador A'}),claim(3,'2026-11-01',10,{armador:'Armador A'}),
    claim(4,'2026-11-01',500,{armador:'Armador B'}),claim(5,'2026-11-01',300,{armador:'Armador C'}),
    claim(6,'2026-11-01',100,{armador:'Armador D'}),claim(7,'2026-11-01',9999,{armador:'',supplier:'Transportadora Alta'}),
    claim(8,'2026-11-01',20000,{armador:'Armador Fora',status:'RESSARCIMENTO ENCAMINHADO'})
  ]}};
  const r=M.build(model,{months:[11]});assert.deepEqual(r.carriers.map(group=>group.name),['Armador B','Armador C','Armador D']);
  assert.deepEqual(r.carrierUniverse,{total:920,count:5,carrierCount:4},'universe includes the fourth carrier but excludes transporters, legal and non-negotiation rows');
  for(const group of r.carriers){assert.equal(group.byReason.reduce((sum,item)=>sum+item.total,0),group.total);assert.equal(group.byCountry.reduce((sum,item)=>sum+item.count,0),group.count);}
});

test('source precision survives, invalid dates stay out and unknown amounts are not invented',()=>{
  const model={meta:{years:[2026],asOf:'2026-11-13'},executiveReport:{controlClaims:[
    claim(2,'2026-11-01',.125),claim(3,'2026-11-01',.125),claim(4,'2026-11-01',null),
    claim(5,'2026-02-30',900),claim(6,'1900-01-01',800),claim(7,'2026-11-14',700)
  ]}};
  const r=M.build(model,{months:[11]});assert.equal(r.negotiation.total,.25);assert.deepEqual(r.negotiation.rows.map(row=>row.claimed),[.125,.125,null]);
  assert.equal(r.meta.excludedDateCount,3);assert.equal(r.meta.missingAmountCount,1);assert.deepEqual(r.meta.yearsAvailable,[2026]);
  assert.deepEqual(M.build(model,{years:[],months:[0,13,1.5,true,null]}).meta.months,[]);
  assert.equal(M.build({}).directors.total,0);assert.deepEqual(M.build({}).carriers,[]);
});

test('real engine contract supplies armador and follow-up fields without replacing the financial model',()=>{
  const row=(width,values)=>Object.assign(Array(width).fill(null),values);
  const bd=[row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',10:'Motivo',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',31:'Cia Maritima',32:'Nº container',35:'Reclamado (USD)',46:'Data NF',56:'Analista'}),row(65,{0:'QA',1:'2026-11-01',3:'ME',5:'Aberto',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'Aguardando retorno',10:'AVARIA',13:'2026-11-02',19:'BRA',22:'QA-ORDER',24:'QA-NF',25:'COMERCIAL',28:'Negociação',31:'Armador Fictício',32:'QA-CONT',35:123.456,46:'2026-10-01'})];
  const control=[row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'})];
  const model=E.analyze(bd,control,{years:[2026],asOf:'2026-11-13'}),before=JSON.stringify(model),r=M.build(model,{years:[2026],months:[11]});
  assert.equal(r.carriers[0].name,'Armador Fictício');assert.equal(r.carriers[0].total,123.46);
  assert.equal(r.carriers[0].rows[0].claimed,123.456);assert.equal(r.carriers[0].rows[0].container,'QA-CONT');assert.equal(r.carriers[0].rows[0].pending,'Aguardando retorno');
  assert.equal(JSON.stringify(model),before);
});
