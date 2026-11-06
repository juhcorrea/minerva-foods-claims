'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const appSource=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),teamSource=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const between=(source,start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at+start.length);assert(at>=0&&until>at,`Source boundary ${start}`);return source.slice(at,until);};
// Execute the production orchestration functions. Only DOM, network and the
// synchronous financial calculation are replaced; no scope decision is copied.
const appCode=[between(appSource,'  const applied=','  const $ ='),between(appSource,'  function view(name)','  const currentScenario'),between(appSource,'  function options()','  async function readFile'),between(appSource,'  function acceptScenarioModel','  function populateSuppliers'),between(appSource,'  function setPublishedReport','  window.MinervaApp')].join('\n');
const teamCode=between(teamSource,'  async function loadReport(options)','  async function publishReport');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){for(let n=0;n<5;n++)await tick();}
const model=allYears=>({meta:{allYears,years:allYears?[2021,2026]:[2026],correctionScenario:'corrected',linkedControlRows:0},summary:{claimed:allYears?100:10,recordCount:0,reviewCount:0},suppliers:[],controlReport:{supplierOptions:[]}});
const payload=allYears=>({model:model(allYears),files:{bd:'Synthetic BD.xlsx',control:'Synthetic Control.xlsx'},revision:allYears?'history':'current',updatedAt:'2026-11-06T12:00:00Z',updatedBy:'Test'});
function fixture({local=false,initialModel=model(false),pausePaint=false,respectAbort=false,renderError=false}={}){
 const elements=new Map(),renders=[],requests=[],errors=[],messages=[],calculations=[],scrolls=[],timers=new Map(),paint=deferred();let paintCount=0,timerId=0,clears=0;
 const node=id=>{if(!elements.has(id))elements.set(id,{id,hidden:false,disabled:false,isConnected:true,open:false,value:'',dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},closest(){return this;},close(){this.open=false;}});return elements.get(id);};
 const years=[{value:'2025',checked:false},{value:'2026',checked:true}],views=['overview','suppliers','procurement','claims','installments'].map(name=>node('view-'+name)),nav=views.map(el=>Object.assign(node('nav-'+el.id),{dataset:{view:el.id.slice(5)}}));
 const controls=[node('supplierFilter'),node('operationFilter'),node('applyFilters'),node('correctionOriginalToggle')];controls[3].disabled=true;
 node('asOf').value='2026-11-06';node('correctionScenario').value='corrected';
 const state={view:'overview',model:initialModel,bd:local?[[]]:null,control:local?[[]]:null,operation:'',controlOperation:'',demo:false};
 const context={state,queueMicrotask,AbortController,URLSearchParams,CustomEvent:class{},console,
  document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},querySelector:node,querySelectorAll(selector){if(selector==='input[name="year"]:checked')return years.filter(y=>y.checked);if(selector==='[id^="view-"]')return views;if(selector==='[data-view]')return nav;if(selector.includes('.filters-panel input'))return [...controls,...(selector.includes('.main-nav')?nav:[])];return [];},dispatchEvent(){}},
  window:{scrollTo(options){scrolls.push({...options});}},global:{setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}},$:node,F:{clear(){clears++;}},captureOperation(){},populateOperations(){},setText(){},populateSuppliers(){},say(){},notice(message){errors.push(message);},integer:String,
  nextPaint:()=>pausePaint&&paintCount++===0?paint.promise:Promise.resolve(),openImports(){throw Error('Unexpected import prompt');},
  E:{analyze(_bd,_control,options){calculations.push({...options});return model(options.allYears===true);}},
  render(){if(renderError)throw Error('Synthetic render failure');renders.push({view:state.view,allYears:state.model.meta.allYears,claimed:state.model.summary.claimed});},
  session:{approved:true},reportController:null,loadVersion:0,loadingReport:false,publishedMeta:null,refreshControls(){},setMessage(message,error){messages.push({message,error:Boolean(error)});},showEmptyReport(){},canUpdateBases:()=>true,
  api(url,options){const job=deferred();requests.push({url,options,...job});if(respectAbort)options.signal.addEventListener('abort',()=>job.reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true});return job.promise;},reportQuery:require('../dist/team.js').reportQuery};
 vm.createContext(context);vm.runInContext(appCode,context,{filename:'app-orchestration-from-production.js'});
 context.app={state,getOptions:context.options,setPublishedReport:context.setPublishedReport};
 vm.runInContext(teamCode,context,{filename:'team-loader-from-production.js'});if(!local)state.serverLoader=context.loadReport;
 return {context,state,years,nav,controls,node,requests,renders,errors,messages,calculations,paint,scrolls,timers,get clears(){return clears;},expireLatest(){const timer=[...timers.values()].at(-1);assert.equal(timer.delay,30000);timer.fn();}};
}

