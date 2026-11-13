'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const host=()=>({innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;},classList:{add(){},remove(){}}});
const read=name=>fs.readFileSync(require.resolve('../dist/'+name),'utf8');
const visible=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
const columnCodes=/\b(?:AJ|AF|AX|AC|BF|BJ|BK)\b|\bStatus F\b|\bSituação G\b|Data RNC B\b|coluna [A-Z]\b|compensação R\b|previsto O\b|recebido T\b|\bM =/i;
function executive(){
 const dashboard=host(),claims=host(),content={innerHTML:'',querySelector:()=>({addEventListener(){}})},dialog={showModal(){}},nodes={executiveDashboard:dashboard,detailDialog:dialog,detailContent:content,detailTitle:{}},document={getElementById:id=>nodes[id]},window={document};
 vm.runInNewContext(read('executive.js'),{window,document});
 return {dashboard,claims,content,api:window.MinervaExecutive,click(id){dashboard.events.click({target:{closest:()=>({dataset:{execDetail:id}})}});}};
}
function fixture(){
 const bh=Array(65).fill(''),ch=Array(32).fill('');Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',49:'Causador',56:'Analista'});
 Object.assign(ch,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
 const row=(ref,status,amount,pending='')=>Object.assign(Array(65).fill(null),{0:ref,1:'2026-02-01',5:'FECHADO',6:status,7:pending,10:'AVARIA',19:'BRA',22:ref,25:'COMERCIAL',28:'Fornecedor exemplo',35:amount,49:'Causador exemplo'});
 return E.analyze([bh,row('NEG-KEEP','EM NEGOCIAÇÃO - PROCEDENTE',100.41),row('NEG-FUP','EM NEGOCIAÇÃO - PROCEDENTE',200.49,'AGUARDANDO FUP SUPRIMENTOS RETORNO'),row('FORWARDED','RESSARCIMENTO ENCAMINHADO',50.25),row('ANALYSIS','EM ANÁLISE',700),row('COSTS','AGUARDANDO CUSTOS',800),row('DENIED','RESPONDIDO - NÃO PROCEDE',900)],[ch],{years:[2026],asOf:'2026-11-10',operations:['COMERCIAL'],suppliers:['Fornecedor exemplo']});
}

test('chart titles retain the financial year and footers disclose the base without changing eligible situations',()=>{
 const ui=executive(),model=fixture(),before=JSON.stringify(model);
 assert.equal(model.summary.claimed,351.15);assert.equal(model.summary.negotiating,100.41);
 ui.api.render(model);ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/<h3>Valor reclamado por causador · 2026<\/h3>/);
 assert.match(ui.claims.innerHTML,/Situações elegíveis · Data RNC/);
 assert.match(ui.claims.innerHTML,/exceto EM ANÁLISE, AGUARDANDO CUSTOS e RESPONDIDO - NÃO PROCEDE/);
 assert.match(ui.claims.innerHTML,/Causador AX da BD, distinto do fornecedor de negociação AC/);
 assert.match(ui.claims.innerHTML,/Fornecedor: Fornecedor exemplo · Operação: COMERCIAL/);
 assert.match(ui.claims.innerHTML,/Não usa Status F nem filtros locais da lista operacional/);
 assert.match(ui.dashboard.innerHTML,/Recebimento mensal · 2026/);
 assert.match(ui.dashboard.innerHTML,/<h3>Maiores causadores · 2026<\/h3>/);
 assert.match(ui.dashboard.innerHTML,/<h3>Recebimento em aberto por fornecedor · Todos os anos<\/h3>/);
 assert.match(ui.dashboard.innerHTML,/<h3>Recebimento por fornecedor · 2026<\/h3>/);
 assert.equal((ui.dashboard.innerHTML.match(/<footer class="exec-source-foot">BASE: (?:BD|RECEBIMENTO)<\/footer>/g)||[]).length,7);
 assert.equal((ui.claims.innerHTML.match(/<footer class="exec-source-foot">BASE: BD<\/footer>/g)||[]).length,3);
 for(const html of [ui.dashboard.innerHTML,ui.claims.innerHTML])assert.doesNotMatch([...html.matchAll(/<h3>(.*?)<\/h3>/g)].map(match=>match[1]).join(' '),/\bBD\b|(?:^| · )Controle(?: · |$)|BASE:/);
 assert.match(ui.dashboard.innerHTML,/<h3>Controle de claim · 2026<\/h3>/,'the new case summary is a legitimate chart name, not a receipt-base label');
 assert.match(ui.dashboard.innerHTML,/sem Pendência contendo FUP SUPRIMENTOS/);
 assert.match(ui.dashboard.innerHTML,/<h3>Em negociação procedente por país · Todos os anos<\/h3>/);
 assert.match(ui.dashboard.innerHTML,/Mesma carteira histórica do card Em negociação/);
 assert.doesNotMatch(visible(ui.dashboard.innerHTML),columnCodes);assert.doesNotMatch(visible(ui.claims.innerHTML),columnCodes);
 assert.match(visible(ui.dashboard.innerHTML),/Status pagamento: Pago · Data de compensação/);
 assert.equal(JSON.stringify(model),before);
});

