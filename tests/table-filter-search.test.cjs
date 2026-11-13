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
 return {F,document,window,changed,click,open,search,prepare};
}

test('Claim cards ignore only case status while their base facets, drill and real callbacks stay coherent',()=>{
 const t=fixture(),host=t.document.createElement('div');host.id='claimRecords';t.document.body.append(host);vm.runInNewContext(fs.readFileSync(require.resolve('../dist/claim-control.js'),'utf8'),{window:t.window,document:t.document,Intl});
 const api=t.window.MinervaClaimControl,id='cc-claims-table',rows=[{row:2,sgr:'CASE-A',supplier:'Analysis open',country:'BRA',status:'EM ANÁLISE',caseStatus:'ABERTO',caseStatusKey:'open',rncYear:2026,claimed:10},{row:3,sgr:'CASE-B',supplier:'Analysis closed',country:'BRA',status:'EM ANÁLISE',caseStatus:'FECHADO',caseStatusKey:'closed',rncYear:2026,claimed:20},{row:4,sgr:'CASE-C',supplier:'Forwarded open',country:'BRA',status:'RESSARCIMENTO ENCAMINHADO',caseStatus:'ABERTO',caseStatusKey:'open',rncYear:2026,claimed:30}],model={meta:{allYears:true,caseYears:[2026]},executiveReport:{controlClaims:rows}},original=JSON.stringify(model);
 t.F.importState({tables:[{id,filters:[{column:1,values:['BRA']},{column:8,values:['Aberto']}],sort:{column:6,direction:'asc'}},{id:'other',filters:[{column:0,values:['preserve']}]}]});let callbacks=0;t.F.onChange(table=>{callbacks++;api.handleFilter(table);});api.render(model);
 const count=key=>host.querySelector('[data-cc-case-metric="'+key+'"]').querySelector('strong').textContent,options=()=>{const popup=t.open(id,2),values=popup.querySelectorAll('.column-filter-option').map(node=>node.querySelector('span').textContent);t.F.close();return values;},records=()=>host.querySelectorAll('[data-cc-detail]').map(node=>Number(node.dataset.ccDetail));
 assert.equal(count('all'),'3');assert.equal(count('closed'),'1');assert.deepEqual(options(),['Analysis open','Forwarded open']);
 t.click(host.querySelector('[data-cc-case-metric="closed"]'));assert.deepEqual(records(),[3]);assert.deepEqual(options(),['Analysis closed']);let saved=plain(t.F.exportState());assert.deepEqual(saved.tables.find(table=>table.id===id),{id,filters:[{column:1,values:['BRA']}],sort:{column:6,direction:'asc'}});assert(saved.tables.some(table=>table.id==='other'));
 t.click(host.querySelector('[data-cc-case-metric="analysis"]'));assert.deepEqual(records(),[2,3]);assert.deepEqual(options(),['Analysis closed','Analysis open']);
 const popup=t.open(id,2);t.search(popup,'Analysis open');t.click(popup.querySelector('[data-filter-apply]'));assert.equal(callbacks,1);assert.deepEqual(records(),[2]);assert.equal(count('all'),'1');assert.equal(count('closed'),'0');assert.deepEqual(options(),['Analysis closed','Analysis open'],'Own column may expose every option within the actual stage for changing the selection');assert.equal(JSON.stringify(model),original);
});

const toggle=popup=>popup.querySelector('[data-filter-toggle]');
const apply=popup=>popup.querySelector('[data-filter-apply]');
function setCheck(popup,label,checked=true){const option=popup.querySelectorAll('.column-filter-option').find(node=>node.querySelector('span').textContent===label);assert(option,'missing option: '+label);const input=option.querySelector('input');input.checked=checked;input.dispatchEvent({type:'change'});}

test('search then Apply replaces all 2209 selected options and leaves other tables unchanged',()=>{
 const t=fixture(),rows=Array.from({length:2209},(_,i)=>({order:'PO/DEMO-'+i,status:'Aberto'}));t.prepare('orders',rows);t.prepare('other',rows.slice(0,2));
 const popup=t.open('orders');t.search(popup,'PO/DEMO-1876');assert.equal(popup.querySelectorAll('.column-filter-option').length,1);assert.match(popup.querySelector('.column-filter-count').textContent,/1 resultado.*2209 de 2209 opções/);assert.equal(t.prepare('orders',rows).length,2209,'Typing a query does not commit');t.click(apply(popup));
 assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['PO/DEMO-1876']);assert.equal(t.prepare('other',rows.slice(0,2)).length,2);assert.deepEqual(t.changed,['orders']);assert.equal(t.document.querySelector('.column-filter-popup'),null);assert.equal(t.document.activeElement.dataset.filterTable,'orders');
});