test('late supplier server response never replaces current-year overview after a rapid return',async()=>{
 const f=fixture();f.context.view('suppliers');assert.equal(f.requests.length,1);assert.equal(f.state.analysisBusy,true);assert(f.nav.every(button=>!button.disabled));assert(f.controls.every(control=>control.disabled));
 f.context.view('overview');assert.equal(f.requests.length,2,'New scope starts without waiting for the old response');assert.equal(f.requests[0].options.signal.aborted,true);f.requests[0].resolve(payload(true));await flush();
 assert.equal(f.state.model.meta.allYears,false);assert.equal(f.renders.length,0,'Rejected historical model is never rendered');assert.equal(f.state.analysisBusy,true,'Old finally cannot unlock the newer analysis');assert(f.controls.every(control=>control.disabled));
 assert.equal(new URLSearchParams(f.requests[1].url.split('?')[1]).has('allYears'),false);
 f.requests[1].resolve(payload(false));await flush();
 assert.deepEqual(f.renders,[{view:'overview',allYears:false,claimed:10}]);assert.equal(f.state.analysisBusy,false);assert(f.nav.every(button=>!button.disabled));assert.deepEqual(f.controls.map(control=>control.disabled),[false,false,false,true]);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);assert.deepEqual(f.errors,[]);assert.equal(f.timers.size,0);
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
 assert.equal(f.requests.length,4);assert(f.requests.slice(0,3).every(request=>request.options.signal.aborted));
 f.requests[3].resolve(payload(false));await flush();assert.deepEqual(f.renders,[{view:'claims',allYears:false,claimed:10}]);
 for(const i of [2,0,1])f.requests[i].resolve(payload(i%2===0));await flush();assert.equal(f.renders.length,1);assert.equal(f.requests.length,4);assert.equal(f.state.analysisBusy,false);
 f.context.view('suppliers');f.requests[4].resolve(payload(true));await flush();assert.deepEqual(f.renders.at(-1),{view:'suppliers',allYears:true,claimed:100});assert.equal(f.state.scopeRefreshPending,false);assert.deepEqual(f.errors,[]);assert.equal(f.timers.size,0);
});

test('clicking the current tab returns to the top without another fetch or cleared filters',async()=>{
 const f=fixture();f.node('supplierFilter').value='Fornecedor exemplo';f.state.chartMonth='2026-03';f.context.view('overview');f.context.view('overview');
 assert.equal(f.requests.length,0);assert.equal(f.scrolls.length,2);assert(f.scrolls.every(options=>options.top===0&&options.left===0));assert.equal(f.node('supplierFilter').value,'Fornecedor exemplo');assert.equal(f.state.chartMonth,'2026-03');assert.equal(f.clears,0);
 f.context.view('suppliers');f.context.view('suppliers');assert.equal(f.requests.length,1);assert.equal(f.scrolls.length,4);f.requests[0].resolve(payload(true));await flush();assert.equal(f.clears,0);
});

