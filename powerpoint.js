(function(global){
  'use strict';
  // Corporate frame follows the two Minerva decks supplied by the user.
  // All report numbers still come from the current applied meeting payload.
  const C={blue:'2E5372',ink:'263746',coral:'E84752',beige:'BDB58C',muted:'637484',line:'CCD5DB',pale:'E8EDF0',bg:'F2F3F4',green:'2F7865',white:'FFFFFF'};
  const FONT='Montserrat',W=13.333333,H=7.5,M=.38;
  const IDS=['summary','trend','analysts','suppliers','goal'];
  const EXPORT_REVISION='Minerva Claims export 2026-11-03-r4';
  const FORMAT='[$-416]#,##0';
  const number=value=>Number.isFinite(Number(value))?Number(value):0;
  const money=value=>number(value).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const pct=value=>(number(value)*100).toLocaleString('pt-BR',{maximumFractionDigits:0})+'%';
  const txt=value=>String(value==null?'':value);
  const duration=value=>`${String(Math.floor(number(value)/60)).padStart(2,'0')}:${String(Math.floor(number(value)%60)).padStart(2,'0')}`;
  const source='Controle Recebimento: M = Pago, ano e mês pela data R e valor positivo em T. Sem data R válida, o pagamento não é somado. AE serve para conferência. A visão integral não depende da validação ou dos filtros da BD. Uma linha agrupada soma T uma vez, mesmo sem detalhamento por ordem.';
  function library(options){const Constructor=options?.PptxGenJS||global.PptxGenJS||global.pptxgen;if(typeof Constructor!=='function')throw new Error('A exportação do PowerPoint ainda não carregou. Atualize a página e tente novamente.');return new Constructor();}
  function text(slide,value,x,y,w,h,size=14,options={}){slide.addText(txt(value),{x,y,w,h,fontFace:FONT,fontSize:size,color:C.ink,margin:0,breakLine:false,paraSpaceAfterPt:0,valign:'top',...options});}
  function line(slide,x1,y1,x2,y2,color=C.line,width=1){slide.addShape('line',{x:x1,y:y1,w:x2-x1,h:y2-y1,line:{color,width,beginArrowType:'none',endArrowType:'none'}});}
  function rect(slide,x,y,w,h,color=C.white){slide.addShape('rect',{x,y,w,h,line:{color,transparency:100},fill:{color},radius:0});}
  function logo(slide,value,x,y,w,h){
    if(value?.data){const ratio=number(value.ratio)>0?number(value.ratio):1200/506,iw=Math.min(w,h*ratio),ih=iw/ratio;slide.addImage({data:value.data,path:value.path||'assets/minerva-logo.png',x:x+(w-iw)/2,y:y+(h-ih)/2,w:iw,h:ih,altText:'Minerva Foods'});}
    else text(slide,'minerva\nfoods',x,y,w,h,Math.min(16,h*35),{color:C.blue,bold:true});
  }
  function makeDeck(title,options={}){const ppt=library(options);ppt.layout='LAYOUT_WIDE';ppt.author='Minerva Foods';ppt.subject='Claims e recebimentos · '+EXPORT_REVISION;ppt.title=title;ppt.company='Minerva Foods';ppt.lang='pt-BR';ppt.theme={headFontFace:FONT,bodyFontFace:FONT,lang:'pt-BR'};return ppt;}
  const NAV_RESULTS=[['summary','Indicadores'],['trend','Evolução'],['analysts','Analistas'],['suppliers','Fornecedores'],['goal','Meta']];
  const NAV_PORTFOLIO=[['before','Rotina'],['bases','Conciliação'],['scope','Critérios'],['correction','Correções'],['demo','Demonstração'],['access','Acesso']];
  function header(ppt,title,subtitle,metadata,index,total,brand,active,portfolio=false){
    const slide=ppt.addSlide();slide.background={color:C.bg};
    logo(slide,brand,.26,.18,.92,.39);
    const nav=portfolio?NAV_PORTFOLIO:NAV_RESULTS,start=1.65,end=12.98,step=(end-start)/nav.length;
    nav.forEach(([id,label],i)=>text(slide,label,start+i*step,.32,step-.08,.23,9.2,{color:id===active?C.blue:'72777B',bold:true,align:'center'}));
    line(slide,.27,.76,13.02,.76,C.line,.8);
    text(slide,title,M,1.01,12.5,.47,22.5,{color:C.blue,bold:true});
    if(subtitle)text(slide,subtitle,M,1.57,12.5,.26,10.5,{color:C.muted});
    rect(slide,M,7.16,.27,.27,C.blue);text(slide,String(index).padStart(2,'0'),M+.015,7.205,.24,.12,6.5,{color:C.white,align:'center',bold:true});
    text(slide,(metadata?.includes('Responsável: Administração')?'':'Responsável: Administração · ')+(metadata||'Minerva Foods Claims'),.78,7.19,10.7,.18,7,{color:C.muted});
    logo(slide,brand,12.0,6.94,.98,.414);
    slide._minervaSlideNumber={index,total};
    return slide;
  }
  function note(slide,content,metadata){slide.addNotes([txt(content),metadata||'',`Valores em USD. ${source}`].filter(Boolean).join('\n\n'));}
  function tableTextLines(value,width,fontSize,bold){
    // Montserrat advance widths keep wrapping deterministic in the browser and worker.
    // Accented Latin characters share the advance of their unaccented base glyph.
    const advances=bold?[283,289,437,720,638,877,728,230,357,358,434,599,262,386,262,392,679,392,590,592,689,595,637,620,660,637,262,262,599,599,599,589,1035,766,765,724,826,671,639,771,808,328,541,740,604,955,808,844,732,844,735,638,618,788,746,1163,714,676,671,368,392,368,600,500,600,617,690,591,692,631,387,700,691,301,307,655,301,1049,691,655,690,690,431,531,435,687,598,937,595,598,543,391,309,391,599]:[262,260,373,696,615,829,669,202,329,329,386,575,212,382,212,335,662,361,568,564,661,566,609,589,638,609,212,212,575,575,575,567,1033,717,754,709,826,669,633,773,813,302,501,711,589,955,813,839,718,839,723,615,574,792,698,1111,656,635,651,318,335,318,576,500,600,590,678,563,678,604,339,685,676,269,274,598,269,1061,676,627,678,678,401,488,406,672,542,879,534,542,511,334,294,334,575];
    const measure=s=>Array.from(s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')).reduce((sum,c)=>sum+(advances[c.charCodeAt(0)-32]||600),0)*fontSize/1000;
    const available=Math.max(1,width*72-14),space=advances[0]*fontSize/1000;
    return txt(value).split('\n').reduce((total,paragraph)=>{
      let lines=1,used=0;
      paragraph.split(/\s+/).filter(Boolean).forEach(word=>{
        const length=measure(word);
        if(used&&used+space+length>available){lines++;used=0;}
        if(length>available){
          for(const character of word){const advance=measure(character);if(used&&used+advance>available){lines++;used=0;}used+=advance;}
        }else used+=(used?space:0)+length;
      });
      return total+lines;
    },0);
  }
  function table(slide,headers,rows,x,y,width,colWidths,options={}){
    const fontSize=options.fontSize||11,rowH=options.rowH||.36;
    const widths=colWidths?.length===headers.length?colWidths:headers.map(()=>width/headers.length);
    let top=y;
    // Editable shapes/text use the same export structure as the earlier working decks.
    // Avoid a:tbl while retaining the corporate table geometry and every cell value.
    [headers,...rows].forEach((row,r)=>{
      const heading=r===0,bold=heading||!!(options.lastBold&&r===rows.length),fill=heading?C.blue:(r-1)%2?C.white:C.pale;
      const color=heading?C.white:bold?C.blue:C.ink;
      const lines=Math.max(1,...row.map((value,c)=>tableTextLines(value,widths[c],fontSize,bold)));
      const height=Math.max(heading ? .34 : rowH,(lines*fontSize*1.14+8)/72);
      let left=x;
      widths.forEach((cellWidth,c)=>{
        slide.addShape('rect',{x:left,y:top,w:cellWidth,h:height,line:{color:C.white,width:.45},fill:{color:fill}});
        // PptxGenJS text margins use left, right, bottom, top (tables use CSS order).
        text(slide,row[c],left,top,cellWidth,height,fontSize,{color,bold,align:c&&options.numeric?'right':'left',margin:[7,7,4,4],valign:'mid'});
        left+=cellWidth;
      });
      top+=height;
    });
  }
  function column(slide,index,title,x,y,w,h){rect(slide,x,y,w,h);rect(slide,x,y,w,.34,C.blue);text(slide,String(index).padStart(2,'0'),x+.13,y+.08,.33,.16,8.5,{bold:true,color:C.beige});text(slide,title,x+.52,y+.075,w-.64,.2,10.5,{bold:true,color:C.white});}
  function metric(slide,value,label,x,y,w=3.7,color=C.blue){rect(slide,x,y,w,.95);line(slide,x,y,x+w,y,color,2.5);text(slide,value,x+.12,y+.19,w-.24,.38,24,{bold:true,color,align:'center'});text(slide,label,x+.12,y+.65,w-.24,.24,10.1,{color:C.muted,align:'center'});}
  function readout(slide,title,body,x,y,w,h=1.35){rect(slide,x,y,w,h,C.blue);if(h<1.1){text(slide,title,x+.19,y+.15,4.25,h-.22,10.4,{bold:true,color:C.white});text(slide,body,x+4.75,y+.13,w-4.94,h-.2,10.7,{color:C.white});}else{text(slide,title,x+.19,y+.18,w-.38,.24,10.4,{bold:true,color:C.white});text(slide,body,x+.19,y+.58,w-.38,h-.68,11.1,{color:C.white});}}
  function section(slide,title,x,y,w){text(slide,title,x,y,w,.25,13,{bold:true,color:C.blue});}
  function bodyNote(slide,value,y=6.75,w=11.4){text(slide,value,M,y,w,.28,8.5,{color:C.muted});}
  function chartOptions(overrides={}){return {x:M,y:2.05,w:8.5,h:3.35,showTitle:false,showLegend:false,showValue:true,showBorder:false,showCatName:false,lang:'pt-BR',chartColors:[C.blue],showShadow:false,showLabel:false,catAxisLabelFontFace:FONT,catAxisLabelFontSize:10,catAxisLabelColor:C.muted,catAxisLineShow:false,catAxisMajorTickMark:'none',catAxisMinorTickMark:'none',valAxisLabelFontFace:FONT,valAxisLabelFontSize:9,valAxisLabelColor:C.muted,valAxisLabelFormatCode:FORMAT,valAxisLineShow:false,valAxisMajorTickMark:'none',valAxisMinorTickMark:'none',valAxisMinVal:0,dataLabelFormatCode:FORMAT,dataLabelFontFace:FONT,dataLabelFontSize:9,dataLabelColor:C.blue,dataLabelPosition:'outEnd',catGridLine:{style:'none'},valGridLine:{color:C.line,width:.6},chartArea:{fill:{color:C.bg},border:{color:C.bg,pt:0},roundedCorners:false},plotArea:{fill:{color:C.bg},border:{color:C.bg,pt:0}},showCatAxisTitle:false,showValAxisTitle:false,...overrides};}
  function comparison(d,p){if(p.month>0&&d.previousAvailable){if(d.variation==null)return 'O mês anterior não registra recebimentos na base.';return `${d.delta>=0?'Aumento':'Redução'} de USD ${money(Math.abs(d.delta))} (${pct(Math.abs(d.variation))}) em relação ao mês anterior.`;}return p.month===-1?'A data de compensação R define o mês; datas inválidas são apontadas e não somadas.':'O recorte considera todas as operações e fornecedores do Controle de Recebimento.';}
  function resultSummary(slide,p){const d=p.data,xs=[M,4.59,8.8],cw=4.15,inner=cw-.34;
    ['RECEBIDO NO PERÍODO','ACUMULADO NO ANO','META DA EQUIPE'].forEach((label,i)=>column(slide,i+1,label,xs[i],1.99,cw,4.92));
    text(slide,`USD ${money(d.received)}`,xs[0]+.17,2.57,inner,.43,24,{bold:true,color:C.blue});text(slide,p.period,xs[0]+.17,3.08,inner,.35,10.7,{color:C.muted});
    const periodRows=[['Parcelas pagas',money(d.count)],['Analistas no período',money(d.analysts?.length)],['Fornecedores',money(d.suppliers?.length)]];
    table(slide,['Controle','Resultado'],periodRows,xs[0]+.17,3.67,inner,[2.3,inner-2.3],{numeric:true,fontSize:10.2,rowH:.38});
    section(slide,'Leitura do período',xs[0]+.17,5.48,inner);text(slide,comparison(d,p),xs[0]+.17,5.9,inner,.82,11.2,{color:C.muted});
    text(slide,`USD ${money(d.annual)}`,xs[1]+.17,2.57,inner,.43,24,{bold:true,color:C.blue});text(slide,`Ano de compensação ${p.year}`,xs[1]+.17,3.08,inner,.35,10.7,{color:C.muted});
    table(slide,['Conferência anual','Resultado'],[['Parcelas pagas',money(d.annualCount)],['Distribuído nos meses',money(d.allocated)],['Sem mês definido',money(d.unallocated)]],xs[1]+.17,3.67,inner,[2.3,inner-2.3],{numeric:true,fontSize:10.2,rowH:.38});
    section(slide,'Realizado integral',xs[1]+.17,5.48,inner);text(slide,'Pago (M) · ano da data de compensação (R) · valor recebido em USD (T). Todos os pagamentos elegíveis do Controle.',xs[1]+.17,5.9,inner,.82,11.2,{color:C.muted});
    if(d.goal){text(slide,`USD ${money(d.goal.target)}`,xs[2]+.17,2.57,inner,.43,24,{bold:true,color:C.blue});text(slide,`Marco de 100% · meta anual de ${p.year}`,xs[2]+.17,3.08,inner,.35,10.7,{color:C.muted});
      table(slide,['Acompanhamento','Valor'],[['Realizado / meta',pct(d.goal.progress)],['Falta para 100%',money(d.goal.delta)],['Falta para 150%',money(d.goal.stretchDelta)]],xs[2]+.17,3.67,inner,[2.3,inner-2.3],{numeric:true,fontSize:10.2,rowH:.38});
      section(slide,'Delta para a meta de 100%',xs[2]+.17,5.48,inner);text(slide,d.goal.delta?`USD ${money(d.goal.delta)}`:'Marco atingido',xs[2]+.17,5.94,inner,.47,24,{color:d.goal.delta?C.coral:C.green,bold:true});text(slide,'A meta usa o acumulado do ano.',xs[2]+.17,6.52,inner,.22,10.2,{color:C.muted});
    }else{text(slide,'Não cadastrada',xs[2]+.17,2.62,inner,.55,23,{bold:true,color:C.blue});text(slide,`Não há meta definida para ${p.year}. Os marcos de USD 300.000 e USD 450.000 pertencem a 2026.`,xs[2]+.17,3.47,inner,1.2,13,{color:C.muted});}
  }
  function resultTrend(slide,p){const d=p.data,rows=d.monthly||[];
    if(rows.length)slide.addChart('bar',[{name:'Recebido USD',labels:rows.map(r=>txt(r.name).slice(0,3)),values:rows.map(r=>number(r.received))}],chartOptions({barDir:'col',dataLabelFontSize:8.5,barGapWidthPct:55,y:2.06,h:3.22}));
    else text(slide,'Nenhuma distribuição mensal disponível.',M,3.0,8.5,.6,20);
    section(slide,'Conferência do total anual',M,5.48,8.48);
    table(slide,['Distribuído nos meses','Sem mês definido','Total do ano'],[[money(d.allocated),money(d.unallocated),money(d.annual)]],M,5.9,8.48,[2.83,2.83,2.82],{fontSize:12,rowH:.45,lastBold:true,numeric:true});
    const rx=9.15,rw=3.78;
    metric(slide,`USD ${money(d.received)}`,'Recebido no período selecionado',rx,2.02,rw);
    metric(slide,`USD ${money(d.annual)}`,`Acumulado em ${p.year}`,rx,3.15,rw,C.beige);
    metric(slide,d.goal?`USD ${money(d.goal.delta)}`:money(d.annualCount),d.goal?'Falta para a meta anual de 100%':'Parcelas pagas no ano',rx,4.28,rw,d.goal?C.coral:C.blue);
    readout(slide,'LEITURA DO PERÍODO',comparison(d,p),rx,5.42,rw,1.3);
    bodyNote(slide,'Ano e mês pela data de compensação R. Pagamentos sem data válida não são somados.',6.81,8.45);
  }
  function wrapName(value,max=33){const words=txt(value).split(/\s+/),lines=[''];for(const word of words){const last=lines.length-1;if(lines[last].length&&lines[last].length+word.length>max)lines.push(word);else lines[last]+=(lines[last]?' ':'')+word;}return lines.join('\n');}
  function resultRanking(slide,p,type){const d=p.data,list=type==='analysts'?d.analysts:d.suppliers,rows=(list||[]).slice(0,5),isAnalyst=type==='analysts',noun=isAnalyst?'analistas':'fornecedores',sumTop=rows.reduce((sum,row)=>sum+number(row.received),0),remaining=Math.max(0,number(d.received)-sumTop),rx=9.15,rw=3.78;
    section(slide,(list||[]).length>5?`Os 5 maiores ${noun}`:`${isAnalyst?'Analistas':'Fornecedores'} no período`,M,2.02,8.48);
    if(rows.length)slide.addChart('bar',[{name:'Recebido USD',labels:rows.map(r=>wrapName(r.name)),values:rows.map(r=>number(r.received))}],chartOptions({barDir:'bar',x:M,y:2.38,h:3.15,w:8.48,catAxisLabelFontSize:isAnalyst?12:9.8,catAxisOrientation:'maxMin',catAxisLabelPos:'low',valAxisHidden:true,valGridLine:{style:'none'},valAxisMaxVal:Math.max(...rows.map(r=>number(r.received)))*1.2||1,dataLabelFontSize:10,barGapWidthPct:58}));
    else text(slide,'Nenhum pagamento neste período.',M,3.2,8.48,.7,20);
    section(slide,'Composição do recebido',M,5.67,8.48);
    table(slide,['Exibido no gráfico',`Demais ${noun}`,'Total do período'],[[money(sumTop),money(remaining),money(d.received)]],M,5.98,8.48,[2.83,2.83,2.82],{fontSize:12,rowH:.43,lastBold:true,numeric:true});
    metric(slide,`USD ${money(d.received)}`,'Recebido no período selecionado',rx,2.02,rw);
    metric(slide,money(d.count),'Parcelas pagas no período',rx,3.15,rw,C.beige);
    metric(slide,money((list||[]).length),`${isAnalyst?'Analistas':'Fornecedores'} no período`,rx,4.28,rw);
    const body=isAnalyst?'Identificação pela coluna AF do Controle. A meta é da equipe, sem metas individuais.':'Nomes originais da coluna K do Controle. Não há agrupamento por inferência com a BD.';
    readout(slide,'CRITÉRIO DA LEITURA',body,rx,5.42,rw,1.3);
    bodyNote(slide,(list||[]).length>5?`Os cinco maiores representam ${pct(d.received?sumTop/d.received:0)} do período. Todos os registros estão no Excel do painel.`:'Os gráficos e a composição consideram o mesmo período aplicado.',6.88,8.45);
  }
  function resultGoal(slide,p){const d=p.data,g=d.goal,rx=9.15,rw=3.78;
    if(!g){rect(slide,M,2.02,8.48,3.15);text(slide,`Meta não definida para ${p.year}`,M+.24,2.46,7.95,.65,24,{bold:true,color:C.blue});text(slide,'Os marcos de USD 300.000 e USD 450.000 foram definidos somente para 2026.',M+.24,3.48,7.95,1.0,16,{color:C.muted});metric(slide,`USD ${money(d.annual)}`,`Recebido no ano de ${p.year}`,rx,2.02,rw);readout(slide,'TOTAL DO ANO','O realizado continua disponível, sem atribuir ao período uma meta que não foi cadastrada.',rx,3.3,rw,1.7);return;}
    rect(slide,M,2.02,8.48,2.56);text(slide,`Recebido no ano de ${p.year}`,M+.23,2.27,7.95,.3,13,{bold:true,color:C.blue});text(slide,`USD ${money(d.annual)}`,M+.23,2.86,7.95,.6,31,{bold:true,color:C.blue});
    rect(slide,M+.23,3.75,7.98,.14,C.pale);rect(slide,M+.23,3.75,Math.max(.001,7.98*Math.min(1,Math.max(0,g.progress))),.14,C.blue);
    text(slide,`${pct(g.progress)} do valor da meta de 100%`,M+.23,4.07,7.95,.3,12,{color:C.muted});
    section(slide,'Metas e valores restantes',M,4.94,8.48);
    table(slide,['Marco','Valor da meta (USD)','Falta atingir (USD)'],[['100%',money(g.target),money(g.delta)],['150%',money(g.stretch),money(g.stretchDelta)]],M,5.38,8.48,[1.85,3.3,3.33],{fontSize:12,rowH:.47,numeric:true});
    metric(slide,`USD ${money(g.target)}`,'Meta anual · marco de 100%',rx,2.02,rw);
    metric(slide,`USD ${money(g.stretch)}`,'Meta anual · marco de 150%',rx,3.15,rw,C.beige);
    metric(slide,g.delta?`USD ${money(g.delta)}`:'Marco atingido','Delta para o marco de 100%',rx,4.28,rw,g.delta?C.coral:C.green);
    readout(slide,'ACOMPANHAMENTO ANUAL','O cálculo usa o acumulado do ano, mesmo quando o período da reunião é um mês.',rx,5.42,rw,1.3);
    bodyNote(slide,'Marcos da equipe, sem metas mensais proporcionais, metas individuais ou interpolação de bônus.',6.81,8.45);
  }
  function imageOption(value,ratio){return typeof value==='string'?{data:value,ratio}:value?.data?value:null;}
  function buildResults(payload,options={}){
    if(!payload?.data)throw new Error('Carregue os dados da reunião antes de exportar.');
    const selected=IDS.filter(id=>(payload.visualIds||[]).includes(id));if(!selected.length)throw new Error('Selecione pelo menos um visual para exportar.');
    const ppt=makeDeck(payload.title||'Reunião de resultados',options),d=payload.data,brand=imageOption(options.logoData,1200/506);
    const titles={summary:'Indicadores | Claims e recebimentos',trend:`Evolução dos recebimentos em ${payload.year}`,analysts:'Recebimento por analista',suppliers:'Recebimento por fornecedor',goal:`Meta da equipe em ${payload.year}`};
    selected.forEach((id,i)=>{
      const scope=id==='trend'?`Ano de compensação ${payload.year} · Valores em USD`:id==='goal'?`Total anual da equipe · Valores em USD`:`${payload.period} · Valores em USD`;
      const slide=header(ppt,titles[id],scope,payload.metadata,i+1,selected.length,brand,id);
      if(id==='summary')resultSummary(slide,payload);else if(id==='trend')resultTrend(slide,payload);else if(id==='goal')resultGoal(slide,payload);else resultRanking(slide,payload,id);
      const explanation=id==='analysts'?'Analista informado na coluna AF do Controle. A meta é da equipe, sem metas individuais.':id==='suppliers'?'Fornecedor da coluna K do Controle. Os nomes originais não são agrupados por inferência.':id==='trend'?`A soma dos meses é USD ${money(d.allocated)}. O total anual de USD ${money(d.annual)} usa o ano da data de compensação R.`:id==='goal'?'Os marcos pertencem a 2026. Não há meta mensal proporcional nem escala de bônus interpolada.':'';
      note(slide,[payload.notes?.[id],explanation,`Período aplicado: ${payload.period}.`].filter(Boolean).join('\n\n'),payload.metadata);
    });return ppt;
  }
  function portfolioCover(ppt,payload,brand,cover){
    const slide=ppt.addSlide();slide.background={color:C.bg};if(cover?.data)slide.addImage({data:cover.data,path:cover.path||'assets/minerva-cover.png',x:0,y:0,w:W,h:H,altText:'Arte institucional Minerva Foods'});
    logo(slide,brand,.52,.46,2.24,.944);
    text(slide,'Minerva Foods\nClaims',.54,2.55,4.95,1.45,34.5,{bold:true,color:C.blue});
    text(slide,'Gestão de ressarcimentos',.56,4.42,4.72,.74,20.25,{bold:true,color:C.beige});
    text(slide,'Supply Chain',.56,5.25,4.5,.32,14,{color:C.muted});
    text(slide,'Responsável: Administração',.56,5.68,4.5,.26,11,{color:C.muted});
    text(slide,'Duas planilhas conectadas.\nRoteiro de 10 minutos.',.56,6.1,4.4,.64,14,{color:C.blue});
    text(slide,(payload.metadata||'').replace('Responsável: Administração · ',''),.56,7.16,4.75,.2,6.3,{color:C.muted});return slide;
  }
  function portfolioContent(slide,index){
    if(index===1){
      table(slide,['Etapa','Na rotina do Excel','Com o painel'],[
        ['Cruzamento','PROCV e conferência entre bases','Cruzamento por ordem ou nota fiscal'],
        ['Conferência','Nomes, ano e mercado para revisar','Divergências agrupadas por ordem'],
        ['Parcelamento','Reconstrução das parcelas de cada acordo','Histórico e quitação no mesmo detalhe'],
        ['Apresentação','Totais e gráficos montados para apresentar','Visuais e exportações com o período escolhido']
      ],M,2.06,12.56,[2.08,5.24,5.24],{fontSize:14,rowH:.76});
      readout(slide,'DOIS ARQUIVOS, UMA LEITURA','As bases continuam no Excel. O painel organiza o cruzamento, a conferência e a apresentação dos resultados.',M,6.06,12.56,.84);
    }else if(index===2){
      section(slide,'Informações de cada base',M,2.04,7.9);
      table(slide,['Informação','BD','Controle Recebimento'],[
        ['Registro','Claim / ocorrência','Parcelas do acordo'],['Vínculo','Ordem (W) ou NF (Y)','Referência (H)'],['Data','Data RNC (B)','Ano e mês da compensação (R)'],['Valor','Reclamado (AJ)','Recebido USD (T)']
      ],M,2.49,7.95,[1.55,2.8,3.6],{fontSize:12,rowH:.54});
      column(slide,1,'EXEMPLO ILUSTRATIVO',8.7,2.04,4.23,4.11);
      text(slide,'1 claim · 3 parcelas',8.9,2.68,3.83,.47,21,{bold:true,color:C.blue});
      table(slide,['Parcela','Situação'],[['1','Paga'],['2','Paga'],['3','Em aberto']],8.9,3.4,3.83,[1.4,2.43],{fontSize:12,rowH:.46});
      text(slide,'A quitação considera o acordo completo.',8.9,5.62,3.83,.35,11,{color:C.muted});
      readout(slide,'VÍNCULO PELA ORDEM OU NOTA FISCAL','As parcelas permanecem em acompanhamento até a quitação, sem multiplicar o valor do claim.',M,6.29,12.56,.61);
    }else if(index===3){
      column(slide,1,'RECEBIDO CONCILIADO',M,2.04,6.15,3.62);column(slide,2,'RECEBIDO TOTAL NO CONTROLE',6.79,2.04,6.15,3.62);
      text(slide,'Comparativo: CTNR/carreta e operação não identificada.',M+.21,2.72,5.73,.86,16,{bold:true,color:C.blue});
      text(slide,'Pago em M, ano por R e valor T. A validação na BD não condiciona o recebido.',M+.21,3.97,5.73,.72,13.5,{color:C.muted});
      text(slide,'Mesmo ano · outros anos · ano não identificado',M+.21,5.04,5.73,.36,11.5,{color:C.blue,bold:true});
      text(slide,'Realizado integral, incluindo pagamentos sem vínculo com a BD.',7,2.72,5.73,.86,16,{bold:true,color:C.blue});
      text(slide,'Status Pago (M), ano da data de compensação (R) e valor recebido em USD (T).',7,3.97,5.73,.72,13.5,{color:C.muted});
      text(slide,'Controle de recebimento + resultado por analista',7,5.04,5.73,.36,11.5,{color:C.blue,bold:true});
      rect(slide,M,6.02,12.56,.65,C.blue);text(slide,'Perda = Reclamado − (Recebido + Em negociação)',M+.2,6.2,12.16,.35,19,{bold:true,color:C.white,align:'center'});
      bodyNote(slide,'As parcelas em aberto são acompanhadas separadamente no Controle.',6.84);
    }else if(index===4){
      const steps=[['Conferir a divergência','Compare fornecedor, ano e mercado originais com correções seguras da BD. O recebido T e o reclamado da BD são preservados.','BD como referência',C.blue],['Corrigir a ordem no Excel','Copie a referência e atualize a planilha. O painel preserva o arquivo original.','Arquivo original preservado',C.beige],['Marcar e publicar','“Já ajustei” registra o acompanhamento. Publique as planilhas atualizadas para compartilhar os novos dados.','Versão compartilhada',C.coral]];
      steps.forEach((s,i)=>{const x=M+i*4.21;rect(slide,x,2.04,4.15,4.35);line(slide,x,2.04,x+4.15,2.04,s[3],3);text(slide,String(i+1),x+.2,2.35,3.75,.38,24,{bold:true,color:s[3]});text(slide,s[0],x+.2,3.02,3.75,.8,18,{bold:true,color:C.blue});text(slide,s[1],x+.2,4.21,3.75,1.28,13,{color:C.muted});text(slide,s[2],x+.2,5.88,3.75,.29,11.4,{bold:true,color:C.blue});});
      bodyNote(slide,'Original ou Corrigido muda a atribuição no painel. “Já ajustei” registra apenas o acompanhamento.',6.73);
    }else if(index===5){
      table(slide,['Sequência','Aba do painel','O que apresentar'],[
        ['01','Visão geral','Conferir o período e os indicadores.'],['02','Fornecedores','Abrir um fornecedor e consultar o acordo.'],['03','Correções da base','Mostrar o original, a referência da BD e o acompanhamento.'],['04','Reunião de resultados','Escolher o mês e os visuais para apresentar.']
      ],M,2.08,12.56,[1.3,3.5,7.76],{fontSize:14,rowH:.79});
      rect(slide,M,6.18,12.56,.69,C.white);line(slide,M,6.18,M+12.56,6.18,C.beige,2.5);text(slide,'2 minutos de demonstração',M+.2,6.38,4.45,.31,17,{bold:true,color:C.blue});text(slide,'Abra o painel no navegador e retorne ao PowerPoint para concluir.',5.24,6.4,7.5,.26,11.5,{color:C.muted});
    }else{
      const steps=[['Publicar a atualização','Administração é a responsável pela atualização do painel e pela versão compartilhada.','Data, hora e responsável',C.blue],['Aprovar a consulta','O time solicita acesso. A visualização é liberada após a aprovação.','Acesso controlado',C.beige],['Acompanhar os resultados','A equipe consulta os dados publicados, confere os detalhes e exporta os visuais.','Mesma versão para o time',C.coral]];
      steps.forEach((s,i)=>{const x=M+i*4.21;rect(slide,x,2.04,4.15,3.94);line(slide,x,2.04,x+4.15,2.04,s[3],3);text(slide,s[0],x+.2,2.5,3.75,.84,18,{bold:true,color:C.blue});text(slide,s[1],x+.2,3.71,3.75,1.15,13.5,{color:C.muted});text(slide,s[2],x+.2,5.42,3.75,.31,11.5,{bold:true,color:C.blue});});
      readout(slide,'A PRÓXIMA REUNIÃO PARTE DA BASE PUBLICADA','Período definido, critérios visíveis e dados disponíveis para conferência.',M,6.22,12.56,.66);
    }
  }
  function buildPortfolio(payload,options={}){
    if(!payload?.slides||payload.slides.length!==7)throw new Error('O roteiro do portfólio não está disponível. Atualize a página.');
    const ppt=makeDeck(payload.title||'Minerva Foods Claims',options),brand=imageOption(options.logoData,1200/506),cover=imageOption(options.coverData,16/9);
    const titles=['Apresentação do painel','Preparação da análise','Conciliação das duas bases','Critérios dos recebimentos','Conferência e atualização da base','Demonstração do painel','Atualização e acesso do time'],active=['','before','bases','scope','correction','demo','access'];
    let elapsed=0;
    payload.slides.forEach((part,i)=>{const start=elapsed;elapsed+=number(part.duration);const subtitle=`Roteiro de apresentação · ${duration(start)} a ${duration(elapsed)}`;const slide=i===0?portfolioCover(ppt,payload,brand,cover):header(ppt,titles[i],subtitle,payload.metadata,i+1,7,brand,active[i],true);if(i)portfolioContent(slide,i);let notes=txt(part.notes);if(i===5)notes='Reserve dois minutos para demonstrar o site. Abra o painel no navegador e percorra Visão geral, Fornecedores, Correções da base e Reunião de resultados. Volte ao PowerPoint para concluir. Evite marcar ou alterar dados durante a demonstração.';slide.addNotes([`Tempo sugerido: ${duration(start)} a ${duration(elapsed)}.`,notes,payload.metadata||''].filter(Boolean).join('\n\n'));});return ppt;
  }
  let generation=0,logoPromise=null,coverPromise=null;
  function cancelled(){return new Error('A exportação foi interrompida porque seu acesso mudou. Atualize a página para continuar.');}
  async function checkAccess(token){
    if(token!==generation)throw cancelled();
    if(global.MINERVA_HOSTED===true){
      const response=await global.fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw cancelled();const session=await response.json();
      if(token!==generation||session.approved!==true||!['admin','editor','reviewer','viewer'].includes(session.role))throw cancelled();
    }
  }
  function imageData(img){const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;if(!canvas.width||!canvas.height)throw new Error('Logo indisponível');const context=canvas.getContext('2d');if(!context)throw new Error('Logo indisponível');context.drawImage(img,0,0);return {data:canvas.toDataURL('image/png'),ratio:canvas.width/canvas.height};}
  async function originalImage(path,ratio){
    // Preserve the original PNG bytes: canvas re-encoding enlarges this artwork.
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await global.fetch(path,{credentials:'same-origin',cache:'force-cache',signal:controller.signal});
      if(!response.ok)throw new Error('Imagem indisponível');
      const blob=await response.blob();if(!/^image\/png(?:;|$)/i.test(blob.type)||!blob.size)throw new Error('Imagem indisponível');
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error||new Error('Imagem indisponível'));reader.readAsDataURL(blob);});
      return {data,ratio,path};
    }finally{clearTimeout(timeout);}
  }
  async function officialLogo(){
    if(!global.document)return null;
    if(!logoPromise)logoPromise=originalImage('assets/minerva-logo.png',1200/506).catch(()=>{
      const current=document.getElementById('brandLogo');if(current?.complete&&current.naturalWidth){try{return {...imageData(current),path:'assets/minerva-logo.png'};}catch{}}
      return null;
    }).then(value=>{if(!value)logoPromise=null;return value;});
    return logoPromise;
  }
  async function officialCover(){
    if(!global.document)return null;
    if(!coverPromise)coverPromise=originalImage('assets/minerva-cover.png',16/9).catch(()=>null).then(value=>{if(!value)coverPromise=null;return value;});
    return coverPromise;
  }
  async function download(payload,kind){
    if(!global.document)throw new Error('A exportação para arquivo exige um navegador.');
    const token=generation;await checkAccess(token);const [logo,cover]=await Promise.all([officialLogo(),kind==='results'?Promise.resolve(null):officialCover()]);if(token!==generation)throw cancelled();
    const ppt=kind==='results'?buildResults(payload,{logoData:logo}):buildPortfolio(payload,{logoData:logo,coverData:cover});
    const blob=await ppt.write({outputType:'blob',compression:true});await checkAccess(token);
    const months=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const month=Number(payload.month),period=month===0?'Anual':month===-1?'Sem-Mes-Definido':months[month-1];
    const fileName=kind==='results'?`Minerva-Foods-Claims-Resultados-${period}-${payload.year}.pptx`:'Minerva-Foods-Claims-Apresentacao-do-Painel.pptx';
    const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=fileName;anchor.style.display='none';document.body.append(anchor);
    try{if(token!==generation)throw cancelled();anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
    return {fileName,exportRevision:EXPORT_REVISION,slideCount:kind==='results'?IDS.filter(id=>payload.visualIds.includes(id)).length:7,logoIncluded:Boolean(logo),coverIncluded:kind==='results'||Boolean(cover)};
  }
  const api={revision:EXPORT_REVISION,buildResults,buildPortfolio,exportResults:payload=>download(payload,'results'),exportPortfolio:payload=>download(payload,'portfolio')};
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
  document.addEventListener('minerva:session-updated',event=>{if(global.MINERVA_HOSTED&&!event.detail){generation++;}});
  global.MinervaPowerPoint=api;
})(typeof window!=='undefined'?window:globalThis);
