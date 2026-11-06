'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/claim-control.js'),'utf8');
function harness(){
 const hosts={},filters=new Map(),sorts=new Map();let modal;
 for(const id of ['claimRecords','procurementContent'])hosts[id]={innerHTML:'',classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},querySelector(){return {textContent:''};}};
 const document={getElementById:id=>hosts[id],querySelector:()=>null,body:{append(el){modal=el;}},createElement:()=>({open:false,innerHTML:'',dataset:{},classList:{add(){},remove(){}},listeners:{},setAttribute(){},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);},showModal(){this.open=true;},close(){this.open=false;}})};
 const F={prepare(id,headers,rows){const result=filters.has(id)?rows.filter(filters.get(id)):[...rows];return sorts.has(id)?result.sort(sorts.get(id)):result;},heading:(id,col,label)=>label,ariaSort:()=> 'none',describe:id=>filters.has(id)?'Filtro de teste':'',has:id=>filters.has(id),hasSort:id=>sorts.has(id),clearDetails(){filters.delete('detail-cc-procurement');sorts.delete('detail-cc-procurement');}};
 class FormDataFake{constructor(form){this.values=form.values;}get(key){return this.values[key]??'';}}
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-06T01:00:00Z']));}static now(){return Date.parse('2026-11-06T01:00:00Z');}}
 const window={MinervaTableFilters:F},context={window,document,FormData:FormDataFake,Date:FixedDate};vm.createContext(context);vm.runInContext(source,context);
 const event=dataset=>({target:{closest:selector=>selector==='button'?{dataset}:null}});
 const click=(host,dataset)=>hosts[host].listeners.click(event(dataset));
 const sheets=(scope,supplier)=>{const output=[];window.MinervaClaimControl.worksheets({},(wb,title,headers,rows)=>output.push({title,headers,rows}),scope,supplier);return JSON.parse(JSON.stringify(output));};
 return {api:window.MinervaClaimControl,hosts,filters,sorts,click,sheets,get modal(){return modal;},toggle(key){modal.listeners.click.at(-1)(event({ccReason:key}));}};
}
const record=(row,supplier,reason,claimed,extra={})=>({row,sgr:'SGR-'+row,order:'ORDEM-'+row,supplier,reason,claimed,category:'negotiation',included:true,country:'País exemplo',pending:'Aguardando retorno',invoiceDate:'2026-01-01',openingDate:'2026-11-04',nf:'NF-'+row,container:'NF-'+row,originalContainer:'',...extra});
const model=(rows,claims=[])=>({executiveReport:{controlClaims:claims},procurementReport:{rows,negotiationTotal:100,legalTotal:20,grandTotal:120,meta:{}}});
const sheet=(sheets,title)=>sheets.find(s=>s.title===title);

test('Claim control defaults to descending USD, preserves manual sorting, and paginates fifty rows',()=>{
 const h=harness(),rows=Array.from({length:53},(_,i)=>record(i+2,'Fornecedor exemplo','Motivo exemplo',i===52?null:i,{financialEligible:true,status:'EM ANÁLISE'}));h.api.render(model([],rows));
 assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,50);
 let exported=sheet(h.sheets('claims'),'Controle de claims').rows;assert.equal(exported[0][13],51);assert.equal(exported.at(-1)[13],null);
 h.click('claimRecords',{ccPage:'claims',ccStep:'1'});assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,3);
 h.sorts.set('cc-claims-table',(a,b)=>(a.claimed??Infinity)-(b.claimed??Infinity));h.api.handleFilter('cc-claims-table');exported=sheet(h.sheets('claims'),'Controle de claims').rows;assert.equal(exported[0][13],0);assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,50);
});