test('abort on navigation stays silent and only the latest request releases controls',async()=>{
 const f=fixture({respectAbort:true});f.context.view('suppliers');f.context.view('overview');await flush();
 assert.equal(f.state.analysisBusy,true);assert(f.nav.every(button=>!button.disabled));assert(f.controls.every(control=>control.disabled));assert.equal(f.messages.length,0);
 f.requests[1].resolve(payload(false));await flush();assert.equal(f.state.analysisBusy,false);assert.equal(f.messages.filter(message=>message.error).length,0);assert.equal(f.timers.size,0);
});

test('report timeout releases controls and permits a clean retry without changing filters',async()=>{
 const f=fixture({respectAbort:true});f.node('supplierFilter').value='Fornecedor exemplo';f.context.view('suppliers');f.expireLatest();await flush();
 assert.equal(f.state.analysisBusy,false);assert.equal(f.context.loadingReport,false);assert.equal(f.context.reportController,null);assert(f.nav.every(button=>!button.disabled));assert.deepEqual(f.controls.map(control=>control.disabled),[false,false,false,true]);assert.match(f.messages.at(-1).message,/30 segundos/);assert.equal(f.messages.at(-1).error,true);assert.equal(f.node('supplierFilter').value,'Fornecedor exemplo');assert.equal(f.timers.size,0);
 f.context.view('suppliers');assert.equal(f.requests.length,2);f.requests[1].resolve(payload(true));await flush();assert.equal(f.renders.length,1);assert.equal(f.state.analysisBusy,false);
});

test('server render failure and a rejected loader both release controls',async()=>{
 const f=fixture({renderError:true});f.context.view('suppliers');f.requests[0].resolve(payload(true));await flush();assert.equal(f.state.analysisBusy,false);assert.match(f.messages.at(-1).message,/Synthetic render failure/);assert(f.nav.every(button=>!button.disabled));assert.equal(f.timers.size,0);
 const g=fixture();g.state.serverLoader=async()=>{throw Error('Synthetic loader failure');};await g.context.analyze();assert.equal(g.state.analysisBusy,false);assert.match(g.errors[0],/Synthetic loader failure/);assert.deepEqual(g.controls.map(control=>control.disabled),[false,false,false,true]);
});

test('local navigation coalesces to the final scope and releases controls after rendering fails',async()=>{
 const f=fixture({local:true,pausePaint:true,renderError:true}),first=f.context.analyze();f.context.view('suppliers');f.context.view('overview');f.paint.resolve();await first;await flush();
 assert.equal(f.calculations.length,1);assert.equal(f.state.analysisBusy,false);assert.equal(f.state.scopeRefreshPending,false);assert.match(f.errors[0],/Synthetic render failure/);assert(f.nav.every(button=>!button.disabled));assert.equal(f.node('loadingOverlay').hidden,true);
});

test('historical values remain hidden after timeout and appear only after a matching retry succeeds',async()=>{
 const f=fixture({initialModel:model(true),respectAbort:true});f.state.view='suppliers';f.node('supplierFilter').value='Fornecedor exemplo';const claimRenders=[];f.context.window.MinervaExecutive={renderClaims(value){claimRenders.push(value);}};
 f.context.view('claims');assert.equal(f.node('view-claims').hidden,true);assert.equal(f.node('viewScopeNotice').hidden,false);assert.equal(f.node('viewScopeRetry').disabled,true);assert.equal(claimRenders.length,0);assert.equal(f.node('exportReport').disabled,true);
 f.expireLatest();await flush();assert.equal(f.state.model.meta.allYears,true);assert.equal(f.node('view-claims').hidden,true);assert.equal(f.node('viewScopeRetry').disabled,false);assert.match(f.node('viewScopeTitle').textContent,/Não foi possível/);assert.equal(f.node('exportPdf').disabled,true);
 const retry=f.context.analyze();assert.equal(f.node('view-claims').hidden,true);f.requests[1].resolve(payload(false));await retry;await flush();assert.equal(f.state.model.meta.allYears,false);assert.equal(f.node('view-claims').hidden,false);assert.equal(f.node('viewScopeNotice').hidden,true);assert.equal(f.node('exportReport').disabled,false);assert.equal(f.node('exportPdf').disabled,false);assert.equal(f.node('supplierFilter').value,'Fornecedor exemplo');
});