test('negotiation card and country chart preserve non-FUP detail and cents when all eligible rows are in the selected year',()=>{
 const ui=executive(),model=fixture();ui.api.render(model);
 const card=ui.dashboard.innerHTML.match(/Em negociação<[^]*?<button[^>]*data-exec-detail="([^"]+)"/);assert(card);
 ui.click(card[1]);assert.match(ui.content.innerHTML,/NEG-KEEP/);assert.doesNotMatch(ui.content.innerHTML,/NEG-FUP/);assert.match(ui.content.innerHTML,/100,41/);
 const country=ui.dashboard.innerHTML.match(/class="exec-country" data-exec-detail="([^"]+)"/);assert(country);
 ui.click(country[1]);assert.match(ui.content.innerHTML,/NEG-KEEP/);assert.doesNotMatch(ui.content.innerHTML,/NEG-FUP/);assert.match(ui.content.innerHTML,/100,41/);
 assert.match(ui.dashboard.innerHTML,/Exclui Pendência contendo FUP SUPRIMENTOS e Motivo INTERFERÊNCIA EXTERNA/);
 assert.match(ui.dashboard.innerHTML,/Carteira de todos os anos, independente do filtro de ano/);
});

test('scope labels follow applied metadata, compact only continuous years, and do not revive cleared legacy filters',()=>{
 const ui=executive(),model=fixture();model.meta.years=[2024,2025,2026];model.meta.suppliers=['A','B','C'];model.meta.claimStatuses=['RESSARCIMENTO ENCAMINHADO'];ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/<h3>Claims em aberto por país · 2024–2026<\/h3>/);assert.match(ui.claims.innerHTML,/Fornecedor: A, B \+ 1/);assert.match(ui.claims.innerHTML,/Fornecedores: A, B, C/);assert.match(ui.claims.innerHTML,/Situação: RESSARCIMENTO ENCAMINHADO/);
 model.meta.years=[2024,2026];model.meta.suppliers=[];model.meta.supplier='stale supplier';model.meta.operations=[];model.meta.operation='stale operation';ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/<h3>Claims em aberto por país · 2024 e 2026<\/h3>/);assert.match(ui.claims.innerHTML,/Fornecedor: todos · Operação: todas/);assert.doesNotMatch(ui.claims.innerHTML,/stale supplier|stale operation/);
});

test('receipt headings separate compensation years from all-year open balances and use only the applied scope argument',()=>{
 const dashboard=host(),reads=[],document={getElementById(id){reads.push(id);if(id==='receiptsExecutive')return dashboard;throw Error('draft filter DOM must not be read');},addEventListener(){}},window={};vm.runInNewContext(read('receipts-executive.js'),{window,document});
 const rows=[{row:2,isControlRecord:true,status:'Pago',includedInConfirmed:true,received:123.45,compensationMonth:'2025-02',supplier:'Supplier A'},{row:3,isControlRecord:true,status:'Vencido',expected:56.78,supplier:'Supplier A'}],model={meta:{years:[2025,2026],asOf:'2026-11-10',operations:['GLOBAL DRAFT'],suppliers:['Supplier A']},controlReport:{meta:{operations:['CONTROL APPLIED']},installments:rows}},before=JSON.stringify(model);
 window.MinervaReceiptsExecutive.render(model,rows,undefined,'Operação: CONTROL APPLIED · Busca: <applied> · Status: todos');
 assert.match(dashboard.innerHTML,/Recebido por mês · 2025 e 2026/);assert.match(dashboard.innerHTML,/Carteira em aberto · todos os anos/);assert.match(dashboard.innerHTML,/Fornecedores · aberto · todos os anos/);assert.match(dashboard.innerHTML,/Analistas · recebido · 2025 e 2026/);
 assert.match(dashboard.innerHTML,/Filtros aplicados · Fornecedor: Supplier A · Operação: CONTROL APPLIED · Busca: &lt;applied&gt;/);assert.doesNotMatch(dashboard.innerHTML,/<applied>|GLOBAL DRAFT/);
 assert.match(dashboard.innerHTML,/Data prevista anterior à posição em 10\/11\/2026/);assert.match(dashboard.innerHTML,/Status pagamento = Pago, Data de compensação válida em 2025 e 2026 e Valor Recebido USD positivo/);
 assert.equal((dashboard.innerHTML.match(/class="rx-info" hidden tabindex="-1"/g)||[]).length,5);assert.deepEqual(reads,['receiptsExecutive']);assert.equal(JSON.stringify(model),before);
 assert.equal((dashboard.innerHTML.match(/<footer class="rx-source-foot">BASE: RECEBIMENTO<\/footer>/g)||[]).length,5);
 assert.doesNotMatch([...dashboard.innerHTML.matchAll(/<(?:h3|p class="rx-panel-scope")>(.*?)<\/(?:h3|p)>/g)].map(match=>match[1]).join(' '),/\bControle\b|BASE:/);
 assert.doesNotMatch(visible(dashboard.innerHTML),columnCodes);
 window.MinervaReceiptsExecutive.render(model,rows);assert.match(dashboard.innerHTML,/Operação do Controle: CONTROL APPLIED/);assert.doesNotMatch(dashboard.innerHTML,/&lt;applied&gt;|GLOBAL DRAFT/);
});

