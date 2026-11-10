'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),E=require('../dist/engine.js');
const row=(size,values)=>Object.assign(Array(size).fill(null),values);
const bh=row(57,{0:'Nº SGR',1:'Data RNC',3:'Mercado',6:'Situação',10:'Motivo',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',35:'Reclamado (USD)',40:'Recebido (USD)',56:'Analista'});
const ch=row(32,{1:'Ano Entrada',3:'Mercado',7:'Referência (Ordem/NF)',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',20:'Valor Integral Claim',21:'Valor negociado Claim',30:'Ano Compensação',31:'Analista'});
function model(integral=1000,reportView='full'){
 const bd=row(57,{0:'SGR-FICTICIO',1:'2026-01-01',3:'ME',6:'RESSARCIMENTO ENCAMINHADO',10:'AVARIA',22:'QA/1',25:'EXPORTAÇÃO - CTNR',28:'Fornecedor fictício',35:1000,40:0,56:'Analista fictício'});
 const control=row(32,{1:2026,3:'ME',7:'QA/1',10:'Fornecedor fictício',11:'Depósito',12:'Dentro do Prazo',13:'2026-12-01',14:0,17:null,19:null,20:integral,21:0,30:null,31:'Analista fictício'});
 return E.analyze([bh,bd],[ch,control],{years:[2026],asOf:'2026-11-10',reportView});
}
function review(){const window={},document={addEventListener(){}};vm.runInNewContext(fs.readFileSync(require.resolve('../dist/correction-impact.js'),'utf8'),{window,document});return window.MinervaCorrectionImpact;}
const plain=value=>JSON.parse(JSON.stringify(value));

test('AJ equals U and AO equals zero scheduled total is reconciled even when derived prejudice equals AJ',()=>{
 const m=model(),audit=m.claimValueAudit.rows[0],api=review();
 assert.equal(audit.claimed,1000);assert.equal(audit.originalClaimValue,1000);assert.equal(audit.bdReceived,0);assert.equal(audit.controlExpected,0);
 assert.equal(audit.prejudice,1000);assert.equal(audit.originalPrejudice,1000);
 assert.equal(audit.status,'Conferido');assert.equal(audit.uncertain,false);assert.equal(audit.hasClaimValueMismatch,false);assert.equal(audit.hasReceivedMismatch,false);assert.equal(m.claimValueAudit.uCorrections.length,0);
 assert.equal(api.buildQueue(m).length,0);assert.equal(model(1000,'suppliers').meta.correctionQueueCount,0,'Lean queue also ignores derived prejudice');
 const financial=plain(m.summary);
 for(const [prejudice,originalPrejudice]of [[null,null],[-5000,999999],[1000,-1000]]){
  Object.assign(audit,{prejudice,originalPrejudice});assert.equal(api.buildQueue(m).length,0);assert.equal(audit.status,'Conferido');assert.deepEqual(plain(m.summary),financial);
 }
});

test('changing only derived prejudice cannot add, remove or change a real AJ/U correction',()=>{
 const m=model(900),audit=m.claimValueAudit.rows[0],api=review(),project=()=>plain(api.buildQueue(m).map(entry=>({bdRows:entry.bdRows,controlRows:entry.controlRows,referenceAmount:entry.referenceAmount,problems:entry.problems}))),before=project(),financial=plain(m.summary),corrections=plain(m.claimValueAudit.uCorrections);
 assert.equal(audit.hasClaimValueMismatch,true);assert.equal(audit.hasReceivedMismatch,false);assert.equal(audit.status,'Divergência de valores');assert.equal(before.length,1);assert.equal(corrections.length,1);assert.equal(corrections[0].cell,'U2');
 for(const [prejudice,originalPrejudice]of [[null,null],[0,0],[-100000,100000]]){
  Object.assign(audit,{prejudice,originalPrejudice});assert.deepEqual(project(),before);assert.deepEqual(plain(m.claimValueAudit.uCorrections),corrections);assert.deepEqual(plain(m.summary),financial);
 }
});
