'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {aggregate,monthOf,defaultMonth}=require('../dist/meetings.js');
const receipt=(overrides={})=>({status:'Pago',compensationYear:2026,compensationMonth:'2026-10',compDate:'2026-10-07',received:100,receiptAnalyst:'Owner',originalSupplier:'ARMADOR A LTDA',row:2,...overrides});
const report=rows=>({rows,years:[...new Set(rows.map(row=>row.compensationYear))]});

test('annual AE total is reconciled by twelve months plus unallocated, preserving precision',()=>{
  const rows=[receipt({received:100.125}),receipt({received:200,compensationMonth:'2026-11'}),receipt({received:30,compensationMonth:null,compDate:null}),receipt({received:40,compensationMonth:'2025-10',compDate:'2025-10-10'}),receipt({received:50,compensationMonth:'2026-13'})];
  const annual=aggregate(report(rows),2026,0);
  assert.equal(annual.annual,420.125);
  assert.equal(annual.allocated,300.125);
  assert.equal(annual.unallocated,120);
  assert.equal(annual.unallocatedCount,3);
  assert.equal(annual.monthly.reduce((sum,row)=>sum+row.received,0)+annual.unallocated,annual.annual);
  assert.equal(annual.rows.length,5);
  const october=aggregate(report(rows),2026,10);
  assert.equal(october.received,100.125);assert.equal(october.count,1);
  assert.equal(october.annual,annual.annual);assert.equal(october.goal.delta,300000-420.125);
  assert.equal(aggregate(report(rows),2026,-1).received,120);
  assert.equal(monthOf(receipt({compensationMonth:'2025-10'})),null);
});

test('monthly comparison uses previous calendar month, and has no divide-by-zero fallback',()=>{
  const r=report([receipt({received:120,compensationMonth:'2026-01'}),receipt({received:80,compensationYear:2025,compensationMonth:'2025-12'}),receipt({received:75,compensationMonth:'2026-03'})]);
  const january=aggregate(r,2026,1);
  assert.equal(january.previousYear,2025);assert.equal(january.previousMonth,12);assert.equal(january.delta,40);assert.equal(january.variation,.5);
  const march=aggregate(r,2026,3);assert.equal(march.previous,0);assert.equal(march.variation,null);assert.equal(march.delta,75);
  const missing=aggregate(report([receipt({compensationMonth:'2026-01'})]),2026,1);assert.equal(missing.previousAvailable,false);assert.equal(missing.delta,null);assert.equal(missing.variation,null);
});

test('all original Control suppliers and AF analysts are included without BD inference',()=>{
  const r=report([receipt({received:100.10,receiptAnalyst:'Ana',originalSupplier:'SEM VINCULO'}),receipt({received:200.20,receiptAnalyst:'ÁNA',originalSupplier:'ARMADOR A LTDA'}),receipt({received:300.30,receiptAnalyst:'',originalSupplier:''}),receipt({received:1000,status:'Vencido'}),receipt({received:-100}),receipt({received:'bad'})]);
  const d=aggregate(r,2026,10);assert(Math.abs(d.received-600.60)<1e-9);assert.equal(d.count,3);
  assert.equal(d.analysts.length,2);assert(Math.abs(d.analysts.find(row=>row.key==='ANA').received-300.30)<1e-9);
  assert(d.suppliers.some(row=>row.name==='SEM VINCULO'));assert(d.suppliers.some(row=>row.name==='Não informado'));
  assert(Math.abs(d.suppliers.reduce((total,row)=>total+row.share,0)-1)<1e-9);
});

test('goal is annual and only the configured 2026 thresholds apply',()=>{
  const r=report([receipt({received:300000,compensationMonth:'2026-12'}),receipt({received:150000,compensationMonth:'2026-01'}),receipt({received:10,compensationYear:2025,compensationMonth:'2025-10'})]);
  const january=aggregate(r,2026,1);assert.equal(january.received,150000);assert.equal(january.annual,450000);assert.equal(january.goal.delta,0);assert.equal(january.goal.stretchDelta,0);assert.equal(january.goal.target,300000);assert.equal(january.goal.stretch,450000);
  assert.equal(aggregate(r,2025,0).goal,null);
  const zero=aggregate(report([]),2026,10);assert.equal(zero.received,0);assert.equal(zero.annual,0);assert.equal(zero.goal.delta,300000);assert.equal(zero.variation,null);assert.equal(zero.monthly.length,12);
});



test('initial month selects the latest populated month at or before analysis date, without excluding future paid rows',()=>{
  const r=report([receipt({compensationMonth:'2026-09'}),receipt({compensationMonth:'2026-10'}),receipt({compensationMonth:'2026-12'}),receipt({compensationMonth:null})]);
  assert.equal(defaultMonth(r,2026,'2026-11-03'),10);
  assert.equal(defaultMonth(r,2026,'2026-10-30'),10);
  assert.equal(defaultMonth(r,2026,'2026-09-30'),9);
  assert.equal(defaultMonth(r,2026,'2026-08-30'),0);
  assert.equal(defaultMonth(r,2026,'2025-11-03'),0);
  assert.equal(defaultMonth(r,2026,''),0);
  assert.equal(aggregate(r,2026,11).received,0,'An explicit empty November remains a valid selection');
  assert.equal(aggregate(r,2026,0).count,4,'Future marked-paid rows remain in the annual total');
});
