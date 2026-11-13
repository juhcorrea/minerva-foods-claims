'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const source=name=>fs.readFileSync(require.resolve('../dist/'+name),'utf8');
function fixture(){
 const dom=createDOM(),{document,window}=dom,create=document.createElement,decode=value=>value.replace(/&(amp|lt|gt|quot|#39);/g,(_,name)=>({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"}[name]));window.document=document;
 document.createElement=tag=>{
  const node=create(tag);Object.defineProperty(node,'type',{get(){return this.getAttribute('type')||'';},set(value){this.setAttribute('type',value);}});
  if(tag==='template')node.content=document.createDocumentFragment();
  if(tag==='dialog'){node.showModal=()=>{node.open=true;};node.close=()=>{node.open=false;node.dispatchEvent({type:'close',target:node});};}
  Object.defineProperty(node,'innerHTML',{get(){return node._html||'';},set(html){
   node._html=String(html);const root=node.content||node;root.replaceChildren();const stack=[root];
   for(const token of String(html).match(/<[^>]*>|[^<]+/g)||[]){
    if(token.startsWith('</')){stack.pop();continue;}
    if(token.startsWith('<')){const match=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);if(!match)continue;const child=document.createElement(match[1]);
     for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)){const value=decode(attr[2]||'');child.setAttribute(attr[1],value);if(['hidden','disabled'].includes(attr[1]))child[attr[1]]=true;if(attr[1]==='value')child.value=value;}
     stack.at(-1).append(child);if(!['input','br','hr','img'].includes(match[1]))stack.push(child);
    }else{const child=create('#text');child.textContent=decode(token);stack.at(-1).append(child);}
   }
  }});return node;
 };
 const dashboard=dom.element('div',{id:'executiveDashboard'}),claims=dom.element('div',{id:'claimAnalytics'}),receipts=dom.element('div',{id:'receiptsExecutive'}),dialog=dom.element('dialog',{id:'detailDialog'});dom.element('h2',{id:'detailTitle'},dialog);const content=dom.element('div',{id:'detailContent'},dialog);
 const context={window,document,Intl,innerWidth:1440,innerHeight:900};vm.runInNewContext(source('table-filters.js'),context);let routed=0;
 const F=window.MinervaTableFilters;F.onChange(id=>{routed++;if(window.MinervaExecutive?.handlesTable(id))window.MinervaExecutive.handleFilter(id);else if(window.MinervaReceiptsExecutive?.handlesTable(id))window.MinervaReceiptsExecutive.handleFilter(id);});
 vm.runInNewContext(source('executive.js'),context);vm.runInNewContext(source('receipts-executive.js'),context);
 function click(node){assert(node,'control is present');if(node.disabled)return;const event={type:'click',target:node,bubbles:true,preventDefault(){}};node.onclick?.(event);node.dispatchEvent(event);}
 function input(node,value){node.value=value;node.dispatchEvent({type:'input',target:node});}
 function popup(id,column){click(document.querySelector(`[data-filter-table="${id}"][data-filter-column="${column}"]`));return document.querySelector('.column-filter-popup');}
 return{...dom,F,dashboard,claims,receipts,dialog,content,click,input,popup,routed:()=>routed};
}
function model(){
 const claims=[2,3].map(row=>({row,sgr:'CASE-'+row,supplier:row===2?'Supplier B':'Supplier A',country:'BRA',status:'EM NEGOCIAÇÃO - PROCEDENTE',reason:'Motivo exemplo',rncDate:row===2?'2026-02-10':'2026-01-10',claimed:row===2?100.003:100.004,analysisEvent:{date:'2026-01-10',value:row===2?.50001:.50002},negotiationEvent:{date:'2026-01-10',value:row===2?11.001:11.002},openingEvent:{date:'2026-01-10',value:row===2?22.001:22.002}}));
 const receipts=claims.map(row=>({row:row.row,reference:'REF-'+row.row,supplier:row.supplier,isControlRecord:true,status:'Pago',includedInConfirmed:true,received:row.row===2?1200.003:1200.004,expected:row.row===2?1300.003:1300.004,compDate:row.rncDate,dueDate:row.rncDate,compensationMonth:'2026-01',receiptAnalyst:'Analyst example'}));
 return{meta:{years:[2026],asOf:'2026-01-31'},summary:{claimed:200.007,negotiating:200.007},suppliers:[],supplierOpenReport:{meta:{openBalance:2600.007},installments:receipts},controlReport:{installments:receipts},executiveReport:{years:[2026],claimRows:claims,controlClaims:claims,receiptRows:receipts,monthlyReceipts:[{year:2026,month:1,received:2400.007,rows:[2,3]}],reasonRanking:[{name:'Motivo exemplo',amount:200.007,count:2,rows:[2,3]}],causeRanking:[],negotiationByCountry:[],sectorReceipts:[],openByCountry:[],slaByMonth:[{period:'2026-01',analysisRate:.5,analysisCount:2,analysisRows:[2,3],negotiationDays:11,negotiationCount:2,negotiationRows:[2,3],openingDays:22,openingCount:2,openingRows:[2,3]}]}};
}
for(const kind of ['claim','receipt','open','analysis','negotiation','opening'])test('executive '+kind+' detail supports column filtering and exact numeric sorting without replacing the shared callback',()=>{
 const t=fixture(),m=model(),before=JSON.stringify(m);t.F.importState({tables:[{id:'another-view',filters:[{column:0,values:['preserve']}]}]});t.window.MinervaExecutive.render(m);t.window.MinervaExecutive.renderClaims(m,t.claims);
 const button=kind==='claim'?t.claims.querySelector('.exec-rank-row'):kind==='receipt'?t.dashboard.querySelector('.exec-kpi-value'):kind==='open'?t.dashboard.querySelectorAll('.exec-kpi')[3].querySelector('button'):t.claims.querySelectorAll('.exec-sla-item button')[['analysis','negotiation','opening'].indexOf(kind)];t.click(button);
 const table=t.content.querySelector('table'),id=table.dataset.tableId,headers=table.querySelectorAll('th');assert(id.startsWith('detail-exec-'));assert.equal(t.content.querySelectorAll('.column-filter-trigger').length,headers.length);
 let popup=t.popup(id,headers.length-1);t.click(popup.querySelector('[data-sort-direction="desc"]'));t.click(popup.querySelector('[data-filter-apply]'));assert.equal(t.content.querySelector('tbody tr td').textContent,'3','raw cents/days/rates determine sort even if formatted values match');
 const supplierColumn=kind==='claim'?3:kind==='receipt'||kind==='open'?1:2;popup=t.popup(id,supplierColumn);t.input(popup.querySelector('input[type=search]'),'Supplier B');t.click(popup.querySelector('[data-filter-apply]'));
 assert.equal(t.content.querySelectorAll('tbody tr').length,1);assert.equal(t.content.querySelector('tbody tr td').textContent,'2');assert.match(t.content.textContent,/1 de 2 linhas/);assert(t.routed()>=2);
 t.input(t.content.querySelector('#executiveDetailSearch'),'absent');assert.equal(t.content.querySelectorAll('tbody tr').length,0);assert.match(t.content.textContent,/Nenhuma linha neste filtro/);
 t.dialog.close();assert(!t.F.exportState().tables.some(item=>item.id===id));assert(t.F.exportState().tables.some(item=>item.id==='another-view'));assert.equal(JSON.stringify(m),before);
});

