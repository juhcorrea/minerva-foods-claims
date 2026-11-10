'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const appSource=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),teamSource=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const between=(source,start,end)=>{const at=source.indexOf(start),until=source.indexOf(end,at+start.length);assert(at>=0&&until>at,`Source boundary ${start}`);return source.slice(at,until);};
// Execute the production orchestration functions. Only DOM, network and the
// synchronous financial calculation are replaced; no scope decision is copied.
const appCode=[between(appSource,'  const applied=','  const $ ='),between(appSource,'  function view(name)','  const currentScenario'),between(appSource,'  function options(','  async function readFile'),between(appSource,'  function acceptScenarioModel','  function populateSuppliers'),between(appSource,'  function setPublishedReport','  window.MinervaApp')].join('\n');
const teamCode=between(teamSource,'  async function loadReport(options)','  async function publishReport');
const deferred=()=>{let resolve,reject;const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function flush(){for(let n=0;n<5;n++)await tick();}
const model=(allYears,years=[2026])=>({meta:{asOf:'2026-11-06',allYears,years:allYears?[2021,2026]:years,correctionScenario:'corrected',linkedControlRows:0},summary:{claimed:allYears?100:10,recordCount:0,reviewCount:0},suppliers:[],controlReport:{supplierOptions:[]}});
const payload=(allYears,years)=>({model:model(allYears,years),files:{bd:'Synthetic BD.xlsx',control:'Synthetic Control.xlsx'},revision:allYears?'history':'current',updatedAt:'2026-11-06T12:00:00Z',updatedBy:'Test'});
function fixture({local=false,initialModel=model(false),pausePaint=false,respectAbort=false,renderError=false}={}){
 const elements=new Map(),renders=[],requests=[],errors=[],messages=[],calculations=[],scrolls=[],timers=new Map(),paint=deferred();let paintCount=0,timerId=0,clears=0;
 const node=id=>{if(!elements.has(id)){const el={id,hidden:false,disabled:false,isConnected:true,open:false,options:[],add(option){this.options.push(option);},dataset:{},classList:{toggle(){}},setAttribute(){},removeAttribute(){},toggleAttribute(){},closest(){return this;},close(){this.open=false;}};Object.defineProperty(el,'value',{get(){return this.options.length?this.options.find(option=>option.selected)?.value||'':this._value||'';},set(value){this._value=value;if(['supplierFilter','operationFilter'].includes(id)&&!this.options.some(option=>option.value===value))this.options.push({value});for(const option of this.options)option.selected=option.value===value;}});elements.set(id,el);}return elements.get(id);};
 const years=[{value:'2025',checked:false},{value:'2026',checked:true}],views=['overview','suppliers','procurement','claims','installments'].map(name=>node('view-'+name)),nav=views.map(el=>Object.assign(node('nav-'+el.id),{dataset:{view:el.id.slice(5)}}));
 const controls=[node('supplierFilter'),node('operationFilter'),node('applyFilters'),node('correctionOriginalToggle')];controls[3].disabled=true;
 node('asOf').value='2026-11-06';node('correctionScenario').value='corrected';
 const state={view:'overview',model:initialModel,bd:local?[[]]:null,control:local?[[]]:null,operation:'',controlOperation:'',demo:false};
 const context={state,Option:function(label,value){this.text=label;this.value=value;this.selected=false;},queueMicrotask,AbortController,URLSearchParams,CustomEvent:class{},console,
  document:{getElementById:node,body:{dataset:{},classList:{toggle(){}}},querySelector:node,querySelectorAll(selector){if(selector==='input[name="year"]')return years;if(selector==='input[name="year"]:checked')return years.filter(y=>y.checked);if(selector==='[id^="view-"]')return views;if(selector==='[data-view]')return nav;if(selector.includes('.filters-panel input'))return [...controls,...(selector.includes('.main-nav')?nav:[])];return [];},dispatchEvent(){}},
  window:{scrollTo(options){scrolls.push({...options});}},global:{setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);}},$:node,F:{clear(){clears++;}},captureOperation(){},populateOperations(){},setText(){},populateSuppliers(){},say(){},notice(message){errors.push(message);},integer:String,
  nextPaint:()=>pausePaint&&paintCount++===0?paint.promise:Promise.resolve(),openImports(){throw Error('Unexpected import prompt');},
  E:{analyze(_bd,_control,options){calculations.push({...options});return {...model(options.allYears===true,options.years),meta:{...model(options.allYears===true,options.years).meta,...options}};}},
  renderViewBody(){},render(){if(renderError)throw Error('Synthetic render failure');renders.push({view:state.view,allYears:state.model.meta.allYears,claimed:state.model.summary.claimed});},
  session:{approved:true},reportCache:require('../dist/team.js').createReportCache(),reportController:null,loadVersion:0,loadingReport:false,publishedMeta:null,refreshControls(){},setMessage(message,error){messages.push({message,error:Boolean(error)});},showEmptyReport(){},canUpdateBases:()=>true,
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
 assert.equal(f.state.analysisBusy,false);assert.equal(f.context.loadingReport,false);assert.equal(f.context.reportController,null);assert(f.nav.every(button=>!button.disabled));assert.deepEqual(f.controls.map(control=>control.disabled),[false,false,false,true]);assert.match(f.messages.at(-1).message,/30 segundos/);assert.equal(f.messages.at(-1).error,true);assert.equal(f.node('supplierFilter').value,'');assert.deepEqual(Array.from(f.state.viewFilters.overview.draft.suppliers),['Fornecedor exemplo']);assert.equal(f.timers.size,0);
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
 const retry=f.context.analyze();assert.equal(f.node('view-claims').hidden,true);f.requests[1].resolve(payload(false));await retry;await flush();assert.equal(f.state.model.meta.allYears,false);assert.equal(f.node('view-claims').hidden,false);assert.equal(f.node('viewScopeNotice').hidden,true);assert.equal(f.node('exportReport').disabled,false);assert.equal(f.node('exportPdf').disabled,false);assert.equal(f.node('supplierFilter').value,'','Claims does not inherit the supplier tab draft');
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
 const workbook=between(appSource,'  function makeWorkbook(','  async function exportBook(');vm.runInContext(workbook,g.context);assert.throws(()=>g.context.makeWorkbook(),/Atualize o período/);
});

