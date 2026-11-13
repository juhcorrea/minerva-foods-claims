'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../dist/multi-select.js'),'utf8');
class ChangeEvent{constructor(type,options={}){this.type=type;Object.assign(this,options)}preventDefault(){this.defaultPrevented=true}}
function harness(){const h=createDOM(),parent=h.element('label'),select=h.element('select',{id:'operations',multiple:'','data-multi-select':'','data-filter-title':'Operação','data-placeholder':'Todas as operações'},parent);function option(value,label,selected=false,disabled=false){const el=h.element('option',{text:label},select);el.value=value;el.selected=selected;el.disabled=disabled;return el;}option('','Todas',true);option('A','Operação Alfa');option('B','Operação Béta');option('C','Operação Gama',false,true);const single=h.element('select',{id:'scenario'});vm.runInNewContext(source,{window:h.window,document:h.document,Event:ChangeEvent,CustomEvent:ChangeEvent});const button=h.document.querySelector('.multi-select-button');return {...h,select,single,option,button,api:h.window.MinervaMultiSelect,open(){button.dispatchEvent({type:'click'});return h.document.querySelector('.multi-select-popover')},press(node){node.dispatchEvent({type:'click'})}};}
const apply=popup=>popup.querySelector('[data-multi-action="apply"]');
const toggle=popup=>popup.querySelector('[data-multi-action="toggle"]');
const search=(popup,value)=>{const input=popup.querySelector('.multi-select-search');input.value=value;input.dispatchEvent({type:'input'});};
const check=(h,popup,value,checked=true)=>{const input=popup.querySelectorAll('input[data-multi-value]').find(node=>node.value===value);assert(input);input.checked=checked;input.dispatchEvent(new ChangeEvent('change',{bubbles:true}));};

test('only marked multiple selects become compact dropdowns and native selectedOptions remains the source',()=>{
 const h=harness();assert(h.select.classList.contains('multi-select-native'));assert(!h.single.classList.contains('multi-select-native'));assert.equal(h.document.querySelectorAll('.multi-select-button').length,1);assert.equal(h.button.textContent,'Todas as operações⌄');let changes=0;h.select.addEventListener('change',()=>changes++);h.api.setValues('operations',['A','B']);assert.deepEqual(Array.from(h.api.values(h.select)),['A','B']);assert.equal(changes,0);h.select.options.find(o=>o.value==='A').selected=false;h.select.dispatchEvent(new ChangeEvent('change',{bubbles:true}));assert.equal(h.button.textContent,'Operação Béta⌄');
});

test('popup is search first, a compact checklist and exactly two footer actions',()=>{
 const h=harness(),popup=h.open();assert.equal(popup.children[0].className,'multi-select-search');assert.equal(popup.querySelectorAll('button').length,2);assert.equal(popup.querySelector('.multi-select-heading'),null);assert.equal(popup.querySelector('.multi-select-close'),null);assert.equal(popup.style.width,'220px');assert.equal(toggle(popup).textContent,'Marcar todos');assert.equal(apply(popup).textContent,'Aplicar');assert.equal(popup.getAttribute('aria-label'),'Operação');
});

test('search is accent insensitive and manual edits preserve checkbox focus with native change',()=>{
 const h=harness(),popup=h.open();search(popup,'beta');const checks=popup.querySelectorAll('input[data-multi-value]');assert.equal(checks.length,1);assert.equal(checks[0].value,'B');let changes=0;h.select.addEventListener('change',()=>changes++);checks[0].focus();check(h,popup,'B');assert.deepEqual(Array.from(h.api.values(h.select)),['B']);assert.equal(changes,1);assert.equal(h.document.activeElement,checks[0]);assert.equal(popup.querySelector('input[data-multi-value]'),checks[0]);
});

test('Marcar todos selects enabled options; Limpar resets search and selection without unsafe label HTML',()=>{
 const h=harness();h.option('D','<img src=x>');const popup=h.open();h.press(toggle(popup));assert.deepEqual(Array.from(h.api.values(h.select)),['A','B','D']);assert.equal(popup.querySelectorAll('img').length,0);assert.equal(toggle(popup).textContent,'Limpar');h.press(toggle(popup));assert.deepEqual(Array.from(h.api.values(h.select)),[]);assert.equal(popup.querySelector('.multi-select-search').value,'');assert.equal(h.button.textContent,'Todas as operações⌄');assert.equal(apply(popup).disabled,false);
});

test('Escape and outside pointer close, searches reset on reopen, and dynamic options stay independent',()=>{
 const h=harness(),popup=h.open();search(popup,'alfa');h.document.dispatchEvent({type:'keydown',key:'Escape',preventDefault(){}});assert(popup.hidden);assert.equal(h.document.activeElement,h.button);h.open();assert.equal(popup.querySelector('.multi-select-search').value,'');h.document.dispatchEvent({type:'pointerdown',target:h.document.body});assert(popup.hidden);h.option('D','Delta',true);h.api.refresh();assert.equal(h.button.textContent,'Delta⌄');h.select.remove();const next=h.element('select',{id:'operations',multiple:'','data-multi-select':''});const o=h.element('option',{text:'Novo'},next);o.value='NEW';o.selected=true;h.api.refresh();assert.equal(h.document.querySelectorAll('.multi-select-button').length,1);assert.deepEqual(Array.from(h.api.values('operations')),['NEW']);assert(!popup.isConnected);
});

