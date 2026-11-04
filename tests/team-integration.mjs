import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const worker=(await import('data:text/javascript;base64,'+fs.readFileSync('build/server/index.js').toString('base64'))).default;
class MemoryR2{
 constructor(){this.objects=new Map();this.serial=0;}
 async get(k){const o=this.objects.get(k);return o?{etag:o.etag,customMetadata:o.meta,json:async()=>JSON.parse(o.text)}:null;}
 async head(k){const o=this.objects.get(k);return o?{etag:o.etag,customMetadata:o.meta}:null;}
 async put(k,text,opts={}){const old=this.objects.get(k);if(opts.onlyIf?.etagMatches&&old?.etag!==opts.onlyIf.etagMatches)return null;if(opts.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const etag='e'+(++this.serial);this.objects.set(k,{text,etag,meta:opts.customMetadata||{}});return{etag};}
}
const ADMIN_OWNER='owner@example.invalid';
const adminToken=randomBytes(32).toString('base64url'),secondToken=randomBytes(32).toString('base64url');
const hash=t=>createHash('sha256').update(t).digest('hex');
const env={BUCKET:new MemoryR2(),ADMIN_LINK_HASHES:JSON.stringify([{id:'owner',email:ADMIN_OWNER,name:'Owner',tokenHash:hash(adminToken)},{id:'developer',email:'developer@example.invalid',name:'Developer',tokenHash:hash(secondToken)}])};
const server=http.createServer(async(req,res)=>{try{if(req.url==='/assets/minerva-logo.webp'){res.writeHead(404);res.end();return;}const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);const r=new Request('http://127.0.0.1:'+server.address().port+req.url,{method:req.method,headers:req.headers,body:body.length?body:undefined});const out=await worker.fetch(r,env,{});res.writeHead(out.status,Object.fromEntries(out.headers));res.end(Buffer.from(await out.arrayBuffer()));}catch(e){res.writeHead(500);res.end(String(e));}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const anon=await fetch(origin);assert.equal(anon.status,200);assert((await anon.text()).includes('Solicite seu acesso'));assert.equal((await fetch(origin+'/api/report')).status,401);
 const spoof=await fetch(origin+'/api/report',{headers:{'oai-authenticated-user-id':'admin','oai-authenticated-user-email':ADMIN_OWNER}});assert.equal(spoof.status,401);
 const mobile=await browser.newContext({viewport:{width:390,height:844}});const mobilePage=await mobile.newPage();await mobilePage.goto(origin);await mobilePage.waitForSelector('#accessRequest:visible');assert(await mobilePage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mobilePage.screenshot({path:'work/access-mobile.png',fullPage:true});await mobile.close();
 const admin=await browser.newContext({viewport:{width:1440,height:1000}});
 const p=await admin.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(origin+'/acesso#ativar='+adminToken,{waitUntil:'domcontentloaded'});await p.waitForSelector('#activateButton:visible');assert(!p.url().includes(adminToken));await p.click('#activateButton');await p.waitForSelector('#teamPublish:visible');
 assert(await p.locator('#teamPublish').isDisabled());await p.waitForSelector('#profileButton:visible');assert.equal(await p.locator('#profileName').innerText(),'Owner');await p.click('#profileButton');assert.equal(await p.locator('#profilePanelRole').innerText(),'Administradora');await p.click('#closeProfile');
 const bdHeader=Array(57).fill('');Object.assign(bdHeader,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
 const crHeader=Array(32).fill('');Object.assign(crHeader,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
 const claim=Array(57).fill(null);Object.assign(claim,{0:'CASE-1',1:'2025-11-06',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/1',24:123,25:'EXPORTAÇÃO - CTNR',28:'FORNECEDOR QA',35:1000});
 const paid=Array(32).fill(null);Object.assign(paid,{1:2026,3:'MERCADO EXTERNO',7:'QA/1',9:'CONF-1',10:'FORNECEDOR QA LTDA',11:'Boleto',12:'Pago',13:'2026-02-10',14:500,17:'2026-02-12',19:500,23:'Reembolsado',30:2026,31:'Analista QA'});
 await p.evaluate(async d=>{document.querySelector('#asOf').value='2026-10-30';await MinervaApp.loadRows(d.bd,d.control);},{bd:[bdHeader,claim],control:[crHeader,paid]});
 await p.evaluate(()=>MinervaApp.view('corrections'));
 assert(await p.locator('[data-correction-progress]').first().isDisabled(),'Unpublished previews cannot save shared completion marks');
 await p.click('#teamPublish');await p.waitForFunction(()=>MinervaApp.state.bd===null&&MinervaApp.state.model?.summary.received===500);
 assert((await p.locator('#teamPublication').innerText()).includes('Owner'));
 const shared=await p.evaluate(async()=>{const response=await fetch('/api/report');if(!response.ok)throw new Error('Report metadata unavailable: '+response.status);return response.json();});
 assert.equal(await p.locator('#sidebarUpdatedAt').getAttribute('datetime'),shared.updatedAt);
 assert.equal(await p.locator('#sidebarUpdatedAt').innerText(),new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(shared.updatedAt)));
 assert((await p.locator('#sidebarUpdatedBy').innerText()).includes('Owner'));
 assert.equal(await p.title(),'Minerva Foods Claims');
 await p.evaluate(()=>MinervaApp.view('corrections'));
 assert.equal(await p.locator('[data-correction-progress]').count(),1);
 assert.equal(await p.locator('[data-correction-progress]').isDisabled(),false);
 await p.locator('[data-correction-progress]').click();
 await p.waitForFunction(()=>MinervaApp.state.model.correctionGroups[0].progress?.done===true);
 assert.equal(await p.locator('#correctionTable tr.correction-complete').count(),1,'Completed order is highlighted');
 assert.equal(await p.evaluate(()=>MinervaApp.state.model.summary.received),500,'Manual progress never changes financial values');
 const progressExport=await p.evaluate(()=>XLSX.utils.sheet_to_json(MinervaApp.makeWorkbook(true).Sheets.Correcoes)[0]);
 assert.match(String(progressExport['Ajustado na planilha']),/^(sim|ajustado|já ajustei)$/i);
 assert.equal(progressExport['Marcado por'],'Owner');
 assert.match(progressExport['Marcado em (Brasília)'],/\d{2}\/\d{2}\/\d{4}/);
 await p.selectOption('#correctionProgressFilter','pending');await p.click('#applyCorrectionFilters');
 assert.equal(await p.locator('#correctionTable [data-correction-progress]').count(),0,'Pending filter hides completed order');
 await p.selectOption('#correctionProgressFilter','done');await p.click('#applyCorrectionFilters');
 assert.equal(await p.locator('#correctionTable tr.correction-complete').count(),1,'Done filter shows marked order');
 await p.selectOption('#correctionProgressFilter','');await p.click('#applyCorrectionFilters');
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.MinervaApp?.state.model?.correctionGroups[0]?.progress?.done===true);
 await p.evaluate(()=>MinervaApp.view('corrections'));
 assert.equal(await p.locator('#correctionTable tr.correction-complete').count(),1,'Saved progress survives page reload');
 const progressSaved=await p.evaluate(async()=>{const r=await fetch('/api/report');return r.json();});
 assert.equal(progressSaved.updatedAt,shared.updatedAt,'Completion mark does not pretend a new spreadsheet publication');
 assert.equal(progressSaved.model.correctionGroups[0].progress.updatedBy,'Owner');

 const privateCheck=await fetch(origin+'/api/report');assert.equal(privateCheck.status,401);const rawPath=await fetch(origin+'/private/report-latest-v1.json');assert.equal(rawPath.status,404);const anonAfterData=await(await fetch(origin)).text();assert(!anonAfterData.includes('FORNECEDOR QA'));
 const vc=await browser.newContext();const v=await vc.newPage();v.on('pageerror',e=>errors.push(e.message));await v.goto(origin,{waitUntil:'domcontentloaded'});await v.fill('#requestName','Pessoa de teste');await v.fill('#requestEmail',ADMIN_OWNER);await v.click('#requestSubmit');await v.waitForSelector('#accessPending:visible');const requestCode=await v.locator('#pendingCode').innerText();assert.notEqual(requestCode,'—');
 assert.equal(await v.evaluate(async()=> (await fetch('/api/report')).status),403);
 await p.click('#teamManage');await p.getByRole('button',{name:'Aprovar acesso de Pessoa de teste',exact:true}).click();await p.waitForSelector('[data-member-action="revoke"]');await p.click('#teamCloseMembers');
 // Approval polling can already navigate away from the pending page; reload the
 // entry deterministically instead of racing its disappearing check button.
 await v.goto(origin,{waitUntil:'domcontentloaded'});await v.waitForFunction(()=>window.MinervaApp?.state.model?.summary.received===500);
 assert.equal(await v.locator('#profileName').innerText(),'Pessoa de teste');assert.equal(await v.locator('#profileRole').innerText(),'Consulta');
 assert.equal(await v.locator('#teamPublish').isVisible(),false);assert.equal(await v.locator('#openImports').isVisible(),false);
 await v.evaluate(()=>MinervaApp.view('corrections'));
 assert.equal(await v.locator('#correctionTable tr.correction-complete').count(),1,'Approved viewer sees shared completion status');
 assert(await v.locator('[data-correction-progress]').isDisabled(),'Viewer cannot change completion marks');
 const progressDenied=await v.evaluate(async()=>{const key=MinervaApp.state.model.correctionGroups[0].progress.key;const r=await fetch('/api/correction-progress',{method:'POST',headers:{'Content-Type':'application/json','X-Minerva-Request':'1'},body:JSON.stringify({key,done:false,reportRevision:MinervaApp.state.publishedMeta.revision,options:MinervaApp.getOptions()})});return r.status;});assert.equal(progressDenied,403);

 const denied=await v.evaluate(async()=>{const r=await fetch('/api/members/test/approve',{method:'POST',headers:{'Content-Type':'application/json','X-Minerva-Request':'1'},body:'{}'});return r.status;});assert.equal(denied,403);
 const setMemberRole=async role=>{await p.click('#teamManage');await p.getByLabel('Tipo de acesso de Pessoa de teste',{exact:true}).selectOption(role);await p.getByRole('button',{name:'Aplicar tipo de acesso de Pessoa de teste',exact:true}).click();await p.waitForFunction(label=>document.querySelector('#teamMemberMessage').textContent==='Permissão de Pessoa de teste alterada para '+label+'.',role==='editor'?'Atualizar bases':'Consulta');if(role==='editor')await p.screenshot({path:'work/member-role-controls.png',fullPage:true});await p.click('#teamCloseMembers');};
 await setMemberRole('editor');
 await v.reload({waitUntil:'domcontentloaded'});await v.waitForFunction(()=>window.MinervaApp?.state.model?.summary.received===500);
 assert.equal(await v.locator('#profileRole').innerText(),'Atualizar bases');assert(await v.locator('#teamPublish').isVisible());assert(await v.locator('#openImports').isVisible());assert(!(await v.locator('#teamManage').isVisible()));
 assert.equal(await v.evaluate(async()=> (await fetch('/api/members')).status),403,'Editors cannot manage access');
 await v.evaluate(()=>MinervaApp.view('corrections'));assert(!(await v.locator('[data-correction-progress]').isDisabled()),'Editors can update correction progress');
 await setMemberRole('viewer');
 await v.reload({waitUntil:'domcontentloaded'});await v.waitForFunction(()=>window.MinervaApp?.state.model?.summary.received===500);
 assert.equal(await v.locator('#profileRole').innerText(),'Consulta');assert(!(await v.locator('#teamPublish').isVisible()));assert(!(await v.locator('#openImports').isVisible()));
 await v.evaluate(()=>MinervaApp.view('corrections'));assert(await v.locator('[data-correction-progress]').isDisabled(),'Removing edit permission restores read-only controls');
 await p.click('#teamManage');await p.getByRole('button',{name:'Revogar acesso de Pessoa de teste',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#teamMemberMessage').textContent.includes('revogado'));
 await v.click('#teamRefresh');await v.waitForFunction(()=>window.MinervaApp.state.model===null);assert.equal(await v.locator('#loadedContent').isVisible(),false);assert.equal(await v.locator('#profileButton').isVisible(),false);assert.equal(await v.evaluate(async()=> (await fetch('/api/report')).status),403);
 await p.getByText('Pedidos rejeitados e acessos revogados',{exact:false}).click();await p.getByRole('button',{name:'Liberar novamente o acesso de Pessoa de teste',exact:true}).click();await p.click('#teamCloseMembers');
 await v.goto(origin);await v.waitForFunction(()=>window.MinervaApp?.state.model?.summary.received===500);
 const second=await browser.newContext();const secondPage=await second.newPage();await secondPage.goto(origin+'/acesso#ativar='+secondToken);await secondPage.click('#activateButton');await secondPage.waitForSelector('#teamManage:visible');assert.equal(await secondPage.locator('#teamEmail').innerText(),'Desenvolvimento');assert.equal(await secondPage.locator('#profileName').innerText(),'Desenvolvimento');
 await secondPage.click('#profileButton');assert.equal(await secondPage.locator('#profilePanelRole').innerText(),'Acesso administrativo');assert(await secondPage.locator('#profilePanelContact').isHidden());await secondPage.click('#closeProfile');
 await secondPage.click('#teamManage');assert((await secondPage.locator('#teamAdminsList').innerText()).includes('Desenvolvimento'));assert(!(await secondPage.locator('#teamAdminsList').innerText()).includes('Developer'));await secondPage.click('#teamCloseMembers');

 await secondPage.waitForFunction(()=>window.MinervaApp?.state.model?.correctionGroups[0]?.progress?.done===true);
 await secondPage.evaluate(()=>MinervaApp.view('corrections'));
 assert.equal(await secondPage.locator('#correctionTable tr.correction-complete').count(),1,'Second administrator sees the shared mark');
 await secondPage.locator('[data-correction-progress]').click();
 await secondPage.waitForFunction(()=>MinervaApp.state.model.correctionGroups[0].progress?.done===false);
 assert.equal(await secondPage.evaluate(()=>MinervaApp.state.model.correctionGroups[0].progress.updatedBy),'Desenvolvimento');
 assert.equal(await secondPage.evaluate(()=>XLSX.utils.sheet_to_json(MinervaApp.makeWorkbook(true).Sheets.Correcoes)[0]['Marcado por']),'','Unmarked corrections intentionally omit completion attribution in Excel');
 assert.equal(await secondPage.locator('#correctionTable tr.correction-complete').count(),0,'Administrator can undo the mark');
 await p.click('#teamRefresh');await p.waitForFunction(()=>MinervaApp.state.model.correctionGroups[0].progress?.done===false);
 assert.equal(await p.locator('#correctionTable tr.correction-complete').count(),0,'Undo is shared across administrators');
 await p.screenshot({path:'work/team-admin.png',fullPage:true});await p.click('#profileButton');await p.click('#profileSignout');await p.waitForSelector('#accessRequest:visible');assert.equal(await p.evaluate(async()=> (await fetch('/api/report')).status),401);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,adminLinks:true,noChatGPT:true,requestApproval:true,viewerReadOnly:true,revocationImmediate:true,reapproval:true,logout:true,correctionProgress:{saved:true,reload:true,filters:true,excel:true,shared:true,undo:true,viewerWriteDenied:403},anonymousAfterDataSaved:401,pendingAndRevokedAfterDataSaved:403,rawObjectPath:404,requestCode,jsErrors:errors}));
}finally{await browser.close();server.close();}
