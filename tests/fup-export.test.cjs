'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const X=require('../dist/vendor/xlsx.full.min.js'),F=require('../dist/fup-export.js');
const detail=(order,claimed,extra={})=>({order,claimed,invoiceDate:'2026-03-01',openingDate:'2026-11-01',container:'CONTÊINER exemplo',days:9,pending:'Aguardando retorno',sgr:'SGR '+order,nf:'NF '+order,country:'BRA',operation:'Operação exemplo',row:2,...extra});
function fixture(){return {date:'2026-11-10',selectedSupplier:null,scopeLabel:'Todos os fornecedores do filtro',rowCount:4,total:30.125,globalTotals:{negotiation:90,legal:20,total:110},criteria:[['Escopo','Todos os registros filtrados, inclusive outras páginas.'],['Fonte','Dados fictícios para teste']],groups:[{supplier:'Fornecedor A & exemplo',claimCount:2,total:30.125,reasons:[{label:'Avaria <teste>',count:2,total:30.125,expanded:true,rows:[detail('000123',10.125),detail('000124',20)]},{label:'Sem valor',count:1,total:0,expanded:false,rows:[detail('=HYPERLINK("https://invalid.test")',null,{invoiceDate:'2026-02-31',openingDate:null,days:null,pending:'+SUM(A1:A2) & <pendência>'})]}]},{supplier:'Fornecedor B',claimCount:1,total:0,reasons:[{label:'Temperatura',count:1,total:0,expanded:true,rows:[detail('000125',0,{days:0,invoiceDate:'2024-02-29',openingDate:'2026-11-10'})]}]}]};}
const bytes=result=>Buffer.concat(result.chunks.map(chunk=>Buffer.from(chunk)));
const file=(result,name)=>result.files.find(file=>file.name===name).data;

test('export produces a real XLSX readable by the existing Excel library with exact amounts and typed dates',()=>{
 const input=fixture(),before=JSON.stringify(input),output=F.create(input),buffer=bytes(output),book=X.read(buffer,{type:'buffer',cellNF:true,cellStyles:true});
 assert.equal(buffer.subarray(0,2).toString(),'PK');assert.deepEqual(book.SheetNames,['FUP reunião','Base do recorte','Critérios']);
 const main=book.Sheets['FUP reunião'],base=book.Sheets['Base do recorte'];assert.equal(main.F10.v,30.125);assert.equal(main.F11.v,30.125);assert.equal(main.F12.v,10.125);assert.equal(main.F12.t,'n');assert.equal(main.A12.v,'000123');assert.equal(main.A12.t,'s');assert.equal(main.B12.t,'n');assert.equal(main.B12.z,'dd/mm/yyyy');assert.equal(main.B12.v,F.excelDate('2026-03-01'));assert.equal(base.H2.v,10.125);assert.equal(base.H2.t,'n');assert.equal(base.D2.z,'dd/mm/yyyy');assert.equal(base.H5.v,0);assert.equal(base.G5.v,0);assert.equal(base.H4?.v,undefined);assert.equal(base.F4?.v,undefined);assert.equal(base.D4.v,'2026-02-31');assert.equal(JSON.stringify(input),before);
 assert.equal(main.A5.v,90);assert.equal(main.C5.v,20);assert.equal(main.E5.v,110);assert.equal(main.F7.v,30.125);assert.equal(main['!ref'],'A1:G19');assert.equal(base['!ref'],'A1:N5');
});

test('supplier and reason outlines retain all rows and preserve closed reason state, frozen headings and meeting print layout',()=>{
 const output=F.create(fixture()),sheet=file(output,'xl/worksheets/sheet1.xml');
 assert.match(sheet,/<outlinePr summaryBelow="0" summaryRight="0"/);assert.match(sheet,/<pane ySplit="9" topLeftCell="A10"/);assert.match(sheet,/<row r="11"[^>]*outlineLevel="1"/);assert.match(sheet,/<row r="12"[^>]*outlineLevel="2"/);assert.match(sheet,/<row r="14"[^>]*outlineLevel="1"[^>]*collapsed="1"/);assert.match(sheet,/<row r="15"[^>]*outlineLevel="2"[^>]*hidden="1"/);assert.equal(output.sheets[1].rows.length,5,'Detail sheet keeps hidden and zero-value rows');assert.match(sheet,/orientation="landscape" fitToWidth="1" fitToHeight="0"/);assert.match(file(output,'xl/workbook.xml'),/_xlnm.Print_Titles[^>]*>[^<]*\$9:\$9/);
 assert.equal(output.sheets[0].rows.filter(row=>row.level===0).length,0,'Top-level supplier headers use default outline level zero');assert.equal(output.sheets[0].rows.filter(row=>row.level===1).length,3);assert.equal(output.sheets[0].rows.filter(row=>row.level===2).length,4);
});

