'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const E=require('../dist/engine.js');
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(65,{0:'Nº SGR',1:'Data RNC',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',49:'Causador',56:'Analista'});
const ch=row(32,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(reference,date,amount,extra={})=>row(65,{0:reference,1:date,3:'ME',5:'ABERTO',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'',10:'AVARIA',19:'BRA',22:reference,24:reference,25:'COMERCIAL',28:'Fornecedor fictício',35:amount,49:'Causador fictício',56:'Analista fictício',...extra});
const receipt=(reference,date,amount,extra={})=>row(32,{0:'Setor fictício',1:Number(date.slice(0,4)),3:'ME',7:reference,10:'Fornecedor fictício',11:'Depósito',12:'Pago',13:date,14:amount,17:date,19:amount,30:Number(date.slice(0,4)),31:'Analista fictício',...extra});
const analyze=(bd,control,options={})=>E.analyze(bd,control,{years:[2026],asOf:'2026-11-30',...options});
const periodFixture=options=>analyze([bh,
  claim('QA-REPEATED','2020-01-01',100.49),
  claim('QA-REPEATED','2026-11-01',200.49,{19:'ARG',22:'QA-NOVEMBER'}),
  claim('QA-FUP-EXCLUDED','2026-11-01',900.49,{7:'Retorno FUP SUPRIMENTOS'}),
  claim('QA-OCTOBER','2026-10-01',300.49)
],[ch,
  receipt('QA-PAID-NOV','2026-11-02',30.49,{0:'Setor Alfa'}),
  receipt('QA-PAID-OCT','2026-10-02',40.49,{0:'Setor Beta'}),
  receipt('QA-PAID-PRIOR','2025-11-02',50.49,{0:'Setor Alfa'})
],options);

function ui(){
  const dashboard={innerHTML:'',events:{},addEventListener(name,fn){this.events[name]=fn;}};
  const content={innerHTML:'',querySelector:()=>({addEventListener(){}})},title={};
  const nodes={executiveDashboard:dashboard,detailContent:content,detailTitle:title,detailDialog:{showModal(){}}};
  const document={getElementById:id=>nodes[id]},window={document};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/executive.js'),'utf8'),{window,document});
  return {dashboard,content,title,api:window.MinervaExecutive,click(button){
    const id=button.match(/data-exec-detail="([^"]+)"/)?.[1];assert(id,'total opens a detail registered by the dashboard');
    dashboard.events.click({target:{closest:()=>({dataset:{execDetail:id}})}});
    const body=content.innerHTML.match(/<tbody>([^]*?)<\/tbody>/)?.[1]||'';
    return [...body.matchAll(/<tr><td[^>]*>(\d+)<\/td>/g)].map(match=>Number(match[1])).sort((a,b)=>a-b);
  }};
}
const text=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
function panel(html,title){
  const heading=html.indexOf('<h3>'+title);assert(heading>=0,'panel exists: '+title);
  const start=html.lastIndexOf('<section ',heading),end=html.indexOf('</section>',heading);
  return html.slice(start,end+10);
}
function total(html){
  const button=[...html.matchAll(/<button\b[^>]*>[^]*?<\/button>/g)].map(match=>match[0]).find(button=>/class="[^"]*\bexec-chart-total\b/.test(button));
  assert(button,'chart retains its own explicit Total Geral');assert.match(text(button),/Total Geral/i);return button;
}
function assertMoney(button,amount){
  const integer=Number(amount).toLocaleString('pt-BR',{maximumFractionDigits:0});
  assert(text(button).includes('US$ '+integer),'full rounded currency is visible: US$ '+integer+'; got '+text(button));
}
function assertCount(button,count,unit){assert.match(text(button),new RegExp('(?:^|\\s)'+count+' (?:'+unit+')(?:\\s|$)','i'));}

test('country Total Geral preserves historical eligibility, repeated SGR lines and cents before display rounding',()=>{
  const view=ui(),model=periodFixture(),before=JSON.stringify(model);view.api.render(model);
  const country=panel(view.dashboard.innerHTML,'Em negociação procedente por país · Todos os anos'),button=total(country);
  assertMoney(button,601.47);assertCount(button,3,'claims|casos|registros');
  assert.deepEqual(view.click(button),[2,3,5]);
  assert.equal((view.content.innerHTML.match(/<td>QA-REPEATED<\/td>/g)||[]).length,2);
  assert.doesNotMatch(view.content.innerHTML,/QA-FUP-EXCLUDED/);
  for(const amount of ['100,49','200,49','300,49'])assert(view.content.innerHTML.includes(amount));
  assert.match(view.title.textContent,/Todos os anos/);assert.equal(JSON.stringify(model),before);
});

test('monthly Total Geral covers all compensation bars and opens exactly the received rows with cents',()=>{
  const view=ui(),model=periodFixture();view.api.render(model);
  const monthly=panel(view.dashboard.innerHTML,'Recebimento mensal · 2026'),button=total(monthly);
  assertMoney(button,70.98);assertCount(button,2,'pagamentos|parcelas|registros');
  assert.deepEqual(view.click(button),[2,3]);
  assert.match(view.content.innerHTML,/30,49/);assert.match(view.content.innerHTML,/40,49/);assert.doesNotMatch(view.content.innerHTML,/QA-PAID-PRIOR/);
  assert.match(view.title.textContent,/2026/);
});

test('sector Total Geral is explicit, clickable and reconciles to the same compensation cash',()=>{
  const view=ui(),model=periodFixture();view.api.render(model);
  const button=total(panel(view.dashboard.innerHTML,'Recebido por setor · 2026'));
  assertMoney(button,70.98);assertCount(button,2,'pagamentos|parcelas|registros');
  assert.deepEqual(view.click(button),[2,3]);assert.match(view.content.innerHTML,/Setor Alfa/);assert.match(view.content.innerHTML,/Setor Beta/);
});

test('all three supplier rankings total the full universe beyond Top6 and drill into the seventh supplier',()=>{
  const bd=[bh],control=[ch];
  for(let i=0;i<7;i++){
    const name='Fornecedor QA '+(i+1),reference='QA-RANK-'+(i+1);
    bd.push(claim(reference,'2026-11-01',(7-i)*100+0.49,{28:name}));
    control.push(receipt(reference,'2026-11-02',(7-i)*10+0.49,{10:name}));
    control.push(receipt(reference,'2026-11-15',(7-i)*20+0.49,{10:name,12:'Dentro do Prazo',17:null,19:null}));
  }
  const model=analyze(bd,control),view=ui(),before=JSON.stringify(model);view.api.render(model);
  const cases=[
    ['Maiores causadores · 2026',2803.43,[2,3,4,5,6,7,8],'claims|casos|registros'],
    ['Recebimento em aberto por fornecedor · Todos os anos',563.43,[3,5,7,9,11,13,15],'parcelas|registros'],
    ['Recebimento por fornecedor · 2026',283.43,[2,4,6,8,10,12,14],'pagamentos|parcelas|registros']
  ];
  for(const [title,amount,ids,unit]of cases){
    const html=panel(view.dashboard.innerHTML,title),button=total(html);
    assert.equal((html.match(/class="exec-rank-row"/g)||[]).length,6,'ranking stays Top6');
    assert.doesNotMatch(html,/data-chart-supplier="Fornecedor QA 7"/,'seventh supplier is outside the visible ranking');
    assertMoney(button,amount);assertCount(button,7,unit);
    assert.deepEqual(view.click(button),ids);assert.match(view.content.innerHTML,/Fornecedor QA 7/);
  }
  assert.equal(JSON.stringify(model),before);
});

test('specific months narrow every total while clearing months restores historical negotiation only',()=>{
  const view=ui();
  const cases=[
    [{years:[2026],months:[11]},'2026 · Nov','2026 · Nov',200.49,[3],30.49,[2]],
    [{years:[2025],months:[]},'Todos os anos','2025',601.47,[2,3,5],50.49,[4]],
    [{years:[2026],months:[]},'Todos os anos','2026',601.47,[2,3,5],70.98,[2,3]]
  ];
  for(const[options,negotiationPeriod,receiptPeriod,negotiationAmount,claimIds,received,receiptIds]of cases){
    const model=periodFixture(options);view.api.render(model);
    const country=total(panel(view.dashboard.innerHTML,'Em negociação procedente por país · '+negotiationPeriod));
    assertMoney(country,negotiationAmount);assert.deepEqual(view.click(country),claimIds);
    const monthly=total(panel(view.dashboard.innerHTML,'Recebimento mensal · '+receiptPeriod));
    assertMoney(monthly,received);assert.deepEqual(view.click(monthly),receiptIds);
    assert.match(view.title.textContent,new RegExp(receiptPeriod.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
});

test('empty charts keep Total Geral zero visible and disable details instead of hiding the total',()=>{
  const model=analyze([bh],[ch]),view=ui();view.api.render(model);
  const titles=['Em negociação procedente por país · Todos os anos','Recebimento mensal · 2026','Recebido por setor · 2026','Maiores causadores · 2026','Recebimento em aberto por fornecedor · Todos os anos','Recebimento por fornecedor · 2026'];
  for(const title of titles){const button=total(panel(view.dashboard.innerHTML,title));assertMoney(button,0);assert.match(button,/<button[^>]*\bdisabled(?:\s|=|>)/);}
});