test('search Apply retains other columns and sorting, with accent insensitive matching',()=>{
 const t=fixture(),rows=[{order:'Búsqueda 1',status:'Aberto'},{order:'Busca 2',status:'Aberto'},{order:'Busca 3',status:'Fechado'},{order:'Outra',status:'Aberto'}];t.F.importState({tables:[{id:'orders',filters:[{column:1,values:['Aberto']}],sort:{column:0,direction:'desc'}}]});t.prepare('orders',rows);
 const popup=t.open('orders');t.search(popup,'bus');t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['Búsqueda 1','Busca 2']);assert.deepEqual(plain(t.F.exportState()),{tables:[{id:'orders',filters:[{column:1,values:['Aberto']},{column:0,values:['Busca 2','Búsqueda 1']}],sort:{column:0,direction:'desc'}}]});
});

test('no results disables both footer actions; Escape preserves filters and sort',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'},{order:'B',status:'Aberto'}];t.F.importState({tables:[{id:'orders',filters:[{column:0,values:['A']}],sort:{column:0,direction:'asc'}}]});t.prepare('orders',rows);const before=plain(t.F.exportState());
 const popup=t.open('orders');t.click(popup.querySelector('[data-sort-direction="desc"]'));t.search(popup,'missing');assert.equal(apply(popup).disabled,true);assert.equal(toggle(popup).disabled,true);apply(popup).onclick();assert.deepEqual(plain(t.F.exportState()),before);assert.deepEqual(t.changed,[]);
 t.document.dispatchEvent({type:'keydown',key:'Escape',preventDefault(){},stopPropagation(){}});assert.deepEqual(plain(t.F.exportState()),before);assert.equal(t.document.querySelector('.column-filter-popup'),null);
});

test('checkbox selections remain a cancellable multi-value draft and Apply commits exactly that draft',()=>{
 const t=fixture(),rows=['A','B','C'].map(order=>({order,status:'Aberto'}));t.prepare('orders',rows);
 let popup=t.open('orders');assert.equal(toggle(popup).textContent,'Limpar');t.click(toggle(popup));setCheck(popup,'A');setCheck(popup,'B');t.click(popup.querySelector('[data-sort-direction="desc"]'));assert.equal(t.prepare('orders',rows).length,3);t.F.close();assert.equal(t.F.has('orders'),false);assert.equal(t.F.getSort('orders'),null);
 popup=t.open('orders');t.click(toggle(popup));setCheck(popup,'A');setCheck(popup,'B');t.click(popup.querySelector('[data-sort-direction="desc"]'));t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['B','A']);assert.deepEqual(t.changed,['orders']);
});

test('blank values remain selectable; bulk search replaces outside choices and Limpar resets the filter',()=>{
 const t=fixture(),rows=['','Alpha 1','Alpha 2','Beta'].map(order=>({order,status:'Aberto'}));t.prepare('orders',rows);
 let popup=t.open('orders');t.search(popup,'sem informacao');t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['']);
 popup=t.open('orders');t.search(popup,'alpha');assert.equal(toggle(popup).textContent,'Marcar todos');t.click(toggle(popup));assert.equal(toggle(popup).textContent,'Limpar');assert.equal(t.prepare('orders',rows).length,1);t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['Alpha 1','Alpha 2']);
 popup=t.open('orders');t.search(popup,'alpha');t.click(toggle(popup));assert.equal(popup.querySelector('input[type=search]').value,'');assert.equal(popup.querySelectorAll('.column-filter-option input').filter(input=>input.checked).length,0);t.click(apply(popup));assert.equal(t.F.has('orders'),false);assert.equal(t.prepare('orders',rows).length,4);
});

test('372 options: manual A and B survive searches, including the final revisit to A',()=>{
 const t=fixture(),rows=Array.from({length:372},(_,i)=>({order:'Fornecedor '+String(i).padStart(3,'0'),status:'Aberto'}));t.prepare('orders',rows);const popup=t.open('orders');t.click(toggle(popup));
 t.search(popup,'Fornecedor 011');setCheck(popup,'Fornecedor 011');t.search(popup,'Fornecedor 295');setCheck(popup,'Fornecedor 295');t.search(popup,'Fornecedor 011');assert.equal(popup.querySelector('.column-filter-option input').checked,true);assert.equal(t.prepare('orders',rows).length,372);t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['Fornecedor 011','Fornecedor 295']);assert.deepEqual(plain(t.F.exportState()).tables[0].filters,[{column:0,values:['Fornecedor 011','Fornecedor 295']}]);
});

