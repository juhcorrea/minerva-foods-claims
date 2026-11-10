import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {projectClientRows} from '../worker/client-report.js';
const require=createRequire(import.meta.url),E=require('../dist/engine.js'),{createRunner,manifestParts,correctionProgressKey}=require('../dist/analysis-worker.js'),{createClient,uploadParts}=require('../dist/client-analysis.js');
const hash=value=>createHash('sha256').update(value).digest('hex'),origin='https://claims-worker.example.test',tick=()=>new Promise(resolve=>setImmediate(resolve));
function sources(){
  const bh=Array(80).fill(null),ch=Array(40).fill(null);
  Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',8:'Data ultima posição',9:'Data Fim Análise',10:'Motivo',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',31:'Cia Maritima',32:'Nº container',35:'Reclamado (USD)',40:'Recebido (USD)',46:'Data NF',49:'Causador',56:'Analista',57:'SLA 25 Dias',61:'Prazo Neg. Claims',62:'Media Abertura Claim',63:'Dias Sem Atualização',70:'PRIVATE UNUSED HEADER'});
  Object.assign(ch,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',23:'Pagamento',30:'Ano Compensação',31:'Analista'});
  const claim=(id,year,status,supplier,amount)=>Object.assign(Array(80).fill(null),{0:'SGR '+id,1:year+'-01-02',3:'ME',6:status,7:'EM TRATATIVA',8:'2026-03-01',9:'2026-02-01',10:'AVARIA',13:'2026-01-03',19:'BRA',22:'ORDER '+id,24:'NF '+id,25:'EXPORTAÇÃO - CTNR',28:supplier,31:'Armador exemplo',32:'CONTAINER '+id,35:amount,40:amount/2,46:'2026-01-01',49:'Causador exemplo',56:'Analista exemplo',57:1,61:20,62:5,63:10,70:'PRIVATE UNUSED CONTENT'});
  const installment=(id,status,amount)=>Object.assign(Array(40).fill(null),{0:'SGR ME',1:2025,3:'MI',7:'ORDER '+id,9:'CONF '+id,10:'Fornecedor original',11:'Boleto',12:status,13:'2026-04-01',14:amount,17:status==='Pago'?'2026-02-01':null,19:status==='Pago'?amount:0,20:amount*2,21:amount*2,30:2026,31:'Analista recebimento',38:'PRIVATE UNUSED CONTROL'});
  const bd=[bh,claim('A',2026,'RESSARCIMENTO ENCAMINHADO','Fornecedor A',100.125),claim('B',2025,'EM NEGOCIAÇÃO - PROCEDENTE','Fornecedor B',300.5),claim('C',2026,'EM ANÁLISE','Fornecedor C',50),Object.assign(Array(80).fill(null),{4:'PRIVATE PRESENCE ONLY'})];
  const control=[ch,installment('A','Pago',50.125),installment('B','Vencido',70),installment('UNMATCHED','Pago',20),Object.assign(Array(40).fill(null),{5:'PRIVATE PRESENCE CONTROL'})];
  return {bd,control};
}
function manifestFixture(input=sources(),revision='revision-a'){
  const texts=new Map(),parts=[];
  for(const sheet of ['bd','control']){
    const rows=projectClientRows(sheet,input[sheet]);
    for(let firstRow=0,index=0;firstRow<rows.length;firstRow+=2,index++){
      const selected=rows.slice(firstRow,firstRow+2),url='/api/client-report/parts?revision='+revision+'&sheet='+sheet+'&index='+index,text=JSON.stringify({rows:selected});texts.set(origin+url,text);parts.push({sheet,index,firstRow,rowCount:selected.length,sha256:hash(text),url});
    }
  }
  const manifest={schemaVersion:2,revision,parts,asOf:'2026-11-10',files:{bd:'Synthetic BD.xlsx',control:'Synthetic Control.xlsx'},updatedBy:'Example',updatedAt:'2026-11-10T12:00:00Z',progress:{entries:{},revision:'none'}};
  const reads=[],fetcher=async url=>{reads.push(url);assert(texts.has(url));return new Response(texts.get(url),{headers:{'content-type':'application/json'}});};
  return {input,texts,manifest,reads,runner:createRunner({engine:E,fetcher,crypto:webcrypto,baseURL:origin+'/analysis-worker.js'})};
}

