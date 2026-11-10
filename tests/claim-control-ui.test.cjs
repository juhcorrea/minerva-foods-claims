'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../dist/claim-control.js'),'utf8');
function harness(){
 const hosts={},filters=new Map(),sorts=new Map(),sortMeta=new Map(),bodyClasses=new Set(),exports=[];let modal;
 for(const id of ['claimRecords','procurementContent','ccProcurementDetail'])hosts[id]={innerHTML:'',classList:{add(){}},listeners:{},addEventListener(k,fn){this.listeners[k]=fn;},querySelector(){return {textContent:''};}};
 const document={getElementById:id=>hosts[id],querySelector:()=>null,body:{append(el){modal=el;},classList:{toggle(name,value){value?bodyClasses.add(name):bodyClasses.delete(name);}}},createElement:()=>({open:false,innerHTML:'',dataset:{},classList:{add(){},remove(){}},listeners:{},setAttribute(){},addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);},showModal(){this.open=true;},close(){this.open=false;}})};
 const F={prepare(id,headers,rows){const result=filters.has(id)?rows.filter(filters.get(id)):[...rows];return sorts.has(id)?result.sort(sorts.get(id)):result;},heading:(id,col,label)=>label,ariaSort:()=> 'none',describe:id=>filters.has(id)?'Filtro de teste':'',has:id=>filters.has(id),hasSort:id=>sorts.has(id),getSort:id=>sortMeta.get(id),clearDetails(){filters.delete('detail-cc-procurement');sorts.delete('detail-cc-procurement');sortMeta.delete('detail-cc-procurement');}};
 class FormDataFake{constructor(form){this.values=form.values;}get(key){return Array.isArray(this.values[key])?this.values[key][0]:this.values[key]??'';}getAll(key){return this.values[key]===undefined?[]:Array.isArray(this.values[key])?this.values[key]:[this.values[key]];}}
 class FixedDate extends Date{constructor(...args){super(...(args.length?args:['2026-11-06T01:00:00Z']));}static now(){return Date.parse('2026-11-06T01:00:00Z');}}
 const window={MinervaTableFilters:F,MinervaFupExport:{download:payload=>exports.push(JSON.parse(JSON.stringify(payload)))}},context={window,document,FormData:FormDataFake,Date:FixedDate};vm.createContext(context);vm.runInContext(source,context);
 const event=dataset=>({target:{closest:selector=>selector==='button'?{dataset}:null}});
 const click=(host,dataset)=>hosts[host].listeners.click(event(dataset));
 const submit=(scope,values)=>hosts[scope==='claims'?'claimRecords':'procurementContent'].listeners.submit({preventDefault(){},target:{closest:()=>({dataset:{ccForm:scope},values})}});
 const sheets=(scope,supplier)=>{const output=[];window.MinervaClaimControl.worksheets({},(wb,title,headers,rows)=>output.push({title,headers,rows}),scope,supplier);return JSON.parse(JSON.stringify(output));};
 return {window,api:window.MinervaClaimControl,hosts,filters,sorts,sortMeta,bodyClasses,exports,click,submit,sheets,get modal(){return modal;},get detail(){return hosts.ccProcurementDetail;},toggle(key){click('procurementContent',{ccReason:key});}};
}
const record=(row,supplier,reason,claimed,extra={})=>({row,sgr:'SGR-'+row,order:'ORDEM-'+row,supplier,reason,claimed,category:'negotiation',included:true,caseStatus:'ABERTO',caseStatusKey:'open',rncYear:2026,country:'País exemplo',pending:'Aguardando retorno',invoiceDate:'2026-01-01',openingDate:'2026-11-04',nf:'NF-'+row,container:'NF-'+row,originalContainer:'',...extra});
const model=(rows,claims=[])=>({executiveReport:{controlClaims:claims},procurementReport:{rows,negotiationTotal:100,legalTotal:20,grandTotal:120,meta:{}}});
const sheet=(sheets,title)=>sheets.find(s=>s.title===title);