test('analytical detail headers use field names while keeping exact amounts and source row references',()=>{
 const ui=executive(),model=fixture();model.supplierOpenReport={meta:{openBalance:123.45},installments:[{row:2,supplier:'Example',reference:'REF-DEMO',status:'Dentro do Prazo',dueDate:'2026-12-10',expected:123.45}]};ui.api.render(model);
 const openId=ui.dashboard.innerHTML.match(/Saldo em aberto<[^]*?<button[^>]*data-exec-detail="([^"]+)"/)[1];ui.click(openId);
 assert.match(ui.content.innerHTML,/Status pagamento/);assert.match(ui.content.innerHTML,/Data prevista/);assert.match(ui.content.innerHTML,/Valor previsto USD/);assert.match(ui.content.innerHTML,/123,45/);assert.doesNotMatch(visible(ui.content.innerHTML),columnCodes);
 const dashboard=host(),nodes={receiptsExecutive:dashboard},document={getElementById:id=>nodes[id],addEventListener(){},createElement(){return{...host(),setAttribute(){},showModal(){}};},body:{append(node){nodes[node.id]=node;}}},window={};vm.runInNewContext(read('receipts-executive.js'),{window,document});
 window.MinervaReceiptsExecutive.render({meta:{years:[2026]},controlReport:{installments:[{row:2,isControlRecord:true,status:'Pago',includedInConfirmed:true,received:123.45,compensationMonth:'2026-01'}]}});
 const paidId=dashboard.innerHTML.match(/data-rx-detail="([^"]+)"/)[1];dashboard.events.click({target:{closest:()=>({dataset:{rxDetail:paidId}})}});
 const html=nodes.receiptsExecutiveDetail.innerHTML;assert.match(html,/<th[^>]*>Data de compensação<\/th>/);assert.match(html,/<th[^>]*>Recebido<\/th>/);assert.match(html,/<th[^>]*>Analista<\/th>/);assert.match(html,/123,45/);assert.doesNotMatch(visible(html),columnCodes);
 const index=read('index.html');assert.doesNotMatch(index,/<details[^>]*cc-financial-complement/);assert(index.indexOf('id="claimAnalytics"')<index.indexOf('id="claimCaseSummary"'));
});

test('the original situation chart and both financial rankings stay visible before the additional case-status view',()=>{
 const ui=executive(),model=fixture(),before=JSON.stringify(model);ui.api.renderClaims(model,ui.claims);const html=ui.claims.innerHTML;
 assert.match(html,/Claims em aberto por país · 2026/);assert.match(html,/class="exec-sla"/);assert.match(html,/Valor reclamado por motivo/);assert.match(html,/Valor reclamado por causador/);
 for(const color of ['#2E5372','#BDB58C','#E84752'])assert(html.includes('background:'+color));
 const countryId=html.match(/class="exec-country-row" data-exec-detail="([^"]+)"/)[1];ui.claims.events.click({target:{closest:()=>({dataset:{execDetail:countryId}})}});
 for(const reference of ['NEG-KEEP','NEG-FUP','ANALYSIS','COSTS'])assert(ui.content.innerHTML.includes(reference));assert.doesNotMatch(ui.content.innerHTML,/FORWARDED|DENIED/);
 assert.equal(JSON.stringify(model),before);assert.doesNotMatch(visible(html),columnCodes);
});

