'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));

// Exercise the production popup and event handlers using the existing small DOM.
// Only its missing HTML parser and reflected input type are supplied here.
function fixture(){
 const dom=createDOM(),{document,window}=dom,create=document.createElement;
 const decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));
 document.createElement=tag=>{
  const node=create(tag);Object.defineProperty(node,'type',{get(){return this.getAttribute('type')||''},set(value){this.setAttribute('type',value)}});
  if(tag==='template')node.content=document.createDocumentFragment();
  Object.defineProperty(node,'innerHTML',{set(html){
   const root=node.content||node;root.replaceChildren();const stack=[root];
   for(const token of String(html).match(/<[^>]*>|[^<]+/g)||[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){
     const match=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);if(!match)continue;
     const child=document.createElement(match[1]);
     for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)){child.setAttribute(attr[1],decode(attr[2]||''));if(attr[1]==='hidden'||attr[1]==='disabled')child[attr[1]]=true;}
     stack.at(-1).append(child);if(!['input','br','hr','img'].includes(match[1]))stack.push(child);
    }else{const child=create('#text');child.textContent=decode(token);stack.at(-1).append(child);}
   }
  }});return node;
 };
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/table-filters.js'),'utf8'),{window,document,Intl,innerWidth:1440,innerHeight:900});
 const F=window.MinervaTableFilters,changed=[];F.onChange(id=>changed.push(id));
 function click(node){assert.ok(node,'Expected a clickable control');if(node.disabled)return;const event={type:'click',target:node,bubbles:true,preventDefault(){}};node.onclick?.(event);node.dispatchEvent(event);}
 function open(id,column=0){let trigger=document.querySelector(`[data-filter-table="${id}"][data-filter-column="${column}"]`);if(!trigger)trigger=dom.element('button',{'data-filter-table':id,'data-filter-column':String(column)});click(trigger);return document.querySelector('.column-filter-popup');}
 function search(popup,value){const input=popup.querySelector('input[type=search]');input.value=value;input.dispatchEvent({type:'input',target:input});}
 const prepare=(id,rows)=>F.prepare(id,['Ordem / referência','Status'],rows,row=>[row.order,row.status]);
 return {F,document,changed,click,open,search,prepare};
}

test('Somente este replaces all 2209 selected options and leaves other tables unchanged',()=>{
 const t=fixture(),rows=Array.from({length:2209},(_,i)=>({order:'PO/DEMO-'+i,status:'Aberto'}));
 t.prepare('orders',rows);t.prepare('other',rows.slice(0,2));
 const popup=t.open('orders');assert.equal(popup.querySelector('[data-filter-search-apply]').hidden,true);
 t.search(popup,'PO/DEMO-1876');
 assert.equal(popup.querySelectorAll('.column-filter-option').length,1);
 assert.match(popup.querySelector('.column-filter-count').textContent,/1 resultado.*2209 opções/);
 assert.equal(t.prepare('orders',rows).length,2209,'Typing a query must not commit a filter');
 t.click(popup.querySelector('.column-filter-only'));
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['PO/DEMO-1876']);
 assert.equal(t.prepare('other',rows.slice(0,2)).length,2);
 assert.deepEqual(t.changed,['orders']);assert.equal(t.document.querySelector('.column-filter-popup'),null);
 assert.equal(t.document.activeElement.dataset.filterTable,'orders');
});

test('search action applies only matching options, retaining other columns and the sort',()=>{
 const t=fixture(),rows=[{order:'Búsqueda 1',status:'Aberto'},{order:'Busca 2',status:'Aberto'},{order:'Busca 3',status:'Fechado'},{order:'Outra',status:'Aberto'}];
 t.F.importState({tables:[{id:'orders',filters:[{column:1,values:['Aberto']}],sort:{column:0,direction:'desc'}}]});t.prepare('orders',rows);
 const popup=t.open('orders');t.search(popup,'bus');const apply=popup.querySelector('[data-filter-search-apply]');
 assert.equal(apply.hidden,false);assert.equal(apply.disabled,false);assert.match(apply.textContent,/\(3\)/);
 t.click(apply);
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['Búsqueda 1','Busca 2']);
 assert.deepEqual(plain(t.F.exportState()),{tables:[{id:'orders',filters:[{column:1,values:['Aberto']},{column:0,values:['Busca 2','Busca 3','Búsqueda 1']}],sort:{column:0,direction:'desc'}}]});
});

test('no matching options disables search action; cancelling preserves filters and sort',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'},{order:'B',status:'Aberto'}];
 t.F.importState({tables:[{id:'orders',filters:[{column:0,values:['A']}],sort:{column:0,direction:'asc'}}]});t.prepare('orders',rows);const before=plain(t.F.exportState());
 const popup=t.open('orders');t.click(popup.querySelector('[data-sort-direction="desc"]'));t.search(popup,'missing');
 const action=popup.querySelector('[data-filter-search-apply]');assert.equal(action.hidden,false);assert.equal(action.disabled,true);
 action.onclick();assert.deepEqual(plain(t.F.exportState()),before);assert.deepEqual(t.changed,[]);
 t.click(popup.querySelector('[data-filter-cancel]'));assert.deepEqual(plain(t.F.exportState()),before);assert.equal(t.document.querySelector('.column-filter-popup'),null);
});

test('checkbox selections stay a cancellable multi-value draft; ordinary Apply commits them',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'},{order:'B',status:'Aberto'},{order:'C',status:'Aberto'}];t.prepare('orders',rows);
 let popup=t.open('orders');t.click(popup.querySelector('[data-filter-none]'));
 for(const option of popup.querySelectorAll('.column-filter-option').slice(0,2)){const checkbox=option.querySelector('input');checkbox.checked=true;checkbox.dispatchEvent({type:'change'});}
 t.click(popup.querySelector('[data-sort-direction="desc"]'));
 assert.equal(t.prepare('orders',rows).length,3);t.click(popup.querySelector('[data-filter-cancel]'));assert.equal(t.F.has('orders'),false);assert.equal(t.F.getSort('orders'),null);
 popup=t.open('orders');t.click(popup.querySelector('[data-filter-none]'));
 for(const option of popup.querySelectorAll('.column-filter-option').slice(0,2)){const checkbox=option.querySelector('input');checkbox.checked=true;checkbox.dispatchEvent({type:'change'});}
 t.click(popup.querySelector('[data-sort-direction="desc"]'));t.click(popup.querySelector('[data-filter-apply]'));
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['B','A']);assert.deepEqual(t.changed,['orders']);
});

test('blank option remains selectable alone and all/none act only on search results',()=>{
 const t=fixture(),rows=[{order:'',status:'Aberto'},{order:'Alpha 1',status:'Aberto'},{order:'Alpha 2',status:'Aberto'},{order:'Beta',status:'Aberto'}];t.prepare('orders',rows);
 let popup=t.open('orders');t.search(popup,'sem informacao');t.click(popup.querySelector('.column-filter-only'));
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['']);
 popup=t.open('orders');t.search(popup,'alpha');t.click(popup.querySelector('[data-filter-all]'));t.click(popup.querySelector('[data-filter-apply]'));
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['','Alpha 1','Alpha 2']);
 popup=t.open('orders');t.search(popup,'alpha');t.click(popup.querySelector('[data-filter-none]'));t.click(popup.querySelector('[data-filter-apply]'));
 assert.deepEqual(t.prepare('orders',rows).map(r=>r.order),['']);
});
