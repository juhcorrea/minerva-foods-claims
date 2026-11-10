(function (global) {
  'use strict';
  const MONTHS=['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
  const COLORS=['#2E5372','#E84752','#BDB58C','#527E8A'];
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const number=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
  const integer=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const exact=value=>number(value)==null?'—':Number(value).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const money=value=>number(value)==null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const pct=value=>number(value)==null?'—':(Number(value)*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%';
  const days=value=>number(value)==null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1});
  const compact=value=>{if(number(value)==null)return'—';const n=Number(value),a=Math.abs(n),unit=a>=1e9?1e9:a>=1e6?1e6:a>=1e3?1e3:1,suffix=unit===1e9?'B':unit===1e6?'M':unit===1e3?'k':'';return(n/unit).toLocaleString('pt-BR',{maximumFractionDigits:0})+suffix;};
  const date=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'—';
  const sum=(rows,key)=>rows.reduce((total,row)=>total+(number(row[key])||0),0);
  const safeList=value=>Array.isArray(value)?value:[];
  const COUNTRY_FLAGS={BRA:['br','Brasil'],PRY:['py','Paraguai'],URY:['uy','Uruguai'],COL:['co','Colômbia'],ARG:['ar','Argentina']};
  const countryFlag=value=>{const flag=COUNTRY_FLAGS[String(value||'').trim().toUpperCase()];return flag?'<img class="exec-country-flag" src="assets/flags/'+flag[0]+'.svg" width="24" height="18" alt="Bandeira: '+flag[1]+'">':'';};
  const comparable=row=>number(row?.receivedComparable??row?.receivedSameYear??row?.received);
  let model=null,referenceYear=null,referenceMonth=null,claimsHost=null,detailItems=new Map(),detailOwner='dashboard',detailSequence=0;
  const mounted=new WeakSet();

  function selection(report,currentModel){
    const years=[...new Set(safeList(report.years).map(Number).filter(Number.isFinite))].sort((a,b)=>a-b);
    const asOf=String(currentModel?.meta?.asOf||''),asYear=Number(asOf.slice(0,4)),asMonth=Number(asOf.slice(5,7));
    if(!years.includes(referenceYear))referenceYear=years.includes(asYear)?asYear:years.at(-1);
    if(!Number.isInteger(referenceMonth)||referenceMonth<1||referenceMonth>12)referenceMonth=asMonth>=1&&asMonth<=12?asMonth:12;
    return{years,year:referenceYear,month:referenceMonth,period:referenceYear?referenceYear+'-'+String(referenceMonth).padStart(2,'0'):null};
  }
  function detailAttr(kind,title,rows,subtitle){const id='exec-'+(++detailSequence);detailItems.set(id,{kind,title,rows:safeList(rows),subtitle:subtitle||'',owner:detailOwner});return 'data-exec-detail="'+id+'"';}
  function beginRender(host,owner){detailOwner=owner;for(const [key,value]of detailItems)if(value.owner===owner)detailItems.delete(key);if(!mounted.has(host)){host.addEventListener('click',onClick);host.addEventListener('change',onChange);mounted.add(host);}}
  const info=(text)=>'<span class="exec-info" tabindex="0" role="note" aria-label="'+esc(text)+'" data-exec-tip="'+esc(text)+'">i</span>';
  const empty=(text='Sem registros no recorte')=>'<div class="exec-empty">'+esc(text)+'</div>';
  function heading(title,unit='',extra=''){return'<div class="exec-panel-heading"><h3>'+esc(title)+'</h3><div class="exec-heading-meta">'+(unit?'<span>'+esc(unit)+'</span>':'')+extra+'</div></div>';}
  function kpi(label,value,detail,kind,attr,tooltip){return'<article class="exec-kpi '+(kind?'exec-kpi-'+kind:'')+'"><div class="exec-kpi-label">'+esc(label)+(tooltip?info(tooltip):'')+'</div>'+(attr?'<button type="button" class="exec-kpi-value" '+attr+'>'+esc(value)+'</button>':'<strong class="exec-kpi-value">'+esc(value)+'</strong>')+'<small>'+esc(detail)+'</small></article>';}

  function renderYoY(report,pick){
    const records=safeList(report.monthlyReceipts),years=pick.years,max=Math.max(1,...records.map(r=>number(r.received)||0));
    if(!years.length)return empty();
    const legend=years.map((y,i)=>'<span><i style="--exec-series:'+COLORS[i%COLORS.length]+'"></i>'+y+'</span>').join('');
    const cells=MONTHS.map((month,index)=>{
      const bars=years.map((year,yi)=>{const record=records.find(r=>Number(r.year)===year&&Number(r.month)===index+1),value=number(record?.received)||0,period=year+'-'+String(index+1).padStart(2,'0');
        return'<button type="button" class="exec-yoy-bar" data-chart-month="'+period+'" aria-label="Recebimentos de '+month+' '+year+': USD '+money(value)+'" title="'+month+' '+year+' · USD '+money(value)+'" style="--exec-bar-height:'+Math.max(0,value/max*100)+'%;--exec-series:'+COLORS[yi%COLORS.length]+'"><span class="exec-yoy-value">'+esc(compact(value))+'</span><span class="exec-yoy-fill" aria-hidden="true"></span></button>';
      }).join('');return'<div class="exec-yoy-month '+(index+1===pick.month?'exec-selected-month':'')+'"><div class="exec-yoy-pair">'+bars+'</div><span class="exec-yoy-label">'+month+'</span></div>';
    }).join('');
    return'<div class="exec-yoy-legend" aria-label="Legenda dos anos">'+legend+'<span class="exec-chart-help">Clique no mês para abrir o Controle</span></div><div class="exec-yoy-scroll"><div class="exec-yoy" role="group" aria-label="Recebimentos mensais por ano">'+cells+'</div></div>';
  }
  function renderCountries(report){
    const rows=safeList(report.negotiationByCountry),total=sum(rows,'amount');
    if(!rows.length)return empty('Nenhum claim em negociação');
    return'<div class="exec-country-grid">'+rows.map(row=>{const attr=detailAttr('claim','Em negociação · '+row.country,row.rows,'USD '+money(row.amount)+' · '+integer(row.count)+' claims');return'<button type="button" class="exec-country" '+attr+'><span class="exec-country-code">'+countryFlag(row.country)+esc(row.country||'N/I')+'</span><strong>'+money(row.amount)+'</strong><span>'+integer(row.count)+' claims <b>'+pct(total?row.amount/total:0)+'</b></span></button>';}).join('')+'</div>';
  }
  function renderOpen(report){
    const rows=safeList(report.openByCountry),max=Math.max(1,...rows.map(row=>number(row.total)||0));
    const statuses=[['negotiating','Em negociação','#2E5372'],['inAnalysis','Em análise','#BDB58C'],['awaitingCosts','Aguardando custos','#E84752']];
    if(!rows.length)return empty('Nenhum claim aberto no recorte');
    return'<div class="exec-status-legend">'+statuses.map(([,label,color])=>'<span><i style="background:'+color+'"></i>'+label+'</span>').join('')+'</div><div class="exec-country-bars">'+rows.map(row=>'<button type="button" class="exec-country-row" '+detailAttr('claim','Claims em aberto · '+row.country,row.rows,integer(row.total)+' claims')+'><span class="exec-country-name">'+esc(row.country||'Não informado')+'</span><span class="exec-stacked-track">'+statuses.map(([field,label,color])=>'<span class="exec-stacked-segment" style="width:'+Math.max(0,(number(row[field])||0)/max*100)+'%;background:'+color+'" title="'+esc(label)+': '+integer(row[field])+'">'+((number(row[field])||0)>0?'<b>'+integer(row[field])+'</b>':'')+'</span>').join('')+'</span><strong>'+integer(row.total)+'</strong></button>').join('')+'</div>';
  }
  function renderSectors(report){
    const rows=[...safeList(report.sectorReceipts)].sort((a,b)=>(number(b.amount)||0)-(number(a.amount)||0)),total=sum(rows,'amount');
    if(!rows.length)return empty('Nenhum recebimento no recorte');
    return'<div class="exec-sector-total"><strong>'+money(total)+'</strong><span>USD · '+integer(sum(rows,'count'))+' pagamentos</span></div><div class="exec-sectors">'+rows.map((row,index)=>'<button type="button" class="exec-sector" '+detailAttr('receipt','Recebido · '+row.name,row.rows,'USD '+money(row.amount))+'><span class="exec-sector-top"><span><i style="background:'+COLORS[index%COLORS.length]+'"></i>'+esc(row.name||'Não informado')+'</span><strong>'+money(row.amount)+'</strong></span><span class="exec-meter"><span style="width:'+Math.max(0,total?(number(row.amount)||0)/total*100:0)+'%;background:'+COLORS[index%COLORS.length]+'"></span></span><small>'+pct(total?row.amount/total:0)+'</small></button>').join('')+'</div>';
  }
  function ranking(rows,field,{title,mode='supplier',detailKind='claim',subtitle='',limit=6}={}){
    const all=safeList(rows).filter(row=>number(row[field])!=null&&Number(row[field])!==0).sort((a,b)=>Number(b[field])-Number(a[field])),list=all.slice(0,limit),max=Math.max(1,...list.map(row=>Math.abs(number(row[field])||0))),total=sum(all,field);
    if(!list.length)return empty();
    return'<div class="exec-ranking">'+list.map((row,index)=>{const name=row.name||row.supplier||'Não informado',attr=mode==='supplier'?'data-chart-supplier="'+esc(name)+'"':detailAttr(detailKind,title+' · '+name,row.rows,'USD '+money(row[field])+' · '+integer(row.count)+' claims');return'<button type="button" class="exec-rank-row" '+attr+' title="'+esc(name)+' · USD '+money(row[field])+'"><span class="exec-rank-position">'+(index+1)+'</span><span class="exec-rank-body"><span class="exec-rank-top"><span>'+esc(name)+'</span><strong>'+compact(row[field])+'</strong></span><span class="exec-meter"><span style="width:'+Math.abs(row[field])/max*100+'%"></span></span>'+(mode==='supplier'&&field==='openBalance'?'<small>'+money(row.overdueBalance)+' vencido</small>':mode!=='supplier'?'<small>'+integer(row.count)+' claims · '+pct(total?row[field]/total:0)+'</small>':'')+'</span></button>';}).join('')+'</div>'+(subtitle?'<div class="exec-panel-foot">'+esc(subtitle)+'</div>':'');
  }
  function renderSla(report,pick){
    const selected=safeList(report.slaByMonth).find(row=>row.period===pick.period),items=[['SLA análise · 25 dias','analysisRate','analysisCount','analysisRows',pct,'Média do índice SLA 25 dias da BD (BF), pela Data Fim Análise (J). A fórmula original da planilha é preservada.','analysis'],['Negociação','negotiationDays','negotiationCount','negotiationRows',days,'Média de Prazo Neg. Claims (BJ), pela Data última posição (I), somente com RESSARCIMENTO ENCAMINHADO.','negotiation'],['Abertura do claim','openingDays','openingCount','openingRows',days,'Média de Media Abertura Claim (BK), pela data Abertura claim (N).','opening']];
    return'<div class="exec-sla-title"><span>PRAZOS</span><strong>'+MONTHS[pick.month-1]+'/'+pick.year+'</strong></div>'+items.map(([label,key,countKey,rowsKey,format,tip,kind])=>{const value=number(selected?.[key]),count=number(selected?.[countKey])||0,attr=detailAttr(kind,label+' · '+MONTHS[pick.month-1]+'/'+pick.year,selected?.[rowsKey],integer(count)+' registros válidos');return'<div class="exec-sla-item"><div><span>'+esc(label)+'</span>'+info(tip)+'</div><button type="button" '+attr+' '+(!count?'disabled':'')+'>'+esc(format(value))+(key==='analysisRate'||value==null?'':'<small> dias</small>')+'</button><small>'+(!count?'Sem informação':integer(count)+' registros')+'</small></div>';}).join('');
  }
  function render(currentModel){
    model=currentModel;const host=global.document?.getElementById('executiveDashboard');if(!host)return;
    beginRender(host,'dashboard');
    if(!model?.executiveReport){host.innerHTML=empty('Indicadores disponíveis após carregar as bases');return;}
    const report=model.executiveReport,pick=selection(report,model),summary=model.summary||{},open=model.supplierOpenReport?.meta||{},receipts=safeList(report.monthlyReceipts),annual=receipts.filter(row=>Number(row.year)===pick.year),monthly=annual.filter(row=>Number(row.month)===pick.month),annualRows=annual.flatMap(row=>safeList(row.rows)),monthRows=monthly.flatMap(row=>safeList(row.rows)),received=comparable(summary),recovery=number(summary.claimed)>0&&received!=null?received/summary.claimed:null;
    const controls='<div class="exec-reference"><span>Referência dos recebimentos e prazos</span><label><span class="exec-sr">Ano de referência</span><select id="executiveYear" aria-label="Ano de referência dos indicadores">'+pick.years.map(year=>'<option value="'+year+'" '+(year===pick.year?'selected':'')+'>'+year+'</option>').join('')+'</select></label><label><span class="exec-sr">Mês de referência</span><select id="executiveMonth" aria-label="Mês de referência dos indicadores">'+MONTHS.map((month,index)=>'<option value="'+(index+1)+'" '+(index+1===pick.month?'selected':'')+'>'+month+'</option>').join('')+'</select></label></div>';
    const openRows=safeList(model.supplierOpenReport?.installments);
    const kpis=kpi('Recebido no ano',money(sum(annual,'received')),'USD · '+pick.year,'received',detailAttr('receipt','Recebido no ano · '+pick.year,annualRows,'USD '+money(sum(annual,'received'))),'Caixa confirmado: M = Pago, data de compensação R válida e valor USD em T, uma vez por linha.')+kpi('Recebido no mês',money(sum(monthly,'received')),'USD · '+MONTHS[pick.month-1]+'/'+pick.year,'received',detailAttr('receipt','Recebido no mês · '+MONTHS[pick.month-1]+'/'+pick.year,monthRows,'USD '+money(sum(monthly,'received'))),'Recebimentos pela data de compensação R no mês de referência.')+kpi('Em negociação',money(summary.negotiating),'USD · recorte selecionado','',detailAttr('claim','Claims em negociação',safeList(report.negotiationByCountry).flatMap(row=>safeList(row.rows)),'USD '+money(summary.negotiating)),'Reclamado dos claims com situação EM NEGOCIAÇÃO - PROCEDENTE nos filtros globais.')+kpi('Saldo em aberto',money(open.openBalance),'USD · todos os anos','',detailAttr('open','Saldo em aberto · Controle',openRows.map(row=>row.row),'USD '+money(open.openBalance)+' · todos os anos'),'Coluna O do Controle quando M = Dentro do Prazo ou Vencido, de todos os anos, no recorte de fornecedor/operação.')+kpi('Vencido',money(open.overdueBalance),'USD · incluído no saldo','overdue',detailAttr('open','Vencido · Controle',openRows.filter(row=>row.status==='Vencido').map(row=>row.row),'USD '+money(open.overdueBalance)+' · incluído no saldo aberto'),'Parte do saldo em aberto com M = Vencido. Este valor já está incluído no saldo em aberto.')+kpi('Recuperação',pct(recovery),'Recebido / reclamado','',null,'Recebido comparável: pagamento e ano de origem do claim dentro dos anos selecionados, dividido pelo reclamado elegível do mesmo recorte.');
    host.innerHTML='<div class="exec-dashboard">'+controls+'<section class="exec-kpis" aria-label="Indicadores executivos">'+kpis+'</section><section class="exec-panel exec-yoy-panel">'+heading('Recebimentos mês a mês','USD · compensação R')+renderYoY(report,pick)+'</section><div class="exec-grid-two"><section class="exec-panel exec-negotiation-panel">'+heading('Em negociação por país','USD',info('Valor reclamado em negociação e quantidade de claims por país. Mesmo recorte dos filtros globais.'))+renderCountries(report)+'</section><section class="exec-panel">'+heading('Recebido por setor','USD',info('Setor informado na coluna A do Controle; não corresponde à operação da BD.'))+renderSectors(report)+'</section></div><div class="exec-grid-three"><section class="exec-panel">'+heading('Maiores reclamados','USD')+ranking(safeList(model.suppliers),'claimed',{title:'Reclamado'})+'</section><section class="exec-panel">'+heading('Saldos por fornecedor','USD')+ranking(safeList(model.suppliers),'openBalance',{title:'Saldo em aberto'})+'</section><section class="exec-panel">'+heading('Recebido por fornecedor','USD',info('Caixa confirmado do Controle no período de compensação, incluindo claims de anos anteriores.'))+ranking(safeList(model.suppliers),'received',{title:'Recebido'})+'</section></div></div>';
  }
  function renderClaims(currentModel,el){
    model=currentModel;const host=typeof el==='string'?document.getElementById(el):el||claimsHost;if(!host)return;claimsHost=host;beginRender(host,'claims');
    if(!model?.executiveReport){host.innerHTML=empty('Indicadores disponíveis após carregar as bases');return;}
    const report=model.executiveReport,pick=selection(report,model),controls='<div class="exec-reference"><span>Referência dos prazos</span><select id="executiveClaimYear" aria-label="Ano de referência dos prazos">'+pick.years.map(year=>'<option value="'+year+'" '+(year===pick.year?'selected':'')+'>'+year+'</option>').join('')+'</select><select id="executiveClaimMonth" aria-label="Mês de referência dos prazos">'+MONTHS.map((month,index)=>'<option value="'+(index+1)+'" '+(index+1===pick.month?'selected':'')+'>'+month+'</option>').join('')+'</select></div>';
    host.innerHTML='<div class="exec-dashboard">'+controls+'<section class="exec-sla" aria-label="Prazos dos claims">'+renderSla(report,pick)+'</section><section class="exec-panel">'+heading('Claims em aberto por país','Quantidade',info('Situações Em negociação, Em análise e Aguardando custos. Não representa o saldo de parcelas do Controle.'))+renderOpen(report)+'</section><div class="exec-grid-two"><section class="exec-panel">'+heading('Motivos dos claims','USD · reclamado')+ranking(safeList(report.reasonRanking),'amount',{title:'Motivo',mode:'detail',limit:8})+'</section><section class="exec-panel">'+heading('Maiores causadores','USD · reclamado',info('Causador informado na BD, distinto do fornecedor de negociação.'))+ranking(safeList(report.causeRanking),'amount',{title:'Causador',mode:'detail',limit:8})+'</section></div></div>';
  }
  function onChange(event){if(['executiveYear','executiveClaimYear'].includes(event.target.id))referenceYear=Number(event.target.value);else if(['executiveMonth','executiveClaimMonth'].includes(event.target.id))referenceMonth=Number(event.target.value);else return;render(model);if(claimsHost)renderClaims(model,claimsHost);}
  function onClick(event){const trigger=event.target.closest('[data-exec-detail]');if(trigger&&detailItems.has(trigger.dataset.execDetail))showDetail(detailItems.get(trigger.dataset.execDetail));}
  function detailRows(item){
    const source=item.kind==='receipt'?safeList(model.executiveReport.receiptRows):item.kind==='open'?safeList(model.supplierOpenReport?.installments):safeList(model.executiveReport.claimRows),wanted=new Set(item.rows.map(row=>typeof row==='object'?row.row:Number(row)));
    const rows=source.filter(row=>wanted.has(Number(row.row))),field=item.kind==='receipt'?'received':item.kind==='open'?'expected':item.kind==='claim'?'claimed':null;
    return field?rows.sort((a,b)=>{const first=number(a[field]),second=number(b[field]);return first==null?(second==null?0:1):second==null?-1:second-first||Number(a.row)-Number(b.row);}):rows;
  }
  function showDetail(item){
    const dialog=document.getElementById('detailDialog'),content=document.getElementById('detailContent'),title=document.getElementById('detailTitle');if(!dialog||!content||!title)return;
    const rows=detailRows(item),receipt=item.kind==='receipt',open=item.kind==='open',sla=['analysis','negotiation','opening'].includes(item.kind);title.textContent=item.title;
    const headers=receipt?['Linha Controle','Fornecedor','Setor','Referência','Compensação','Recebido USD']:open?['Linha Controle','Fornecedor','Referência','Status informado M','Previsão N','Previsto O USD']:sla?['Linha BD','SGR','Fornecedor','Situação','Data do evento',item.kind==='analysis'?'Índice SLA da base':'Dias informados']:['Linha BD','SGR','País','Fornecedor','Situação','Motivo','Data RNC','Reclamado USD'];
    const cells=row=>receipt?[row.row,row.supplier,row.sector,row.reference,date(row.compDate),exact(row.received)]:open?[row.row,row.supplier,row.reference,row.status,date(row.dueDate),exact(row.expected)]:sla?[row.row,row.sgr,row.supplier,row.status,date(row[item.kind+'Event']?.date),item.kind==='analysis'?pct(row.analysisEvent?.value):days(row[item.kind+'Event']?.value)]:[row.row,row.sgr,row.country,row.supplier,row.status,row.reason,date(row.rncDate),exact(row.claimed)];
    content.innerHTML='<div class="exec-detail-heading"><strong>'+esc(item.subtitle)+'</strong><span>'+integer(rows.length)+' linhas</span></div><label class="exec-detail-search"><span>Buscar nas linhas</span><input id="executiveDetailSearch" type="search" placeholder="Fornecedor, referência ou situação" aria-label="Buscar no detalhe do indicador"></label><div class="exec-detail-table"><table><thead><tr>'+headers.map((label,index)=>'<th'+(index===0||index===headers.length-1?' class="num"':'')+'>'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+cells(row).map((value,index)=>'<td'+(index===0||index===headers.length-1?' class="exec-detail-number num"':'')+'>'+esc(value)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+(!rows.length?empty('Nenhuma linha neste indicador'):'');
    content.querySelector('#executiveDetailSearch').addEventListener('input',event=>{const q=event.target.value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();content.querySelectorAll('tbody tr').forEach(row=>row.hidden=!row.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().includes(q));});
    if(!dialog.open)dialog.showModal();
  }
  function worksheets(wb,worksheet){
    if(!model?.executiveReport||typeof worksheet!=='function')return;const report=model.executiveReport;
    worksheet(wb,'Executivo mensal',['Ano','Mês','Compensação','Recebido USD','Pagamentos'],safeList(report.monthlyReceipts).map(row=>[row.year,row.month,row.period,row.received,row.count]));
    worksheet(wb,'Negociação por país',['País','Em negociação USD','Claims','Linhas BD'],safeList(report.negotiationByCountry).map(row=>[row.country,row.amount,row.count,safeList(row.rows).join('; ')]));
    worksheet(wb,'Claims abertos por país',['País','Em negociação','Em análise','Aguardando custos','Total','Linhas BD'],safeList(report.openByCountry).map(row=>[row.country,row.negotiating,row.inAnalysis,row.awaitingCosts,row.total,safeList(row.rows).join('; ')]));
    worksheet(wb,'Recebido por setor',['Setor','Recebido USD','Pagamentos','Linhas Controle'],safeList(report.sectorReceipts).map(row=>[row.name,row.amount,row.count,safeList(row.rows).join('; ')]));
    worksheet(wb,'Motivos dos claims',['Motivo','Reclamado USD','Claims','Linhas BD'],safeList(report.reasonRanking).map(row=>[row.name,row.amount,row.count,safeList(row.rows).join('; ')]));
    worksheet(wb,'Causadores dos claims',['Causador','Reclamado USD','Claims','Linhas BD'],safeList(report.causeRanking).map(row=>[row.name,row.amount,row.count,safeList(row.rows).join('; ')]));
    worksheet(wb,'Prazos dos claims',['Período','SLA análise 25 dias %','Registros análise','Negociação dias','Registros negociação','Abertura dias','Registros abertura'],safeList(report.slaByMonth).map(row=>[row.period,row.analysisRate,row.analysisCount,row.negotiationDays,row.negotiationCount,row.openingDays,row.openingCount]));
  }
  global.MinervaExecutive={render,renderClaims,worksheets};
})(typeof window!=='undefined'?window:globalThis);