test('projected browser calculation preserves every financial and audit result across full, original, filtered and supplier views',async()=>{
  const f=manifestFixture();const variants=[{}, {allYears:true},{allYears:true,correctionScenario:'original'},{claimStatuses:['RESSARCIMENTO ENCAMINHADO']},{allYears:true,suppliers:['Fornecedor A']},{allYears:true,reportView:'suppliers'}];
  for(const selection of variants){
    const options={years:[2026],asOf:'2026-11-10',lossFormula:'subtract-negotiating',...selection},actual=await f.runner.analyze(f.manifest,options),expected=E.analyze(f.input.bd,f.input.control,options);
    delete expected.unmatchedControls;expected.meta.correctionProgressRevision='none';
    for(const group of expected.correctionGroups||[])group.progress={key:await correctionProgressKey(group,webcrypto),done:false,updatedAt:null,updatedBy:null};
    assert.deepEqual(actual,expected,JSON.stringify(selection));assert(!JSON.stringify(actual).includes('PRIVATE UNUSED'));
  }
  assert.equal(f.reads.length,f.manifest.parts.length,'Subsequent filters reuse this revision only in memory');
});

test('worker verifies digest and exact part order before calculating and rejects external or original-data URLs',async()=>{
  const f=manifestFixture();f.texts.set(origin+f.manifest.parts[0].url,'{"rows":[]}');await assert.rejects(f.runner.analyze(f.manifest,{}),/integridade/);
  const g=manifestFixture();for(const change of [{url:'https://other.example.test/secret'},{url:g.manifest.parts[0].url+'&original=1'},{url:g.manifest.parts[0].url+'&sheet=bd'},{index:2},{firstRow:8},{sheet:'other'},{sha256:'bad'}]){const invalid={...g.manifest,parts:g.manifest.parts.map((part,index)=>index?part:{...part,...change})};assert.throws(()=>manifestParts(invalid,origin),/publicação|origem|sequência|manifesto/i);}
  const unauthorized=createRunner({engine:E,crypto:webcrypto,baseURL:origin,fetcher:async()=>new Response('{}',{status:403})});await assert.rejects(unauthorized.analyze(g.manifest,{}),error=>error.status===403);
});

test('progress rehydration uses the same canonical correction key and does not download unchanged bases',async()=>{
  const f=manifestFixture(),options={years:[2026],asOf:'2026-11-10'},model=await f.runner.analyze(f.manifest,options);assert(model.correctionGroups.length>0);const group=model.correctionGroups[0],key=await correctionProgressKey(group,webcrypto),reads=f.reads.length;
  f.manifest.progress={revision:'progress-2',entries:{[key]:{done:true,updatedAt:'2026-11-10T13:00:00Z',updatedBy:'Admin Example'}}};const updated=await f.runner.analyze(f.manifest,options);assert.equal(updated.correctionGroups[0].progress.done,true);assert.equal(updated.meta.correctionProgressRevision,'progress-2');assert.equal(f.reads.length,reads);f.runner.clear();await f.runner.analyze(f.manifest,options);assert.equal(f.reads.length,reads*2);
});