test('Marcar todos during each search replaces the draft rather than retaining prior queries',()=>{
 const t=fixture(),rows=['Alpha 1','Alpha 2','Beta','Other'].map(order=>({order,status:'Aberto'}));t.prepare('orders',rows);const popup=t.open('orders');t.search(popup,'alpha');t.click(toggle(popup));t.search(popup,'beta');t.click(toggle(popup));assert.deepEqual(t.changed,[]);assert.equal(t.prepare('orders',rows).length,4);t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['Beta']);
});

test('choices cascade through other columns; without search Marcar todos restores only its own universe',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'},{order:'B',status:'Aberto'},{order:'C',status:'Fechado'},{order:'A',status:'Fechado'}];t.F.importState({tables:[{id:'orders',filters:[{column:0,values:['A']},{column:1,values:['Aberto']}],sort:null}]});t.prepare('orders',rows);
 let popup=t.open('orders');assert.deepEqual(popup.querySelectorAll('.column-filter-option label span').map(node=>node.textContent),['A','B']);t.click(toggle(popup));t.click(apply(popup));assert.deepEqual(plain(t.F.exportState()).tables[0].filters,[{column:1,values:['Aberto']}]);assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['A','B']);
 popup=t.open('orders',1);assert.deepEqual(popup.querySelectorAll('.column-filter-option label span').map(node=>node.textContent),['Aberto','Fechado']);t.F.close();t.F.importState({tables:[]});t.prepare('orders',rows);popup=t.open('orders');assert.equal(popup.querySelectorAll('.column-filter-option').length,3);
});

test('hidden selections survive ordinary Apply, but explicit search replaces them and never expands a no-result query',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'},{order:'B',status:'Aberto'},{order:'C',status:'Fechado'}];t.F.importState({tables:[{id:'orders',filters:[{column:0,values:['A','C']},{column:1,values:['Aberto']}],sort:null}]});t.prepare('orders',rows);
 let popup=t.open('orders');assert.match(popup.querySelector('.column-filter-count').textContent,/1 de 2.*1 seleção\(ões\) fora/);t.click(apply(popup));assert.deepEqual(plain(t.F.exportState()).tables[0].filters[0].values,['A','C']);popup=t.open('orders');t.search(popup,'missing');t.click(apply(popup));assert.deepEqual(plain(t.F.exportState()).tables[0].filters[0].values,['A','C']);t.search(popup,'A');t.click(apply(popup));assert.deepEqual(plain(t.F.exportState()).tables[0].filters[0].values,['A']);
});

test('explicit checkbox deselection can produce zero rows; an empty related facet preserves that filter',()=>{
 const t=fixture(),rows=[{order:'A',status:'Aberto'}];t.prepare('orders',rows);let popup=t.open('orders');setCheck(popup,'A',false);t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows),[]);assert.deepEqual(plain(t.F.exportState()).tables[0].filters,[{column:0,values:[]}]);
 t.F.importState({tables:[{id:'orders',filters:[{column:0,values:[]},{column:1,values:['Fechado']}],sort:null}]});t.prepare('orders',rows);popup=t.open('orders');assert.equal(popup.querySelectorAll('.column-filter-option').length,0);assert.match(popup.querySelector('.column-filter-options').textContent,/demais filtros/);t.click(apply(popup));assert.deepEqual(plain(t.F.exportState()).tables[0].filters,[{column:0,values:[]},{column:1,values:['Fechado']}]);
});

test('first manual edit during an initially-all search drops invisible outside selections',()=>{
 const t=fixture(),rows=['Alpha 1','Alpha 2','Beta'].map(order=>({order,status:'Aberto'}));t.prepare('orders',rows);const popup=t.open('orders');t.search(popup,'Alpha');setCheck(popup,'Alpha 1',false);t.click(apply(popup));assert.deepEqual(t.prepare('orders',rows).map(row=>row.order),['Alpha 2']);
});

test('compact popup has search first, two footer actions and collapsed optional sorting',()=>{
 const t=fixture();t.prepare('orders',[{order:'A',status:'Aberto'}]);const popup=t.open('orders');assert.equal(popup.children[0].className,'filter-search-label');assert.equal(popup.querySelectorAll('.column-filter-footer button').length,2);assert.equal(popup.querySelector('.column-filter-title'),null);assert.equal(popup.querySelector('.column-filter-only'),null);assert.equal(popup.querySelector('.column-sort-disclosure').hasAttribute('open'),false);assert.equal(popup.style.width,'220px');assert.equal(apply(popup).textContent,'Aplicar');
});