test('dropdown arrows navigate checkboxes and disabled filters cannot open',()=>{
 const h=harness(),popup=h.open(),checks=popup.querySelectorAll('input[data-multi-value]');checks[0].focus();popup.dispatchEvent({type:'keydown',key:'ArrowDown',target:checks[0],preventDefault(){}});assert.equal(h.document.activeElement,checks[1]);h.api.close();h.select.disabled=true;h.api.refresh();assert(h.button.disabled);h.press(h.button);assert(popup.hidden);
});

test('Apply closes first then clicks the configured target once without another change or form submit',()=>{
 const h=harness(),target=h.element('button',{id:'applyFilters'}),form=h.element('form');form.append(h.select.parentElement);h.select.dataset.applyTarget='#applyFilters';let clicks=0,submits=0,changes=0;form.requestSubmit=()=>submits++;h.select.addEventListener('change',()=>changes++);h.api.setValues(h.select,['A','B']);const popup=h.open();target.addEventListener('click',()=>{assert(popup.hidden);clicks++});h.press(apply(popup));assert.equal(clicks,1);assert.equal(submits,0);assert.equal(changes,0);assert.deepEqual(Array.from(h.api.values(h.select)),['A','B']);
});

test('Apply submits the closest form or emits one extension event when no form exists',()=>{
 const h=harness(),form=h.element('form');form.append(h.select.parentElement);let submits=0,events=0;form.requestSubmit=()=>{assert(h.document.querySelector('.multi-select-popover').hidden);submits++};h.document.addEventListener('minerva:filter-apply',event=>{assert.equal(event.detail.selectId,'operations');events++});let popup=h.open();h.press(apply(popup));assert.equal(submits,1);assert.equal(events,0);h.document.body.append(h.select.parentElement);popup=h.open();h.press(apply(popup));assert.equal(submits,1);assert.equal(events,1);
});

test('Apply directly after search replaces an initial all-selection with matching results only',()=>{
 const h=harness();h.api.setValues(h.select,['A','B']);const popup=h.open();let events=0;h.document.addEventListener('minerva:filter-apply',()=>events++);search(popup,'beta');assert.deepEqual(Array.from(h.api.values(h.select)),['A','B'],'search itself is just display');h.press(apply(popup));assert.deepEqual(Array.from(h.api.values(h.select)),['B']);assert.equal(events,1);
});

test('Marcar todos during search replaces the selection; Limpar removes query and the filter',()=>{
 const h=harness();h.api.setValues(h.select,['A','B']);const popup=h.open();search(popup,'alfa');assert.equal(toggle(popup).textContent,'Marcar todos');h.press(toggle(popup));assert.deepEqual(Array.from(h.api.values(h.select)),['A']);assert.equal(toggle(popup).textContent,'Limpar');h.press(toggle(popup));assert.equal(popup.querySelector('.multi-select-search').value,'');assert.deepEqual(Array.from(h.api.values(h.select)),[]);h.press(apply(popup));assert(popup.hidden);
});

test('manual choices across searches survive Apply, while zero results never apply all accidentally',()=>{
 const h=harness(),popup=h.open();search(popup,'alfa');check(h,popup,'A');search(popup,'beta');check(h,popup,'B');search(popup,'alfa');h.press(apply(popup));assert.deepEqual(Array.from(h.api.values(h.select)),['A','B']);const again=h.open();search(again,'absent');assert.equal(apply(again).disabled,true);assert.equal(toggle(again).disabled,true);h.press(apply(again));assert.equal(again.hidden,false);assert.deepEqual(Array.from(h.api.values(h.select)),['A','B']);
});

test('manual zero-selection cannot accidentally become Todos, but explicit Limpar can reset',()=>{
 const h=harness(),popup=h.open();check(h,popup,'A');check(h,popup,'A',false);assert.equal(apply(popup).disabled,true);h.press(apply(popup));assert.equal(popup.hidden,false);h.press(toggle(popup));assert.equal(toggle(popup).textContent,'Limpar');h.press(toggle(popup));assert.equal(apply(popup).disabled,false);h.press(apply(popup));assert(popup.hidden);
});

test('editing an initially-all search drops outside choices before applying manual selections',()=>{
 const h=harness();h.option('D','Operação Alfa 2');h.api.setValues(h.select,['A','B','D']);const popup=h.open();search(popup,'alfa');check(h,popup,'A',false);h.press(apply(popup));assert.deepEqual(Array.from(h.api.values(h.select)),['D']);
});
