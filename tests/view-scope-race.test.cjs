'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const appSource=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),teamSource=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const between=(source,start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at+start.length);assert(at>=0&&until>at,`Source boundary ${start}`);return source.slice(at,until);};
// Execute the production orchestration functions. Only DOM, network and the
// synchronous financial calculation are replaced; no scope decision is copied.
const appCode=[between(appSource,'  const applied=','  const $ ='),between(appSource,'  function view(name)','  const currentScenario'),between(appSource,'  function options()','  async function readFile'),between(appSource,'  function acceptScenarioModel','  function populateSuppliers'),between(appSource,'  function setPublishedReport','  window.MinervaApp')].join('\n');
const teamCode=between(teamSource,'  async function loadReport(options)','  async function publishReport');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){for(let n=0;n<5;n++)await tick();}
const model=allYears=>({meta:{allYears,years:allYears?[2021,2026]:[2026],correctionScenario:'corrected',linkedControlRows:0},summary:{claimed:allYears?100:10,recordCount:0,reviewCount:0},suppliers:[],controlReport:{supplierOptions:[]}});
const payload=allYears=>({model:model(allYears),files:{bd:'Synthetic BD.xlsx',control:'Synthetic Control.xlsx'},revision:allYears?'history':'current',updatedAt:'2026-11-06T12:00:00Z',updatedBy:'Test'});
function fixture({local=false,initialModel=model(false),pausePaint=false}={}){
 const elements=new Map(),renders=[],requests=[],errors=[],calculations=[],paint=deferred();let paintCount=0;
 const node=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,isConnected:true,open:false,value:'',dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},closest(){return this;},close(){this.open=false;}});return elements.get(id);};
 const years=[{value:'2025',checked:false},{value:'2026',checked:true}],views=['overview','suppliers','procurement','claims','installments'].map(name=>node('view-'+name)),nav=views.map(el=>Object.assign(node('nav-'+el.id),{dataset:{view:el.id.slice(5)}}));
 node('asOf').value='2026-11-06';node('correctionScenario').value='corrected';
 const state={view:'overview',model:initialModel,bd:local?[[]]:null,control:local?[[]]:null,operation:'',controlOperation:'',demo:false};
 const context={state,queueMicrotask,AbortController,URLSearchParams,CustomEvent:class{},console,
  document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},querySelector:node,querySelectorAll(selector){if(selector==='input[name="year"]:checked')return years.filter(y=>y.checked);if(selector==='[id^="view-"]')return views;if(selector==='[data-view]')return nav;if(selector.includes('.filters-panel input'))return nav;return [];},dispatchEvent(){}},
  window:{},$:node,F:{clear(){}},captureOperation(){},populateOperations(){},setText(){},populateSuppliers(){},say(){},notice(message){errors.push(message);},integer:String,
  nextPaint:()=>pausePaint&&paintCount++===0?paint.promise:Promise.resolve(),openImports(){throw Error('Unexpected import prompt');},
  E:{analyze(_bd,_control,options){calculations.push({...options});return model(options.allYears===true);}},
  render(){renders.push({view:state.view,allYears:state.model.meta.allYears,claimed:state.model.summary.claimed});},
  session:{approved:true},reportController:null,loadVersion:0,loadingReport:false,publishedMeta:null,refreshControls(){},setMessage(){},showEmptyReport(){},canUpdateBases:()=>true,
  api(url,options){const job=deferred();requests.push({url,options,...job});return job.promise;},reportQuery:require('../dist/team.js').reportQuery};
 vm.createContext(context);vm.runInContext(appCode,context,{filename:'app-orchestration-from-production.js'});
 context.app={state,getOptions:context.options,setPublishedReport:context.setPublishedReport};
 vm.runInContext(teamCode,context,{filename:'team-loader-from-production.js'});if(!local)state.serverLoader=context.loadReport;
 return {context,state,years,nav,requests,renders,errors,calculations,paint};
}

test('late supplier server response never replaces current-year overview after a rapid return',async()=>{
 const f=fixture();f.context.view('suppliers');assert.equal(f.requests.length,1);assert.equal(f.state.analysisBusy,true);assert(f.nav.every(button=>button.disabled));
 f.context.view('overview');f.requests[0].resolve(payload(true));await flush();
 assert.equal(f.state.model.meta.allYears,false);assert.equal(f.renders.length,0,'Rejected historical model is never rendered');assert.equal(f.requests.length,2);
 assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).has('allYears'),false);
 f.requests[1].resolve(payload(false));await flush();
 assert.deepEqual(f.renders,[{view:'overview',allYears:false,claimed:10}]);assert.equal(f.state.analysisBusy,false);assert(f.nav.every(button=>!button.disabled));assert.deepEqual(f.years.map(y=>y.checked),[false,true]);assert.deepEqual(f.errors,[]);
});

test('initial direct team load rejects the stale scope and requests the newly selected supplier history',async()=>{
 const f=fixture({initialModel:null}),loading=f.context.loadReport(f.context.options());f.context.view('suppliers');
 f.requests[0].resolve(payload(false));assert.equal(await loading,false);await flush();
 assert.equal(f.state.model,null);assert.equal(f.state.publishedMeta,undefined);assert.equal(f.renders.length,0);assert.equal(f.requests.length,2);
 assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).get('allYears'),'1');
 f.requests[1].resolve(payload(true));await flush();
 assert.equal(f.state.model.meta.allYears,true);assert.equal(f.state.publishedMeta.revision,'history');assert.deepEqual(f.renders,[{view:'suppliers',allYears:true,claimed:100}]);assert.deepEqual(f.errors,[]);
});

test('local deferred analysis discards the old view result and recomputes without changing year checkboxes',async()=>{
 const f=fixture({local:true,pausePaint:true}),first=f.context.analyze();f.context.view('suppliers');f.paint.resolve();assert.equal(await first,false);await flush();
 assert.deepEqual(f.calculations.map(options=>options.allYears),[false,true]);assert.deepEqual(f.renders,[{view:'suppliers',allYears:true,claimed:100}]);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);assert.equal(f.state.scopeRefreshPending,false);assert.deepEqual(f.errors,[]);
});

test('repeated programmatic scope changes use the final view and do not loop or retain historical results',async()=>{
 const f=fixture();f.context.view('suppliers');f.context.view('overview');f.context.view('suppliers');f.context.view('claims');
 f.requests[0].resolve(payload(true));await flush();assert.equal(f.requests.length,2);assert.equal(f.renders.length,0);
 f.context.view('suppliers');f.requests[1].resolve(payload(false));await flush();assert.equal(f.requests.length,3);assert.equal(f.renders.length,0);
 f.requests[2].resolve(payload(true));await flush();assert.equal(f.requests.length,3);assert.deepEqual(f.renders,[{view:'suppliers',allYears:true,claimed:100}]);
 f.context.view('overview');assert.equal(f.requests.length,4);f.requests[3].resolve(payload(false));await flush();assert.equal(f.requests.length,4);assert.deepEqual(f.renders.at(-1),{view:'overview',allYears:false,claimed:10});assert.equal(f.state.analysisBusy,false);assert.equal(f.state.scopeRefreshPending,false);assert.deepEqual(f.errors,[]);
});
