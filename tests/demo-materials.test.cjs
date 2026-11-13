'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../dist/engine.js'),M=require('../dist/materials-data.js');
function demo(){
 const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),start=app.indexOf('  function demo(){'),end=app.indexOf('  function exportPdf(){',start);assert(start>=0&&end>start);
 const context={state:{},setSelected(){},setGlobalYears(){},$(){return{value:''}},document:{querySelectorAll:()=>[]},analyze(){}};vm.runInNewContext(app.slice(start,end)+'\ndemo();',context);return context.state;
}
test('synthetic demo exercises literal open, closed, missing Status and three explicit maritime carriers',()=>{
 const {bd,control}=demo(),options={years:[2026],asOf:'2026-03-31'},model=E.analyze(bd,control,options),rows=model.executiveReport.controlClaims;
 assert.equal(bd[0][5],'Status');assert.equal(bd[0][31],'Cia Maritima');
 for(const status of ['open','closed','unknown'])assert(rows.some(row=>row.caseStatusKey===status),status);
 assert(bd.slice(1).every(row=>['ABERTO','FECHADO',null].includes(row[5])));
 const report=M.build(model,{years:[2026],months:[],tab:'carriers'});
 assert.equal(report.carriers.length,3);assert.deepEqual(report.carriers.map(row=>row.name),['ARMADOR ALFA','ARMADOR DELTA','ARMADOR BETA']);
 assert(report.carriers.every(group=>group.rows.every(row=>row.armador===group.name)));assert(report.negotiation.allYears);
 const legacy=bd.map((row,index)=>index?Object.assign([...row],{5:index<6?'CONCLUÍDO':'EM ABERTO'}):[...row]),before=E.analyze(legacy,control,options);
 for(const key of ['summary','suppliers','receiptCohorts','supplierOpenReport','baseReconciliation','claimValueAudit'])assert.deepEqual(model[key],before[key],'Status fixture must not change financial calculations: '+key);
});
