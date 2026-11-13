'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(sgr,caseStatus,situation,extra={})=>row(65,{0:sgr,1:'2026-11-02',3:'ME',5:caseStatus,6:situation,7:'',10:'AVARIA',19:'BRA',22:'QA-ORDER-'+sgr,24:'QA-NF-'+sgr,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor Alfa',35:100.25,...extra});
const fixture=()=>[bh,
  claim('QA-REPEATED','ABERTO','EM NEGOCIAÇÃO - PROCEDENTE'),
  claim('QA-REPEATED','FECHADO','RESPONDIDO - NÃO PROCEDE',{22:'QA-OTHER-ORDER'}),
  claim('QA-COSTS',' aberto ','AGUARDANDO CUSTOS'),
  claim('QA-OCT','FECHADO','RESSARCIMENTO ENCAMINHADO',{1:'2026-10-02'}),
  claim('QA-PRIOR','ABERTO','RESSARCIMENTO ENCAMINHADO',{1:'2025-11-02'}),
  claim('QA-HISTORICAL','FECHADO','RESSARCIMENTO ENCAMINHADO',{1:'2020-11-02'}),
  claim('QA-NO-STATUS','','RESSARCIMENTO ENCAMINHADO'),
  claim('QA-UNKNOWN','Cancelado','RESSARCIMENTO ENCAMINHADO'),
  claim('QA-EXTERNAL','FECHADO','RESSARCIMENTO ENCAMINHADO',{10:'INTERFERÊNCIA EXTERNA'}),
  claim('QA-EXTERNAL-SPACES','ABERTO','RESSARCIMENTO ENCAMINHADO',{10:' Interferência   externa '}),
  claim('QA-NO-DATE','FECHADO','RESSARCIMENTO ENCAMINHADO',{1:null}),
  claim('QA-FUTURE','FECHADO','RESSARCIMENTO ENCAMINHADO',{1:'2026-11-20'}),
  claim('','ABERTO','RESSARCIMENTO ENCAMINHADO',{22:'QA-NO-SGR'}),
  claim('QA-BETA','FECHADO','RESSARCIMENTO ENCAMINHADO',{25:'COMERCIAL',28:'Fornecedor Beta'})
];
const run=options=>E.analyze(fixture(),[ch],{years:[2026],asOf:'2026-11-13',...options});
function ui(){
  const dashboard={innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;},classList:{add(){},remove(){}}};
  const field={addEventListener(){}},content={innerHTML:'',querySelector:()=>field},title={},prepared=[];
  const dialog={open:false,addEventListener(){},showModal(){this.open=true;}};
  const nodes={executiveDashboard:dashboard,detailContent:content,detailTitle:title,detailDialog:dialog};
  const document={getElementById:id=>nodes[id]},window={document,MinervaTableFilters:{
    prepare(id,headers,rows,_cells,label,settings){prepared.push({id,headers,label,settings});return rows;},
    heading:(_id,_index,label)=>'<span data-test-filter>'+label+'</span>',summary:()=>'',ariaSort:()=> 'none',clearDetails(){},close(){}
  }};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/executive.js'),'utf8'),{window,document});
  const section=()=>dashboard.innerHTML.match(/<section class="exec-panel exec-claim-summary">([\s\S]*?)<\/section>/)?.[1]||'';
  const cards=()=>new Map([...section().matchAll(/<button type="button" class="exec-case-total" data-exec-detail="([^"]+)"[^>]*><span>([^<]+)<\/span><strong>([^<]+)<\/strong><\/button>/g)].map(match=>[match[2],{id:match[1],count:Number(match[3].replace(/\./g,''))}]));
  return {dashboard,content,title,prepared,section,cards,api:window.MinervaExecutive,
    click(label){const card=cards().get(label);assert(card,'missing card: '+label);dashboard.events.click({target:{closest:()=>({dataset:{execDetail:card.id}})}});},
    detailIds(){return [...(content.innerHTML.split('<tbody>')[1]||'').matchAll(/<tr><td[^>]*>(\d+)<\/td>/g)].map(match=>Number(match[1]));}
  };
}