test('returning to suppliers after a failed scope change reveals the retained matching model',async()=>{
 const f=fixture({initialModel:model(true),respectAbort:true});f.state.view='suppliers';f.context.view('claims');f.expireLatest();await flush();f.context.view('suppliers');
 assert.equal(f.requests.length,1);assert.equal(f.node('view-suppliers').hidden,false);assert.equal(f.node('view-claims').hidden,true);assert.equal(f.node('viewScopeNotice').hidden,true);assert.equal(f.node('exportReport').disabled,false);assert.equal(f.state.model.meta.allYears,true);assert(f.nav.every(button=>!button.disabled));
});

test('initial empty state remains usable, but a failed first load has a visible retry and disabled exports',async()=>{
 const f=fixture({initialModel:null,respectAbort:true});f.context.refreshViewScope();assert.equal(f.node('view-overview').hidden,false);assert.equal(f.node('viewScopeNotice').hidden,true);assert.equal(f.node('exportReport').disabled,true);
 const first=f.context.analyze();assert.equal(f.node('view-overview').hidden,true);f.expireLatest();await first;await flush();assert.equal(f.node('viewScopeNotice').hidden,false);assert.equal(f.node('viewScopeRetry').disabled,false);assert.equal(f.node('exportReport').disabled,true);
 const retry=f.context.analyze();f.requests[1].resolve(payload(false));await retry;assert.equal(f.node('view-overview').hidden,false);assert.equal(f.node('viewScopeNotice').hidden,true);assert.equal(f.node('exportReport').disabled,false);
});

test('render failure cannot reveal partially updated values and year mismatch cannot be exported',async()=>{
 const f=fixture({initialModel:model(true),renderError:true});f.state.view='suppliers';f.context.view('claims');f.requests[0].resolve(payload(false));await flush();assert.equal(f.node('view-claims').hidden,true);assert.equal(f.node('exportReport').disabled,true);assert.equal(f.node('viewScopeNotice').hidden,false);
 const g=fixture();g.years[0].checked=true;g.years[1].checked=false;g.context.refreshViewScope();assert.equal(g.node('view-overview').hidden,true);assert.equal(g.node('exportPdf').disabled,true);
 const workbook=between(appSource,'  function makeWorkbook(','  function exportBook(');vm.runInContext(workbook,g.context);assert.throws(()=>g.context.makeWorkbook(),/Atualize o período/);
});

test('scope notice is outside global filters and its retry button invokes analysis',()=>{
 const {createDOM}=require('./dom-fixture.cjs'),dom=createDOM(),main=dom.element('main'),globalFilters=dom.element('div',{id:'globalFilterBlock'},main),receipt=dom.element('nav',{id:'receiptViews'},main),claims=dom.element('section',{id:'view-claims'},main),exports=dom.element('button',{id:'exportReport'},main);let retries=0;
 const context={state:{view:'claims',model:model(true)},document:dom.document,$:id=>dom.document.getElementById(id),analyze(){retries++;}};vm.createContext(context);vm.runInContext(between(appSource,'  function viewScopeMatches','  const currentScenario'),context);context.refreshViewScope();
 const banner=dom.document.getElementById('viewScopeNotice'),retry=dom.document.getElementById('viewScopeRetry');assert.equal(banner.parentElement,main);assert.equal(globalFilters.contains(banner),false);assert.equal(main.children.indexOf(banner)+1,main.children.indexOf(receipt));assert.equal(claims.hidden,true);assert.equal(exports.disabled,true);retry.click();assert.equal(retries,1);
});
