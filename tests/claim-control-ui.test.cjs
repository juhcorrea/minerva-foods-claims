'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/claim-control.js'),'utf8');
function harness(){
 const hosts={},filters=new Map(),sorts=new Map(),sortMeta=new Map(),bodyClasses=new Set();let modal;
 for(const id of ['claimRecords','procurementContent','ccProcurementDetail'])hosts[id]={innerHTML:'',classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},querySelector(){return {textContent:''};}};
 const document={getElementById:id=>hosts[id],querySelector:()=>null,body:{append(el){modal=el;},classList:{toggle(name,value){value?bodyClasses.add(name):bodyClasses.delete(name);}}},createElement:()=>({open:false,innerHTML:'',dataset:{},classList:{add(){},remove(){}},listeners:{},setAttribute(){},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);},showModal(){this.open=true;},close(){this.open=false;}})};
 const F={prepare(id,headers,rows){const result=filters.has(id)?rows.filter(filters.get(id)):[...rows];return sorts.has(id)?result.sort(sorts.get(id)):result;},heading:(id,col,label)=>label,ariaSort:()=> 'none',describe:id=>filters.has(id)?'Filtro de teste':'',has:id=>filters.has(id),hasSort:id=>sorts.has(id),getSort:id=>sortMeta.get(id),clearDetails(){filters.delete('detail-cc-procurement');sorts.delete('detail-cc-procurement');sortMeta.delete('detail-cc-procurement');}};
 class FormDataFake{constructor(form){this.values=form.values;}get(key){return Array.isArray(this.values[key])?this.values[key][0]:this.values[key]??'';}getAll(key){return this.values[key]===undefined?[]:Array.isArray(this.values[key])?this.values[key]:[this.values[key]];}}
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-06T01:00:00Z']));}static now(){return Date.parse('2026-11-06T01:00:00Z');}}
 const window={MinervaTableFilters:F},context={window,document,FormData:FormDataFake,Date:FixedDate};vm.createContext(context);vm.runInContext(source,context);
 const event=dataset=>({target:{closest:selector=>selector==='button'?{dataset}:null}});
 const click=(host,dataset)=>hosts[host].listeners.click(event(dataset));
 const submit=(scope,values)=>hosts[scope==='claims'?'claimRecords':'procurementContent'].listeners.submit({preventDefault(){},target:{closest:()=>({dataset:{ccForm:scope},values})}});
 const sheets=(scope,supplier)=>{const output=[];window.MinervaClaimControl.worksheets({},(wb,title,headers,rows)=>output.push({title,headers,rows}),scope,supplier);return JSON.parse(JSON.stringify(output));};
 return {api:window.MinervaClaimControl,hosts,filters,sorts,sortMeta,bodyClasses,click,submit,sheets,get modal(){return modal;},get detail(){return hosts.ccProcurementDetail;},toggle(key){click('procurementContent',{ccReason:key});}};
}
const record=(row,supplier,reason,claimed,extra={})=>({row,sgr:'SGR-'+row,order:'ORDEM-'+row,supplier,reason,claimed,category:'negotiation',included:true,country:'País exemplo',pending:'Aguardando retorno',invoiceDate:'2026-01-01',openingDate:'2026-11-04',nf:'NF-'+row,container:'NF-'+row,originalContainer:'',...extra});
const model=(rows,claims=[])=>({executiveReport:{controlClaims:claims},procurementReport:{rows,negotiationTotal:100,legalTotal:20,grandTotal:120,meta:{}}});
const sheet=(sheets,title)=>sheets.find(s=>s.title===title);

