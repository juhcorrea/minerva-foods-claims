'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const materials=require('../dist/materials.js'),data=require('../dist/materials-data.js');
global.XLSX=require('../dist/vendor/xlsx.full.min.js');
const claim=(row,extra={})=>({row,sgr:'CASE-'+row,order:'ORDEM/'+row,armador:'ARMADOR TESTE',supplier:'FORNECEDOR TESTE',country:'BRA',reason:'MOTIVO TESTE',pending:'AGUARDANDO RETORNO',status:'EM NEGOCIAÇÃO - PROCEDENTE',claimed:100.25,rncDate:'2026-05-01',openingDate:'2026-05-10',invoiceDate:'2026-04-01',container:'CONTAINER'+row,daysOpen:10,...extra});
const build=(rows,options={})=>data.build({meta:{asOf:'2026-11-13',years:[2026]},executiveReport:{controlClaims:rows}},{years:[2026],months:[],...options});

test('Director material has two pages, external blanks stay unknown and only aggregate legal amount is exposed',()=>{
 const model=build([claim(1),claim(2,{supplier:'JURÍDICO',order:'LEGAL-DETAIL-MUST-NOT-APPEAR',claimed:20.75})]);
 const pages=materials.buildPages(model,'directors',{},2026),html=pages.join('');
 assert.equal(pages.length,2);assert.match(html,/Não informado/);assert.match(html,/Carteira aberta · Todos os anos/);assert.match(html,/Jurídico/);assert.match(html,/US\$ 121/);assert(!html.includes('LEGAL-DETAIL-MUST-NOT-APPEAR'));assert(!html.includes('Reembolso'));
 assert.match(html,/Base: BD/);assert.match(html,/Base: Informação Externa/);assert.match(html,/assets\/flags\/br.svg/);
});

test('Source labels, statuses and notes are escaped in every report page',()=>{
 const malicious='<script>alert("unsafe")</script>',model=build([claim(1,{armador:malicious,supplier:malicious,reason:malicious,pending:malicious,order:malicious})]);
 for(const tab of ['directors','carriers']){const html=materials.buildPages(model,tab,{note:malicious},2026,true).join('');assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));}
});

test('Carrier print includes each source row once with separate chunks and preserves grouped collapsed screen details',()=>{
 const rows=Array.from({length:23},(_,index)=>claim(index+1)),model=build(rows),screen=materials.buildPages(model,'carriers',{},2026,false),print=materials.buildPages(model,'carriers',{},2026,true);
 assert.equal(screen.length,3);assert.match(screen[0],/Panorama Dos Armadores/);assert.match(screen[2],/<details class="materials-reason"[^>]*>/);assert.doesNotMatch(screen[2],/<details class="materials-reason"[^>]*\bopen\b/);assert.match(screen[2],/Expandir Todos/);assert.match(screen[2],/Recolher Todos/);
 assert.equal(print.length,5);const html=print.slice(2).join('');for(const row of rows)assert.equal((html.match(new RegExp('>'+row.order+'<','g'))||[]).length,1);assert.match(html,/17–23 de 23/);
});

