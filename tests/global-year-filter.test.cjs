'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),multi=fs.readFileSync(require.resolve('../dist/multi-select.js'),'utf8'),html=fs.readFileSync(require.resolve('../dist/index.html'),'utf8');
const section=(start,end)=>app.slice(app.indexOf(start),app.indexOf(end,app.indexOf(start)+start.length));
const plain=value=>JSON.parse(JSON.stringify(value));
class Event{constructor(type,options={}){this.type=type;Object.assign(this,options)}preventDefault(){}}
function fixture(){
 const h=createDOM(),field=h.element('fieldset',{class:'year-selector'}),select=h.element('select',{id:'globalYearFilter',multiple:'','data-multi-select':'','data-filter-title':'Ano do claim e do recebimento','data-placeholder':'Todos os anos','data-apply-target':'#applyFilters'},field),apply=h.element('button',{id:'applyFilters'});select.multiple=true;
 Object.defineProperty(select,'innerHTML',{get(){return this._html||'';},set(value){this._html=value;this.replaceChildren();for(const match of value.matchAll(/<option value="([^"]*)"([^>]*)>([^<]*)<\/option>/g)){const option=h.element('option',{text:match[3]},this);option.value=match[1];option.selected=/\bselected\b/.test(match[2]);}}});
 select.innerHTML='<option value="2026" selected>2026</option>';select.add=option=>select.append(option);
 const state={view:'overview',model:{meta:{years:[2026],availableYears:[1999,2018,2020,2023,2025,2026,2027],caseYears:[2018,2020,2023,2025,2026]}}},context={window:h.window,document:h.document,state,Event,CustomEvent:Event,$:id=>h.document.getElementById(id),asList:v=>(Array.isArray(v)?v:v?[v]:[]).map(String),selectValues:el=>h.window.MinervaMultiSelect.values(el),setSelected:(el,values)=>h.window.MinervaMultiSelect.setValues(el,values)};
 context.Option=function(label,value){const option=h.document.createElement('option');option.textContent=label;option.value=value;return option;};
 vm.createContext(context);vm.runInContext(multi,context);vm.runInContext(section('  function cleanYears','  function sameYearScope'),context);
 const applied=[];apply.addEventListener('click',()=>applied.push(plain(context.requestedYearScope())));
 return {...h,context,state,select,applied,api:h.window.MinervaMultiSelect,open(){h.document.querySelector('.multi-select-button').click();return h.document.querySelector('.multi-select-popover');}};
}
test('global year dropdown exposes every source year on the first restricted report',()=>{
 const f=fixture();f.context.populateGlobalYears();f.api.refresh();
 assert.deepEqual(f.select.options.filter(o=>o.value).map(o=>Number(o.value)),[2027,2026,2025,2023,2020,2018,1999]);
 assert.deepEqual(plain(f.context.globalYears()),[2026]);
 assert.match(html,/<select id="globalYearFilter"[^>]*multiple[^>]*data-multi-select[^>]*data-apply-target="#applyFilters"/);
 assert(!/<input[^>]*name="year"[^>]*value="202[56]"/.test(html));
});
test('year search preserves manual choices; bulk acts on the search; Limpar restores all years',()=>{
 const f=fixture();f.context.populateGlobalYears();f.api.refresh();const popup=f.open(),search=popup.querySelector('.multi-select-search'),toggle=popup.querySelector('[data-multi-action="toggle"]');
 toggle.click();assert.equal(toggle.textContent,'Limpar');toggle.click();assert.deepEqual(plain(f.context.globalYears()),[]);
 for(const year of ['2018','2020']){search.value=year;search.dispatchEvent(new Event('input'));const box=popup.querySelector('input[data-multi-value]');assert.equal(box.value,year);box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));}
 assert.deepEqual(plain(f.context.globalYears()),[2018,2020]);assert.equal(f.applied.length,0);
 popup.querySelector('.multi-select-footer').children[1].click();assert.deepEqual(f.applied,[{years:[2018,2020],allYears:false}]);
 f.open();search.value='1999';search.dispatchEvent(new Event('input'));toggle.click();assert.deepEqual(plain(f.context.globalYears()),[1999]);assert.equal(toggle.textContent,'Limpar');toggle.click();assert.equal(search.value,'');popup.querySelector('.multi-select-footer').children[1].click();assert.deepEqual(f.applied.at(-1),{years:[],allYears:true});
});
test('new source years refresh without silently changing selected historical years',()=>{
 const f=fixture();f.context.populateGlobalYears();f.context.setGlobalYears([2018,2020]);f.context.populateGlobalYears({meta:{availableYears:[2026,2028]}});
 assert.deepEqual(f.select.options.filter(o=>o.value).map(o=>Number(o.value)),[2028,2026,2020,2018]);assert.deepEqual(plain(f.context.globalYears()),[2018,2020]);
 f.context.setGlobalYears([]);f.context.populateGlobalYears({meta:{availableYears:[2026,2028]}});assert.deepEqual(f.select.options.filter(o=>o.value).map(o=>Number(o.value)),[2028,2026]);assert.deepEqual(plain(f.context.requestedYearScope()),{years:[],allYears:true});
 f.context.setGlobalYears([2018]);f.context.populateGlobalYears({meta:{availableYears:[2026,2028]}});assert.deepEqual(plain(f.context.globalYears()),[2018],'An older tab draft remains explicit when another tab has refreshed the base');
});

test('month dropdown searches and accumulates selections across searches, applies internally and marks or clears all dynamically',()=>{
 const f=fixture(),field=f.element('label',{id:'globalMonthField'}),select=f.element('select',{id:'globalMonthFilter',multiple:'','data-multi-select':'','data-filter-title':'Mês','data-placeholder':'Todos os meses','data-apply-target':'#applyFilters'},field);select.multiple=true;
 const monthNames=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
 for(const [index,name] of monthNames.entries()){const option=f.element('option',{text:name},select);option.value=String(index+1);option.selected=false;}
 f.api.refresh();let applied;f.document.getElementById('applyFilters').addEventListener('click',()=>applied=plain(f.context.globalMonths()));field.querySelector('.multi-select-button').click();
 const popup=f.document.querySelector('.multi-select-popover'),search=popup.querySelector('.multi-select-search'),toggle=popup.querySelector('[data-multi-action="toggle"]');
 assert.deepEqual(plain(f.context.globalMonths()),[]);
 for(const query of ['fev','nov']){search.value=query;search.dispatchEvent(new Event('input'));const box=popup.querySelector('input[data-multi-value]');box.checked=true;box.dispatchEvent(new Event('change',{bubbles:true}));}
 assert.deepEqual(plain(f.context.globalMonths()),[2,11]);popup.querySelector('.multi-select-footer').children[1].click();assert.deepEqual(applied,[2,11]);
 field.querySelector('.multi-select-button').click();toggle.click();assert.deepEqual(plain(f.context.globalMonths()),[]);assert.equal(toggle.textContent,'Limpar');toggle.click();assert.deepEqual(plain(f.context.globalMonths()),[]);
 assert.match(html,/<select id="globalMonthFilter"[^>]*multiple[^>]*data-multi-select[^>]*data-apply-target="#applyFilters"/);assert.match(html,/id="clearAnalysisFilters"[^>]*aria-label="Limpar filtros desta aba"/);
});
