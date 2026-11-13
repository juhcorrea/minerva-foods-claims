'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const engineSource=fs.readFileSync(require.resolve('../dist/engine.js'),'utf8'),appSource=fs.readFileSync(require.resolve('../dist/app.js'),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));
function engineAt(instant){
 const NativeDate=Date;
 class FixedDate extends NativeDate{constructor(...args){super(...(args.length?args:[instant]));}static now(){return NativeDate.parse(instant);}}
 const context={Date:FixedDate};vm.runInNewContext(engineSource,context);return context.ClaimsEngine;
}
const row=(width,values)=>Object.assign(Array(width).fill(null),values);
const bh=row(64,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const bd=[bh,...[2023,2024,2025,2026].map((year,index)=>row(64,{0:'QA-SGR-'+year,1:year+'-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/'+year,25:'EXPORTAÇÃO - CTNR',28:'Fornecedor QA',35:(index+1)*100,56:'Analista QA'}))];
const control=[ch,...[[2022,5],[2023,10],[2024,20],[2025,30],[2026,40],[2027,50],[null,7]].map(([year,amount])=>row(32,{1:year,3:'ME',7:'QA/'+(year??'SEM-ANO'),10:'Fornecedor QA',12:'Pago',13:'2026-02-01',14:amount,17:'2026-02-01',19:amount,30:2026,31:'Analista QA'}))];
const analyze=(engine,options={})=>engine.analyze(bd,control,{years:[2026],asOf:'2026-11-10',lossFormula:'subtract-negotiating',...options});

test('calendar columns roll over at midnight in Brasilia, independently of analysis date and filters',()=>{
 const before=engineAt('2027-01-01T02:59:59Z'),after=engineAt('2027-01-01T03:00:00Z');
 assert.equal(before.today(),'2026-12-31');assert.deepEqual(plain(before.recentClaimYears()),[2025,2026]);
 assert.equal(after.today(),'2027-01-01');assert.deepEqual(plain(after.recentClaimYears()),[2026,2027]);
 const a=analyze(before),b=analyze(after);
 assert.deepEqual(plain(a.meta.claimYearDisplayYears),[2025,2026]);assert.deepEqual(plain(b.meta.claimYearDisplayYears),[2026,2027]);
 assert.deepEqual(plain(a.summary.receivedByClaimYear),{2025:30,2026:40,other:85,unknown:7});
 assert.deepEqual(plain(b.summary.receivedByClaimYear),{2026:40,2027:50,other:65,unknown:7});
 for(const model of [a,b]){assert.equal(model.summary.received,162);assert.equal(model.summary.receivedComparable,40);assert.equal(model.summary.claimed,400);assert.equal(model.summary.receivedUnknownYear,7);assert.equal(model.receiptCohorts.rows.length,7);assert.equal(model.controlReport.meta.receivedConfirmed,162);assert.deepEqual(plain(model.meta.years),[2026]);}
 assert.deepEqual(plain(a.receiptCohorts.rows),plain(b.receiptCohorts.rows),'Only the display grouping changes at New Year');
});

test('all years and historical selections preserve old receipts, unknown provenance and full/lean parity',()=>{
 const engine=engineAt('2026-11-10T12:00:00Z'),before=JSON.stringify({bd,control});
 for(const correctionScenario of ['original','corrected'])for(const options of [{allYears:true},{years:[2023,2026]},{years:[2024]}]){
  const full=analyze(engine,{...options,correctionScenario}),lean=analyze(engine,{...options,correctionScenario,reportView:'suppliers'});
  assert.deepEqual(plain(lean.summary),plain(full.summary));assert.deepEqual(plain(lean.meta.claimYearDisplayYears),[2025,2026]);
  for(const group of [full.summary,...full.suppliers,...full.annual,...full.monthly])assert.equal(Object.values(group.receivedByClaimYear).reduce((total,amount)=>total+Math.round(amount*100),0),Math.round(group.received*100));
  if(options.allYears){assert.equal(full.meta.allYears,true);assert.equal(full.summary.receivedComparable,155);assert.equal(full.summary.claimed,1000);assert.equal(full.summary.receivedByClaimYear.other,85);assert.equal(full.summary.receivedByClaimYear.unknown,7);assert.deepEqual(plain(lean.supplierAnnual.find(item=>item.year===2026).byYear),{2025:30,2026:40,other:85,unknown:7});}
 }
 assert.equal(JSON.stringify({bd,control}),before);
});

const between=(start,end)=>{const a=appSource.indexOf(start),b=appSource.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return appSource.slice(a,b);};
function ui(model,engine){
 const context={state:{model,view:'suppliers',supplierMode:'summary',sort:'claimed',direction:-1},E:engine,window:{},LOSS:'claimed-received-negotiating',F:{prepare:(_id,_heads,rows)=>rows,has:()=>false,criteria:()=>[]},XLSX:{utils:{book_new:()=>({sheets:{}})}},worksheet:(book,name,headers,rows)=>book.sheets[name]={headers,rows},supplierButton:value=>value,money:value=>String(value),moneyExact:value=>String(value),integer:String,pct:String,normalize:value=>String(value).toUpperCase(),filterValue:()=>'',filterLabel:()=>'',asList:value=>value||[],scenarioLabel:()=>model.meta.correctionScenario,receiptOperationNote:()=>'',viewScopeMatches:()=>true,prepareExportViews(){},correctionWorksheets(){},controlWorksheets(){},appliedGlobal:()=>'',controlOperationLabel:()=>'',controlFilterText:()=>'',progressLabel:()=>'',analystText:()=>'',cohortLabel:value=>value};
 vm.createContext(context);
 const code=[between('  function cleanMonths','  function globalMonths'),between('  const comparativeReceived','  const amountRank'),between('  const loss =','  function '),between('  function supplierCells','  function render(force'),between('  function supplierAnnual','  function renderSuppliers'),between('  function receiptScopeNote','  function supplierReceiptDetail'),between('  function makeWorkbook','  async function exportBook')].join('\n');
 vm.runInContext(code,context);return context;
}

test('supplier display, annual comparison, Excel and criteria use the same calendar groups',()=>{
 for(const [instant,years,amounts] of [['2026-11-10T12:00:00Z',[2025,2026],[85,30,40]],['2027-01-01T03:00:00Z',[2026,2027],[65,40,50]]]){
  const engine=engineAt(instant),model=analyze(engine,{allYears:true}),context=ui(model,engine),supplier=model.suppliers[0];
  const summary=context.supplierRows('summary');assert.deepEqual(plain(summary.heads.slice(2,5)),['Recebido · Demais anos · USD',...years.map(year=>'Recebido · claims '+year+' · USD')]);
  assert.deepEqual(plain(summary.cells(supplier).slice(2,5)),amounts.map(String));assert.deepEqual(plain(context.supplierFooter().slice(2,5)),amounts.map(String));
  const annual=context.supplierAnnual(supplier,2026);assert.equal(annual.byYear.other,amounts[0]);assert.equal(annual.byYear.unknown,7);assert.equal(annual.financialReceived,162);assert.equal(annual.received,155);
  const note=context.receiptScopeNote();assert(note.includes(years.join(' e ')));assert.match(note,/Ano a conferir: USD 7/);
  const book=context.makeWorkbook();
  for(const name of ['Fornecedores','Resumo visão geral']){assert.deepEqual(plain(book.sheets[name].headers.slice(2,5)),['Recebido Demais anos USD',...years.map(year=>'Recebido claims '+year+' USD')]);assert.deepEqual(plain(book.sheets[name].rows[0].slice(2,5)),amounts);}
  const annualSheet=book.sheets['Comparativo anual'];assert.deepEqual(plain(annualSheet.headers.slice(3,6)),['Recebido Demais anos USD',...years.map(year=>'Recebido claims '+year+' USD')]);assert.deepEqual(plain(annualSheet.rows.find(row=>row[1]===2026).slice(3,6)),amounts);
  const criterion=book.sheets.Criterios.rows.find(row=>row[0]==='Total recebido no comparativo')[1];assert(criterion.includes(years.join(', ')));assert.match(criterion,/todos os outros anos conhecidos/);assert.match(criterion,/Ano a conferir/);
 }
});
