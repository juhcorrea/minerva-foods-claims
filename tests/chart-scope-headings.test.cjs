'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const host=()=>({innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;},classList:{add(){},remove(){}}});
const read=name=>fs.readFileSync(require.resolve('../dist/'+name),'utf8');
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

test('chart titles disclose the financial year/base and rankings include eligible non-procedente situations',()=>{
 const ui=executive(),model=fixture(),before=JSON.stringify(model);
 assert.equal(model.summary.claimed,351.15);assert.equal(model.summary.negotiating,100.41);
 ui.api.render(model);ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/<h3>Valor reclamado por causador · BD · 2026<\/h3>/);
 assert.match(ui.claims.innerHTML,/Reclamado AJ · não limitado a procedentes · Data RNC B/);
 assert.match(ui.claims.innerHTML,/exceto EM ANÁLISE, AGUARDANDO CUSTOS e RESPONDIDO - NÃO PROCEDE/);
 assert.match(ui.claims.innerHTML,/Causador AX da BD, distinto do fornecedor de negociação AC/);
 assert.match(ui.claims.innerHTML,/Fornecedor: Fornecedor exemplo · Operação: COMERCIAL/);
 assert.match(ui.claims.innerHTML,/Não usa Status F nem filtros locais da lista operacional/);
 assert.match(ui.dashboard.innerHTML,/Recebido por compensação · Controle · 2026/);
 assert.match(ui.dashboard.innerHTML,/Este gráfico inclui pendências H contendo FUP SUPRIMENTOS; o card Em negociação as exclui/);
 assert.equal(JSON.stringify(model),before);
});

test('negotiation card opens only its non-FUP rows while country chart keeps its broader scope and cents',()=>{
 const ui=executive(),model=fixture();ui.api.render(model);
 const card=ui.dashboard.innerHTML.match(/Em negociação<[^]*?<button[^>]*data-exec-detail="([^"]+)"/);assert(card);
 ui.click(card[1]);assert.match(ui.content.innerHTML,/NEG-KEEP/);assert.doesNotMatch(ui.content.innerHTML,/NEG-FUP/);assert.match(ui.content.innerHTML,/100,41/);
 const country=ui.dashboard.innerHTML.match(/class="exec-country" data-exec-detail="([^"]+)"/);assert(country);
 ui.click(country[1]);assert.match(ui.content.innerHTML,/NEG-KEEP/);assert.match(ui.content.innerHTML,/NEG-FUP/);assert.match(ui.content.innerHTML,/200,49/);
 assert.match(ui.dashboard.innerHTML,/exclui pendência H contendo FUP SUPRIMENTOS/);
});

test('scope labels follow applied metadata, compact only continuous years, and do not revive cleared legacy filters',()=>{
 const ui=executive(),model=fixture();model.meta.years=[2024,2025,2026];model.meta.suppliers=['A','B','C'];model.meta.claimStatuses=['RESSARCIMENTO ENCAMINHADO'];ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/BD · 2024–2026/);assert.match(ui.claims.innerHTML,/Fornecedor: A, B \+ 1/);assert.match(ui.claims.innerHTML,/Fornecedores: A, B, C/);assert.match(ui.claims.innerHTML,/Situação G: RESSARCIMENTO ENCAMINHADO/);
 model.meta.years=[2024,2026];model.meta.suppliers=[];model.meta.supplier='stale supplier';model.meta.operations=[];model.meta.operation='stale operation';ui.api.renderClaims(model,ui.claims);
 assert.match(ui.claims.innerHTML,/BD · 2024 \+ 2026/);assert.match(ui.claims.innerHTML,/Fornecedor: todos · Operação: todas/);assert.doesNotMatch(ui.claims.innerHTML,/stale supplier|stale operation/);
});

test('receipt headings separate compensation years from all-year open balances and use only the applied scope argument',()=>{
 const dashboard=host(),reads=[],document={getElementById(id){reads.push(id);if(id==='receiptsExecutive')return dashboard;throw Error('draft filter DOM must not be read');},addEventListener(){}},window={};vm.runInNewContext(read('receipts-executive.js'),{window,document});
 const rows=[{row:2,isControlRecord:true,status:'Pago',includedInConfirmed:true,received:123.45,compensationMonth:'2025-02',supplier:'Supplier A'},{row:3,isControlRecord:true,status:'Vencido',expected:56.78,supplier:'Supplier A'}],model={meta:{years:[2025,2026],asOf:'2026-11-10',operations:['GLOBAL DRAFT'],suppliers:['Supplier A']},controlReport:{meta:{operations:['CONTROL APPLIED']},installments:rows}},before=JSON.stringify(model);
 window.MinervaReceiptsExecutive.render(model,rows,undefined,'Operação: CONTROL APPLIED · Busca: <applied> · Status: todos');
 assert.match(dashboard.innerHTML,/Recebido por mês · 2025 \+ 2026/);assert.match(dashboard.innerHTML,/Carteira em aberto · todos os anos/);assert.match(dashboard.innerHTML,/Fornecedores · aberto · todos os anos/);assert.match(dashboard.innerHTML,/Analistas · recebido · 2025 \+ 2026/);
 assert.match(dashboard.innerHTML,/Filtros aplicados · Fornecedor: Supplier A · Operação: CONTROL APPLIED · Busca: &lt;applied&gt;/);assert.doesNotMatch(dashboard.innerHTML,/<applied>|GLOBAL DRAFT/);
 assert.match(dashboard.innerHTML,/previsão N anterior à posição em 10\/11\/2026/);assert.match(dashboard.innerHTML,/M = Pago, compensação R válida em 2025 \+ 2026 e recebido T positivo/);
 assert.equal((dashboard.innerHTML.match(/class="rx-info" tabindex="0"/g)||[]).length,5);assert.deepEqual(reads,['receiptsExecutive']);assert.equal(JSON.stringify(model),before);
 window.MinervaReceiptsExecutive.render(model,rows);assert.match(dashboard.innerHTML,/Operação do Controle: CONTROL APPLIED/);assert.doesNotMatch(dashboard.innerHTML,/&lt;applied&gt;|GLOBAL DRAFT/);
});