test('overview case summary follows RNC year/month and includes old cases only in the selected scope',()=>{
  const cases=[
    [{years:[2026],months:[11]},'2026 · Nov',[2,3,4,8,9,15]],
    [{years:[2026],months:[]},'2026',[2,3,4,5,8,9,15]],
    [{years:[2025,2026],months:[11]},'2025 e 2026 · Nov',[2,3,4,6,8,9,15]],
    [{allYears:true,years:[],months:[11]},'Todos os anos · Nov',[2,3,4,6,7,8,9,15]],
    [{years:[2026],months:[10]},'2026 · Out',[5]]
  ];
  for(const [options,label,ids] of cases){
    const h=ui(),model=run(options),before=JSON.stringify(model);h.api.render(model);
    assert(h.section().includes('Controle de claim · '+label),label);
    assert.equal(h.cards().get('Total de casos').count,ids.length,label);
    h.click('Total de casos');assert.deepEqual(h.detailIds(),ids,label);assert(h.title.textContent.includes(label));
    assert.equal(JSON.stringify(model),before);
  }
});

test('open/closed uses the actual claim Status, keeps repeated SGR rows and exposes financially excluded cases',()=>{
  const h=ui(),model=run({months:[11]});h.api.render(model);
  assert.equal(h.cards().get('Total de casos').count,6);
  assert.equal(h.cards().get('Abertos').count,2);assert.equal(h.cards().get('Fechados').count,2);assert.equal(h.cards().get('Status não informado').count,2);
  assert.equal(['Abertos','Fechados','Status não informado'].reduce((sum,label)=>sum+h.cards().get(label).count,0),6);
  h.click('Abertos');assert.deepEqual(h.detailIds(),[2,4]);assert.match(h.content.innerHTML,/QA-COSTS/);
  assert(!model.executiveReport.claimRows.some(row=>row.row===3),'denied case is not in the financial claim projection');
  h.click('Fechados');assert.deepEqual(h.detailIds(),[3,15]);assert.match(h.content.innerHTML,/RESPONDIDO - NÃO PROCEDE/);
  h.click('Total de casos');assert.equal((h.content.innerHTML.match(/<td>QA-REPEATED<\/td>/g)||[]).length,2);
  h.click('Status não informado');assert.deepEqual(h.detailIds(),[8,9]);
  assert.deepEqual(Array.from(h.prepared.at(-1).headers),['Linha BD','SGR','País','Fornecedor','Status','Situação','Motivo','Data RNC','Reclamado USD']);
  assert.match(h.content.innerHTML,/<td>Não informado<\/td>/);assert.match(h.content.innerHTML,/<td>Cancelado<\/td>/);
  assert.equal(h.prepared.at(-1).settings.types[7],'date');assert.equal(h.prepared.at(-1).settings.types[8],'number');
  h.click('Fechados');assert.match(h.content.innerHTML,/<td>FECHADO<\/td><td>RESPONDIDO - NÃO PROCEDE<\/td>/,'Status and Situação remain independent fields');
  assert(h.prepared.every(item=>item.id.startsWith('detail-exec-')));assert.match(h.content.innerHTML,/data-test-filter/,'drilldown retains per-column filters');
});

test('summary excludes external interference, missing dates, future dates and blank SGR without changing source counts',()=>{
  const h=ui(),model=run({months:[11]}),sourceLength=model.executiveReport.controlClaims.length;h.api.render(model);h.click('Total de casos');
  assert.deepEqual(h.detailIds(),[2,3,4,8,9,15]);
  assert.doesNotMatch(h.content.innerHTML,/QA-EXTERNAL|QA-NO-DATE|QA-FUTURE|QA-NO-SGR/);
  assert.equal(model.executiveReport.controlClaims.length,sourceLength);
  assert.match(h.section(),/<footer class="exec-source-foot">BASE: BD<\/footer>/);
  const october=run({months:[10]});h.api.render(october);assert.equal(h.cards().has('Status não informado'),false,'no empty unknown-status bucket');
});

test('summary inherits supplier/operation restrictions already applied by the engine and handles empty periods',()=>{
  const h=ui(),model=run({months:[11],operations:['COMERCIAL'],suppliers:['Fornecedor Beta']});h.api.render(model);
  assert.equal(h.cards().get('Total de casos').count,1);assert.equal(h.cards().get('Abertos').count,0);assert.equal(h.cards().get('Fechados').count,1);
  h.click('Total de casos');assert.deepEqual(h.detailIds(),[15]);assert.match(h.content.innerHTML,/Fornecedor Beta/);
  h.api.render(run({months:[1]}));assert.equal(h.cards().get('Total de casos').count,0);h.click('Total de casos');assert.deepEqual(h.detailIds(),[]);assert.match(h.content.innerHTML,/Nenhuma linha neste filtro/);
});