test('expanding the whole FUP visual uses its global heading and preserves filters, selection and table DOM',()=>{
 const h=harness(),m=model([record(2,'Fornecedor exemplo','Motivo exemplo',100)]);h.api.render(m);const before=h.detail.innerHTML,view=JSON.stringify(h.api.getViewState()),label={textContent:'Expandir visual'},attributes={};const button={dataset:{ccToggleWidth:''},setAttribute(name,value){attributes[name]=value;},querySelector(){return label;}};const toggle=()=>h.hosts.procurementContent.listeners.click({target:{closest:()=>button}});
 const initial=h.hosts.procurementContent.innerHTML;assert(initial.indexOf('data-cc-toggle-width')<initial.indexOf('cc-editorial-strip'));assert(!h.detail.innerHTML.includes('data-cc-toggle-width'));assert(initial.includes('aria-controls="procurementContent"'));
 h.filters.set('detail-cc-procurement',()=>true);h.sortMeta.set('detail-cc-procurement',{column:6,direction:'desc'});toggle();assert(h.bodyClasses.has('cc-fup-wide'));assert.equal(attributes['aria-pressed'],'true');assert.equal(label.textContent,'Restaurar visual');assert.equal(h.detail.innerHTML,before);assert.equal(JSON.stringify(h.api.getViewState()),view);assert(h.filters.has('detail-cc-procurement'));assert.equal(h.sortMeta.get('detail-cc-procurement').direction,'desc');h.api.render(m);assert(h.hosts.procurementContent.innerHTML.includes('data-cc-toggle-width aria-pressed="true"'));const expanded=h.detail.innerHTML;toggle();assert(!h.bodyClasses.has('cc-fup-wide'));assert.equal(attributes['aria-pressed'],'false');assert.equal(label.textContent,'Expandir visual');assert.equal(h.detail.innerHTML,expanded);
});

test('FUP expansion remains available with no selected supplier or no rows',()=>{const h=harness();h.api.render(model([]));const html=h.hosts.procurementContent.innerHTML;assert.equal((html.match(/data-cc-toggle-width/g)||[]).length,1);assert(html.includes('Expandir visual'));assert(!h.detail.innerHTML.includes('data-cc-toggle-width'));});

test('Claim control defaults to descending USD, preserves manual sorting, and paginates fifty rows',()=>{
 const h=harness(),rows=Array.from({length:53},(_,i)=>record(i+2,'Fornecedor exemplo','Motivo exemplo',i===52?null:i,{financialEligible:true,status:'EM ANÁLISE'}));h.api.render(model([],rows));
 assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,50);
 let exported=sheet(h.sheets('claims'),'Controle de claims').rows;assert.equal(exported[0][13],51);assert.equal(exported.at(-1)[13],null);
 h.click('claimRecords',{ccPage:'claims',ccStep:'1'});assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,3);
 h.sorts.set('cc-claims-table',(a,b)=>(a.claimed??Infinity)-(b.claimed??Infinity));h.api.handleFilter('cc-claims-table');exported=sheet(h.sheets('claims'),'Controle de claims').rows;assert.equal(exported[0][13],0);assert.equal((h.hosts.claimRecords.innerHTML.match(/data-cc-detail=/g)||[]).length,50);
});

test('supplier and reason variants consolidate in inline descending groups with matching Excel subtotals',()=>{
 const h=harness(),rows=[record(2,'Fornecedor Alfa','Malfunction',10),record(3,' FORNECEDOR   ALFA ','MALFÚNCTION',30),record(4,'Fornecedor Alfa','Avaria',5),record(5,'Fornecedor Beta','Avaria',50),record(6,'Fornecedor escondido','Excluído',500,{included:false}),record(7,'Jurídico restrito','Jurídico',600,{category:'legal'})],m=model(rows),before=JSON.stringify(m);h.api.render(m);
 const macro=sheet(h.sheets('fup'),'FUP Fornecedores').rows;assert.deepEqual(macro.map(r=>r[2]),[50,45]);assert.equal(macro.length,2);assert(!h.hosts.procurementContent.innerHTML.includes('Jurídico restrito'));assert(!h.hosts.procurementContent.innerHTML.includes('Fornecedor escondido'));
 assert(h.detail.innerHTML.includes('Fornecedor Beta'));assert.equal(h.modal,undefined);h.click('procurementContent',{ccSupplier:'Fornecedor Alfa'});const html=h.detail.innerHTML;assert.equal((html.match(/aria-expanded="false"/g)||[]).length,1);assert.equal((html.match(/aria-expanded="true"/g)||[]).length,1);assert(html.indexOf('data-cc-reason="MALFUNCTION"')<html.indexOf('data-cc-reason="AVARIA"'));assert(html.includes('40,00'));assert.equal((html.match(/<th scope=/g)||[]).length,14);
 h.toggle('MALFUNCTION');assert(h.detail.innerHTML.includes('data-cc-reason="MALFUNCTION" aria-expanded="false"'));h.toggle('MALFUNCTION');assert(h.detail.innerHTML.indexOf('ORDEM-3')<h.detail.innerHTML.indexOf('ORDEM-2'));
 const book=h.sheets('fup','FORNECEDOR ALFA'),detail=sheet(book,'FUP Claims'),subtotals=sheet(book,'FUP Motivos');assert.deepEqual(detail.rows.map(r=>r[7]),[30,10,5]);assert.deepEqual(subtotals.rows.map(r=>r[4]),[40,5]);assert.equal(detail.rows.reduce((sum,r)=>sum+r[7],0),45);assert(!book.some(s=>s.title==='FUP Resumo'));assert(!detail.headers.includes('Categoria'));assert.equal(JSON.stringify(m),before);
});