test('Claim cases default to open F across all years, count repeated SGR by line and filter chart, cards and Excel together',()=>{
 const h=harness(),rows=[record(2,'Fornecedor','Avaria',10,{sgr:'REPETIDO',rncYear:2021,country:'BRA',caseStatus:'ABERTO',caseStatusKey:'open',status:'RESSARCIMENTO ENCAMINHADO'}),record(3,'Fornecedor','INTERFERÊNCIA EXTERNA',20,{sgr:'REPETIDO',rncYear:2023,country:'BRA',caseStatus:'ABERTO',caseStatusKey:'open',financialEligible:false}),record(4,'Fornecedor','Avaria',30,{rncYear:2020,country:'ARG',caseStatus:'FECHADO',caseStatusKey:'closed',status:'EM NEGOCIAÇÃO - PROCEDENTE'}),record(5,'Fornecedor','Avaria',40,{rncYear:null,rncDate:null,country:'URY',caseStatus:'Outra classificação',caseStatusKey:'unknown'}),record(6,'Fornecedor','Avaria',50,{sgr:'',rncYear:2022,country:'BRA'})],m=model([],rows);m.meta={allYears:true,years:[2020,2021,2022,2023,2026]};const before=JSON.stringify(m);h.api.render(m);
 let html=h.hosts.claimRecords.innerHTML;assert(html.includes('<span>Casos no filtro</span><strong>2</strong>'));assert(html.includes('<span>Abertos</span><strong>2</strong>'));assert(html.includes('<span>Fechados</span><strong>0</strong>'));assert(html.includes('2 casos no filtro'));assert(html.includes('value="open" selected'));assert.deepEqual(sheet(h.sheets('claims'),'Controle de claims').rows.map(row=>row[0]),[6,3,2]);assert(html.includes('1 sem SGR'));
 h.submit('claims',{caseStatusKey:['closed']});html=h.hosts.claimRecords.innerHTML;assert(html.includes('<span>Casos no filtro</span><strong>1</strong>'));assert(html.includes('<span>Fechados</span><strong>1</strong>'));assert(html.includes('data-cc-case-country="ARG"'));let book=h.sheets('claims');assert.deepEqual(sheet(book,'Controle de claims').rows.map(row=>row[0]),[4]);assert.equal(sheet(book,'Controle de claims').rows[0].at(-1),'FECHADO');assert.equal(sheet(book,'Critérios claims').rows.find(row=>row[0]==='Status do caso · F')[1],'Fechado');
 h.submit('claims',{caseStatusKey:['open','closed']});assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,4);h.click('claimRecords',{ccClear:'claims'});html=h.hosts.claimRecords.innerHTML;assert(html.includes('<span>Casos no filtro</span><strong>4</strong>'));assert(html.includes('<span>Status não informado / outro</span><strong>1</strong>'));h.api.render(m);assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,5,'Clearing stays all statuses after rerender');
 h.click('claimRecords',{ccCaseCountry:'BRA'});assert.deepEqual(sheet(h.sheets('claims'),'Controle de claims').rows.map(row=>row[0]),[6,3,2]);h.api.setViewState({claims:{caseStatusKey:[],country:[]}});m.meta={...m.meta,allYears:false,years:[2020]};h.api.render(m);assert.deepEqual(sheet(h.sheets('claims'),'Controle de claims').rows.map(row=>row[0]),[4]);m.meta={allYears:true,years:[2020,2021,2022,2023,2026]};assert.equal(JSON.stringify(m),before);
});

test('Claim status from F survives saved views independently of procurement and unknown F is never inferred from G',()=>{
 const h=harness(),m=model([record(8,'Fornecedor FUP','Motivo',60)],[record(2,'Fornecedor','Motivo',10,{caseStatus:'',caseStatusKey:'unknown',status:'EM NEGOCIAÇÃO - PROCEDENTE'})]);h.api.render(m);assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,0);h.submit('claims',{caseStatusKey:['unknown']});h.submit('procurement',{country:['País exemplo']});const saved=h.api.getViewState();assert.deepEqual(Array.from(saved.claims.caseStatusKey),['unknown']);h.api.setViewState(saved);h.api.render(m);assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,1);assert.equal(sheet(h.sheets('fup'),'FUP Claims').rows.length,1);assert(h.hosts.claimRecords.innerHTML.includes('Status do caso · F'));assert(h.hosts.claimRecords.innerHTML.includes('Situação · G'));
});

