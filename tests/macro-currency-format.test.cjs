'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=name=>fs.readFileSync(require.resolve('../dist/'+name),'utf8');
const host=()=>({innerHTML:'',events:{},addEventListener(name,callback){this.events[name]=callback;},classList:{add(){},remove(){}}});

test('executive macros show whole USD while detail sorting and workbook values retain cents',()=>{
 const dashboard=host(),claims=host(),content={innerHTML:'',querySelector:()=>({addEventListener(){}})},dialog={open:false,showModal(){this.open=true;}},title={},nodes={executiveDashboard:dashboard,detailDialog:dialog,detailContent:content,detailTitle:title},document={getElementById:id=>nodes[id]},window={document};
 vm.runInNewContext(source('executive.js'),{window,document});
 const model={meta:{asOf:'2026-11-10'},summary:{claimed:1234567.89,negotiating:1234567.89,receivedComparable:200.9},suppliers:[{name:'Fornecedor QA',claimed:1234567.89,received:200.9,openBalance:1580.4,overdueBalance:80.75}],supplierOpenReport:{meta:{openBalance:1580.4,overdueBalance:80.75},installments:[]},executiveReport:{years:[2026],monthlyReceipts:[{year:2026,month:11,period:'2026-11',received:200.9,count:2,rows:[2,3]}],receiptRows:[{row:2,supplier:'QA',reference:'lower cents',received:100.41},{row:3,supplier:'QA',reference:'higher cents',received:100.49}],negotiationPortfolio:{allYears:true,amount:1234567.89,count:1,rows:[4],byCountry:[{country:'BRA',amount:1234567.89,count:1,rows:[4]}]},negotiationByCountry:[{country:'BRA',amount:1234567.89,count:1,rows:[4]}],sectorReceipts:[{name:'QA',amount:200.9,count:2,rows:[2,3]}],claimRows:[{row:4,claimed:1234567.89}],reasonRanking:[{name:'Motivo QA',amount:1234567.89,count:1,rows:[4]}],causeRanking:[],openByCountry:[],slaByMonth:[]}},before=JSON.stringify(model);
 window.MinervaExecutive.render(model);
 assert.match(dashboard.innerHTML,/title="Nov 2026 · USD 201"/);assert.match(dashboard.innerHTML,/aria-label="Recebimentos de Nov 2026: USD 201"/);assert.match(dashboard.innerHTML,/<strong>US\$ 1\.234\.568<\/strong>/);assert.doesNotMatch(dashboard.innerHTML,/<strong>1M<\/strong>|1,23M|USD 200,90|USD 1\.234\.567,89/);
 const id=dashboard.innerHTML.match(/data-exec-detail="([^"]+)"/)[1];dashboard.events.click({target:{closest:()=>({dataset:{execDetail:id}})}});
 assert.match(content.innerHTML,/<strong>USD 201<\/strong>/);assert.match(content.innerHTML,/100,49/);assert.match(content.innerHTML,/100,41/);assert(content.innerHTML.indexOf('higher cents')<content.innerHTML.indexOf('lower cents'),'sort uses cents even when macro values round equally');
 window.MinervaExecutive.renderClaims(model,claims);assert.match(claims.innerHTML,/title="Motivo QA · USD 1\.234\.568"/);assert.match(claims.innerHTML,/<strong>US\$ 1\.234\.568<\/strong>/);assert.doesNotMatch(claims.innerHTML,/<strong>1M<\/strong>/);
 const sheets=new Map();window.MinervaExecutive.worksheets({},(_wb,name,_headers,rows)=>sheets.set(name,rows));assert.equal(sheets.get('Executivo mensal')[0][3],200.9);assert.equal(sheets.get('Negociação por país')[0][1],1234567.89);assert.equal(sheets.get('Motivos dos claims')[0][1],1234567.89);assert.equal(JSON.stringify(model),before);
});

test('receipt chart labels and tooltips round only the display, preserving exact detail and aggregate amounts',()=>{
 const dashboard=host(),nodes={receiptsExecutive:dashboard},document={getElementById:id=>nodes[id],addEventListener(){},createElement(){return{...host(),open:false,setAttribute(){},showModal(){this.open=true;}};},body:{append(node){nodes[node.id]=node;}}},window={};vm.runInNewContext(source('receipts-executive.js'),{window,document});
 const make=(row,reference,received)=>({row,reference,isControlRecord:true,status:'Pago',includedInConfirmed:true,received,expected:3000.99,compensationMonth:'2026-11',compDate:'2026-11-01',supplier:'Fornecedor QA'}),rows=[make(2,'lower cents',1245.41),make(3,'higher cents',1245.49)],model={meta:{years:[2026]},controlReport:{installments:rows}},before=JSON.stringify(model);
 window.MinervaReceiptsExecutive.render(model);
 assert.match(dashboard.innerHTML,/title="Nov\/2026 · USD 2\.491 · 2 pagamentos"/);assert.match(dashboard.innerHTML,/<span>2 mil<\/span>/);assert.doesNotMatch(dashboard.innerHTML,/2,5 mil|2\.490,90/);
 assert.match(dashboard.innerHTML,/<strong>US\$ 2\.491<\/strong>/);
 const id=dashboard.innerHTML.match(/data-rx-detail="([^"]+)"/)[1];dashboard.events.click({target:{closest:()=>({dataset:{rxDetail:id}})}});const detail=nodes.receiptsExecutiveDetail.innerHTML;
 assert.match(detail,/1\.245,49/);assert.match(detail,/1\.245,41/);assert.match(detail,/3\.000,99/);assert(detail.indexOf('higher cents')<detail.indexOf('lower cents'));assert.equal(window.MinervaReceiptsExecutive.aggregate(rows,[2026]).summary.confirmed,2490.9);assert.equal(JSON.stringify(model),before);
});