test('column filters apply before grouping and manual sorting remains effective inside each reason',()=>{
 const h=harness(),rows=[record(2,'Fornecedor exemplo','Motivo A',10),record(3,'Fornecedor exemplo','Motivo A',30),record(4,'Fornecedor exemplo','Motivo B',20)];h.api.render(model(rows));h.click('procurementContent',{ccSupplier:'Fornecedor exemplo'});
 h.filters.set('detail-cc-procurement',r=>r.reason==='Motivo A');h.sorts.set('detail-cc-procurement',(a,b)=>a.claimed-b.claimed);h.api.handleFilter('detail-cc-procurement');
 const book=h.sheets('fup','Fornecedor exemplo');assert.equal(sheet(book,'FUP Motivos').rows.length,1);assert.deepEqual(sheet(book,'FUP Claims').rows.map(r=>r[7]),[10,30]);assert(!h.detail.innerHTML.includes('data-cc-reason="MOTIVO B"'));
});

test('global distinct claim count is not the sum of supplier counts and aging uses Sao Paulo civil date',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Motivo',10,{sgr:'SHARED'}),record(3,'Fornecedor B','Motivo',20,{sgr:'SHARED',openingDate:'2026-11-05'}),record(4,'Fornecedor B','Motivo',30,{openingDate:'2026-11-06'}),record(5,'Fornecedor B','Motivo',40,{openingDate:null})];h.api.render(model(rows));
 const book=h.sheets('fup'),criteria=sheet(book,'Critérios FUP').rows,detail=sheet(book,'FUP Claims').rows;assert.equal(criteria.find(r=>r[0]==='Claims únicos do filtro')[1],3);assert.equal(sheet(book,'FUP Fornecedores').rows.reduce((sum,r)=>sum+r[1],0),4);assert(h.hosts.procurementContent.innerHTML.includes('2 no filtro · 3 claims'));
 const ages=new Map(detail.map(r=>[r.at(-1),r[6]]));assert.equal(ages.get(2),1);assert.equal(ages.get(3),0);assert.equal(ages.get(4),null);assert.equal(ages.get(5),null);
});

test('incomplete source notices are conditional and supplier text is escaped',()=>{
 const h=harness(),m=model([record(2,'<img src=x onerror=alert(1)>','Motivo',10)]);h.api.render(m);assert(!h.hosts.procurementContent.innerHTML.includes('cc-incomplete'));assert(!h.hosts.procurementContent.innerHTML.includes('<img'));assert(h.hosts.procurementContent.innerHTML.includes('&lt;img'));
 m.procurementReport.meta.amountIncomplete=true;h.api.render(m);assert(h.hosts.procurementContent.innerHTML.includes('cc-incomplete'));assert(h.hosts.procurementContent.innerHTML.includes('totais parciais'));
});

