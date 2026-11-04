const fs=require('node:fs');
const http=require('node:http');
const assert=require('node:assert/strict');
const {createHash,randomBytes}=require('node:crypto');
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const XLSX=require('../dist/vendor/xlsx.full.min.js');
async function tableField(row,pattern){const headers=await row.locator('xpath=ancestor::table').locator('thead th').allTextContents(),index=headers.findIndex(name=>pattern.test(name.replace(/\s+/g,' ')));assert(index>=0,'Missing table column: '+pattern);return(await row.locator('td').allTextContents())[index];}

class MemoryR2 {
  constructor(){this.objects=new Map();this.serial=0;}
  async get(key){const value=this.objects.get(key);return value?{etag:value.etag,customMetadata:value.meta,json:async()=>JSON.parse(value.text)}:null;}
  async head(key){const value=this.objects.get(key);return value?{etag:value.etag,customMetadata:value.meta}:null;}
  async put(key,text,options={}){const previous=this.objects.get(key);if(options.onlyIf?.etagMatches&&previous?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&previous)return null;const etag='e'+(++this.serial);this.objects.set(key,{text,etag,meta:options.customMetadata||{}});return{etag};}
}

function fixture(){
  const bdHeader=Array(57).fill('');Object.assign(bdHeader,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
  const controlHeader=Array(32).fill('');Object.assign(controlHeader,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
  const claim=(sgr,order,supplier,year,market)=>{const row=Array(57).fill(null);Object.assign(row,{0:sgr,1:year+'-06-12',3:market,6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:order,24:sgr,25:'EXPORTAÇÃO - CTNR',28:supplier,35:1000,40:800,56:'Analista QA'});return row;};
  const payment=(order,supplier,year,market,value,date,ae)=>{const row=Array(32).fill(null);Object.assign(row,{1:year,3:market,7:order,9:'CONF QA',10:supplier,11:'Boleto',12:'Pago',13:date,14:value,17:date,19:value,20:1000,21:800,23:'Reembolsado',30:ae,31:'Analista QA'});return row;};
  const open=payment('QA/1','ARMADOR ALFA SHIPPING',2026,'MI',0,null,null);Object.assign(open,{12:'Dentro do Prazo',13:'2024-01-20',14:75,23:'Aguardando Pagamento'});
  return {
    bd:[bdHeader,claim('1001','QA/1','ARMADOR ALFA',2025,'ME'),claim('1002','QA/1','ARMADOR ALFA',2025,'ME'),claim('2001','QA/2','ARMADOR GAMA',2026,'MI')],
    control:[controlHeader,payment('QA/1','ARMADOR ALFA SHIPPING',2026,'MI',100,'2026-02-10',2025),payment('QA/1','ARMADOR ALFA SHIPPING',2026,'MI',200,'2026-03-10',2025),open,payment('QA/2','ARMADOR GAMA SA',2025,'ME',50,'2026-04-10',2025),payment('QA/ORPHAN','FORNECEDOR SEM VÍNCULO',2026,'ME',25,'2026-05-10',2025),payment('QA/1','ARMADOR ALFA SHIPPING',2026,'MI',900,'2025-12-10',2026),payment('QA/1','ARMADOR ALFA SHIPPING',2026,'MI',700,null,2026)]
  };
}

function financialFixture(){
  const base=fixture(),finance=[...base.bd[3]],old=[...base.bd[3]],zero=[...base.bd[3]];
  Object.assign(finance,{0:'3001',1:'2026-01-01',3:'ME',22:'O/FINANCE',24:'3001',28:'FINANCE',35:1000,40:800});
  Object.assign(old,{0:'3002',1:'2024-01-01',3:'ME',22:'O/OLD-2024',24:'3002',28:'FINANCE',35:500,40:300});
  Object.assign(zero,{0:'4001',1:'2026-01-01',3:'ME',22:'O/AGREEMENT',24:'4001',28:'CARRIER ZERO',35:2600,40:2600});
  const paid=[...base.control[1]];Object.assign(paid,{1:2026,3:'ME',7:'O/FINANCE',9:'CONF FINANCE',10:'FINANCE',14:100,17:'2026-02-10',19:100,20:900,21:800,30:2025});
  const open=[...paid];Object.assign(open,{12:'Dentro do Prazo',13:'2027-01-10',14:200,17:null,19:0,23:'Aguardando Pagamento',30:null});
  const oldPayment=[...paid];Object.assign(oldPayment,{14:50,17:'2025-12-10',19:50,30:2025});
  const oldClaimPaid=[...paid];Object.assign(oldClaimPaid,{1:2024,7:'O/OLD-2024',9:'CONF OLD',14:300,19:300,20:500,21:300,30:2026});
  const schedule=Array.from({length:13},(_,index)=>{const row=[...open];Object.assign(row,{7:'O/AGREEMENT',9:'CONF AGREEMENT',10:'CARRIER ZERO',13:`2027-${String(index%12+1).padStart(2,'0')}-10`,14:100,20:2600,21:2600});return row;});
  return {bd:[base.bd[0],finance,old,zero],control:[base.control[0],paid,open,oldPayment,oldClaimPaid,...schedule]};
}

(async()=>{
  const worker=(await import('data:text/javascript;base64,'+fs.readFileSync('build/server/index.js').toString('base64'))).default;
  const token=randomBytes(32).toString('base64url'),hash=value=>createHash('sha256').update(value).digest('hex');
  const env={BUCKET:new MemoryR2(),ADMIN_LINK_HASHES:JSON.stringify([{id:'owner',name:'Administração',email:'owner@example.invalid',tokenHash:hash(token)},{id:'developer',name:'Developer Example',email:'developer@example.invalid',tokenHash:hash(randomBytes(32))}])};
  const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);const request=new Request('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:req.headers,body:body.length?body:undefined});const response=await worker.fetch(request,env,{});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch(error){res.writeHead(500);res.end(String(error));}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const errors=[],failedAssets=[];
  try{
    const context=await browser.newContext({viewport:{width:1512,height:1050},acceptDownloads:true});
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));page.on('response',response=>{if(response.url().includes('/correction-impact.')&&response.status()!==200)failedAssets.push({url:response.url(),status:response.status()});});
    await page.goto(origin+'/acesso#ativar='+token,{waitUntil:'domcontentloaded'});await page.click('#activateButton');await page.waitForSelector('#teamPublish:visible');
    await page.evaluate(async input=>{document.querySelector('input[name="year"][value="2025"]').checked=false;document.querySelector('input[name="year"][value="2026"]').checked=true;document.querySelector('#asOf').value='2026-10-30';await MinervaApp.loadRows(input.bd,input.control);},fixture());
    await page.click('#teamPublish');await page.waitForFunction(()=>MinervaApp.state.bd===null&&MinervaApp.state.model?.correctionImpact?.summary.received===375);
    await page.evaluate(()=>MinervaApp.view('corrections'));await page.waitForSelector('#correctionOriginalToggle:visible');
    const setOriginal=async enabled=>{await page.locator('#correctionOriginalToggle').setChecked(enabled);await page.waitForFunction(expected=>MinervaApp.state.model?.meta.correctionScenario===expected,enabled?'original':'corrected');};
    const impact=await page.evaluate(()=>MinervaApp.state.model.correctionImpact);
    assert.equal(impact.summary.received,375,'Paid amounts follow R=2026, ignoring conflicting AE=2025');assert.equal(impact.summary.receivedCount,4,'Each paid ledger row is counted once despite two BD claims for QA/1');assert.equal(impact.summary.openBalance,75,'An open installment remains included despite its older due year');assert.equal(impact.summary.openCount,1);assert.equal(impact.summary.orderCount,3);
    const corrected=impact.corrected.find(row=>row.supplier==='ARMADOR ALFA');assert.deepEqual([corrected.yearEntry,corrected.market,corrected.received,corrected.receivedCount,corrected.orderCount],[2025,'ME',300,2,1]);
    const original=impact.original.find(row=>row.supplier==='ARMADOR ALFA SHIPPING');assert.deepEqual([original.yearEntry,original.market,original.received,original.receivedCount,original.orderCount],[2026,'MI',300,2,1]);
    const orphan=impact.corrected.find(row=>row.supplier==='FORNECEDOR SEM VÍNCULO');assert.equal(orphan.unresolvedRows,1);assert.equal(orphan.received,25);
    const globalBefore=await page.evaluate(()=>({summary:MinervaApp.state.model.summary,control:MinervaApp.state.model.controlReport.summary,options:MinervaApp.getOptions()}));
    assert.equal(await page.locator('[data-table-id="correction-impact-corrected"] tbody tr').count(),3);assert((await page.locator('#correctionScenarioLabel').innerText()).startsWith('Com correções'));
    await setOriginal(true);assert((await page.locator('#correctionScenarioLabel').innerText()).startsWith('Sem correções'));
    const originalCells=await page.locator('[data-table-id="correction-impact-original"] tbody tr').filter({hasText:'ARMADOR ALFA SHIPPING'}).locator('td').allTextContents();assert.deepEqual(originalCells.slice(0,5),['ARMADOR ALFA SHIPPING','2026','MI','300','2']);
    await setOriginal(false);const correctedCells=await page.locator('[data-table-id="correction-impact-corrected"] tbody tr').filter({hasText:'ARMADOR ALFA'}).locator('td').allTextContents();assert.deepEqual(correctedCells.slice(0,5),['ARMADOR ALFA','2025','ME','300','2']);
    assert.deepEqual(await page.evaluate(()=>({summary:MinervaApp.state.model.summary,control:MinervaApp.state.model.controlReport.summary,options:MinervaApp.getOptions()})),globalBefore,'Returning to corrected restores its main indicators and filters');

    await page.locator('[data-filter-table="correction-impact-corrected"][data-filter-column="0"]').click();
    const popup=page.locator('.column-filter-popup');await popup.locator('[data-filter-none]').click();await popup.locator('.column-filter-search').fill('alfa');assert.equal(await popup.locator('.column-filter-options label').count(),1);await popup.locator('.column-filter-options input[type="checkbox"]').check();
    assert.equal(await page.locator('[data-table-id="correction-impact-corrected"] tbody tr').count(),3,'Draft choices wait for Apply');
    await popup.locator('[data-filter-apply]').click();assert.equal(await page.locator('[data-table-id="correction-impact-corrected"] tbody tr').count(),1);assert.equal(await page.locator('.correction-impact-metrics article').first().locator('strong').innerText(),'USD 300');
    await setOriginal(true);assert.equal(await page.locator('[data-table-id="correction-impact-original"] tbody tr').count(),3,'Global scenario changes clear stale table filters');assert.equal(await page.locator('.correction-impact-metrics article').first().locator('strong').innerText(),'USD 375');
    await setOriginal(false);assert.equal(await page.locator('[data-table-id="correction-impact-corrected"] tbody tr').count(),3,'Returning to corrected shows its full result after global reanalysis');assert.equal(await page.locator('[data-clear-table="correction-impact-corrected"]').count(),0);

    const marks=page.locator('[data-correction-progress]');assert(await marks.count()>0);await marks.first().click();await page.waitForFunction(()=>MinervaApp.state.model.correctionGroups.some(group=>group.progress?.done));assert.deepEqual(await page.evaluate(()=>MinervaApp.state.model.correctionImpact),impact,'The Já ajustei tracking flag does not reclassify or remove financial amounts');
    await page.locator('#correctionImpact').scrollIntoViewIfNeeded();await page.screenshot({path:'work/correction-impact-ui.png',fullPage:true});
    const downloadPromise=page.waitForEvent('download');await page.click('#exportCorrections');const download=await downloadPromise;await download.saveAs('work/correction-impact-ui.xlsx');assert.equal(await download.failure(),null);
    const workbook=XLSX.read(fs.readFileSync('work/correction-impact-ui.xlsx'),{type:'buffer'});assert(workbook.SheetNames.includes('Cenario original'));assert(workbook.SheetNames.includes('Cenario corrigido'));
    const sheets=Object.fromEntries(['Cenario original','Cenario corrigido'].map(name=>[name,XLSX.utils.sheet_to_json(workbook.Sheets[name])]));
    for(const rows of Object.values(sheets)){assert.equal(rows.reduce((total,row)=>total+row['Recebido · USD'],0),375);assert.equal(rows.reduce((total,row)=>total+row['Parcelas pagas'],0),4);assert.equal(rows.reduce((total,row)=>total+row['Saldo em aberto · USD'],0),75);}
    assert.equal(sheets['Cenario original'].find(row=>row.Fornecedor==='ARMADOR ALFA SHIPPING')['Ano Entrada'],2026);assert.equal(sheets['Cenario corrigido'].find(row=>row.Fornecedor==='ARMADOR ALFA')['Ano Entrada'],2025);

    // A second publication isolates claim-value, agreement, and receipt-year
    // semantics without deriving expected values from the engine itself.
    await page.evaluate(async input=>{await MinervaApp.loadRows(input.bd,input.control);},financialFixture());await page.click('#teamPublish');await page.waitForFunction(()=>MinervaApp.state.bd===null&&MinervaApp.state.model?.summary.received===400);
    await page.evaluate(()=>MinervaApp.view('corrections'));
    const finance=await page.evaluate(()=>MinervaApp.state.model.claimValueAudit.rows.find(row=>row.reference==='O/FINANCE'));
    assert.deepEqual([finance.claimed,finance.bdReceived,finance.controlExpected,finance.prejudice,finance.originalClaimValue,finance.originalPrejudice,finance.deltaReceived],[1000,800,350,200,900,550,-450],'AO is checked against every O installment, regardless of status or compensation year');
    const uChanges=await page.evaluate(()=>MinervaApp.state.model.claimValueAudit.uCorrections.filter(row=>row.reference==='O/FINANCE'));assert.equal(uChanges.length,3);assert(uChanges.every(row=>row.original===900&&row.corrected===1000&&row.cell.startsWith('U')));
    const financeRow=()=>page.locator('[data-table-id="correction-impact-claims-corrected"] tbody tr').filter({hasText:'O/FINANCE'});
    assert.deepEqual((await financeRow().locator('td').allTextContents()).slice(2,6),['1.000','800','200','-450']);assert((await page.locator('#claimAuditScenario').innerText()).includes('corrigida'));
    assert((await page.locator('[data-table-id="correction-impact-claims-corrected"] thead').innerText()).includes('BD AO'));
    await setOriginal(true);const originalFinance=page.locator('[data-table-id="correction-impact-claims-original"] tbody tr').filter({hasText:'O/FINANCE'});assert.deepEqual((await originalFinance.locator('td').allTextContents()).slice(2,6),['900','350','550','-450']);assert.equal(await page.locator('#claimAuditScenario').innerText(),'Original · Controle');
    await setOriginal(false);assert.deepEqual((await financeRow().locator('td').allTextContents()).slice(2,6),['1.000','800','200','-450']);
    await page.locator('.claim-value-panel').screenshot({path:'work/claim-financial-ui.png'});

    await page.evaluate(()=>MinervaApp.view('installments'));
    const agreement=await page.evaluate(()=>MinervaApp.state.model.controlReport.processes.find(row=>row.references.includes('O/AGREEMENT')));
    assert.deepEqual([agreement.integralControl,agreement.agreed,agreement.agreementRate,agreement.receivedAllYears,agreement.agreementBalance,agreement.scheduledTotal,agreement.total,agreement.paid,agreement.settled],[2600,2600,1,0,2600,1300,13,0,false]);
    const agreementRow=page.locator('#processTable tbody tr').filter({hasText:'O/AGREEMENT'}),agreementCells=await agreementRow.locator('td').allTextContents();assert(agreementCells[8].includes('0 de 13'));assert(agreementCells[7].includes('100%'));assert.deepEqual(agreementCells.slice(2,5),['2.600','0','2.600']);
    await agreementRow.locator('[data-process-detail]').click();assert((await page.locator('#detailContent').innerText()).includes('Percentual acordado é V ÷ U e não significa quitação'));assert((await page.locator('#detailContent').innerText()).includes('USD 1.300'));await page.locator('#detailDialog').screenshot({path:'work/agreement-financial-ui.png'});await page.click('#closeDetail');

    await page.evaluate(()=>MinervaApp.view('suppliers'));
    const supplier=await page.evaluate(()=>MinervaApp.state.model.suppliers.find(row=>row.name==='FINANCE'));assert.deepEqual([supplier.received,supplier.receivedSameYear,supplier.receivedDifferentYear,supplier.receivedUnknownYear,supplier.receivedComparable],[400,100,300,0,100]);assert.equal(await page.locator('#metricReceived').innerText(),'100','Claims from 2024 remain in cash but outside the selected 2026 comparison');
    const supplierRow=()=>page.locator('#supplierTable tbody tr').filter({hasText:'FINANCE'});assert.deepEqual([await tableField(supplierRow(),/claims 2024/),await tableField(supplierRow(),/claims 2025/),await tableField(supplierRow(),/claims 2026/),await tableField(supplierRow(),/Total recebido/)],['300','0','100','100']);
    await page.selectOption('#supplierMode','annual');assert.deepEqual([await tableField(supplierRow(),/Reclamado 2026/),await tableField(supplierRow(),/claims 2024/),await tableField(supplierRow(),/claims 2025/),await tableField(supplierRow(),/claims 2026/),await tableField(supplierRow(),/Total do per[ií]odo/)],['1.000','300','0','100','100']);
    await supplierRow().locator('[data-supplier-detail]').click();const cohortRows=await page.locator('[data-table-id="detail-receipt-years"] tbody tr').allTextContents();assert(cohortRows.some(row=>row.includes('O/OLD-2024')&&row.includes('2024')&&row.includes('300')));assert(cohortRows.some(row=>row.includes('O/FINANCE')&&row.includes('100')));await page.locator('#detailDialog').screenshot({path:'work/receipt-cohorts-ui.png'});await page.click('#closeDetail');
    const fullDownload=page.waitForEvent('download');await page.click('#exportReport');const full=await fullDownload;await full.saveAs('work/claim-financial-ui.xlsx');assert.equal(await full.failure(),null);
    const fullWorkbook=XLSX.read(fs.readFileSync('work/claim-financial-ui.xlsx'),{type:'buffer'});for(const name of ['Claim original','Claim corrigido','Ajustes valor integral U','Recebidos por ano do claim','Comparativo anual','Ordens e acordos'])assert(fullWorkbook.SheetNames.includes(name));
    const readSheet=name=>XLSX.utils.sheet_to_json(fullWorkbook.Sheets[name]);
    const originalClaim=readSheet('Claim original').find(row=>row['Ordem / referência']==='O/FINANCE'),correctedClaim=readSheet('Claim corrigido').find(row=>row['Ordem / referência']==='O/FINANCE');assert.deepEqual([originalClaim['Integral · Controle U'],originalClaim['Acordado · soma Controle O'],originalClaim['Prejuízo · U − soma O']],[900,350,550]);assert.deepEqual([correctedClaim['Integral · BD AJ'],correctedClaim['Acordado · BD AO'],correctedClaim['Prejuízo · AJ − AO']],[1000,800,200]);
    assert.equal(readSheet('Ajustes valor integral U').filter(row=>row['Ordem / referência']==='O/FINANCE').length,3);
    const exportedOld=readSheet('Recebidos por ano do claim').find(row=>row['Ordem / NF']==='O/OLD-2024');assert.deepEqual([exportedOld['Ano do pagamento R'],exportedOld['Ano de referência'],exportedOld['Recebido USD']],[2026,2024,300]);
    const exportedAgreement=readSheet('Ordens e acordos').find(row=>row['Ordem / acordo']==='O/AGREEMENT');assert.deepEqual([exportedAgreement['% do claim acordado'],exportedAgreement['Recebido no acordo T USD - todos os anos'],exportedAgreement['Saldo do acordo V menos T USD']],[1,0,2600]);

    const viewer=await browser.newContext({viewport:{width:1365,height:1000}}),v=await viewer.newPage();v.on('pageerror',error=>errors.push(error.message));await v.goto(origin);
    const request=await v.evaluate(async()=>{const response=await fetch('/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json','X-Minerva-Request':'1'},body:JSON.stringify({name:'Pessoa QA impacto',email:'qa@example.test'})});return response.json();});
    assert(request.userId);assert.equal(await page.evaluate(async id=>(await fetch('/api/members/'+id+'/approve',{method:'POST',headers:{'Content-Type':'application/json','X-Minerva-Request':'1'},body:'{}'})).status,request.userId),200);
    await v.goto(origin);await v.waitForFunction(()=>window.MinervaApp?.state.model?.correctionImpact);await v.evaluate(()=>MinervaApp.view('corrections'));await v.check('#correctionOriginalToggle');await v.waitForFunction(()=>MinervaApp.state.model?.meta.correctionScenario==='original');assert(await v.locator('[data-table-id="correction-impact-original"] tbody tr').count()>0);
    assert.equal(await page.evaluate(async id=>(await fetch('/api/members/'+id,{method:'DELETE',headers:{'Content-Type':'application/json','X-Minerva-Request':'1'},body:'{}'})).status,request.userId),200);
    await v.click('#teamRefresh');await v.waitForFunction(()=>MinervaApp.state.model===null);assert.equal(await v.locator('#correctionImpact').innerHTML(),'','Revocation clears retained scenario tables');assert.equal(await v.evaluate(async()=>(await fetch('/api/report')).status),403);
    assert.deepEqual(errors,[]);assert.deepEqual(failedAssets,[]);
    console.log(JSON.stringify({passed:true,paidByR:375,paidRows:4,openAcrossYears:75,sameOrderNoDoubleCount:true,originalCorrectedToggle:true,searchApplyFilters:true,independentProgressFlag:true,claimFinance:{original:[900,350,550],corrected:[1000,800,200],uCorrections:3},agreement:{rate:1,paid:0,balance:2600,settled:false},receiptCohorts:{same:100,different:300,total:400},excelSheets:fullWorkbook.SheetNames,revocationClearsScenario:true,screenshots:['work/correction-impact-ui.png','work/claim-financial-ui.png','work/agreement-financial-ui.png','work/receipt-cohorts-ui.png'],jsErrors:errors}));
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