test('dedicated case summary precedes financial disclosure and its filters leave the data table mounted below',()=>{
 const h=harness();h.hosts.claimCaseSummary={innerHTML:'',classList:{add(){}},listeners:{},addEventListener(key,listener){this.listeners[key]=listener;}};h.api.render(model([],[record(2,'Fornecedor','Motivo',10,{country:'BRA'}),record(3,'Fornecedor','Motivo',20,{country:'ARG'})]));assert(h.hosts.claimCaseSummary.innerHTML.includes('Casos por país'));assert(h.hosts.claimCaseSummary.innerHTML.includes('name="caseStatusKey"'));assert(!h.hosts.claimRecords.innerHTML.includes('Casos por país'));assert(h.hosts.claimRecords.innerHTML.includes('data-table-id="cc-claims-table"'));h.click('claimCaseSummary',{ccCaseCountry:'BRA'});assert.deepEqual(sheet(h.sheets('claims'),'Controle de claims').rows.map(row=>row[0]),[2]);
 const index=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8'),begin=index.indexOf('id="claimCaseSummary"'),financial=index.indexOf('id="claimAnalytics"'),base=index.indexOf('id="claimRecords"');assert(begin>=0&&begin<financial&&financial<base);assert(index.includes('<details class="panel cc-financial-complement">'));assert(!fs.readFileSync(path.join(__dirname,'../dist/executive.js'),'utf8').includes("heading('Claims em aberto por país'"));
});

test('case cards identify source/year and open exact stage rows without changing applied filters or counting repeated SGR once',()=>{
 const h=harness(),collapse=[],scrolls=[];h.window.MinervaSectionCollapse={setCollapsed(key,value){collapse.push({key,value});},refresh(){}};h.hosts.claimRecords.scrollIntoView=value=>scrolls.push(value);h.window.MinervaApp={state:{bdName:'BD demonstração.xlsx',publishedMeta:{revision:'revision-a'}}};
 const rows=[record(2,'Fornecedor','Motivo',10.12,{rncYear:2020,sgr:'REPETIDO',status:'EM ANÁLISE'}),record(3,'Fornecedor','Motivo',20.23,{rncYear:2020,sgr:'REPETIDO',status:'EM ANALISE'}),record(4,'Fornecedor','Motivo',30.34,{rncYear:2020,status:'AGUARDANDO CUSTOS'}),record(5,'Fornecedor','Motivo',40.45,{rncYear:2020,status:'EM NEGOCIAÇÃO - PROCEDENTE',caseStatusKey:'closed',caseStatus:'FECHADO'}),record(6,'Fornecedor','Motivo',50.56,{rncYear:2020,sgr:'',status:'EM NEGOCIAÇÃO - PROCEDENTE'})],m=model([],rows);m.meta={allYears:false,years:[2020]};h.api.render(m);let html=h.hosts.claimRecords.innerHTML;
 assert(html.includes('BD demonstração.xlsx'));assert(html.includes('Ano · Data RNC (B):</strong> 2020'));for(const key of ['all','open','closed','analysis','costs','negotiating'])assert(html.includes('data-cc-case-metric="'+key+'"'));assert(html.includes('<span>Em análise</span><strong>2</strong>'));assert(html.includes('<span>Aguardando custos</span><strong>1</strong>'));assert(html.includes('<span>Em negociação</span><strong>0</strong>'));assert(!html.includes('<span>Sem atualização</span>'));assert.equal(collapse.at(-1).value,true);
 const filters=JSON.stringify(h.api.getViewState());h.click('claimRecords',{ccCaseMetric:'analysis'});assert.deepEqual(sheet(h.sheets('claims'),'Controle de claims').rows.map(row=>row[0]),[3,2]);assert.equal(JSON.stringify(h.api.getViewState()),filters);assert.equal(collapse.at(-1).value,false);assert.equal(scrolls.at(-1).block,'start');assert(h.hosts.claimRecords.innerHTML.includes('aria-pressed="true"'));
 h.click('claimRecords',{ccCaseMetric:'closed'});assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,0);assert(h.hosts.claimRecords.innerHTML.includes('Nenhum fechado nos filtros atuais; altere Status F para consultar.'));assert.equal(JSON.stringify(h.api.getViewState()),filters);
 h.click('claimRecords',{ccClearMetric:''});assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,4);h.click('claimRecords',{ccCaseMetric:'all'});assert.equal(sheet(h.sheets('claims'),'Controle de claims').rows.length,3,'Total card opens counted cases, excluding only empty SGR rows');h.click('claimRecords',{ccCaseMetric:'costs'});const book=h.sheets('claims');assert.equal(sheet(book,'Controle de claims').rows[0][13],30.34);assert.equal(sheet(book,'Critérios claims').rows.find(row=>row[0]==='Detalhamento do card')[1],'Aguardando custos · G');
 const prior=collapse.length;h.api.render({...m});assert.equal(collapse.length,prior,'Filtering or recalculation within the same source preserves expansion');h.window.MinervaApp.state.publishedMeta.revision='revision-b';h.api.render({...m});assert.equal(collapse.at(-1).value,true,'New published source starts collapsed');
});