test('Carrier panorama uses the full carrier universe and packs small reasons together without losing subtotals',()=>{
 const rows=[claim(1,{reason:'MOTIVO A',claimed:100}),claim(2,{reason:'MOTIVO B',claimed:200}),claim(3,{reason:'MOTIVO C',claimed:300}),claim(4,{armador:'SEGUNDO',claimed:400}),claim(5,{armador:'TERCEIRO',claimed:500}),claim(6,{armador:'QUARTO',claimed:10}),claim(7,{armador:'',claimed:9000})],model=build(rows),pages=materials.buildPages(model,'carriers',{},2026,true);
 assert.match(pages[0],/US\$ 1\.500/);assert.match(pages[0],/99,3%/);assert.match(pages[0],/Universo: 4 Armadores/);assert.match(pages[0],/US\$ 1\.510/);assert.doesNotMatch(pages[0],/9\.000/);
 const detail=pages.filter(page=>page.includes('materials-detail-page'));assert.equal(detail.length,3);const packed=detail.find(page=>page.includes('MOTIVO A'));assert(packed.includes('MOTIVO B'));assert(packed.includes('MOTIVO C'));assert.match(packed,/US\$ 100/);assert.match(packed,/US\$ 200/);assert.match(packed,/US\$ 300/);
 const html=detail.join('');for(const row of rows.slice(0,5))assert.equal((html.match(new RegExp('>'+row.order+'<','g'))||[]).length,1);assert(!html.includes('ORDEM/6'));assert(!html.includes('ORDEM/7'));
 const wb=materials.workbook(model,'carriers');assert.equal(wb.Sheets['Resumo Armadores'].B3.v,1510);assert.equal(wb.Sheets['Resumo Armadores'].B2.v,1500);
});

test('Saved material views include only independent filters and normalize full-month selection',()=>{
 materials.setViewState({years:[2025],months:[11],freightUsd:999,note:'must not persist'},'directors');materials.setViewState({years:[],months:Array.from({length:12},(_,index)=>index+1)},'carriers');
 assert.deepEqual(materials.getViewState(),{directors:{years:[2025],months:[11]},carriers:{years:[],months:[]}});
 assert.deepEqual(materials.cleanYears([1900,1999,2026,2026,true]),[1999,2026]);assert.deepEqual(materials.cleanMonths([11,3,11,0,13,true,false]),[3,11]);
 const safe=materials.sanitizeViewState({directors:{years:[2026,2025,2026],months:[11,2,11],freightUsd:99,note:'private'},carriers:{years:[],months:[13]},periods:{2026:{containerTotal:99}},revision:'private'});
 assert.deepEqual(safe,{directors:{years:[2025,2026],months:[2,11]},carriers:{years:[],months:[]}});assert(!JSON.stringify(safe).includes('private'));
 const before=materials.getViewState();materials.setViewState({years:[2020],months:[1]},'fup');assert.deepEqual(materials.getViewState(),before);
});

test('Manual agreement totals require each selected month and preserve a confirmed zero',()=>{
 const values={agreements:{'ARMADOR TESTE':{1:0,2:2,3:null}}};
 assert.equal(materials.agreementValue(values,'ARMADOR TESTE',[1]),0);assert.equal(materials.agreementValue(values,'ARMADOR TESTE',[1,2]),2);assert.equal(materials.agreementValue(values,'ARMADOR TESTE',[2,3]),null);assert.equal(materials.agreementValue(values,'ARMADOR TESTE',[]),null);
});

test('Excel preserves cent precision, explicit source text and separate negotiations and external inputs',()=>{
 const model=build([claim(1,{pending:'=HYPERLINK("x")'}),claim(2,{rncDate:'2025-01-01',claimed:12.34})]),wb=materials.workbook(model,'directors',{freightUsd:1000.45,agreements:{'ARMADOR TESTE':{11:0}}},2026);
 assert.equal(wb.Sheets['Base Claims'].I2.v,100.25);assert.equal(wb.Sheets['Base Claims'].I2.z,'#,##0.00');assert.equal(wb.Sheets['Base Claims'].J2.t,'s');assert.equal(wb.Sheets['Base Claims'].J2.f,undefined);
 assert.equal(wb.Sheets['Base negociações'].I3.v,12.34);assert.equal(wb.Sheets['Informações Externas'].C6.v,1000.45);assert.equal(wb.Sheets['Informações Externas'].C6.z,'#,##0.00');assert.equal(wb.Sheets['Acordos informados'].D2.v,0);
 const bytes=global.XLSX.write(wb,{type:'buffer',bookType:'xlsx'}),read=global.XLSX.read(bytes,{type:'buffer',cellNF:true});assert.equal(read.Sheets['Base Claims'].I2.v,100.25);assert.equal(read.Sheets['Base Claims'].I2.z,'#,##0.00');
});
