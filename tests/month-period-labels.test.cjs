'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');
const context={asList:value=>Array.isArray(value)?value:value?[value]:[]};vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('  function cleanYears('),source.indexOf('  function globalMonths(')),context);
test('period captions preserve historical portfolios until months explicitly restrict the period',()=>{
 assert.equal(context.analysisPeriodLabel({years:[2026],months:[]},true),'Todos os anos');
 assert.equal(context.analysisPeriodLabel({years:[2025,2026],months:[1,11]},true),'2025 + 2026 · Janeiro, Novembro');
 assert.equal(context.analysisPeriodLabel({years:[2026],months:[11]}),'2026 · Novembro');
 assert.equal(context.analysisPeriodLabel({allYears:true,years:[2024,2025,2026],months:[2]}),'Todos os anos · Fevereiro');
 assert.equal(context.analysisPeriodLabel({years:[2026],months:Array.from({length:12},(_,index)=>index+1)},true),'Todos os anos');
 assert.equal(context.monthFilterLabel([]),'Todos Os Meses');
});
test('print scope and open-balance details consume the applied month-aware period instead of claiming all years',()=>{
 assert.match(source,/analysisPeriodLabel\(state\.view==='procurement'\?state\.model\.procurementReport\?\.meta\|\|state\.model\.meta:state\.model\.meta,state\.view==='procurement'\)/);
 assert.match(source,/Composição do saldo em aberto<\/h3><p>'\+esc\(analysisPeriodLabel\(state\.model\.meta,true\)\)/);
 assert.match(source,/Referências no período · '\+analysisPeriodLabel\(state\.model\.meta\)/);
 assert.match(source,/\['Meses selecionados',monthFilterLabel\(m\.meta\.months\)\]/);
});
