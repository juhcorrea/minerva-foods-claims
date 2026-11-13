'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
test('public demo offers literal open, closed and unknown F examples without changing financial results',()=>{
 const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),start=app.indexOf('  function demo(){'),end=app.indexOf('  function exportPdf(){',start);assert(start>=0&&end>start);
 let selectedYears;const context={state:{},setSelected(){},setGlobalYears(years){selectedYears=Array.from(years);},$(){return{value:''}},document:{querySelectorAll:()=>[]},analyze(){}};vm.runInNewContext(app.slice(start,end)+'\ndemo();',context);assert.deepEqual(selectedYears,[2026]);
 const {bd,control}=context.state,options={years:[2026],asOf:'2026-03-31'},model=E.analyze(bd,control,options),rows=model.executiveReport.controlClaims;
 assert.equal(bd[0][5],'Status');assert(rows.some(row=>row.caseStatusKey==='open'));assert(rows.some(row=>row.caseStatusKey==='closed'));assert(rows.some(row=>row.caseStatusKey==='unknown'));assert(rows.some(row=>row.caseStatusKey==='open'&&row.rncYear<2026));assert(bd.slice(1).every(row=>['ABERTO','FECHADO',null].includes(row[5])));
 const legacy=bd.map((row,index)=>index?Object.assign([...row],{5:index<6?'CONCLUÍDO':'EM ABERTO'}):[...row]),before=E.analyze(legacy,control,options);
 for(const key of ['summary','suppliers','receiptCohorts','supplierOpenReport','baseReconciliation','claimValueAudit'])assert.deepEqual(model[key],before[key]);
});