test('scope notice is outside global filters and its retry button invokes analysis',()=>{
 const {createDOM}=require('./dom-fixture.cjs'),dom=createDOM(),main=dom.element('main'),globalFilters=dom.element('div',{id:'globalFilterBlock'},main),receipt=dom.element('nav',{id:'receiptViews'},main),claims=dom.element('section',{id:'view-claims'},main),exports=dom.element('button',{id:'exportReport'},main);let retries=0;
 const context={state:{view:'claims',model:model(true)},document:dom.document,$:id=>dom.document.getElementById(id),asList:value=>value||[],analyze(){retries++;}};vm.createContext(context);vm.runInContext(between(appSource,'  function cleanYears','  function captureSupplierYears')+between(appSource,'  function viewScopeMatches','  const currentScenario'),context);context.refreshViewScope();
 const banner=dom.document.getElementById('viewScopeNotice'),retry=dom.document.getElementById('viewScopeRetry');assert.equal(banner.parentElement,main);assert.equal(globalFilters.contains(banner),false);assert.equal(main.children.indexOf(banner)+1,main.children.indexOf(receipt));assert.equal(claims.hidden,true);assert.equal(exports.disabled,true);retry.click();assert.equal(retries,1);
});

test('supplier year scope is independent and changing between two restricted scopes reloads the correct years',async()=>{
 const f=fixture();f.state.supplierYears=[2025];f.context.view('suppliers');
 assert.equal(f.requests.length,1);let query=new URLSearchParams(f.requests[0].url.split('?')[1]);assert.equal(query.has('allYears'),false);assert.equal(query.get('years'),'2025');assert.equal(f.node('view-suppliers').hidden,true);
 f.requests[0].resolve(payload(false,[2025]));await flush();assert.equal(f.context.viewScopeMatches(),true);assert.deepEqual(f.years.map(y=>y.checked),[false,true]);
 f.context.view('claims');assert.equal(f.requests.length,2);query=new URLSearchParams(f.requests[1].url.split('?')[1]);assert.equal(query.get('years'),'2026');assert.equal(f.node('view-claims').hidden,true);
 f.requests[1].resolve(payload(false,[2026]));await flush();f.context.view('suppliers');assert.equal(f.requests.length,3);assert.equal(f.requests[2].url,'/api/report/meta');assert.deepEqual(Array.from(f.state.supplierYears),[2025]);
 f.requests[2].resolve({reportMeta:{revision:'new-revision'}});await flush();assert.equal(new URLSearchParams(f.requests[3].url.split('?')[1]).get('years'),'2025');f.requests[3].resolve(payload(false,[2025]));await flush();assert.equal(f.node('view-suppliers').hidden,false);assert.equal(f.node('exportReport').disabled,false);
});

test('same restricted year can reuse the active model while different and multiple supplier years cannot',async()=>{
 const f=fixture();f.state.supplierYears=[2026];f.context.view('suppliers');assert.equal(f.requests.length,0);assert.equal(f.context.viewScopeMatches(),true);
 f.state.supplierYears=[2026,2025,2026];const selected=f.context.options();assert.equal(selected.allYears,false);assert.deepEqual(Array.from(selected.years),[2025,2026]);assert.equal(f.context.viewScopeMatches(),false);
 f.context.view('suppliers');assert.equal(f.requests.length,1);f.requests[0].resolve(payload(false,[2026,2025]));await flush();assert.equal(f.context.viewScopeMatches(),true,'Equal year sets do not depend on response ordering');
 f.state.supplierYears=[];assert.equal(f.context.options().allYears,true);assert.equal(f.context.viewScopeMatches(),false);f.context.view('suppliers');f.requests[1].resolve(payload(true));await flush();assert.equal(f.context.viewScopeMatches(),true);
});