test('manual reason order applies to groups and export while supplier changes clear detail filters',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Zeta',50),record(3,'Fornecedor A','Alfa',10),record(4,'Fornecedor B','Beta',20)];h.api.render(model(rows));
 assert(h.detail.innerHTML.indexOf('data-cc-reason="ZETA"')<h.detail.innerHTML.indexOf('data-cc-reason="ALFA"'));
 h.sortMeta.set('detail-cc-procurement',{column:0,direction:'asc'});h.api.handleFilter('detail-cc-procurement');assert(h.detail.innerHTML.indexOf('data-cc-reason="ALFA"')<h.detail.innerHTML.indexOf('data-cc-reason="ZETA"'));
 assert.deepEqual(sheet(h.sheets('fup','Fornecedor A'),'FUP Motivos').rows.map(r=>r[1]),['Alfa','Zeta']);
 h.filters.set('detail-cc-procurement',()=>false);h.api.handleFilter('detail-cc-procurement');assert(h.detail.innerHTML.includes('Sem claims neste filtro'));
 h.click('procurementContent',{ccSupplier:'Fornecedor B'});assert(h.detail.innerHTML.includes('ORDEM-4'));assert(!h.filters.has('detail-cc-procurement'));assert(!h.sortMeta.has('detail-cc-procurement'));assert.equal(h.modal,undefined);
});

test('empty supplier selection removes stale details and restoring filters selects the largest supplier',()=>{
 const h=harness();h.api.render(model([record(2,'Fornecedor A','Motivo',10),record(3,'Fornecedor B','Motivo',30)]));assert(h.detail.innerHTML.includes('Fornecedor B'));
 h.filters.set('cc-procurement-table',()=>false);h.api.handleFilter('cc-procurement-table');assert(h.detail.innerHTML.includes('Nenhum registro neste filtro'));assert(!h.detail.innerHTML.includes('ORDEM-'));assert.equal(sheet(h.sheets('fup'),'FUP Claims').rows.length,0);
 h.filters.delete('cc-procurement-table');h.api.handleFilter('cc-procurement-table');assert(h.detail.innerHTML.includes('Fornecedor B'));assert(h.hosts.procurementContent.innerHTML.includes('cc-master-active'));
});

test('expand and collapse apply to all filtered reasons, including other pages, and reset on supplier switch',()=>{
 const h=harness(),rows=Array.from({length:53},(_,i)=>record(i+2,'Fornecedor A','Motivo '+String(i).padStart(2,'0'),100-i));rows.push(record(100,'Fornecedor B','Motivo B1',1),record(101,'Fornecedor B','Motivo B2',1));h.api.render(model(rows));
 h.filters.set('detail-cc-procurement',r=>r.row!==2);h.api.handleFilter('detail-cc-procurement');
 h.click('procurementContent',{ccReasons:'expand'});assert.equal((h.detail.innerHTML.match(/aria-expanded="true"/g)||[]).length,50);assert(!h.detail.innerHTML.includes('MOTIVO 00'));
 h.click('procurementContent',{ccMicroStep:'1'});assert.equal((h.detail.innerHTML.match(/aria-expanded="true"/g)||[]).length,2);
 h.click('procurementContent',{ccReasons:'collapse'});assert.equal((h.detail.innerHTML.match(/aria-expanded="true"/g)||[]).length,0);h.click('procurementContent',{ccMicroStep:'-1'});assert.equal((h.detail.innerHTML.match(/aria-expanded="false"/g)||[]).length,50);
 h.click('procurementContent',{ccSupplier:'Fornecedor B'});assert.equal((h.detail.innerHTML.match(/aria-expanded="true"/g)||[]).length,1);assert.equal((h.detail.innerHTML.match(/aria-expanded="false"/g)||[]).length,1);assert(!h.filters.has('detail-cc-procurement'));
});

test('procurement identity uses the engine compatibility normalization and separate fallback namespace',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Motivo',10,{sgr:'ＣＬＡＩＭ-１'}),record(3,'Fornecedor A','Motivo',20,{sgr:'CLAIM-1'}),record(4,'Fornecedor A','Motivo',30,{sgr:''}),record(5,'Fornecedor A','Motivo',40,{sgr:'ROW:4'})];h.api.render(model(rows));
 const book=h.sheets('fup');assert.equal(sheet(book,'FUP Fornecedores').rows[0][1],3);assert.equal(sheet(book,'Critérios FUP').rows.find(r=>r[0]==='Claims únicos do filtro')[1],3);assert.equal(sheet(book,'FUP Claims').rows.length,4);
});