test('country chart total is prominent and opens exactly the union of case rows, preserving repeated SGR and cents',()=>{
 const ui=executive(),model=fixture(),report=model.executiveReport,original=report.claimRows.find(row=>row.sgr==='NEG-KEEP');
 report.claimRows.push({...original,row:99,country:'ARG',claimed:10.25},{...original,row:100,country:'ARG',claimed:20.75});
 report.openByCountry.push({country:'ARG',negotiating:2,inAnalysis:0,awaitingCosts:0,total:2,rows:[99,100]});const before=JSON.stringify(model);
 ui.api.renderClaims(model,ui.claims);const html=ui.claims.innerHTML,button=html.match(/class="exec-open-total" data-exec-detail="([^"]+)"[^>]*><span>Total geral<\/span><strong>(\d+)<\/strong><small>casos<\/small>/);assert(button);assert.equal(Number(button[2]),6);assert(html.indexOf('exec-open-total')<html.indexOf('exec-country-bars'));
 ui.claims.events.click({target:{closest:()=>({dataset:{execDetail:button[1]}})}});assert.match(ui.content.innerHTML,/6 de 6 linhas/);assert.match(ui.content.innerHTML,/10,25/);assert.match(ui.content.innerHTML,/20,75/);assert.equal((ui.content.innerHTML.match(/<td>NEG-KEEP<\/td>/g)||[]).length,3);assert.doesNotMatch(ui.content.innerHTML,/FORWARDED|DENIED/);assert.equal(JSON.stringify(model),before);
 report.openByCountry=[];ui.api.renderClaims(model,ui.claims);const empty=ui.claims.innerHTML.match(/class="exec-open-total" data-exec-detail="([^"]+)"[^>]*><span>Total geral<\/span><strong>0<\/strong>/);assert(empty);ui.claims.events.click({target:{closest:()=>({dataset:{execDetail:empty[1]}})}});assert.match(ui.content.innerHTML,/0 de 0 linhas/);
});

test('all-year and long selected periods use short truthful labels in both chart modules',()=>{
 const ui=executive(),model=fixture();model.meta.allYears=true;model.meta.years=Array.from({length:11},(_,i)=>2018+i);ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/Claims em aberto por país · Todos os anos/);assert.doesNotMatch(visible(ui.claims.innerHTML),/Claims em aberto por país · 2018[– ]/);
 model.meta.allYears=false;model.meta.years=[2018,2020,2026];ui.api.renderClaims(model,ui.claims);assert.match(ui.claims.innerHTML,/3 anos selecionados desde 2018/);assert.doesNotMatch(ui.claims.innerHTML,/2018 e 2020 e 2026/);
 const dashboard=host(),document={getElementById:id=>id==='receiptsExecutive'?dashboard:null,addEventListener(){}},window={};vm.runInNewContext(read('receipts-executive.js'),{window,document});model.meta.allYears=true;window.MinervaReceiptsExecutive.render(model,[]);assert.match(dashboard.innerHTML,/Recebido por mês · Todos os anos/);
 model.meta.allYears=false;model.meta.years=[2024,2025,2026];window.MinervaReceiptsExecutive.render(model,[]);assert.match(dashboard.innerHTML,/Recebido por mês · 2024–2026/);
});

test('pipeline country bars retain labels and use only the five existing official flag assets',()=>{
 const ui=executive(),m=fixture(),countries=[['BRA','br','Brasil'],['PRY','py','Paraguai'],['URY','uy','Uruguai'],['COL','co','Colômbia'],['ARG','ar','Argentina'],['N/I',null,null]];m.executiveReport.openByCountry=countries.map(([country],i)=>({country,negotiating:1,inAnalysis:0,awaitingCosts:0,total:1,rows:[i+2]}));ui.api.render(m);ui.api.renderClaims(m,ui.claims);
 for(const html of [ui.dashboard.innerHTML,ui.claims.innerHTML]){const labels=[...html.matchAll(/<span class="exec-country-name">([^]*?)<\/span>/g)].map(match=>match[1]);assert.equal(labels.length,countries.length);for(let i=0;i<5;i++){const [code,asset,name]=countries[i];assert(labels[i].includes('src="assets/flags/'+asset+'.svg"'));assert(labels[i].includes('alt="Bandeira: '+name+'"'));assert(labels[i].endsWith(code));}assert.equal(labels[5],'N/I');}
});