test('a late supplier year response cannot overwrite the last selected year and timeout keeps mismatched values hidden',async()=>{
 const f=fixture({respectAbort:true});f.state.supplierYears=[2025];f.context.view('suppliers');f.state.supplierYears=[2026];const last=f.context.analyze();await flush();assert.equal(f.requests.length,2);assert.equal(f.requests[0].options.signal.aborted,true);
 f.requests[0].resolve(payload(false,[2025]));f.requests[1].resolve(payload(false,[2026]));await last;await flush();assert.deepEqual(f.state.model.meta.years,[2026]);assert.equal(f.context.viewScopeMatches(),true);assert(f.nav.every(button=>!button.disabled));
 f.state.supplierYears=[2025];f.context.analyze();f.expireLatest();await flush();assert.equal(f.node('view-suppliers').hidden,true);assert.equal(f.node('exportReport').disabled,true);assert.deepEqual(f.state.model.meta.years,[2026]);
 const retry=f.context.analyze();f.requests.at(-1).resolve(payload(false,[2025]));await retry;await flush();assert.equal(f.node('view-suppliers').hidden,false);assert.equal(f.node('exportReport').disabled,false);
});

test('supplier year field uses the shared searchable multi-select contract and retains historical options',()=>{
 const {createDOM}=require('./dom-fixture.cjs'),dom=createDOM(),filters=dom.element('section',{class:'filters-panel'}),anchor=dom.element('div',{class:'year-selector'},filters);let selection=[];
 for(const year of [2025,2026]){const input=dom.element('input',{name:'year',value:String(year)},anchor);input.value=String(year);input.checked=year===2026;}
 const state={view:'overview',supplierYears:[2021,2025],model:{meta:{allYears:true,years:[2020,2021,2026]}}},context={state,document:dom.document,$:id=>dom.document.getElementById(id),asList:value=>Array.isArray(value)?value:value?[value]:[],setSelected(_el,values){selection=Array.from(values);},selectValues:()=>['2026','2025']};
 vm.createContext(context);vm.runInContext(between(appSource,'  function cleanYears','  function renderView'),context);context.setupSupplierYears();
 const field=dom.document.getElementById('supplierYearField'),select=dom.document.getElementById('supplierYearFilter');assert.equal(field.hidden,true);assert.equal(select.multiple,true);assert.equal(select.hasAttribute('data-multi-select'),true);assert.equal(select.dataset.applyTarget,'#applyFilters');assert.equal(select.dataset.placeholder,'Todos os anos');assert.deepEqual(selection,[2021,2025]);assert.deepEqual([...select.innerHTML.matchAll(/value="(\d+)"/g)].map(match=>Number(match[1])),[2026,2025,2021,2020]);
 select.dispatchEvent({type:'change'});assert.deepEqual(Array.from(state.supplierYears),[2025,2026]);context.populateSupplierYears({meta:{allYears:false,years:[2026]}});assert(select.innerHTML.includes('value="2020"'));context.setupSupplierYears();assert.equal(filters.querySelectorAll('#supplierYearField').length,1);
});

test('leaving a lean supplier report requests full data even when the selected years match',async()=>{
 const lean=model(false);lean.meta.reportView='suppliers';const f=fixture({initialModel:lean});f.state.view='suppliers';f.state.supplierYears=[2026];f.context.view('claims');assert.equal(f.requests.length,1);assert.equal(new URLSearchParams(f.requests[0].url.split('?')[1]).has('view'),false);assert.equal(f.node('view-claims').hidden,true);assert.equal(f.node('exportReport').disabled,true);
 f.requests[0].resolve(payload(false));await flush();assert.equal(f.node('view-claims').hidden,false);assert.equal(f.node('exportReport').disabled,false);
});

function scopedPayload(request){
 const query=new URLSearchParams(request.url.split('?')[1]),allYears=query.get('allYears')==='1',years=(query.get('years')||'2026').split(',').map(Number),result=payload(allYears,years);
 Object.assign(result.model.meta,{asOf:query.get('asOf')||'2026-11-06',suppliers:query.getAll('supplier'),operations:query.getAll('operation'),controlOperations:query.getAll('controlOperation'),claimStatuses:query.getAll('claimStatus'),correctionScenario:query.get('correctionScenario')||'corrected',reportView:query.get('view')==='suppliers'?'suppliers':'full'});return result;
}