test('Claim categorical selections use OR within each field and AND between fields with readable exports',()=>{
 const h=harness(),rows=[record(2,'Fornecedor','Motivo',10,{country:'A',status:'EM ANÁLISE',pending:'P1',analyst:'X'}),record(3,'Fornecedor','Motivo',20,{country:'B',status:'AGUARDANDO CUSTOS',pending:'P2',analyst:'Y'}),record(4,'Fornecedor','Motivo',30,{country:'C',status:'EM ANÁLISE',pending:'P1',analyst:'X'}),record(5,'Fornecedor','Motivo',40,{country:'A',status:'EM ANÁLISE',pending:'P1',analyst:'Z'})];h.api.render(model([],rows));
 h.submit('claims',{country:['A','B'],status:['EM ANÁLISE','AGUARDANDO CUSTOS'],pending:['P1','P2'],analyst:['X','Y']});const book=h.sheets('claims');assert.deepEqual(sheet(book,'Controle de claims').rows.map(r=>r[0]),[3,2]);assert.equal(sheet(book,'Critérios claims').rows.find(r=>r[0]==='País')[1],'A, B');assert.equal(sheet(book,'Critérios claims').rows.find(r=>r[0]==='Analista')[1],'X, Y');assert.equal((h.hosts.claimRecords.innerHTML.match(/<select multiple data-multi-select/g)||[]).length,4);assert(h.hosts.claimRecords.innerHTML.includes('value="B" selected'));
 h.submit('claims',{country:[],status:[],pending:[],analyst:[]});assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,4);
});

test('procurement country and Status H accept several values without changing global portfolio cards',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Motivo',10,{country:'A',pending:'P1'}),record(3,'Fornecedor B','Motivo',20,{country:'B',pending:'P2'}),record(4,'Fornecedor C','Motivo',30,{country:'A',pending:'P3'}),record(5,'Fornecedor D','Motivo',40,{country:'C',pending:'P1'})];h.api.render(model(rows));h.submit('procurement',{country:['A','B'],pending:['P1','P2']});
 const book=h.sheets('fup');assert.deepEqual(sheet(book,'FUP Claims').rows.map(r=>r.at(-1)),[3,2]);assert.equal(sheet(book,'Critérios FUP').rows.find(r=>r[0]==='País')[1],'A, B');assert.equal(sheet(book,'Critérios FUP').rows.find(r=>r[0]==='Status H')[1],'P1, P2');assert.equal(sheet(book,'FUP Resumo').rows.find(r=>r[0]==='Total geral')[1],120);assert.equal((h.hosts.procurementContent.innerHTML.match(/<select multiple data-multi-select/g)||[]).length,2);
});

test('saved Claim/FUP filters restore against new rows and keep a supplier beyond the first page',()=>{
 const h=harness(),rows=Array.from({length:52},(_,i)=>record(i+2,'Fornecedor '+String(i).padStart(2,'0'),'Motivo',100-i));h.api.render(model(rows,[record(1,'Fornecedor A','Motivo',10,{country:'País A'})]));
 h.submit('claims',{country:['País A'],query:''});const saved=h.api.getViewState();saved.supplier='Fornecedor 51';assert(!JSON.stringify(saved).includes('claimed'));h.api.setViewState(saved);
 h.api.render(model(rows.map(r=>({...r,claimed:r.claimed*2})),[record(3,'Fornecedor novo','Motivo',900,{country:'País A'})]));assert(h.detail.innerHTML.includes('Fornecedor 51'));assert(h.hosts.procurementContent.innerHTML.includes('<span>2 / 2</span>'));assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows[0][13],900);assert.deepEqual(Array.from(h.api.getViewState().claims.country),['País A']);
});