test('FUP visual totals round to integers while detail rows and every Excel payload retain decimals',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Avaria',1000.2549),record(3,'Fornecedor A','Avaria',200.4999),record(4,'Fornecedor B','Outro',1200.80)],m=model(rows);Object.assign(m.procurementReport,{negotiationTotal:9999.6,legalTotal:1234.4,grandTotal:11234});const before=JSON.stringify(m);h.api.render(m);
 const macro=h.hosts.procurementContent.innerHTML;assert(macro.includes('<strong>10.000</strong>'));assert(macro.includes('<strong>1.234</strong>'));assert(macro.includes('<strong>11.234</strong>'));assert.equal((macro.match(/class="cc-master-value">1\.201</g)||[]).length,2);assert(macro.indexOf('data-cc-supplier="Fornecedor B"')<macro.indexOf('data-cc-supplier="Fornecedor A"'),'Sorting uses exact subtotals, even when rounded labels match');assert(macro.includes('USD 2.402</strong>'));assert(!macro.includes('9.999,60'));
 h.click('procurementContent',{ccSupplier:'Fornecedor A'});const detail=h.detail.innerHTML;assert(detail.includes('<strong>1.201</strong>'));assert(detail.includes('<b><i>USD</i> 1.201</b>'));assert(detail.includes('1.000,25'));assert(detail.includes('200,50'));
 const book=h.sheets('fup'),selected=h.sheets('fup','Fornecedor A');assert.equal(sheet(book,'FUP Resumo').rows[0][1],9999.6);assert.equal(sheet(book,'FUP Fornecedores').rows.find(row=>row[0]==='Fornecedor A')[2],1000.2549+200.4999);assert.equal(sheet(selected,'FUP Motivos').rows[0][4],1000.2549+200.4999);assert.deepEqual(sheet(selected,'FUP Claims').rows.map(row=>row[7]),[1000.2549,200.4999]);
 h.api.exportProcurement('Fornecedor A');const payload=h.exports[0];assert.equal(payload.total,1000.2549+200.4999);assert.equal(payload.groups[0].reasons[0].total,payload.total);assert.deepEqual(payload.groups[0].reasons[0].rows.map(row=>row.claimed),[1000.2549,200.4999]);assert.equal(JSON.stringify(m),before);
});

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
 assert(h.detail.innerHTML.includes('Fornecedor Beta'));assert.equal(h.modal,undefined);h.click('procurementContent',{ccSupplier:'Fornecedor Alfa'});const html=h.detail.innerHTML;assert.equal((html.match(/aria-expanded="false"/g)||[]).length,1);assert.equal((html.match(/aria-expanded="true"/g)||[]).length,1);assert(html.indexOf('data-cc-reason="MALFUNCTION"')<html.indexOf('data-cc-reason="AVARIA"'));assert(html.includes('<b><i>USD</i> 40</b>'));assert.equal((html.match(/<th scope=/g)||[]).length,14);
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
 h.submit('claims',{country:['A','B'],status:['EM ANÁLISE','AGUARDANDO CUSTOS'],pending:['P1','P2'],analyst:['X','Y']});const book=h.sheets('claims');assert.deepEqual(sheet(book,'Controle de claims').rows.map(r=>r[0]),[3,2]);assert.equal(sheet(book,'Critérios claims').rows.find(r=>r[0]==='País')[1],'A, B');assert.equal(sheet(book,'Critérios claims').rows.find(r=>r[0]==='Analista')[1],'X, Y');assert.equal((h.hosts.claimRecords.innerHTML.match(/<select multiple data-multi-select/g)||[]).length,5);assert(h.hosts.claimRecords.innerHTML.includes('value="B" selected'));
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