test('navigation isolates every scope field and restores unfinished drafts without applying them',async()=>{
 const f=fixture();f.node('supplierFilter').value='Fornecedor A';f.state.operations=['Operação A'];f.node('asOf').value='2026-10-31';f.node('correctionScenario').value='original';const applied=f.context.analyze();f.requests.at(-1).resolve(scopedPayload(f.requests.at(-1)));await applied;
 f.node('supplierFilter').value='Rascunho B';f.node('asOf').value='2025-12-31';f.node('correctionScenario').value='corrected';f.context.view('claims');
 let request=f.requests.at(-1),query=new URLSearchParams(request.url.split('?')[1]);assert.deepEqual(query.getAll('supplier'),[]);assert.deepEqual(query.getAll('operation'),[]);assert.equal(query.get('asOf'),'2026-11-06');assert.equal(query.get('correctionScenario'),'corrected');assert.equal(f.node('supplierFilter').value,'');request.resolve(scopedPayload(request));await flush();
 f.context.reportCache.clear();f.context.view('overview');request=f.requests.at(-1);query=new URLSearchParams(request.url.split('?')[1]);assert.deepEqual(query.getAll('supplier'),['Fornecedor A']);assert.deepEqual(query.getAll('operation'),['Operação A']);assert.equal(query.get('asOf'),'2026-10-31');assert.equal(query.get('correctionScenario'),'original');assert.equal(f.node('supplierFilter').value,'Rascunho B');assert.equal(f.node('asOf').value,'2025-12-31');request.resolve(scopedPayload(request));await flush();
 assert.equal(f.context.viewScopeMatches(),true);assert.equal(f.node('supplierFilter').value,'Rascunho B');assert.deepEqual(Array.from(f.state.model.meta.suppliers),['Fornecedor A']);assert.equal(f.state.model.meta.asOf,'2026-10-31');assert.equal(f.node('exportReport').disabled,false);
});

test('same-year late responses cannot leak supplier, operation or scenario selections into another tab',async()=>{
 const f=fixture({respectAbort:true});f.node('supplierFilter').value='Fornecedor A';f.state.operations=['Operação A'];f.node('correctionScenario').value='original';const old=f.context.analyze();assert.equal(f.requests.length,1);
 f.context.view('claims');assert.equal(f.requests.length,2);assert.equal(f.requests[0].options.signal.aborted,true);assert.equal(f.node('supplierFilter').value,'');f.requests[0].resolve(scopedPayload(f.requests[0]));f.requests[1].resolve(scopedPayload(f.requests[1]));await old;await flush();
 assert.deepEqual(f.state.model.meta.suppliers,[]);assert.deepEqual(f.state.model.meta.operations,[]);assert.equal(f.state.model.meta.correctionScenario,'corrected');assert.equal(f.context.viewScopeMatches(),true);assert(f.nav.every(button=>!button.disabled));
 f.context.reportCache.clear();f.context.view('overview');assert.equal(f.node('view-overview').hidden,true);f.expireLatest();await flush();assert.equal(f.node('view-overview').hidden,true);assert.equal(f.node('exportReport').disabled,true);assert.equal(f.node('viewScopeRetry').disabled,false);
});

test('supplier situation control is searchable, contains all available BD situations and preserves absent selections',()=>{
 const {createDOM}=require('./dom-fixture.cjs'),dom=createDOM(),filters=dom.element('section'),anchor=dom.element('label',{id:'supplierYearField'},filters),values=['EM ANÁLISE','AGUARDANDO CUSTOS','RESSARCIMENTO ENCAMINHADO'];let selected=[];
 const context={state:{view:'suppliers',claimStatuses:['Situação preservada'],model:{claimStatusOptions:values}},document:dom.document,$:id=>dom.document.getElementById(id),esc:value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;'),selectValues:()=>['EM ANÁLISE'],setSelected:(_el,value)=>selected=Array.from(value)};
 vm.createContext(context);vm.runInContext(between(appSource,'  function populateSupplierStatuses','  function captureSupplierYears'),context);context.setupSupplierStatuses();const select=dom.document.getElementById('supplierStatusFilter');assert(select.multiple);assert(select.hasAttribute('data-multi-select'));assert.equal(select.dataset.applyTarget,'#applyFilters');assert.equal(select.dataset.filterTitle,'Situação do claim');for(const value of values)assert(select.innerHTML.includes(value));assert(select.innerHTML.includes('Situação preservada'));assert.deepEqual(selected,['Situação preservada']);select.dispatchEvent({type:'change'});assert.deepEqual(context.state.claimStatuses,['EM ANÁLISE']);context.setupSupplierStatuses();assert.equal(filters.querySelectorAll('#supplierStatusFilter').length,1);assert.equal(anchor.parentElement,filters);
});