class FakeWorker{
  messages=[];listeners=new Map();terminated=false;
  addEventListener(type,fn){if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
  removeEventListener(type,fn){this.listeners.get(type)?.delete(fn);}
  postMessage(value){this.messages.push(value);}
  terminate(){this.terminated=true;}
  finish(model={meta:{},summary:{}}){for(const listener of this.listeners.get('message')||[])listener({data:{id:this.messages.at(-1).id,model}});}
  progress(progress,id=this.messages.at(-1).id){for(const listener of this.listeners.get('message')||[])listener({data:{id,type:'progress',progress}});}
}
function clientFixture(){const workers=[],client=createClient({makeWorker:()=>{const worker=new FakeWorker();workers.push(worker);return worker;}}),manifest={revision:'a',files:{},updatedBy:'Example'},api=async()=>manifest;return {workers,client,manifest,api};}

test('worker progress is forwarded without resolving a partial model and ignores stale or malformed events',async()=>{
 const f=clientFixture(),events=[],controller=new AbortController();let resolved=false;
 const pending=f.client.load({},{api:f.api,signal:controller.signal,onProgress:value=>events.push(value)}).then(value=>{resolved=true;return value;});await tick();
 f.workers[0].progress({phase:'download',loaded:10,total:231});f.workers[0].progress({phase:'download',loaded:999,total:231});f.workers[0].progress({phase:'analysis'},-1);await tick();
 assert.equal(resolved,false);assert.deepEqual(events,[{phase:'manifest'},{phase:'download',loaded:10,total:231}]);
 f.workers[0].progress({phase:'analysis'});f.workers[0].finish({complete:true});assert.deepEqual((await pending).model,{complete:true});assert.equal(events.at(-1).phase,'analysis');
});

test('231 delayed verified parts use at most eight simultaneous requests and report monotonic completion',async()=>{
 const input=sources();for(const sheet of ['bd','control'])input[sheet]=Array.from({length:sheet==='bd'?232:230},(_row,index)=>input[sheet][index?1:0].slice());
 const f=manifestFixture(input),events=[];let active=0,maxActive=0,reads=0;
 const runner=createRunner({engine:E,crypto:webcrypto,baseURL:origin,fetcher:async(url,options)=>{
  active++;maxActive=Math.max(active,maxActive);reads++;assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');assert(options.signal);
  await new Promise(resolve=>setTimeout(resolve,2));active--;return new Response(f.texts.get(url));
 }});
 const model=await runner.analyze(f.manifest,{years:[2026],asOf:'2026-11-10'},{onProgress:value=>events.push(value)});
 assert.equal(f.manifest.parts.length,231);assert.equal(reads,231);assert.equal(maxActive,8);assert.equal(model.summary.received,11478.63);
 assert.deepEqual(events.filter(value=>value.phase==='download').map(value=>value.loaded),Array.from({length:232},(_v,index)=>index));assert(events.filter(value=>value.phase==='download').every(value=>value.total===231));assert.equal(events.at(-1).phase,'analysis');
 events.length=0;await runner.analyze(f.manifest,{years:[2026],asOf:'2026-11-10'},{onProgress:value=>events.push(value)});assert.equal(reads,231);assert.deepEqual(events,[{phase:'analysis'}]);
});

test('aborting, changing revision and signing out terminate the worker and never accept a stale result',async()=>{
  const f=clientFixture(),controller=new AbortController(),first=f.client.load({years:[2026]},{api:f.api,signal:controller.signal});await tick();const rejected=assert.rejects(first,{name:'AbortError'});controller.abort();await rejected;assert(f.workers[0].terminated);
  const second=f.client.load({years:[2025]},{api:f.api});await tick();f.workers[0].finish({stale:true});f.workers[1].finish({current:true});assert.deepEqual((await second).model,{current:true});
  const third=f.client.load({years:[2026]},{api:f.api});await tick();assert.equal(f.workers.length,2);f.workers[1].finish();await third;
  f.manifest.revision='b';const fourth=f.client.load({},{api:f.api});await tick();assert(f.workers[1].terminated);const cancelled=assert.rejects(fourth,{name:'AbortError'});f.client.clear();await cancelled;assert(f.workers[2].terminated);
});

test('multipart upload preserves exact rows and UTF-8 limits and commits only after every part is confirmed',async()=>{
  const rows=Array.from({length:150},(_row,index)=>['ROW '+index,'Á😀'.repeat(50),index,null]),original=JSON.stringify(rows),parts=[...uploadParts('bd',rows)];assert(parts.length>=3);assert(parts.every(part=>new TextEncoder().encode(part.body).length<=65536&&part.rowCount<=64));assert.deepEqual(parts.flatMap(part=>JSON.parse(part.body).rows),rows);assert.equal(parts[0].firstRow,0);assert.equal(parts[1].firstRow,parts[0].rowCount);
  const f=clientFixture(),calls=[],api=async(url,opts)=>{const body=JSON.parse(opts.body);calls.push({url,body});if(url.endsWith('/start'))return {uploadId:'test-upload'};if(url.endsWith('/parts'))return {...body,rowCount:body.rows.length};return {revision:'published'};};
  const result=await f.client.publish({bd:rows,control:rows,files:{bd:'BD.xlsx',control:'Control.xlsx'},asOf:'2026-11-10'},{api,expectedRevision:'previous'});assert.equal(result.revision,'published');assert.equal(calls[0].body.expectedRevision,'previous');assert.deepEqual(calls[0].body.expectedRows,{bd:150,control:150});assert(calls.at(-1).url.endsWith('/commit'));assert.deepEqual(calls.at(-1).body,{});assert.equal(JSON.stringify(rows),original);
});

test('failed part confirmation and session cleanup stop publication before commit',async()=>{
  const payload={bd:[[1],[2]],control:[[1],[2]],files:{},asOf:'2026-11-10'},f=clientFixture(),calls=[];
  const api=async(url,opts)=>{calls.push(url);if(url.endsWith('/start'))return {uploadId:'test'};return {...JSON.parse(opts.body),rowCount:99};};await assert.rejects(f.client.publish(payload,{api,expectedRevision:'none'}),/confirmada/);assert(!calls.some(url=>url.endsWith('/commit')));
  let finish;const g=clientFixture(),pending=g.client.publish(payload,{expectedRevision:'none',api:()=>new Promise(resolve=>finish=resolve)});g.client.clear();finish({uploadId:'test'});await assert.rejects(pending,{name:'AbortError'});
});

test('optional maintenance is sequential, coalesces calls and honors the per-session limit',async()=>{
 const f=clientFixture(),calls=[];let active=0,maxActive=0;
 const api=async(url,options)=>{active++;maxActive=Math.max(maxActive,active);calls.push({url,options});await tick();active--;return {hasMore:true,cursor:'cursor-'+calls.length,deleted:12};};
 await f.client.maintain({api});assert.equal(calls.length,0,'Unapproved/read-only users never trigger cleanup');
 const first=f.client.maintain({api,allowed:()=>true}),second=f.client.maintain({api,allowed:()=>true});assert.equal(first,second);await first;
 assert.equal(calls.length,100);assert.equal(maxActive,1);assert.deepEqual(JSON.parse(calls[0].options.body),{cursor:null});assert.deepEqual(JSON.parse(calls[99].options.body),{cursor:'cursor-99'});assert(calls.every(call=>call.url==='/api/client-report/cleanup'&&call.options.method==='POST'));
 await f.client.maintain({api,allowed:()=>true});assert.equal(calls.length,100);
});

test('cleanup stops quietly on access change, logout, failure and invalid continuation',async()=>{
 for(const mode of ['access','logout','failure','cursor']){
  const f=clientFixture();let allowed=true,calls=0,signal;
  await f.client.maintain({allowed:()=>allowed,api:async(_url,options)=>{calls++;signal=options.signal;if(mode==='failure')throw Error('Temporary failure');if(mode==='logout')f.client.clear();if(mode==='access')allowed=false;return {hasMore:true,cursor:mode==='cursor'?'':'next'};}});
  assert.equal(calls,1);if(mode==='logout')assert(signal.aborted);
 }
});
