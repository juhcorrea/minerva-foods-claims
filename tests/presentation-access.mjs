import fs from 'node:fs';
import http from 'node:http';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const {chromium} = require('/opt/codex/cua_node/lib/node_modules/playwright-core');
const worker = (await import('data:text/javascript;base64,' + fs.readFileSync('build/server/index.js').toString('base64'))).default;
class MemoryR2 {
  constructor() { this.objects = new Map(); this.serial = 0; }
  async get(key) { const o = this.objects.get(key); return o ? {etag:o.etag, customMetadata:o.meta, json:async()=>JSON.parse(o.text)} : null; }
  async head(key) { const o = this.objects.get(key); return o ? {etag:o.etag, customMetadata:o.meta} : null; }
  async put(key, text, options = {}) {
    const old = this.objects.get(key);
    if (options.onlyIf?.etagMatches && old?.etag !== options.onlyIf.etagMatches) return null;
    if (options.onlyIf?.etagDoesNotMatch === '*' && old) return null;
    const etag = 'e' + ++this.serial; this.objects.set(key, {text,etag,meta:options.customMetadata||{}}); return {etag};
  }
}
const token = randomBytes(32).toString('base64url');
const env = {BUCKET:new MemoryR2(), ADMIN_LINK_HASHES:JSON.stringify([{id:'owner',email:'owner@example.invalid',name:'Owner',tokenHash:createHash('sha256').update(token).digest('hex')},{id:'developer',email:'developer@example.invalid',name:'Developer',tokenHash:createHash('sha256').update(randomBytes(32)).digest('hex')}])};
const server = http.createServer(async (req,res) => {
  try {
    if (req.url.startsWith('/assets/minerva-') || req.url === '/favicon.ico') {res.writeHead(404);res.end();return;}
    const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = Buffer.concat(chunks);
    const response = await worker.fetch(new Request('http://127.0.0.1:' + server.address().port + req.url,{method:req.method,headers:req.headers,body:body.length?body:undefined}),env,{});
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch(error) {res.writeHead(500);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const errors = [];
  const anon = await fetch(origin); const anonymousHtml = await anon.text();
  assert.equal(anon.status,200);assert(anonymousHtml.includes('Solicite seu acesso'));assert(!anonymousHtml.includes('id="view-meeting"'));
  assert.equal((await fetch(origin+'/api/report')).status,401);
  const admin = await browser.newContext({viewport:{width:1440,height:900}});const page = await admin.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/acesso#ativar='+token);await page.click('#activateButton');await page.waitForSelector('#teamPublish:visible');
  const bh = Array(57).fill('');Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',56:'Analista'});
  const ch = Array(32).fill('');Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
  const claim = Array(57).fill(null);Object.assign(claim,{0:'PRIVATE-CLAIM',1:'2026-01-10',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'PRIVATE-QA/1',25:'EXPORTAÇÃO - CTNR',28:'PRIVATE QA SUPPLIER',35:1234,56:'Analista BD'});
  const paid = Array(32).fill(null);Object.assign(paid,{1:2026,3:'ME',7:'PRIVATE-QA/1',10:'PRIVATE QA SUPPLIER',11:'Boleto',12:'Pago',13:'2026-10-10',14:1234,17:'2026-10-10',19:1234,30:2026,31:'PRIVATE QA ANALYST'});
  await page.evaluate(async data=>{document.querySelector('#asOf').value='2026-10-30';await MinervaApp.loadRows(data.bd,data.control);},{bd:[bh,claim],control:[ch,paid]});
  await page.click('#teamPublish');await page.waitForFunction(()=>MinervaApp.state.bd===null&&MinervaApp.state.model?.receiptReport?.rows.length===1);
  const viewerContext = await browser.newContext({viewport:{width:1440,height:900}});const viewer = await viewerContext.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(origin);await viewer.fill('#requestName','Pessoa reunião QA');await viewer.click('#requestSubmit');await viewer.waitForSelector('#accessPending:visible');
  assert.equal(await viewer.evaluate(async()=> (await fetch('/api/report')).status),403);
  await page.click('#teamManage');await page.getByRole('button',{name:'Aprovar acesso de Pessoa reunião QA',exact:true}).click();await page.waitForSelector('[data-member-action="revoke"]');await page.click('#teamCloseMembers');
  await viewer.click('#checkAccess');await viewer.waitForFunction(()=>window.MinervaApp?.state.model?.receiptReport?.rows.length===1);
  await viewer.locator('.main-nav [data-view="meeting"]').click();
  assert(await viewer.locator('#view-meeting').isVisible());
  await viewer.locator('.main-nav [data-view="portfolio"]').click();
  assert(await viewer.locator('#view-portfolio').isVisible());
  await viewer.evaluate(()=>MinervaPresentation.open({title:'Apresentação privada',metadata:'QA',slides:[{label:'Dados privados',html:'<h2>PRIVATE-SLIDE-QA-1234</h2>',notes:'PRIVATE-NOTES-QA',duration:60}]}));
  assert.equal(await viewer.locator('dialog[open]').count(),1);
  assert(await viewer.getByText('PRIVATE-SLIDE-QA-1234',{exact:true}).isVisible());
  await page.click('#teamManage');await page.getByRole('button',{name:'Revogar acesso de Pessoa reunião QA',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#teamMemberMessage').textContent.includes('revogado'));
  await viewer.evaluate(()=>MinervaTeam.refresh());
  await viewer.waitForFunction(()=>MinervaApp.state.model===null);
  assert.equal(await viewer.locator('dialog[open]').count(),0,'Revocation closes the presentation immediately after server denial');
  assert.equal(await viewer.locator('#view-meeting').isVisible(),false,'Report workspace is inaccessible after revocation');
  assert(!await viewer.evaluate(()=>document.body.innerHTML.includes('PRIVATE-SLIDE-QA-1234')),'Presentation copy is removed, not merely hidden');
  assert(!await viewer.evaluate(()=>document.querySelector('#view-meeting').innerHTML.includes('PRIVATE QA ANALYST')),'Meeting financial detail is cleared on session loss');
  assert.equal(await viewer.evaluate(async()=> (await fetch('/api/report')).status),403);
  const unauthenticatedHtml = await (await fetch(origin)).text();
  assert(!unauthenticatedHtml.includes('PRIVATE QA'));assert.equal((await fetch(origin+'/private/report-latest-v1.json')).status,404);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,anonymousEntryOnly:true,approvedViewerSeesMeetingAndPortfolio:true,revocationClosesAndClearsPresentation:true,privateDataProtected:true,jsErrors:errors}));
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