test('receipt detail combines searchable column filters, date/amount sort and free search without leaking to other views',()=>{
 const t=fixture(),m=model(),before=JSON.stringify(m);t.F.importState({tables:[{id:'detail-cc-procurement',filters:[{column:0,values:['keep']}]}]});t.window.MinervaReceiptsExecutive.render(m);t.click(t.receipts.querySelector('.rx-kpi'));
 const dialog=t.document.getElementById('receiptsExecutiveDetail'),id=dialog.querySelector('table').dataset.tableId;assert(id.startsWith('detail-rx-'));assert.equal(dialog.querySelectorAll('.column-filter-trigger').length,9);
 let popup=t.popup(id,6);t.click(popup.querySelector('[data-sort-direction="desc"]'));t.click(popup.querySelector('[data-filter-apply]'));assert.match(dialog.querySelector('tbody tr').textContent,/REF-3/);
 popup=t.popup(id,4);t.click(popup.querySelector('[data-sort-direction="asc"]'));t.click(popup.querySelector('[data-filter-apply]'));assert.match(dialog.querySelector('tbody tr').textContent,/REF-3/,'ISO date values govern ordering');
 popup=t.popup(id,1);t.input(popup.querySelector('input[type=search]'),'Supplier B');t.click(popup.querySelector('[data-filter-apply]'));assert.equal(dialog.querySelectorAll('tbody tr').length,1);assert.match(dialog.querySelector('tbody tr').textContent,/REF-2/);
 t.input(dialog.querySelector('#receiptsExecutiveSearch'),'absent');assert.equal(dialog.querySelectorAll('tbody tr').length,0);assert.match(dialog.textContent,/Nenhuma parcela neste filtro/);assert(t.routed()>=3);
 dialog.close();assert(!t.F.exportState().tables.some(item=>item.id===id));assert(t.F.exportState().tables.some(item=>item.id==='detail-cc-procurement'));assert.equal(JSON.stringify(m),before);
});

for(const action of ['cleared model','ended session'])test('receipt detail closes and discards private rows on '+action,()=>{
 const t=fixture();t.window.MinervaReceiptsExecutive.render(model());t.click(t.receipts.querySelector('.rx-kpi'));
 const dialog=t.document.getElementById('receiptsExecutiveDetail'),id=dialog.querySelector('table').dataset.tableId;assert(dialog.open);assert.match(dialog.textContent,/REF-2/);
 let popup=t.popup(id,1);t.input(popup.querySelector('input[type=search]'),'Supplier B');t.click(popup.querySelector('[data-filter-apply]'));assert(t.F.has(id));
 if(action==='cleared model')t.window.MinervaReceiptsExecutive.render(null);else t.document.dispatchEvent({type:'minerva:session-updated',detail:null});
 assert.equal(dialog.open,false);assert.equal(dialog.textContent,'');assert.equal(t.receipts.textContent,'');assert(!t.F.has(id));
 t.window.MinervaReceiptsExecutive.handleFilter(id);assert.equal(dialog.textContent,'');assert.equal(dialog.open,false);
});
