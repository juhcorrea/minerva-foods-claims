'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(require.resolve('../dist/column-layout.js'),'utf8');
function fixture(){
 const dom=createDOM(),events=new Map(),counts=new Map(),proto=Object.getPrototypeOf(dom.document.body),create=dom.document.createElement;
 Object.defineProperties(proto,{
  previousElementSibling:{get(){const i=this.parentElement?.children.indexOf(this);return i>0?this.parentElement.children[i-1]:null;}},
  tHead:{get(){return this.children.find(child=>child.tagName==='THEAD')||null;}},
  rows:{get(){if(this.tagName==='TABLE'){const count=counts.get(this);if(count)count.rows++;}return this.querySelectorAll('tr');}},
  cells:{get(){return this.children.filter(child=>['TD','TH'].includes(child.tagName));}}
 });
 proto.before=function(node){this.parentElement.insertBefore(node,this);};
 proto.getClientRects=function(){return [{width:300}];};
 const rect=proto.getBoundingClientRect;proto.getBoundingClientRect=function(){const table=this.closest('table');if(counts.has(table))counts.get(table).geometry++;return rect.call(this);};
 dom.document.createElement=tag=>{const el=create(tag);el.style={getPropertyValue(name){return this[name]||'';},setProperty(name,value){this[name]=value;},removeProperty(name){delete this[name];}};if(tag==='canvas')el.getContext=()=>({measureText:text=>({width:text.length*7})});return el;};
 dom.window.addEventListener=(type,fn)=>{if(!events.has(type))events.set(type,[]);events.get(type).push(fn);};
 const makeTable=(id,parent)=>{const table=dom.element('table',{'data-table-id':id},parent),head=dom.element('thead',{},table),hr=dom.element('tr',{},head),body=dom.element('tbody',{},table);dom.element('th',{text:'Fornecedor'},hr);dom.element('th',{text:'Valor USD',class:'num'},hr);const row=dom.element('tr',{},body);dom.element('td',{text:'Fornecedor fictício'},row);dom.element('td',{text:'100'},row);counts.set(table,{rows:0,geometry:0});return {table,body,row};};
 const shown=dom.element('section',{id:'visibleView'}),hidden=dom.element('section',{id:'hiddenView'});hidden.hidden=true;const first=makeTable('first',shown),second=makeTable('second',hidden);
 const context={window:dom.window,document:dom.document,MutationObserver:dom.window.MutationObserver,requestAnimationFrame:dom.window.requestAnimationFrame,getComputedStyle:()=>({font:'14px sans-serif',paddingLeft:'8',paddingRight:'8',getPropertyValue:()=> '1'})};vm.runInNewContext(source,context,{filename:'column-layout.js'});
 const mutation=(records,flush=true)=>{dom.observers[0].callback(records);if(flush)dom.flush();};
 const attribute=(target,name='hidden')=>mutation([{type:'attributes',target,attributeName:name}]);
 const child=(target,addedNodes=[],removedNodes=[])=>mutation([{type:'childList',target,addedNodes,removedNodes}]);
 const fire=type=>{for(const fn of events.get(type)||[])fn();dom.flush();};
 return {...dom,counts,shown,hidden,first,second,makeTable,mutation,attribute,child,fire,api:dom.window.MinervaColumnLayout};
}
test('initial mounting skips hidden tables and unrelated controls do not rescan any table',()=>{
 const f=fixture();assert.equal(f.counts.get(f.first.table).rows,1);assert.equal(f.counts.get(f.second.table).rows,0);assert(f.first.row.cells[1].classList.contains('num'));assert(!f.second.row.cells[1].classList.contains('num'));
 const before={...f.counts.get(f.first.table)},select=f.element('select'),option=f.element('option',{text:'2026'},select);f.child(select,[option]);const status=f.element('p',{text:'Atualizado'});f.child(f.document.body,[status]);assert.deepEqual(f.counts.get(f.first.table),before);assert.equal(f.counts.get(f.second.table).rows,0);
});
test('revealing a pane mounts it once and later geometry refreshes do not walk intact cells',()=>{
 const f=fixture();f.shown.hidden=true;f.hidden.hidden=false;f.attribute(f.hidden);assert.equal(f.counts.get(f.second.table).rows,1);assert.equal(f.counts.get(f.first.table).rows,1);assert.equal(f.second.table.querySelectorAll('.column-resize-handle').length,2);
 f.api.refresh();f.fire('resize');f.observers[1].callback([]);f.flush();assert.equal(f.counts.get(f.second.table).rows,1);assert.equal(f.second.table.querySelectorAll('.column-resize-handle').length,2);assert.equal(f.hidden.querySelectorAll('.column-layout-toolbar').length,1);
});
test('changed body rows invalidate only their table and hidden changes wait until reveal',()=>{
 const f=fixture(),row=f.element('tr',{},f.first.body);f.element('td',{text:'Outro exemplo'},row);f.element('td',{text:'200'},row);f.child(f.first.body,[row]);assert.equal(f.counts.get(f.first.table).rows,2);assert(row.cells[1].classList.contains('num'));assert.equal(f.counts.get(f.second.table).rows,0);
 const hiddenRow=f.element('tr',{},f.second.body);f.element('td',{text:'Oculto'},hiddenRow);f.element('td',{text:'300'},hiddenRow);f.child(f.second.body,[hiddenRow]);assert.equal(f.counts.get(f.second.table).rows,0);f.hidden.hidden=false;f.attribute(f.hidden);assert.equal(f.counts.get(f.second.table).rows,1);assert(hiddenRow.cells[1].classList.contains('num'));
});
test('collapsed bases and closed dialogs defer work, but print expands active collapsed bases',()=>{
 const f=fixture(),collapsed=f.element('div',{'data-sc-collapsed':'true'},f.shown),base=f.makeTable('collapsed',collapsed);f.child(collapsed,[base.table]);assert.equal(f.counts.get(base.table).rows,0);
 f.fire('beforeprint');assert.equal(f.counts.get(base.table).rows,1);assert(base.row.cells[1].classList.contains('num'));assert.equal(f.counts.get(f.second.table).rows,0);f.fire('afterprint');
 const dialog=f.element('dialog'),detail=f.makeTable('detail',dialog);f.child(dialog,[detail.table]);assert.equal(f.counts.get(detail.table).rows,0);dialog.open=true;f.attribute(dialog,'open');assert.equal(f.counts.get(detail.table).rows,1);
 const later=f.makeTable('later',collapsed);f.child(collapsed,[later.table]);assert.equal(f.counts.get(later.table).rows,0);collapsed.setAttribute('data-sc-collapsed','false');f.attribute(collapsed,'data-sc-collapsed');assert.equal(f.counts.get(later.table).rows,1);
});
test('manual widths survive replacement and layout-only notifications preserve numeric stamps',()=>{
 const f=fixture(),handle=f.first.table.querySelector('.column-resize-handle');handle.dispatchEvent({type:'keydown',key:'ArrowRight',preventDefault(){},stopPropagation(){}});const saved=f.api.getWidths('first');assert(saved?.length===2);
 const original=f.first.table;original.remove();const replacement=f.makeTable('first',f.shown);f.child(f.shown,[replacement.table],[original]);assert.deepEqual(f.api.getWidths('first'),saved);assert(replacement.table.classList.contains('columns-sized'));assert.equal(f.counts.get(replacement.table).rows,1);
 f.attribute(f.document.body,'class');f.document.dispatchEvent({type:'fullscreenchange'});f.flush();assert.equal(f.counts.get(replacement.table).rows,1);assert.equal(f.counts.get(f.second.table).rows,0);
});