test('workbook uses the panel palette and Montserrat with centered numeric styles and visible zebra cells',()=>{
 const output=F.create(fixture()),styles=file(output,'xl/styles.xml'),sheet=file(output,'xl/worksheets/sheet1.xml');
 for(const color of ['FF233F57','FFFFFFFF','FFE4E7EB'])assert(styles.includes(color));assert(styles.includes('<name val="Montserrat"/>'));assert(styles.includes('<sz val="11"/>'));assert(styles.includes('<sz val="18"/>'));
 const xfs=styles.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/)[1].match(/<xf\b.*?<\/xf>/g);for(const index of [2,3,4,5,6,7,10,12,16,18,20,22])assert.match(xfs[index],/horizontal="center" vertical="center"/);
 assert.match(sheet,/<c r="F12" s="4" t="n"/);assert.match(sheet,/<c r="F13" s="5" t="n"/);assert.match(sheet,/<c r="A12" s="0" t="inlineStr"/);assert.match(sheet,/<c r="A13" s="1" t="inlineStr"/);
});

test('source strings cannot become formulas, links or extra XML parts and invalid controls are removed',()=>{
 const input=fixture();input.groups[0].supplier='=SUM(1,2)\u0001 & <supplier>';input.groups[0].reasons[0].rows[0].pending='@SUM(A1:A2)';const output=F.create(input),book=X.read(bytes(output),{type:'buffer'});
 for(const sheet of Object.values(book.Sheets))for(const [key,cell]of Object.entries(sheet)){if(key.startsWith('!'))continue;assert.equal(cell.f,undefined);assert.equal(cell.l,undefined);}
 assert.equal(book.Sheets['FUP reunião'].A10.v,'=SUM(1,2) & <supplier>');assert.equal(book.Sheets['FUP reunião'].A15.t,'s');assert.equal(book.Sheets['FUP reunião'].A15.v,'=HYPERLINK("https://invalid.test")');
 const sheet=file(output,'xl/worksheets/sheet1.xml');assert(!sheet.includes('<f>'));assert(!sheet.includes('<hyperlink'));assert(sheet.includes('&amp; &lt;supplier&gt;'));assert(!sheet.includes('\u0001'));assert(output.files.every(entry=>!entry.name.includes('externalLinks')));
});

test('dates preserve leap years, reject invalid dates and follow Excel 1900 serial boundaries',()=>{
 assert.equal(F.excelDate('1900-01-01'),1);assert.equal(F.excelDate('1900-02-28'),59);assert.equal(F.excelDate('1900-03-01'),61);assert.equal(F.excelDate('2024-02-29'),45351);assert.equal(F.excelDate('2026-02-29'),null);assert.equal(F.excelDate(''),null);assert.equal(F.excelDate('2026-11-10T23:10:00Z'),F.excelDate('2026-11-10'));assert.throws(()=>F.create({groups:[]}),/Nenhum fornecedor/);
});

test('browser download uses the Excel MIME type and temporary object URL, not network or persistent storage',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../dist/fup-export.js'),'utf8'),links=[],urls=[],revoked=[],timers=[];let clicked=0,removed=0,blob;
 const context={window:{},TextEncoder,Uint8Array,Uint32Array,DataView,Blob,URL:{createObjectURL:value=>{blob=value;urls.push('blob:synthetic');return urls[0];},revokeObjectURL:value=>revoked.push(value)},document:{body:{append:link=>links.push(link)},createElement:()=>({click(){clicked++;},remove(){removed++;}})},setTimeout:fn=>timers.push(fn)};
 vm.runInNewContext(source,context);const result=context.window.MinervaFupExport.download({...fixture(),selectedSupplier:'Fornecedor A'});assert.equal(blob.type,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');assert.equal(clicked,1);assert.equal(removed,1);assert.equal(links[0].download,result.filename);assert.match(result.filename,/Fornecedor/);timers[0]();assert.deepEqual(revoked,['blob:synthetic']);
});
