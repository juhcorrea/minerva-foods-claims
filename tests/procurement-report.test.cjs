'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),E=require('../dist/engine.js');
const bh=Array(65).fill(''),ch=Array(32).fill('');
Object.assign(bh,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',7:'Pendência',8:'Data ultima posição',9:'Data Fim Análise',10:'Motivo',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',31:'Cia Maritima',32:'Nº container',35:'Reclamado (USD)',46:'Data NF',49:'Causador',56:'Analista',57:'SLA 25 Dias',61:'Prazo Neg. Claims',62:'Media Abertura Claim',63:'Dias Sem Atualização'});
Object.assign(ch,{0:'Setor',1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',30:'Ano Compensação',31:'Analista'});
const claim=(o={})=>Object.assign(Array(65).fill(null),{0:o.sgr===undefined?o.ref||'CASE':o.sgr,1:o.rnc===undefined?'2026-01-01':o.rnc,3:'ME',6:o.status||'EM NEGOCIAÇÃO - PROCEDENTE',7:o.pending===undefined?'Aguardando retorno':o.pending,8:o.updated,10:o.reason||'AVARIA',13:o.opening,19:o.country||'BRA',22:o.ref||'ORDER',24:o.nf===undefined?123:o.nf,25:o.operation===undefined?'EXPORTAÇÃO - CTNR':o.operation,28:o.supplier===undefined?'Fornecedor exemplo':o.supplier,31:'Armador exemplo',32:o.container,35:o.amount===undefined?100:o.amount,46:o.invoiceDate,49:'Causador exemplo',56:'Analista fictício'});
const run=(b,o={})=>E.analyze([bh,...b],[ch],{years:[2026],asOf:'2026-11-06',...o});

test('FUP totals separate legal and negotiations, omit FUP text from both totals and row payloads',()=>{
 const b=[claim({ref:'N1',sgr:'CASE1',amount:40}),claim({ref:'N2',sgr:'CASE1',amount:60}),claim({ref:'L1',supplier:'Departamento Jurídico',amount:80}),claim({ref:'F1',pending:'  Em tratativa — fup   suprimentos confirmado',amount:1000}),claim({ref:'LF',supplier:'JURIDICO',pending:'FUP SUPRIMENTOS',amount:2000}),claim({ref:'CLOSED',supplier:'JURIDICO',status:'PREJUIZO MINERVA',amount:9000})];
 const before=JSON.stringify(b),m=run(b),p=m.procurementReport;
 assert.equal(p.negotiationTotal,100);assert.equal(p.legalTotal,80);assert.equal(p.grandTotal,180);assert.equal(p.grandTotal,p.negotiationTotal+p.legalTotal);
 assert.equal(p.counts.negotiation,1);assert.equal(p.counts.legal,1);assert.equal(p.counts.total,2);assert.equal(p.meta.excludedFupCount,2);assert.equal(p.meta.excludedFupAmount,3000);
 assert.deepEqual(p.rows.map(r=>r.row),[2,3]);assert(p.rows.every(r=>r.category==='negotiation'&&r.included));assert.deepEqual(p.excludedFup,[]);assert.equal(p.bySupplier.length,1);assert.deepEqual(p.bySupplier[0].rows,[2,3]);assert.equal(p.bySupplier[0].total,100);assert.equal(p.bySupplier[0].claimCount,1);
 assert.equal(p.meta.legalDetailAvailable,false);assert.equal(JSON.stringify(b),before);
 assert.equal(m.summary.negotiating,180,'Supplier negotiation also excludes FUP SUPRIMENTOS, as explicitly requested');
 assert(!JSON.stringify(p.rows).includes('Departamento Jurídico'));assert(!JSON.stringify(p.bySupplier).includes('JURIDICO'));
});

test('open portfolio keeps all RNC years while global operation and supplier filters still apply',()=>{
 const b=[claim({ref:'OLD',rnc:'2021-01-01',amount:20,operation:'IMPORTAÇÃO - CTNR'}),claim({ref:'NEW',amount:30,supplier:'Outro fornecedor'}),claim({ref:'LEGALOLD',rnc:'2020-01-01',supplier:'JURIDICO',amount:40,operation:'COMERCIAL'}),claim({ref:'UNKNOWN',rnc:null,amount:10,operation:''})];
 const m=run(b),p=m.procurementReport;
 assert.equal(p.negotiationTotal,60);assert.equal(p.legalTotal,40);assert.equal(p.grandTotal,100);assert.equal(m.summary.negotiating,30);assert.equal(p.meta.allYears,true);assert.equal(p.rows.length,3);
 assert.equal(run(b,{years:[2025]}).procurementReport.grandTotal,100,'Year selector does not hide open agreements');
 assert.equal(run(b,{operation:'IMPORTAÇÃO - CTNR'}).procurementReport.negotiationTotal,20);assert.equal(run(b,{operation:'COMERCIAL'}).procurementReport.legalTotal,40);
 const supplier=run(b,{supplier:'Fornecedor exemplo'}).procurementReport;assert.equal(supplier.negotiationTotal,30);assert.equal(supplier.legalTotal,0);
 assert.deepEqual(run(b,{correctionScenario:'original'}).procurementReport.rows,p.rows,'BD portfolio is not rewritten by Control corrections');
});

test('claim drilldown carries exact invoice/opening/container fields with NF fallback and civil aging',()=>{
 const current=E.today(),tomorrow=new Date(Date.parse(current+'T00:00:00Z')+86400000).toISOString().slice(0,10);
 const p=run([claim({ref:'DETAIL',invoiceDate:'2020-02-01',opening:'2020-03-01',container:'CONT-EXAMPLE',nf:456}),claim({ref:'ZERO',opening:current,container:'',nf:789}),claim({ref:'FUTURE',opening:tomorrow}),claim({ref:'MISSING',opening:null}),claim({ref:'INVALID',opening:'not a date'})]).procurementReport;
 const row=p.rows[0];assert.equal(row.invoiceDate,'2020-02-01');assert.equal(row.openingDate,'2020-03-01');assert.equal(row.container,'CONT-EXAMPLE');assert.equal(row.originalContainer,'CONT-EXAMPLE');assert.equal(row.nf,'456');assert.equal(row.daysOpen,Math.round((Date.parse(current+'T00:00:00Z')-Date.parse('2020-03-01T00:00:00Z'))/86400000));assert.equal(row.pending,'Aguardando retorno');assert.equal(row.reason,'AVARIA');assert.equal(row.order,'DETAIL');
 assert.equal(p.rows[1].daysOpen,0);assert.equal(p.rows[1].container,'789');assert.equal(p.rows[1].originalContainer,'');
 for(const r of p.rows.slice(2))assert.equal(r.daysOpen,null);assert.match(p.rows[2].agingIssue,/futura/);assert.match(p.rows[3].agingIssue,/não informada/);assert.match(p.rows[4].agingIssue,/inválida/);
 const c=run([claim({ref:'DETAIL',invoiceDate:'2020-02-01',opening:'2020-03-01',container:'CONT-EXAMPLE'})]).executiveReport.controlClaims[0];assert.equal(c.invoiceDate,row.invoiceDate);assert.equal(c.container,row.container);assert.equal(c.daysOpen,row.daysOpen);
});

test('source missing values stay explicit and do not fabricate totals or dates',()=>{
 const p=run([claim({ref:'N',amount:null,invoiceDate:'bad',opening:'bad'}),claim({ref:'L',amount:null,supplier:'JURIDICO'}),claim({ref:'ZERO',amount:0,sgr:null})]).procurementReport;
 assert.equal(p.negotiationTotal,0);assert.equal(p.legalTotal,0);assert.equal(p.grandTotal,0);assert.equal(p.meta.amountIncomplete,true);assert.equal(p.meta.missingAmountCount,2);assert.equal(p.rows[0].claimed,null);assert.equal(p.rows[0].invoiceDate,null);assert.equal(p.rows[0].daysOpen,null);assert.equal(p.counts.negotiation,2);assert.equal(p.counts.legal,1);
 const headers=[...bh];headers[7]='Other column';const m=E.analyze([headers,claim({pending:'FUP SUPRIMENTOS'})],[ch],{years:[2026],asOf:'2026-11-06'});assert.equal(m.procurementReport.meta.criteriaIncomplete,true);assert.equal(m.procurementReport.meta.available.pending,false);
});

test('case and accent normalization match FUP and legal while blank SGR uses each row',()=>{
 const p=run([claim({sgr:null,supplier:' fornecedor exemplo ',amount:.004}),claim({sgr:null,supplier:'FORNECEDOR EXEMPLO',amount:.004}),claim({supplier:'Jurídico',amount:.004}),claim({pending:'fúp Suprimêntos',amount:100})]).procurementReport;
 assert.equal(p.bySupplier.length,1);assert.equal(p.bySupplier[0].claimCount,2);assert.equal(p.negotiationTotal,.01);assert.equal(p.legalTotal,0);assert.equal(p.grandTotal,.01);assert.equal(p.meta.excludedFupCount,1);assert.equal(p.rows.length,2);
});