test('meeting Excel includes all macro-filtered suppliers and pages, but never legal or excluded detail',()=>{
 const h=harness(),rows=Array.from({length:55},(_,i)=>record(i+2,'Fornecedor '+String(i).padStart(2,'0'),'Motivo',i+1,{country:i===0?'Fora':'Dentro'}));rows.push(record(100,'Jurídico oculto','Jurídico',999,{category:'legal'}),record(101,'FUP excluído','Excluído',999,{included:false}));
 const m=model(rows),before=JSON.stringify(m);h.api.render(m);h.submit('procurement',{country:['Dentro']});h.filters.set('cc-procurement-table',group=>group.negotiation>=3);h.api.handleFilter('cc-procurement-table');h.click('procurementContent',{ccExport:'procurement'});
 const output=h.exports[0];assert.equal(output.groups.length,53);assert.equal(output.rowCount,53);assert.equal(output.groups[0].supplier,'Fornecedor 54');assert.equal(output.total,rows.slice(2,55).reduce((sum,row)=>sum+row.claimed,0));assert.equal(output.globalTotals.legal,20);assert.equal(output.globalTotals.total,120);assert.equal(output.selectedSupplier,null);assert(output.groups.every(group=>group.reasons.every(reason=>reason.expanded)));assert(!JSON.stringify(output.groups).includes('Jurídico oculto'));assert(!JSON.stringify(output.groups).includes('FUP excluído'));assert.equal(JSON.stringify(m),before);
});

test('selected supplier meeting Excel preserves micro filters, order and collapsed reasons without dropping hidden rows',()=>{
 const h=harness(),rows=[record(2,'Fornecedor A','Zeta',30),record(3,'Fornecedor A','Alfa',20),record(4,'Fornecedor A','Alfa',10),record(5,'Fornecedor B','Outro',5)];h.api.render(model(rows));h.click('procurementContent',{ccSupplier:'Fornecedor A'});h.filters.set('detail-cc-procurement',row=>row.row!==2);h.sortMeta.set('detail-cc-procurement',{column:0,direction:'asc'});h.sorts.set('detail-cc-procurement',(a,b)=>a.claimed-b.claimed);h.api.handleFilter('detail-cc-procurement');h.click('procurementContent',{ccReasons:'collapse'});h.click('procurementContent',{ccExportSupplier:'Fornecedor A'});
 const output=h.exports[0];assert.equal(output.selectedSupplier,'Fornecedor A');assert.equal(output.groups.length,1);assert.equal(output.total,30);assert.equal(output.rowCount,2);assert.equal(output.groups[0].reasons[0].expanded,false);assert.deepEqual(output.groups[0].reasons[0].rows.map(row=>row.claimed),[10,20]);assert.equal(output.groups[0].reasons[0].total,30);assert.equal(output.groups[0].reasons[0].rows[0].days,1);assert(output.criteria.some(row=>row[0]==='Colunas micro'&&row[1]==='Filtro de teste'));
});
