'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),html=fs.readFileSync(require.resolve('../dist/index.html'),'utf8');
const between=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+a.length));
const code=between('  function currentMaterialsTab','  function updateMaterialsNavigation')+between('  async function exportBook','  function demo')+between('  function exportPdf','  function extraControls');
function fixture(tab){const calls=[],errors=[],state={view:'procurement',materialsTab:tab,model:{meta:{}}},context={state,window:{MinervaMaterials:{async exportExcel(tab){calls.push(['excel',tab]);},exportPdf(tab){calls.push(['pdf',tab]);}},MinervaClaimControl:{exportProcurement(){calls.push(['fup-excel']);}}},ensureFullModel:async()=>true,viewScopeMatches:()=>true,refreshViewScope(){},prepareExportViews(){},renderView(){},say(){},notice:message=>errors.push(message)};vm.createContext(context);vm.runInContext(code,context);return {context,state,calls,errors};}
test('Materials main menu and accessible subtabs preserve the original FUP host and identify separate report hosts',()=>{
 assert.match(html,/data-view="procurement"[^>]*>[\s\S]*?<span>Materiais<\/span>/);
 for(const [tab,host]of [['fup','procurementContent'],['directors','materialsDirectors'],['carriers','materialsCarriers']])assert.match(html,new RegExp('data-materials-tab="'+tab+'"[^>]*role="tab"[^>]*aria-controls="'+host+'"'));
 assert.match(html,/id="materialsViews"[^>]*role="tablist"/);assert.match(html,/<script src="materials.js"><\/script>/);
 assert.match(html,/<link rel="stylesheet" href="materials.css">/);assert(html.indexOf('src="materials-data.js"')>=0&&html.indexOf('src="materials-data.js"')<html.indexOf('src="materials.js"'),'The data projection loads before the material UI');
});
test('toolbar Excel and PDF dispatch to the selected report while FUP retains its existing styled workbook',async()=>{
 for(const tab of ['directors','carriers']){const f=fixture(tab);await f.context.exportBook('procurement');f.context.exportPdf();assert.deepEqual(f.calls,[['excel',tab],['pdf',tab]]);assert.equal(f.state.exportBookPending,false);assert.equal(f.state.printing,undefined);assert.deepEqual(f.errors,[]);}
 const f=fixture('fup');await f.context.exportBook('procurement');assert.deepEqual(f.calls,[['fup-excel']]);
});
test('missing material exports cannot fall back to a different report and changing subtab during hydration cancels export',async()=>{
 const f=fixture('directors');f.context.window.MinervaMaterials={};await f.context.exportBook('procurement');f.context.exportPdf();assert.equal(f.errors.length,2);assert.deepEqual(f.calls,[]);
 const g=fixture('directors');let finish;g.context.ensureFullModel=()=>new Promise(resolve=>finish=resolve);const pending=g.context.exportBook('procurement');g.state.materialsTab='carriers';finish(true);await pending;assert.deepEqual(g.calls,[]);assert.equal(g.state.exportBookPending,false);
});