test('supplier and reason variants consolidate into collapsed descending groups with matching Excel subtotals',()=>{
 const h=harness(),rows=[record(2,'Fornecedor Alfa','Malfunction',10),record(3,' FORNECEDOR   ALFA ','MALFÚNCTION',30),record(4,'Fornecedor Alfa','Avaria',5),record(5,'Fornecedor Beta','Avaria',50),record(6,'Fornecedor escondido','Excluído',500,{included:false}),record(7,'Jurídico restrito','Jurídico',600,{category:'legal'})],m=model(rows),before=JSON.stringify(m);h.api.render(m);
 const macro=sheet(h.sheets('fup'),'FUP Fornecedores').rows;assert.deepEqual(macro.map(r=>r[2]),[50,45]);assert.equal(macro.length,2);assert(!h.hosts.procurementContent.innerHTML.includes('Jurídico restrito'));assert(!h.hosts.procurementContent.innerHTML.includes('Fornecedor escondido'));
 h.click('procurementContent',{ccSupplier:'Fornecedor Alfa'});const html=h.modal.innerHTML;assert.equal((html.match(/aria-expanded="false"/g)||[]).length,2);assert(html.indexOf('data-cc-reason="MALFUNCTION"')<html.indexOf('data-cc-reason="AVARIA"'));assert(html.includes('USD 40,00'));
 h.toggle('MALFUNCTION');assert(h.modal.innerHTML.includes('data-cc-reason="MALFUNCTION" aria-expanded="true"'));assert(h.modal.innerHTML.indexOf('ORDEM-3')<h.modal.innerHTML.indexOf('ORDEM-2'));
 const book=h.sheets('fup','FORNECEDOR ALFA'),detail=sheet(book,'FUP Claims'),subtotals=sheet(book,'FUP Motivos');assert.deepEqual(detail.rows.map(r=>r[7]),[30,10,5]);assert.deepEqual(subtotals.rows.map(r=>r[4]),[40,5]);assert.equal(detail.rows.reduce((sum,r)=>sum+r[7],0),45);assert(!book.some(s=>s.title==='FUP Resumo'));assert(!detail.headers.includes('Categoria'));assert.equal(JSON.stringify(m),before);
});

test('column filters apply before grouping and manual sorting remains effective inside each reason',()=>{
 const h=harness(),rows=[record(2,'Fornecedor exemplo','Motivo A',10),record(3,'Fornecedor exemplo','Motivo A',30),record(4,'Fornecedor exemplo','Motivo B',20)];h.api.render(model(rows));h.click('procurementContent',{ccSupplier:'Fornecedor exemplo'});
 h.filters.set('detail-cc-procurement',r=>r.reason==='Motivo A');h.sorts.set('detail-cc-procurement',(a,b)=>a.claimed-b.claimed);h.api.handleFilter('detail-cc-procurement');
 const book=h.sheets('fup','Fornecedor exemplo');assert.equal(sheet(book,'FUP Motivos').rows.length,1);assert.deepEqual(sheet(book,'FUP Claims').rows.map(r=>r[7]),[10,30]);assert(!h.modal.innerHTML.includes('data-cc-reason="MOTIVO B"'));
});

test('global distinct claim count is not the sum of supplier counts and aging uses Sao Paulo civil date',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Motivo',10,{sgr:'SHARED'}),record(3,'Fornecedor B','Motivo',20,{sgr:'SHARED',openingDate:'2026-11-05'}),record(4,'Fornecedor B','Motivo',30,{openingDate:'2026-11-06'}),record(5,'Fornecedor B','Motivo',40,{openingDate:null})];h.api.render(model(rows));
 const book=h.sheets('fup'),criteria=sheet(book,'Critérios FUP').rows,detail=sheet(book,'FUP Claims').rows;assert.equal(criteria.find(r=>r[0]==='Claims únicos do filtro')[1],3);assert.equal(sheet(book,'FUP Fornecedores').rows.reduce((sum,r)=>sum+r[1],0),4);assert(h.hosts.procurementContent.innerHTML.includes('<td>Total do filtro</td><td class="cc-number">3</td>'));
 const ages=new Map(detail.map(r=>[r.at(-1),r[6]]));assert.equal(ages.get(2),1);assert.equal(ages.get(3),0);assert.equal(ages.get(4),null);assert.equal(ages.get(5),null);
});

test('incomplete source notices are conditional and supplier text is escaped',()=>{
 const h=harness(),m=model([record(2,'<img src=x onerror=alert(1)>','Motivo',10)]);h.api.render(m);assert(!h.hosts.procurementContent.innerHTML.includes('cc-incomplete'));assert(!h.hosts.procurementContent.innerHTML.includes('<img'));assert(h.hosts.procurementContent.innerHTML.includes('&lt;img'));
 m.procurementReport.meta.amountIncomplete=true;h.api.render(m);assert(h.hosts.procurementContent.innerHTML.includes('cc-incomplete'));assert(h.hosts.procurementContent.innerHTML.includes('totais parciais'));
});
