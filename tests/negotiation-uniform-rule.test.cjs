'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const bh=Array(65).fill(''),ch=Array(32).fill('');
bh[56]='Analista';ch[31]='Analista';
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',10:'Motivo',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)'});
Object.assign(ch,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação'});
const claim=(id,amount,changes={})=>Object.assign(Array(65).fill(null),{0:id,1:'2026-01-02',3:'ME',6:'EM NEGOCIAÇÃO - PROCEDENTE',7:'',10:'AVARIA',19:'BRA',22:id,24:id,25:'COMERCIAL',28:'Fornecedor A',35:amount},changes);
const bd=[bh,claim('QA-KEEP',101.25),claim('QA-OTHER',202.5,{7:'Aguardando análise externa'}),claim('QA-FUP-ALONE',3.75,{7:'FUP'}),claim('QA-FUP',900,{7:' Fúp   Suprimêntos '}),claim('QA-FUP-TEXT',800,{7:'RETORNO: FUP\nSUPRIMENTOS confirmado'}),claim('QA-NOT-PROCEDENT',700,{6:'EM NEGOCIAÇÃO - NÃO PROCEDENTE'}),claim('QA-NO-PROCEDENT',600,{6:'EM NEGOCIAÇÃO'}),claim('QA-FORWARDED',500,{6:'RESSARCIMENTO ENCAMINHADO'}),claim('QA-OLD',40,{1:'2025-02-03',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor B',19:'URY'}),claim('QA-LEGAL',50,{28:'Jurídico'}),claim('QA-LEGAL-FUP',300,{28:'Jurídico',7:'FUP SUPRIMENTOS'})];
const control=[ch,Object.assign(Array(32).fill(null),{1:2026,3:'ME',7:'QA-FUP',10:'Fornecedor A',11:'Depósito',12:'Pago',13:'2026-06-01',14:20,17:'2026-06-01',19:20,30:2026})];
const round=n=>Math.round(n*100)/100;
const cases=[['current',{},[2,3,4,11]],['prior',{years:[2025]},[10]],['both years',{years:[2025,2026]},[2,3,4,10,11]],['supplier',{suppliers:['Fornecedor A']},[2,3,4]],['suppliers',{suppliers:['Fornecedor A','Fornecedor B'],years:[2025,2026]},[2,3,4,10]],['operation',{operations:['EXPORTAÇÃO - CTNR'],years:[2025,2026]},[10]],['operations',{operations:['COMERCIAL','EXPORTAÇÃO - CTNR'],years:[2025,2026]},[2,3,4,10,11]],['situations',{claimStatuses:['EM NEGOCIAÇÃO - PROCEDENTE','RESSARCIMENTO ENCAMINHADO','EM NEGOCIAÇÃO - NÃO PROCEDENTE']},[2,3,4,11]],['incompatible situation',{claimStatuses:['RESSARCIMENTO ENCAMINHADO']},[]]];
for(const [name,scope,expectedRows]of cases)for(const correctionScenario of ['corrected','original'])test('monetary negotiation rule survives '+name+' / '+correctionScenario,()=>{
 const before=JSON.stringify({bd,control}),options={years:[2026],asOf:'2026-11-12',...scope,correctionScenario},full=E.analyze(bd,control,options),lean=E.analyze(bd,control,{...options,reportView:'suppliers'}),report=full.executiveReport;
 const expected=round(expectedRows.reduce((n,row)=>n+bd[row-1][35],0));
 assert.equal(full.summary.negotiating,expected);assert.equal(lean.summary.negotiating,expected);
 assert.equal(round(full.suppliers.reduce((n,row)=>n+row.negotiating,0)),expected);
 assert.equal(round(full.annual.reduce((n,row)=>n+row.negotiating,0)),expected);
 assert.equal(round(report.negotiationByCountry.reduce((n,row)=>n+row.amount,0)),expected);
 assert.deepEqual(report.negotiationByCountry.flatMap(row=>row.rows).sort((a,b)=>a-b),expectedRows);
 const nodes={executiveDashboard:{innerHTML:'',addEventListener(){}}},document={getElementById:id=>nodes[id]},window={document};
 vm.runInNewContext(fs.readFileSync(require.resolve('../dist/executive.js'),'utf8'),{window,document});window.MinervaExecutive.render(full);
 const sheets=new Map();window.MinervaExecutive.worksheets({},(_book,name,_headers,rows)=>sheets.set(name,rows));
 const exported=sheets.get('Negociação por país');assert.equal(round(exported.reduce((n,row)=>n+row[1],0)),expected);
 assert.deepEqual(Array.from(exported).flatMap(row=>String(row[3]).split('; ').filter(Boolean).map(Number)).sort((a,b)=>a-b),expectedRows);
 assert.equal(JSON.stringify({bd,control}),before);
});
test('all other pending values and confirmed receipts survive; FUP still uses all years and legal aggregate',()=>{
 const full=E.analyze(bd,control,{years:[2026],asOf:'2026-11-12'});
 assert.equal(full.summary.received,20);assert.equal(full.procurementReport.negotiationTotal,347.5);assert.equal(full.procurementReport.legalTotal,50);assert.equal(full.procurementReport.grandTotal,397.5);
 assert.deepEqual(full.procurementReport.rows.map(row=>row.row),[2,3,4,10]);assert.equal(full.executiveReport.controlClaims.length,bd.length-1);
});
test('an unrecognized pending header cannot reintroduce FUP amounts',()=>{
 const headers=[...bh];headers[7]='Andamento';const full=E.analyze([headers,...bd.slice(1)],control,{years:[2026],asOf:'2026-11-12'});
 assert.equal(full.procurementReport.meta.criteriaIncomplete,true);assert.equal(full.procurementReport.negotiationTotal,347.5);
 assert.equal(full.summary.negotiating,357.5);assert.equal(round(full.executiveReport.negotiationByCountry.reduce((n,row)=>n+row.amount,0)),357.5);
});
