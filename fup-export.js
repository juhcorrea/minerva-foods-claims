(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else global.MinervaFupExport=api;
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  // OOXML strings are explicit inline strings: source text is never a formula.
  // Outlines use summary rows above details, like the FUP's supplier/reason view.
  const encoder=new TextEncoder(),xml=value=>String(value??'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\ufffe\uffff]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const numeric=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
  const textCell=(value,style=0)=>({value:String(value??''),style}),numberCell=(value,style=4)=>({value:numeric(value),style});
  function excelDate(value){
    const match=String(value??'').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!match)return null;
    const stamp=Date.UTC(+match[1],+match[2]-1,+match[3]),date=new Date(stamp);
    if(date.toISOString().slice(0,10)!==match[0].slice(0,10)||+match[1]<1900)return null;
    return stamp/86400000+25569-(stamp<Date.UTC(1900,2,1)?1:0);
  }
  function dateCell(value,style){const serial=excelDate(value);return serial===null?textCell(value,style):numberCell(serial,style);}
  const columns=['Ordem','Faturamento','Contêiner / NF','Abertura','Dias','USD','Status'];
  const fonts=[{size:11},{size:11,bold:true},{size:11,bold:true,color:'FFFFFF'},{size:18,bold:true,color:'FFFFFF'},{size:10},{size:13,bold:true,color:'FFFFFF'},{size:13,bold:true}];
  const fills=['FFFFFF','E4E7EB','233F57','2E5372','EDF4F8','F4F0E5','BDB58C'];
  const styles=[
    {},{fill:3},{num:164},{fill:3,num:164},{font:1,num:165},{font:1,fill:3,num:165},{num:166},{fill:3,num:166},
    {font:2,fill:4},{font:5,fill:4,align:'left'},{font:5,fill:4,num:165},{font:2,fill:5,align:'left'},{font:2,fill:5,num:165},
    {font:3,fill:4,align:'left'},{font:4,align:'left'},{font:1,fill:6},{font:6,fill:6,num:165},{font:1,fill:7},{font:6,fill:7,num:165},
    {font:2,fill:4},{font:5,fill:4,num:165},{font:1,fill:8,align:'left'},{font:1,fill:8,num:165},{font:1,fill:3,align:'left'},{align:'left'},
    {font:2,fill:4},{font:2,fill:5}
  ];
  function stylesXml(){
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red](#,##0.00);0.00"/><numFmt numFmtId="166" formatCode="0"/></numFmts><fonts count="'+fonts.length+'">'+fonts.map(font=>'<font>'+(font.bold?'<b/>':'')+'<sz val="'+font.size+'"/><color rgb="FF'+(font.color||'233F57')+'"/><name val="Montserrat"/><family val="2"/></font>').join('')+'</fonts><fills count="'+(fills.length+2)+'"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'+fills.map(color=>'<fill><patternFill patternType="solid"><fgColor rgb="FF'+color+'"/><bgColor indexed="64"/></patternFill></fill>').join('')+'</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFC2CED7"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="'+styles.length+'">'+styles.map(style=>'<xf numFmtId="'+(style.num||0)+'" fontId="'+(style.font||0)+'" fillId="'+(style.fill??2)+'" borderId="1" xfId="0" applyAlignment="1" applyFill="1" applyFont="1"'+(style.num?' applyNumberFormat="1"':'')+'><alignment horizontal="'+(style.align||'center')+'" vertical="center" wrapText="1"/></xf>').join('')+'</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/></styleSheet>';
  }
  const colName=index=>{let out='';for(let n=index+1;n;n=Math.floor((n-1)/26))out=String.fromCharCode(65+(n-1)%26)+out;return out;};
  function cellXml(cell,row,col){
    const address=colName(col)+row,style=cell.style??0;
    if(cell.value===null||cell.value===undefined||cell.value==='')return '<c r="'+address+'" s="'+style+'"/>';
    if(typeof cell.value==='number')return '<c r="'+address+'" s="'+style+'" t="n"><v>'+cell.value+'</v></c>';
    if(cell.value.length>32767)throw new Error('Uma célula excede o limite de texto do Excel. Confira o registro antes de exportar.');
    return '<c r="'+address+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(cell.value)+'</t></is></c>';
  }
  function sheetXml(sheet){
    const last=colName(sheet.widths.length-1)+sheet.rows.length;
    if(sheet.rows.length>1048576)throw new Error('O recorte excede o limite de linhas do Excel.');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><outlinePr summaryBelow="0" summaryRight="0"/><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:'+last+'"/><sheetViews><sheetView workbookViewId="0" showGridLines="0" showOutlineSymbols="1" zoomScale="90"><pane ySplit="'+sheet.freeze+'" topLeftCell="A'+(sheet.freeze+1)+'" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A'+(sheet.freeze+1)+'" sqref="A'+(sheet.freeze+1)+'"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="24" outlineLevelRow="2"/><cols>'+sheet.widths.map((width,index)=>'<col min="'+(index+1)+'" max="'+(index+1)+'" width="'+width+'" customWidth="1"/>').join('')+'</cols><sheetData>'+sheet.rows.map((row,index)=>'<row r="'+(index+1)+'" ht="'+(row.height||26)+'" customHeight="1"'+(row.level?' outlineLevel="'+row.level+'"':'')+(row.hidden?' hidden="1"':'')+(row.collapsed?' collapsed="1"':'')+'>'+row.cells.map((cell,col)=>cellXml(cell,index+1,col)).join('')+'</row>').join('')+'</sheetData>'+(sheet.filter?'<autoFilter ref="A1:'+last+'"/>':'')+(sheet.merges.length?'<mergeCells count="'+sheet.merges.length+'">'+sheet.merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells>':'')+'<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/><headerFooter><oddFooter>'+xml('&CMinerva Foods Claims · Página &P de &N')+'</oddFooter></headerFooter></worksheet>';
  }
  function makeSheets(payload){
    if(!Array.isArray(payload?.groups)||!payload.groups.length)throw new Error('Nenhum fornecedor neste filtro para exportar.');
    const main={name:'FUP reunião',widths:[20,17,25,17,10,21,48],rows:[],merges:[],freeze:9},base={name:'Base do recorte',widths:[32,30,20,17,25,17,10,21,48,20,20,12,27,12],rows:[],merges:[],freeze:1,filter:true},criteria={name:'Critérios',widths:[32,110],rows:[],merges:[],freeze:1};
    const add=(sheet,cells,options={})=>{sheet.rows.push({cells,...options});return sheet.rows.length;};
    const merged=(value,style,last=6)=>[textCell(value,style),...Array.from({length:last},()=>textCell('',style))];
    let r=add(main,merged('MINERVA FOODS · FUP SUPRIMENTOS',13),{height:38});main.merges.push('A'+r+':G'+r);
    r=add(main,merged(payload.scopeLabel||'Todos os fornecedores do filtro',14),{height:28});main.merges.push('A'+r+':G'+r);
    r=add(main,merged('Carteira global · USD',14));main.merges.push('A'+r+':G'+r);
    r=add(main,[textCell('Negociações',15),textCell('',15),textCell('Jurídico · somente total',17),textCell('',17),textCell('Total geral',19),textCell('',19),textCell('',19)]);for(const ref of ['A:B','C:D','E:G']){const [first,last]=ref.split(':');main.merges.push(first+r+':'+last+r);}
    r=add(main,[numberCell(payload.globalTotals?.negotiation,16),textCell('',16),numberCell(payload.globalTotals?.legal,18),textCell('',18),numberCell(payload.globalTotals?.total,20),textCell('',20),textCell('',20)],{height:34});for(const ref of ['A:B','C:D','E:G']){const [first,last]=ref.split(':');main.merges.push(first+r+':'+last+r);}
    add(main,merged('',0),{height:10});
    r=add(main,[...merged('Negociações do recorte',21,4),numberCell(payload.total,22),textCell((payload.rowCount??0)+' linhas',21)],{height:30});main.merges.push('A'+r+':E'+r);
    r=add(main,merged('Dias em aberto até '+String(payload.date||'').split('-').reverse().join('/')+' · Use + / − à esquerda para abrir ou recolher os grupos.',14),{height:27});main.merges.push('A'+r+':G'+r);
    add(main,columns.map(label=>textCell(label,8)),{height:30});
    add(base,['Fornecedor','Motivo',...columns,'SGR','NF','País','Operação','Linha BD'].map(label=>textCell(label,8)),{height:32});
    let detailIndex=0;
    for(const group of payload.groups){
      r=add(main,[...merged(group.supplier,9,4),numberCell(group.total,10),textCell(group.claimCount+' claims',25)],{height:34});main.merges.push('A'+r+':E'+r);
      for(const reason of group.reasons||[]){
        r=add(main,[...merged(reason.label,11,4),numberCell(reason.total,12),textCell(reason.count+' claims · '+reason.rows.length+' linhas',26)],{height:30,level:1,collapsed:reason.expanded===false});main.merges.push('A'+r+':E'+r);
        for(let index=0;index<reason.rows.length;index++){
          const row=reason.rows[index],stripe=index%2,style=stripe?1:0,values=[textCell(row.order,style),dateCell(row.invoiceDate,stripe?3:2),textCell(row.container,style),dateCell(row.openingDate,stripe?3:2),numberCell(row.days,stripe?7:6),numberCell(row.claimed,stripe?5:4),textCell(row.pending,style)];
          const longest=Math.max(String(row.pending||'').length/44,String(row.container||'').length/23,String(row.order||'').length/19),height=Math.max(27,Math.min(120,Math.ceil(longest)*15));
          add(main,values,{height,level:2,hidden:reason.expanded===false});
          const flatStripe=detailIndex++%2,flatStyle=flatStripe?1:0;
          add(base,[textCell(group.supplier,flatStyle),textCell(reason.label,flatStyle),textCell(row.order,flatStyle),dateCell(row.invoiceDate,flatStripe?3:2),textCell(row.container,flatStyle),dateCell(row.openingDate,flatStripe?3:2),numberCell(row.days,flatStripe?7:6),numberCell(row.claimed,flatStripe?5:4),textCell(row.pending,flatStyle),textCell(row.sgr,flatStyle),textCell(row.nf,flatStyle),textCell(row.country,flatStyle),textCell(row.operation,flatStyle),numberCell(row.row,flatStripe?7:6)],{height});
        }
      }
    }
    r=add(main,[...merged('TOTAL DO RECORTE',9,4),numberCell(payload.total,10),textCell(detailIndex+' linhas',25)],{height:34});main.merges.push('A'+r+':E'+r);
    add(criteria,[textCell('Critério',8),textCell('Aplicação',8)],{height:30});
    for(const [label,value]of payload.criteria||[])add(criteria,[textCell(label,23),textCell(value,24)],{height:Math.max(28,Math.min(110,Math.ceil(String(value??'').length/105)*16))});
    add(criteria,[textCell('Formato do relatório',23),textCell('Fornecedor → motivo → detalhes. Subtotais reproduzem o recorte; agrupamentos podem ser abertos e recolhidos no Excel. O Jurídico permanece somente no total global.',24)],{height:48});
    return [main,base,criteria];
  }
  const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=crcTable[(crc^value)&255]^(crc>>>8);return(crc^0xffffffff)>>>0;}
  function zip(files){
    const chunks=[],central=[];let offset=0,size=0;
    for(const file of files){const name=encoder.encode(file.name),data=encoder.encode(file.data),crc=crc32(data),local=new Uint8Array(30+name.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint16(12,33,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,name.length,true);local.set(name,30);chunks.push(local,data);const directory=new Uint8Array(46+name.length),d=new DataView(directory.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint16(14,33,true);d.setUint32(16,crc,true);d.setUint32(20,data.length,true);d.setUint32(24,data.length,true);d.setUint16(28,name.length,true);d.setUint32(42,offset,true);directory.set(name,46);central.push(directory);size+=directory.length;offset+=local.length+data.length;}
    if(offset+size>0xffffffff)throw new Error('O recorte excede o tamanho suportado para exportação.');
    const end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,files.length,true);v.setUint16(10,files.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);return [...chunks,...central,end];
  }
  function create(payload){
    const sheets=makeSheets(payload),relationship='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const files=[{name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+sheets.map((_,index)=>'<Override PartName="/xl/worksheets/sheet'+(index+1)+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'},
      {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="'+relationship+'officeDocument" Target="xl/workbook.xml"/></Relationships>'},
      {name:'xl/workbook.xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>'+sheets.map((sheet,index)=>'<sheet name="'+xml(sheet.name)+'" sheetId="'+(index+1)+'" r:id="rId'+(index+1)+'"/>').join('')+'</sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">&apos;FUP reunião&apos;!$A$1:$G$'+sheets[0].rows.length+'</definedName><definedName name="_xlnm.Print_Titles" localSheetId="0">&apos;FUP reunião&apos;!$9:$9</definedName></definedNames><calcPr calcId="191029"/></workbook>'},
      {name:'xl/_rels/workbook.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((_,index)=>'<Relationship Id="rId'+(index+1)+'" Type="'+relationship+'worksheet" Target="worksheets/sheet'+(index+1)+'.xml"/>').join('')+'<Relationship Id="rId'+(sheets.length+1)+'" Type="'+relationship+'styles" Target="styles.xml"/></Relationships>'},
      {name:'xl/styles.xml',data:stylesXml()},...sheets.map((sheet,index)=>({name:'xl/worksheets/sheet'+(index+1)+'.xml',data:sheetXml(sheet)}))];
    return {chunks:zip(files),sheets,files,filename:'FUP_Suprimentos_'+(payload.selectedSupplier?'Fornecedor_':'')+'Minerva.xlsx'};
  }
  function download(payload){
    const output=create(payload),blob=new Blob(output.chunks,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=output.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);return {rows:payload.rowCount,filename:output.filename};
  }
  return {create,download,excelDate};
});
