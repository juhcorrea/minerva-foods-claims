(function (global) {
  'use strict';
  const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const VISUALS = [{id:'summary',label:'Resumo executivo'},{id:'trend',label:'Evolução mensal'},{id:'analysts',label:'Recebido por analista'},{id:'suppliers',label:'Recebido por fornecedor'},{id:'goal',label:'Meta da equipe'}];
  const TARGET_YEAR = 2026, TARGET = 300000, STRETCH = 450000, DETAIL = 'meeting-payments', PAGE_SIZE = 60;
  const sum = rows => rows.reduce((total,row) => total + Number(row.received || 0), 0);
  const labelFor=(row,key)=>String(row[key]||(key==='originalSupplier'?row.supplier:'')||'Não informado').trim()||'Não informado';
  const norm = value => String(value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const keyFor = (year,month) => String(year)+'-'+String(month).padStart(2,'0');
  const currentYear = () => Number(new Intl.DateTimeFormat('en', {timeZone: 'America/Sao_Paulo', year: 'numeric'}).format(new Date()));
  function monthOf(row) {
    const value = String(row.compensationMonth || '');
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4)) === Number(row.compensationYear) ? Number(value.slice(5)) : null;
  }
  function defaultMonth(report, year, asOf) {
    const match=String(asOf||'').match(/^(\d{4})-(0[1-9]|1[0-2])(?:-|$)/);
    if(!match||Number(match[1])!==Number(year))return 0;
    const ceiling=Number(match[2]);
    const months=(report?.rows||[]).filter(row=>row.status==='Pago'&&Number(row.received)>0&&Number.isFinite(Number(row.received))&&Number(row.compensationYear)===Number(year)).map(monthOf).filter(month=>month!=null&&month<=ceiling);
    return months.length?Math.max(...months):0;
  }
  function ranking(rows,key) {
    const map = new Map();
    for (const row of rows) {
      const name=labelFor(row,key);
      const normalized = norm(name);
      if (!map.has(normalized)) map.set(normalized,{name,key:normalized,received:0,count:0});
      const entry=map.get(normalized);entry.received+=Number(row.received||0);entry.count++;
    }
    const total=sum(rows);
    return [...map.values()].map(row=>({...row,share:total ? row.received/total : 0})).sort((a,b)=>b.received-a.received||a.name.localeCompare(b.name,'pt-BR'));
  }
  // receiptReport is the whole Control: a BD filter must never change this report.
  function aggregate(report, year, month=0) {
    year=Number(year); month=Number(month); if(!Number.isInteger(month)||month < -1||month>12)month=0;
    const all=(report?.rows||[]).filter(row=>row.status==='Pago' && Number.isFinite(Number(row.received)) && Number(row.received)>0 && Number.isInteger(Number(row.compensationYear)));
    const annualRows=all.filter(row=>Number(row.compensationYear)===year), allocated=annualRows.filter(row=>monthOf(row)!=null), unallocated=annualRows.filter(row=>monthOf(row)==null);
    const selected=month===0?annualRows:month===-1?unallocated:annualRows.filter(row=>monthOf(row)===month);
    const monthly=MONTHS.map((name,index)=>{const rows=annualRows.filter(row=>monthOf(row)===index+1);return {month:index+1,name,key:keyFor(year,index+1),received:sum(rows),count:rows.length};});
    const priorYear=month===1?year-1:year, priorMonth=month===1?12:month-1;
    const previousRows=month>0?all.filter(row=>Number(row.compensationYear)===priorYear&&monthOf(row)===priorMonth):[];
    const previousAvailable=month>0 && (report?.years||[...new Set(all.map(row=>Number(row.compensationYear)))]).map(Number).includes(priorYear);
    const received=sum(selected), previous=sum(previousRows), annual=sum(annualRows);
    return {year,month,rows:selected,annualRows,received,count:selected.length,annual,annualCount:annualRows.length,allocated:sum(allocated),unallocated:sum(unallocated),unallocatedCount:unallocated.length,monthly,analysts:ranking(selected,'receiptAnalyst'),suppliers:ranking(selected,'originalSupplier'),previous,previousAvailable,previousMonth:priorMonth,previousYear:priorYear,delta:previousAvailable?received-previous:null,variation:previousAvailable&&previous>0?(received-previous)/previous:null,goal:year===TARGET_YEAR?{target:TARGET,stretch:STRETCH,delta:Math.max(0,TARGET-annual),stretchDelta:Math.max(0,STRETCH-annual),progress:annual/TARGET}:null};
  }
  if (typeof module!=='undefined' && module.exports) {module.exports={aggregate,ranking,monthOf,defaultMonth};return;}
  let exportingPowerPoint=false;
  const state={model:null,year:null,month:0,draftYear:null,draftMonth:0,selected:new Set(VISUALS.map(v=>v.id)),detail:null,page:1};
  const $=id=>document.getElementById(id), esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const percentage=value=>(Number(value||0)*100).toLocaleString('pt-BR',{maximumFractionDigits:0})+'%';
  const shortDate=value=>value?String(value).slice(0,10).split('-').reverse().join('/'):'Sem data';
  const F=()=>global.MinervaTableFilters;
  const data=()=>aggregate(state.model?.receiptReport,state.year,state.month);
  const period=()=>state.month===0?`Ano completo · ${state.year}`:state.month===-1?`Sem mês definido · ${state.year}`:`${MONTHS[state.month-1]} de ${state.year}`;
  const message=text=>{if($('meetingStatus'))$('meetingStatus').textContent=text;};
  function metadata() {
    const app=global.MinervaApp?.state,meta=!app?.bd?app?.publishedMeta:null;
    return `Responsável: Administração · ${period()} · Controle integral · USD · `+(meta?.updatedAt?`Base publicada em ${new Intl.DateTimeFormat('pt-BR',{dateStyle:'short',timeStyle:'short',timeZone:'America/Sao_Paulo'}).format(new Date(meta.updatedAt))} (Brasília) por ${meta.updatedBy||'administradora'}`:app?.demo?'Demonstração fictícia':'Prévia local — ainda não publicada');
  }
  function comparison(d) {
    if(d.month<=0)return d.month===0?'Todos os pagamentos com data de compensação válida no ano.':'A data de compensação R define o mês; datas inválidas são apontadas e não somadas.';
    if(!d.previousAvailable)return 'Não há base do ano anterior para comparar este mês.';
    const label=`${MONTHS[d.previousMonth-1].toLowerCase()}/${d.previousYear}`;
    return d.variation==null?`Mês anterior sem recebimentos: ${label}.`:`${d.delta>=0?'+':'−'}USD ${amount(Math.abs(d.delta))} (${d.variation>=0?'+':'−'}${percentage(Math.abs(d.variation))}) em relação a ${label}.`;
  }
  function kpis(d) {
    return `<div class="meeting-kpis"><article class="meeting-kpi meeting-kpi-primary"><span>Recebido · ${esc(period())}</span><strong data-meeting-kpi="received">USD ${amount(d.received)}</strong><small>${amount(d.count)} parcelas pagas neste recorte</small></article><article class="meeting-kpi"><span>Total recebido em ${d.year}</span><strong data-meeting-kpi="annual">USD ${amount(d.annual)}</strong><small>${amount(d.annualCount)} parcelas · data de compensação válida</small></article><article class="meeting-kpi"><span>${d.goal?'Falta para 100% da meta':'Analistas neste recorte'}</span><strong data-meeting-kpi="delta">${d.goal?'USD '+amount(d.goal.delta):amount(d.analysts.length)}</strong><small>${d.goal?'Meta anual da equipe · USD '+amount(d.goal.target):'Identificação no Controle de Recebimento'}</small></article></div><p class="meeting-comparison">${esc(comparison(d))}</p>`;
  }
  function monthlyChart(d,interactive=true) {
    const max=Math.max(1,...d.monthly.map(row=>row.received));
    return `<div class="meeting-month-chart" role="group" aria-label="Recebido em cada mês de ${d.year}">${d.monthly.map(row=>{const tag=interactive?'button':'div';return `<${tag}${interactive?` type="button" data-meeting-month="${row.month}" aria-pressed="${d.month===row.month}" aria-label="${row.name}: USD ${amount(row.received)}, ${amount(row.count)} parcelas. Filtrar este mês."`:''} class="meeting-month ${d.month===row.month?'is-selected':''}"><span class="meeting-month-track" style="--month-height:${row.received>0?Math.max(2,row.received/max*100):0}%"><b class="meeting-month-value">${amount(row.received)}</b><span style="height:${row.received>0?Math.max(2,row.received/max*100):0}%"></span></span><strong>${row.name.slice(0,3)}</strong><small>${amount(row.count)} pagas</small></${tag}>`;}).join('')}</div><div class="meeting-reconciliation"><span>Distribuído nos meses <strong>USD ${amount(d.allocated)}</strong></span><span>Sem mês definido <strong>USD ${amount(d.unallocated)}</strong></span><span>Total do ano <strong>USD ${amount(d.annual)}</strong></span></div>`;
  }
  function rankingChart(rows,type,interactive=true,limit=8) {
    if(!rows.length)return '<div class="meeting-empty-chart">Nenhum pagamento neste recorte.</div>';
    const max=Math.max(1,...rows.map(row=>row.received));
    return `<div class="meeting-rankings">${rows.slice(0,limit).map((row,index)=>{const tag=interactive?'button':'div';return `<${tag}${interactive?` type="button" data-meeting-detail="${type}" data-meeting-key="${esc(row.key)}" aria-label="Conferir pagamentos de ${esc(row.name)}"`:''} class="meeting-ranking"><span class="meeting-rank-number">${String(index+1).padStart(2,'0')}</span><span class="meeting-rank-body"><span class="meeting-rank-label"><strong>${esc(row.name)}</strong><b>USD ${amount(row.received)}</b></span><span class="meeting-rank-track"><span style="width:${row.received/max*100}%"></span></span><small>${amount(row.count)} parcelas · ${percentage(row.share)} do recorte</small></span></${tag}>`;}).join('')}</div>${rows.length>limit?`<p class="meeting-footnote">Os ${limit} maiores de ${amount(rows.length)} ${type==='analyst'?'analistas':'fornecedores'}. O Excel contém todos.</p>`:''}`;
  }
  function goalChart(d) {
    if(!d.goal)return '<div class="meeting-goal-empty"><span class="section-kicker">Meta anual</span><h3>Meta não definida para este ano.</h3><p>Os marcos de USD 300.000 e USD 450.000 pertencem a 2026.</p></div>';
    const goal=d.goal;
    return `<div class="meeting-goal"><div class="meeting-goal-head"><div><span class="section-kicker">Meta da equipe · ${d.year}</span><h3>${d.annual>=goal.stretch?'Marco de 150% atingido':d.annual>=goal.target?'Meta de 100% atingida':'Avanço rumo à meta'}</h3></div><strong>${percentage(goal.progress)}</strong></div><div class="meeting-goal-track" role="progressbar" aria-label="Recebido dividido pela meta de 100%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100,goal.progress*100).toFixed(2)}"><span style="width:${Math.min(100,goal.progress*100)}%"></span></div><p>Recebido no ano ÷ USD ${amount(goal.target)}. O percentual indica avanço financeiro; os marcos abaixo são os definidos para a equipe.</p><div class="meeting-goal-marks"><div><span>100% da meta</span><strong>USD ${amount(goal.target)}</strong><small>${goal.delta?'Faltam USD '+amount(goal.delta):'Atingida'}</small></div><div><span>150% da meta</span><strong>USD ${amount(goal.stretch)}</strong><small>${goal.stretchDelta?'Faltam USD '+amount(goal.stretchDelta):'Atingida'}</small></div></div></div>`;
  }
  function render(model) {
    if(model!==undefined&&state.model!==model){state.model=model;state.detail=null;$('meetingDetailDialog')?.close();$('meetingDetailDialog')?.remove();}
    const host=$('view-meeting'); if(!host)return;host.classList.add('meeting-view');
    if(!state.model?.receiptReport){host.innerHTML='<section class="panel meeting-empty"><span class="section-kicker">Reunião de resultados</span><h2>Os números da reunião começam nas bases.</h2><p>Carregue e analise as duas planilhas, ou consulte a última versão publicada. Os gráficos serão montados com os recebimentos do Controle integral.</p></section>';return;}
    const report=state.model.receiptReport,years=[...new Set((report.years||[]).map(Number))].sort((a,b)=>b-a);
    if(!years.length){host.innerHTML='<section class="panel meeting-empty"><h2>Nenhum recebimento confirmado nas bases.</h2><p>Esta visão usa pagamentos com status Pago, data de compensação R válida e valor recebido positivo. Confira a aba Recebimento por analista para os apontamentos.</p></section>';return;}
    if(!years.includes(state.year)){const year=currentYear();state.year=years.includes(year)?year:years[0];state.month=defaultMonth(report,state.year,state.model.meta?.asOf);state.draftYear=state.year;state.draftMonth=state.month;state.detail=null;}
    const d=data();
    host.innerHTML=`<div class="meeting-heading"><div><span class="section-kicker">Resultados para compartilhar</span><h2>Reunião de resultados</h2><p>Escolha o período, componha os visuais e apresente os números da equipe.</p></div><div class="meeting-actions"><button class="button button-outline" type="button" data-meeting-action="excel">Baixar Excel</button><button class="button button-outline" type="button" data-meeting-action="pptx"${!state.selected.size||exportingPowerPoint?' disabled':''}>${exportingPowerPoint?'Gerando PowerPoint…':'Exportar PowerPoint'}</button><button class="button button-outline" type="button" data-meeting-action="pdf"${!state.selected.size?' disabled':''}>Exportar PDF</button><button class="button button-primary" type="button" data-meeting-action="present"${!state.selected.size?' disabled':''}>Apresentar resultados <svg class="icon"><use href="#icon-arrow"/></svg></button></div></div><form id="meetingFilters" class="meeting-filters panel"><label for="meetingYear">Ano de compensação<select id="meetingYear">${years.map(year=>`<option value="${year}"${year===state.draftYear?' selected':''}>${year}</option>`).join('')}</select></label><label for="meetingMonth">Período da reunião<select id="meetingMonth"><option value="0"${state.draftMonth===0?' selected':''}>Ano completo</option>${MONTHS.map((month,index)=>`<option value="${index+1}"${state.draftMonth===index+1?' selected':''}>${month}</option>`).join('')}<option value="-1"${state.draftMonth===-1?' selected':''}>Sem mês definido</option></select></label><button class="button button-filter" type="submit">Aplicar</button><p id="meetingFilterStatus" role="status">Exibindo ${esc(period())}. Todas as operações e fornecedores do Controle, independentemente dos filtros da BD.</p></form><section class="meeting-composer panel"><div><span class="section-kicker">Monte sua apresentação</span><h3>Quais visuais vão para a reunião?</h3><p>A seleção vale para a apresentação, o PDF e o PowerPoint.</p></div><fieldset><legend class="sr-only">Visuais da apresentação</legend>${VISUALS.map(visual=>`<label><input type="checkbox" data-meeting-visual="${visual.id}"${state.selected.has(visual.id)?' checked':''}><span>${visual.label}</span></label>`).join('')}</fieldset><span id="meetingSelectedCount" class="meeting-selected-count">${state.selected.size} visuais selecionados</span></section><section class="meeting-summary" aria-label="Resumo do período"><div class="meeting-section-title"><span class="section-kicker">${esc(period())}</span><h3>O resultado em uma visão</h3></div>${kpis(d)}</section><section class="panel meeting-chart-panel"><div class="meeting-panel-heading"><div><span class="section-kicker">Ritmo de recebimento · ${d.year}</span><h3>Evolução mês a mês</h3><p>Clique em um mês para atualizar os indicadores e os rankings.</p></div><button type="button" class="button button-text" data-meeting-month="0">Ver ano completo</button></div>${monthlyChart(d)}${d.unallocatedCount?`<div class="meeting-unallocated"><div><strong>${amount(d.unallocatedCount)} pagamentos sem mês definido</strong><p>USD ${amount(d.unallocated)} precisam de conferência de distribuição mensal. A regra atual exige data R válida e usa seu ano e mês.</p></div><button type="button" class="button button-outline" data-meeting-month="-1">Conferir pagamentos</button></div>`:''}</section><div class="meeting-chart-grid"><section class="panel meeting-chart-panel"><div class="meeting-panel-heading"><div><span class="section-kicker">Contribuição da equipe</span><h3>Recebido por analista</h3><p>Clique no nome para conferir os pagamentos do período.</p></div></div>${rankingChart(d.analysts,'analyst')}</section><section class="panel meeting-chart-panel"><div class="meeting-panel-heading"><div><span class="section-kicker">Origem dos recebimentos</span><h3>Recebido por fornecedor</h3><p>Nomes do Controle. Clique para consultar as parcelas.</p></div></div>${rankingChart(d.suppliers,'supplier')}</section></div><section class="panel meeting-goal-panel">${goalChart(d)}</section><div class="meeting-source"><div><strong>${esc(metadata())}</strong><p>Recebido: status Pago (M), ano e mês pela data de compensação (R) e valor USD (T). Sem data R válida, o pagamento não é somado. AE serve para conferência. Analista: AF. Fornecedor: K. Uma linha agrupada soma T uma vez, mesmo sem detalhamento por ordem; a validação na BD não condiciona o recebido. Os totais preservam os centavos; a exibição é arredondada.</p></div><button class="button button-outline" type="button" data-meeting-detail="all">Conferir parcelas do recorte</button></div><p id="meetingStatus" role="status" class="meeting-status"></p>`;
  }
  function sourceDetail() {
    let rows=data().rows;
    if(state.detail?.type==='analyst')rows=rows.filter(row=>norm(labelFor(row,'receiptAnalyst'))===state.detail.key);
    if(state.detail?.type==='supplier')rows=rows.filter(row=>norm(labelFor(row,'originalSupplier'))===state.detail.key);
    return [...rows].sort((a,b)=>Number(b.received)-Number(a.received)||Number(a.row)-Number(b.row));
  }
  function detailRows() {
    const headers=['Ordem / NF','Fornecedor · Controle','Analista · AF','Compensação · R','Ano · R','Recebido USD · T','Linha Excel'];
    const cells=row=>[esc(row.reference||'—'),esc(row.originalSupplier||row.supplier||'Não informado'),esc(row.receiptAnalyst||'Não informado'),esc(shortDate(row.compDate)),esc(row.compensationYear),amount(row.received),amount(row.row)];
    const rows=F()?F().prepare(DETAIL,headers,sourceDetail(),cells,'Parcelas da reunião',{types:['text','text','text','date','number','number','number'],sortValues:row=>[row.reference,row.originalSupplier||row.supplier,row.receiptAnalyst,row.compDate,row.compensationYear,row.received,row.row]}):sourceDetail();
    return {headers,cells,rows};
  }
  function renderDetail() {
    const dialog=$('meetingDetailDialog');if(!dialog||!state.detail)return;
    const {headers,cells,rows}=detailRows(),pages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));state.page=Math.max(1,Math.min(state.page,pages));
    const label=state.detail.type==='all'?'Parcelas do período':(data()[state.detail.type==='analyst'?'analysts':'suppliers'].find(row=>row.key===state.detail.key)?.name||'Pagamentos');
    dialog.innerHTML=`<div class="dialog-heading"><div><span class="section-kicker">Conferência da reunião</span><h2 id="meetingDetailTitle">${esc(label)}</h2></div><button type="button" class="icon-button" data-meeting-action="close-detail" aria-label="Fechar conferência">×</button></div><p>${esc(period())} · <strong>USD ${amount(sum(rows))}</strong> em ${amount(rows.length)} parcelas nesta tabela. Os filtros deste detalhe não alteram os gráficos.</p>${F()?.summary(DETAIL)||''}<div class="meeting-detail-scroll table-wrap" tabindex="0" aria-label="Parcelas do período, role para ver todas as colunas"><table data-table-id="${DETAIL}"><caption class="sr-only">Parcelas pagas selecionadas na reunião</caption><thead><tr>${headers.map((header,index)=>`<th scope="col" aria-sort="${F()?.ariaSort(DETAIL,index)||'none'}">${F()?.heading(DETAIL,index,esc(header))||esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.slice((state.page-1)*PAGE_SIZE,state.page*PAGE_SIZE).map(row=>'<tr>'+cells(row).map(cell=>`<td>${cell}</td>`).join('')+'</tr>').join(''):'<tr><td colspan="7">Nenhuma parcela corresponde a este filtro.</td></tr>'}</tbody></table></div><div class="meeting-detail-footer"><span>Página ${state.page} de ${pages}</span><div><button type="button" class="button button-outline" data-meeting-page="${state.page-1}"${state.page===1?' disabled':''}>Anterior</button><button type="button" class="button button-outline" data-meeting-page="${state.page+1}"${state.page===pages?' disabled':''}>Próxima</button></div></div>`;
    global.MinervaColumnLayout?.refresh();
  }
  function openDetail(type,key) {
    let dialog=$('meetingDetailDialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='meetingDetailDialog';dialog.className='meeting-detail-dialog';dialog.setAttribute('aria-labelledby','meetingDetailTitle');document.body.append(dialog);dialog.addEventListener('close',()=>{F()?.close();state.detail=null;});}
    state.detail={type,key};state.page=1;renderDetail();if(!dialog.open)dialog.showModal();
  }
  function meetingMasthead(active) {return `<div class="report-masthead"><img src="/assets/minerva-logo.png" alt="Minerva Foods"><div aria-label="Visuais da reunião">${VISUALS.map(v=>`<span${v.id===active?' class="is-current"':''}>${esc(v.label)}</span>`).join('')}</div></div>`;}
  function slideStat(value,label,color='blue'){return `<div class="meeting-slide-stat ${color}"><strong>${value}</strong><span>${label}</span></div>`;}
  function meetingReading(title,text){return `<div class="meeting-reading"><strong>${title}</strong><p>${text}</p></div>`;}
  function slides() {
    const d=data(),title=period(),statPeriod=slideStat('USD '+amount(d.received),'Recebido · '+esc(title)),statYear=slideStat('USD '+amount(d.annual),'Total do ano de compensação · '+d.year,'beige'),statCount=slideStat(amount(d.count),'Parcelas pagas no recorte','coral');
    const heading=(id,label,subtitle=title)=>`${meetingMasthead(id)}<h2>${label}</h2><p class="meeting-slide-period">${esc(subtitle)}</p>`;
    const all={
      summary:{label:'Resumo executivo',html:`<div class="meeting-slide">${heading('summary','Indicadores | Recebimentos')}${kpis(d)}<div class="meeting-summary-columns"><section><h3>01 · RECORTE DO PERÍODO</h3><dl><div><dt>Pagamentos</dt><dd>${amount(d.count)}</dd></div><div><dt>Analistas</dt><dd>${amount(d.analysts.length)}</dd></div><div><dt>Fornecedores</dt><dd>${amount(d.suppliers.length)}</dd></div></dl></section><section><h3>02 · DISTRIBUIÇÃO ANUAL</h3><dl><div><dt>Nos meses</dt><dd>USD ${amount(d.allocated)}</dd></div><div><dt>Sem mês definido</dt><dd>USD ${amount(d.unallocated)}</dd></div><div><dt>Pagamentos no ano</dt><dd>${amount(d.annualCount)}</dd></div></dl></section><section><h3>03 · CRITÉRIOS DA BASE</h3><dl><div><dt>Situação</dt><dd>Pago · M</dd></div><div><dt>Ano</dt><dd>Data de compensação · R</dd></div><div><dt>Valor</dt><dd>Recebido USD · T</dd></div></dl></section></div><p class="meeting-slide-note">Controle integral: todos os fornecedores e operações. ${d.unallocatedCount?`Há USD ${amount(d.unallocated)} para conferir na distribuição mensal.`:''}</p></div>`,notes:`Abra com o recebido do período: USD ${amount(d.received)}. Diferencie o recorte mensal do total anual de USD ${amount(d.annual)}. Os valores vêm do Controle integral, com status Pago.`,duration:90},
      trend:{label:'Evolução mensal',html:`<div class="meeting-slide">${heading('trend','Evolução dos recebimentos','Ano de compensação '+d.year)}<div class="meeting-chart-layout"><div>${monthlyChart(d,false)}</div><aside>${statYear}${slideStat('USD '+amount(d.unallocated),'Sem mês definido','beige')}${meetingReading('LEITURA DO PERÍODO',esc(comparison(d)))}</aside></div><p class="meeting-slide-note">O ano e o mês vêm da data de compensação R. Sem data válida, o pagamento é apontado e não é somado.</p></div>`,notes:'Comente os meses de maior recebimento. A variação mostra o volume realizado, sem atribuir causas que não foram verificadas. Datas R inválidas são apontadas; os valores não são somados nem distribuídos artificialmente.',duration:90},
      analysts:{label:'Recebido por analista',html:`<div class="meeting-slide">${heading('analysts','Recebimento por analista')}<div class="meeting-chart-layout"><div>${rankingChart(d.analysts,'analyst',false,5)}</div><aside>${statPeriod}${slideStat(amount(d.analysts.length),'Analistas no recorte','beige')}${meetingReading('BASE DO INDICADOR','Analista informado na coluna AF do Controle. A meta é única da equipe.')}</aside></div><p class="meeting-slide-note">O ranking mostra recebimentos do período. Não representa uma meta individual nem a autoria do claim.</p></div>`,notes:'Apresente a contribuição de cada analista conforme a coluna AF do Controle. O ranking indica recebimentos, não uma meta individual nem a autoria dos claims.',duration:90},
      suppliers:{label:'Recebido por fornecedor',html:`<div class="meeting-slide">${heading('suppliers','Recebimento por fornecedor')}<div class="meeting-chart-layout"><div>${rankingChart(d.suppliers,'supplier',false,5)}</div><aside>${statPeriod}${statCount}${meetingReading('BASE DO INDICADOR','Nomes originais da coluna K do Controle. Os demais fornecedores constam no Excel.')}</aside></div><p class="meeting-slide-note">M/R/T confirmam o recebido. Linhas agrupadas entram uma vez, mesmo sem detalhamento por ordem ou vínculo com a BD.</p></div>`,notes:'Destaque os principais fornecedores no recebido do período. Os nomes são os do Controle para preservar todos os pagamentos, inclusive os sem vínculo com a BD.',duration:90},
      goal:{label:'Meta da equipe',html:`<div class="meeting-slide">${heading('goal','Meta da equipe','Ano de compensação '+d.year)}<div class="meeting-chart-layout meeting-goal-layout"><div>${goalChart(d)}</div><aside>${statYear}${slideStat(amount(d.annualCount),'Pagamentos no ano','beige')}${meetingReading('CRITÉRIO DA META','O acompanhamento usa o ano completo, mesmo quando a reunião apresenta um mês.')}</aside></div></div>`,notes:d.goal?`A meta anual de 100% é USD ${amount(TARGET)}. Faltam USD ${amount(d.goal.delta)}. Para o marco de 150%, de USD ${amount(STRETCH)}, faltam USD ${amount(d.goal.stretchDelta)}. Este valor usa o ano completo, mesmo com mês selecionado.`:'Não há meta cadastrada para este ano. Os marcos fornecidos referem-se a 2026.',duration:90}
    };
    return VISUALS.filter(v=>state.selected.has(v.id)).map(v=>all[v.id]);
  }
  function presentationPayload() {return {title:'Reunião de resultados · Minerva Foods Claims',slides:slides(),metadata:metadata()};}
  function powerPointPayload(){
    const d=data(), selected=VISUALS.filter(v=>state.selected.has(v.id));
    const selectedSlides=slides();
    const fields=['received','count','annual','annualCount','allocated','unallocated','unallocatedCount','monthly','analysts','suppliers','goal','previous','previousAvailable','variation','delta','previousMonth','previousYear'];
    return {kind:'results',title:'Reunião de resultados',period:period(),metadata:metadata(),year:state.year,month:state.month,visualIds:selected.map(v=>v.id),data:Object.fromEntries(fields.map(key=>[key,d[key]])),notes:Object.fromEntries(selected.map((visual,index)=>[visual.id,selectedSlides[index]?.notes||'']))};
  }
  function updatePowerPointButton(){document.querySelectorAll('[data-meeting-action="pptx"]').forEach(button=>{button.disabled=exportingPowerPoint||!state.selected.size;button.textContent=exportingPowerPoint?'Gerando PowerPoint…':'Exportar PowerPoint';button.setAttribute('aria-busy',String(exportingPowerPoint));});}
  async function exportPowerPoint(){
    if(exportingPowerPoint||!state.model?.receiptReport||!state.selected.size)return;
    exportingPowerPoint=true;updatePowerPointButton();message('Preparando os slides com os visuais selecionados…');
    try{
      if(!global.MinervaPowerPoint)throw new Error('Atualize a página para carregar a exportação em PowerPoint.');
      const result=await global.MinervaPowerPoint.exportResults(powerPointPayload());
      if(result&&!result.cancelled)message(result.logoIncluded?'PowerPoint gerado com textos e gráficos editáveis.':'PowerPoint gerado. O logo não carregou nesta tentativa; atualize a página e exporte novamente para incluí-lo.');
    }catch(error){message(error.message||'Não foi possível gerar o PowerPoint. Tente novamente.');}
    finally{exportingPowerPoint=false;updatePowerPointButton();}
  }
  function present(){if(!state.model?.receiptReport||!state.selected.size)return;global.MinervaPresentation?.open(presentationPayload());}
  function exportPdf(){if(!state.model?.receiptReport||!state.selected.size)return;global.MinervaPresentation?.print(presentationPayload());}
  function addSheet(wb,name,headers,rows,numeric=[]) {
    const sheet=global.XLSX.utils.aoa_to_sheet([headers,...rows]);sheet['!cols']=headers.map((_,index)=>({wch:numeric.includes(index)?22:34}));
    sheet['!autofilter']={ref:global.XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};
    for(let r=1;r<=rows.length;r++)for(const c of numeric){const cell=sheet[global.XLSX.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z='#,##0';}
    global.XLSX.utils.book_append_sheet(wb,sheet,name);
  }
  function exportWorkbook() {
    if(!state.model?.receiptReport||!global.XLSX)return null;
    const d=data(),wb=global.XLSX.utils.book_new();
    addSheet(wb,'Resumo da reuniao',['Indicador','Valor'],[['Período',period()],['Recebido do recorte USD',d.received],['Parcelas do recorte',d.count],['Recebido no ano USD',d.annual],['Parcelas do ano',d.annualCount],['Distribuído nos meses USD',d.allocated],['Sem mês definido USD',d.unallocated],['Pagamentos sem mês',d.unallocatedCount],...(d.goal?[['Meta 100% USD',d.goal.target],['Falta para 100% USD',d.goal.delta],['Meta 150% USD',d.goal.stretch],['Falta para 150% USD',d.goal.stretchDelta]]:[])],[1]);
    addSheet(wb,'Evolucao mensal',['Período','Recebido USD','Parcelas'],[...d.monthly.map(row=>[row.key,row.received,row.count]),['Sem mês definido',d.unallocated,d.unallocatedCount]],[1,2]);
    addSheet(wb,'Por analista',['Analista AF','Recebido USD','Parcelas','Participação no recorte'],d.analysts.map(row=>[row.name,row.received,row.count,row.share]),[1,2]);
    addSheet(wb,'Por fornecedor',['Fornecedor no Controle K','Recebido USD','Parcelas','Participação no recorte'],d.suppliers.map(row=>[row.name,row.received,row.count,row.share]),[1,2]);
    for(const name of ['Por analista','Por fornecedor'])for(let r=2;r<=((name==='Por analista'?d.analysts:d.suppliers).length+1);r++)if(wb.Sheets[name]['D'+r])wb.Sheets[name]['D'+r].z='0%';
    const headers=['Ordem / NF','Fornecedor no Controle','Analista AF','Data compensação R','Ano R','Mês atribuído','Status M','Recebido USD T','Linha Excel'];
    const cells=row=>[row.reference,row.originalSupplier||row.supplier,row.receiptAnalyst,row.compDate,row.compensationYear,monthOf(row)?keyFor(row.compensationYear,monthOf(row)):'Sem mês definido','Pago',row.received,row.row];
    addSheet(wb,'Parcelas do recorte',headers,d.rows.map(cells),[7,8]);
    if(state.detail)addSheet(wb,'Detalhe selecionado',headers,detailRows().rows.map(cells),[7,8]);
    addSheet(wb,'Criterios',['Critério','Valor'],[['Relatório','Reunião de resultados'],['Período',period()],['Fonte','Controle Recebimento integral; M=Pago; ano e mês da data R; T=Valor Recebido USD positivo.'],['Mês','Ano e mês vêm de R. Data ausente ou inválida exclui o pagamento do recebido; AE serve apenas para conferência.'],['Escopo','Todas as operações e fornecedores; independente do ano RNC, vínculo ou filtros da BD.'],['Analista','Coluna AF do Controle; não é o analista BE da BD.'],['Fornecedor','Nome original da coluna K no Controle; não agrupado por inferência.'],['Meta','Equipe 2026: USD 300.000 = 100%, USD 450.000 = 150%. Meta usa ano completo.'],['Visuais selecionados',VISUALS.filter(v=>state.selected.has(v.id)).map(v=>v.label).join('; ')],['Precisão','Valores originais com centavos preservados; apenas a exibição é arredondada.'],['Publicação',metadata()],['Detalhe selecionado',state.detail?F()?.describe(DETAIL)||'Sem filtro adicional':'Não aberto']]);
    return wb;
  }
  function selectMonth(month){state.month=state.draftMonth=Number(month);state.draftYear=state.year;state.detail=null;render();message(`Recorte atualizado: ${period()}.`);}
  function clear(){state.model=null;state.year=state.draftYear=null;state.month=state.draftMonth=0;state.detail=null;state.page=1;F()?.clear();$('meetingDetailDialog')?.close();$('meetingDetailDialog')?.remove();render();}
  function handlesTable(id){return id===DETAIL;}
  function handleFilter(id){if(handlesTable(id)){state.page=1;renderDetail();}}
  document.addEventListener('submit',event=>{if(event.target.id!=='meetingFilters')return;event.preventDefault();state.year=state.draftYear;state.month=state.draftMonth;state.detail=null;render();message(`Filtros aplicados: ${period()}.`);});
  document.addEventListener('change',event=>{
    if(event.target.id==='meetingYear'||event.target.id==='meetingMonth'){state.draftYear=Number($('meetingYear').value);state.draftMonth=Number($('meetingMonth').value);$('meetingFilterStatus').textContent='Seleção pendente. Clique em Aplicar para atualizar os gráficos.';return;}
    const visual=event.target.dataset?.meetingVisual;if(visual){event.target.checked?state.selected.add(visual):state.selected.delete(visual);$('meetingSelectedCount').textContent=state.selected.size+' visuais selecionados';document.querySelectorAll('[data-meeting-action="present"],[data-meeting-action="pdf"]').forEach(button=>button.disabled=!state.selected.size);updatePowerPointButton();message(state.selected.size?'Apresentação atualizada com os visuais selecionados.':'Selecione pelo menos um visual para apresentar ou exportar os slides.');}
  });
  document.addEventListener('click',event=>{
    const month=event.target.closest('[data-meeting-month]');if(month){selectMonth(month.dataset.meetingMonth);return;}
    const detail=event.target.closest('[data-meeting-detail]');if(detail){openDetail(detail.dataset.meetingDetail,detail.dataset.meetingKey);return;}
    const page=event.target.closest('[data-meeting-page]');if(page){state.page=Number(page.dataset.meetingPage);renderDetail();return;}
    const button=event.target.closest('[data-meeting-action]');if(!button)return;
    switch(button.dataset.meetingAction){case 'present':present();break;case 'pdf':exportPdf();break;case 'pptx':exportPowerPoint();break;case 'close-detail':$('meetingDetailDialog')?.close();break;case 'excel':try{const workbook=exportWorkbook();if(workbook){global.XLSX.writeFile(workbook,`Minerva-Reuniao-${state.year}-${state.month===0?'ano':state.month===-1?'sem-mes':String(state.month).padStart(2,'0')}.xlsx`);message('Excel gerado com resumo, gráficos em dados e todas as parcelas do recorte.');}}catch(error){message('Não foi possível gerar o Excel: '+error.message);}break;}
  });
  document.addEventListener('minerva:model-updated',()=>{const app=global.MinervaApp,model=app?.state.model||null;if(!model||app?.state.view==='meeting')render(model);});
  document.addEventListener('minerva:session-updated',event=>{if(global.MINERVA_HOSTED&&!event.detail)clear();});
  global.MinervaMeetings={getViewState:()=>({year:state.year,month:state.month}),setViewState:value=>{if(Number.isInteger(value?.year)){state.year=state.draftYear=value.year;state.month=state.draftMonth=Number.isInteger(value.month)?value.month:0;state.page=1;}},render,clear,aggregate,exportWorkbook,exportPdf,present,handlesTable,handleFilter,filterText:period,presentationPayload,powerPointPayload,exportPowerPoint};
})(typeof window!=='undefined'?window:globalThis);
