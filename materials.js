(function (global, factory) {
  'use strict';
  const api = factory(global);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else global.MinervaMaterials = api;
})(typeof window === 'object' ? window : globalThis, function (global) {
  'use strict';
  const doc = global.document, MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const FIELDS = [['containerTotal','Volume Embarcado','Contêineres'],['containerFrozen','Congelado','Contêineres'],['containerChilled','Resfriado','Contêineres'],['containerDry','Dry','Contêineres'],['freightUsd','Frete Marítimo + Custos Extras','USD']];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const numeric = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const integer = value => numeric(value) === null ? '—' : value.toLocaleString('pt-BR',{maximumFractionDigits:0});
  const money = value => numeric(value) === null ? 'Não informado' : 'US$ ' + integer(value);
  const cleanYears = value => [...new Set((Array.isArray(value)?value:[]).filter(year=>typeof year!=='boolean').map(Number).filter(year=>Number.isInteger(year)&&year>1900&&year<=9999))].sort((a,b)=>a-b);
  const cleanMonths = value => { const months=[...new Set((Array.isArray(value)?value:[]).filter(month=>typeof month!=='boolean').map(Number).filter(month=>Number.isInteger(month)&&month>=1&&month<=12))].sort((a,b)=>a-b);return months.length===12?[]:months; };
  const currentYear = () => Number((global.MinervaEngine?.today?.() || new Date().toISOString().slice(0,10)).slice(0,4));
  const tabName = tab => tab === 'carriers' ? 'carriers' : 'directors';
  const title = tab => tab === 'carriers' ? 'Report Armadores' : 'Report De Claims Diretoria';
  const hostId = tab => tab === 'carriers' ? 'materialsCarriers' : 'materialsDirectors';
  const states = {directors:{years:null,months:[],filtersOpen:true,editorOpen:false},carriers:{years:[],months:[],filtersOpen:true,editorOpen:false}};
  let model = null, currentTab = 'directors', inputs = {revision:null,periods:{}}, inputYear = currentYear(), agreementMonth = new Date().getMonth()+1;
  let inputsLoaded = false, inputsLoading = false, saving = false, inputError = '', sessionVersion = 0, printing = false, inputRequest = null, saveRequest = null;
  const profileIdentity = profile => String(profile?.id||profile?.email||'');
  const profileKey = () => {const profile=global.MinervaTeam?.getProfile?.();return profile?JSON.stringify([profileIdentity(profile),profile.role]):'';};
  let sessionKey=profileKey(),sessionIdentity=profileIdentity(global.MinervaTeam?.getProfile?.());
  const openGroups = new Set(), DETAIL_HEADERS=['Ordem','Faturamento','Contêiner / NF','Abertura','Dias','Reclamado · USD','Status'];
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${esc(name)}"/></svg>`;
  const empty = text => `<p class="materials-empty">${esc(text)}</p>`;
  const foot = (source='BD',note='') => `<footer class="materials-chart-source">Base: ${esc(source)}${note?` <span>· ${esc(note)}</span>`:''}</footer>`;
  const period = meta => { const years=cleanYears(meta?.years),months=cleanMonths(meta?.months);return (years.length===0?'Todos os anos':years.length===1?String(years[0]):years.length<=2?years.join(' e '):`${years[0]}–${years.at(-1)}`)+(months.length?' · '+months.map(month=>MONTHS[month-1]).join(', '):' · Todos Os Meses'); };
  const negotiationPeriod = data => data.negotiation?.allYears ? 'Carteira aberta · Todos os anos' : 'Negociações · '+period(data.meta);
  const date = value => /^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10).split('-').reverse().join('/'):'—';
  const flags = {BRA:['br','Brasil'],BR:['br','Brasil'],BRASIL:['br','Brasil'],ARG:['ar','Argentina'],AR:['ar','Argentina'],ARGENTINA:['ar','Argentina'],PRY:['py','Paraguai'],PY:['py','Paraguai'],PARAGUAI:['py','Paraguai'],URY:['uy','Uruguai'],UY:['uy','Uruguai'],URUGUAI:['uy','Uruguai'],COL:['co','Colômbia'],CO:['co','Colômbia'],'COLÔMBIA':['co','Colômbia']};
  function country(name) { const match=flags[String(name||'').toUpperCase()];return match?`<span class="materials-country"><img src="assets/flags/${match[0]}.svg" alt="" width="24" height="16">${esc(match[1])}</span>`:esc(name||'Não informado'); }
  function pageHeader(tab,heading,subtitle,active=0,steps=[]) {
    const agenda=steps.length?steps:tab==='directors'?['Visão Executiva','Carteira Em Negociação']:['Panorama','Carteiras Por Armador'];
    return `<header class="materials-page-head"><div class="materials-brand"><img src="assets/minerva-monogram.svg" alt="Minerva Foods" width="42" height="42"><span>Minerva Foods <b>Claims</b></span></div><nav aria-label="Agenda do material">${agenda.map((item,index)=>`<span class="${index===active?'is-active':''}">${String(index+1).padStart(2,'0')} ${esc(item)}</span>`).join('')}</nav><img class="materials-official-logo" src="assets/minerva-logo.png" alt="Minerva Foods"></header><div class="materials-page-title"><div><p class="materials-eyebrow">${esc(title(tab))}</p><h2>${esc(heading)}</h2></div><p>${esc(subtitle)}</p></div>`;
  }
  function pageFooter(data,label) { return `<footer class="materials-page-foot"><span>Minerva Foods · Claims</span><span>${esc(label)}</span><span>Posição ${date(data.meta?.asOf)}</span></footer>`; }
  function metric(label,value,note='',kind='') { return `<div class="materials-metric ${kind}"><span>${esc(label)}</span><strong>${typeof value==='number'?money(value):esc(value)}</strong>${note?`<small>${esc(note)}</small>`:''}</div>`; }
  function rank(titleText,groups,total,options={}) {
    const sorted=[...(groups||[])].sort((a,b)=>(b.total||0)-(a.total||0)),limit=options.limit||8,rows=sorted.slice(0,limit),max=Math.max(0,...rows.map(row=>row.total||0));
    return `<section class="materials-chart"><div class="materials-section-heading"><h3>${esc(titleText)}</h3><span>USD</span></div>${rows.length?`<ol class="materials-ranking">${rows.map((row,index)=>`<li><span class="materials-rank-number">${index+1}</span><div><div class="materials-rank-label"><span>${esc(row.name||'Não informado')}</span><strong>${money(row.total)}</strong></div><div class="materials-bar-track"><span style="width:${max?Math.max(0,Math.min(100,(row.total||0)/max*100)):0}%"></span></div><small>${integer(row.count||0)} ${row.count===1?'claim':'claims'}</small></div></li>`).join('')}</ol>`:empty('Nenhum claim neste recorte.')}<div class="materials-chart-total"><span>Total ${options.totalLabel||'do recorte'}</span><strong>${money(total)}</strong></div>${foot('BD',sorted.length>limit?`${limit} principais de ${sorted.length} · total inclui todos`:options.note||'')}</section>`;
  }
  function countries(groups,total,heading='Distribuição Por Origem') {
    const rows=[...(groups||[])].sort((a,b)=>(b.total||0)-(a.total||0));
    return `<section class="materials-chart materials-origin"><div class="materials-section-heading"><h3>${esc(heading)}</h3><span>USD</span></div>${rows.length?rows.map(row=>`<div class="materials-country-row">${country(row.name)}<strong>${money(row.total)}</strong><small>${integer(row.count||0)} ${row.count===1?'claim':'claims'}</small></div>`).join(''):empty('Nenhum país neste recorte.')}<div class="materials-chart-total"><span>Total</span><strong>${money(total)}</strong></div>${foot('BD')}</section>`;
  }
  function externalValues(values={},year=inputYear) {
    return `<section class="materials-external-strip" aria-label="Informações Externas"><div class="materials-external-caption">Contexto Operacional Anual <strong>${esc(year)}</strong><span>Informação Externa</span></div><div class="materials-external-values">${FIELDS.map(([key,label,unit])=>`<div><span>${esc(label)}</span><strong>${numeric(values[key])===null?'—':key==='freightUsd'?money(values[key]):integer(values[key])}</strong><small>${esc(unit)}${numeric(values[key])===null?' · Não informado':''}</small></div>`).join('')}</div>${values.note?`<p class="materials-external-note">${esc(values.note)}</p>`:''}${foot('Informação Externa',`Ano ${year} · não altera os cálculos da BD`)}</section>`;
  }
  function directorsPages(data,external={},year=inputYear) {
    const d=data.directors||{},n=data.negotiation||{};
    const first=`<article class="materials-page materials-director-overview">${pageHeader('directors','Resultado E Principais Causas',period(data.meta),0)}${externalValues(external,year)}<div class="materials-headline"><div><span>Reclamado Procedente</span><strong>${money(d.total)}</strong></div><div><span>Ocorrências No Recorte</span><strong>${integer(d.count||0)}</strong></div><p>Situações procedentes confirmadas<br><b>Sem aguardando custos</b></p></div><div class="materials-editorial-grid"><div>${rank('Motivos Dos Claims Procedentes',d.byReason,d.total,{limit:8})}</div><div class="materials-right-column">${countries(d.byCountry,d.total)}${rank('Maiores Causadores',d.bySupplier||d.topSuppliers,d.total,{limit:5})}</div></div>${pageFooter(data,'Visão Executiva')}</article>`;
    const second=`<article class="materials-page">${pageHeader('directors','Carteira Em Negociação',negotiationPeriod(data),1)}<div class="materials-totals">${metric('Negociações',n.total,`${integer(n.count||0)} claims`)}${metric('Jurídico',n.legalTotal,'Somente total','is-legal')}${metric('Total Geral',n.grandTotal,'Negociações + Jurídico','is-total')}</div><div class="materials-editorial-grid materials-negotiation-grid"><div>${rank('Negociações Por Fornecedor',n.bySupplier,n.total,{limit:12})}</div><div>${countries(n.byCountry,n.total,'Negociações Por País')}<aside class="materials-editorial-note"><span>Critério Da Carteira</span><p>Em negociação procedente, sem pendências de FUP Suprimentos.</p><small>Jurídico é apresentado somente no total separado.</small></aside></div></div>${pageFooter(data,'Carteira Em Negociação')}</article>`;
    return [first,second];
  }
  function rowCells(row) { return [row.order||'—',date(row.invoiceDate),row.container||row.nf||'—',date(row.openingDate),numeric(row.daysOpen)===null?'—':integer(row.daysOpen),money(row.claimed),row.pending||'—']; }
  function tableId(carrier,reason){let hash=2166136261;for(const char of carrier+'\u0000'+reason)hash=Math.imul(hash^char.charCodeAt(0),16777619);return 'materials-carrier-'+(hash>>>0).toString(36);}
  function filteredDetails(rows,id){const F=global.MinervaTableFilters;return id&&F?F.prepare(id,DETAIL_HEADERS,rows,row=>rowCells(row).map(esc),'Claims do material de armadores',{types:['text','date','text','date','number','number','text'],sortValues:row=>[row.order,row.invoiceDate,row.container||row.nf,row.openingDate,row.daysOpen,row.claimed,row.pending]}):rows;}
  function detailTable(source,id='') {
    const F=global.MinervaTableFilters,rows=filteredDetails(source,id);
    return `${id?F?.summary(id)||'':''}<div class="materials-table-wrap"><table class="materials-detail-table"${id?` data-table-id="${id}"`:''}><thead><tr>${DETAIL_HEADERS.map((label,index)=>`<th scope="col"${id?` aria-sort="${F?.ariaSort(id,index)||'none'}"`:''}>${id?F?.heading(id,index,label)||label:label}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${rowCells(row).map((cell,index)=>`<td${index===6?` title="${esc(cell)}"`:''}>${esc(cell)}</td>`).join('')}</tr>`).join(''):'<tr><td colspan="7">Nenhum registro neste filtro.</td></tr>'}</tbody></table></div>${id?`<div class="materials-detail-page-note">${integer(rows.length)} registros na tabela · ${money(rows.reduce((sum,row)=>sum+(row.claimed||0),0))} · Filtros da base não alteram os gráficos.</div>`:''}`;
  }
  function carrierGroups(carrier,print=false) { return (carrier.byReason||[]).map(group=>{const id=tableId(carrier.name,group.name);return `<details class="materials-reason" data-material-group="${id}" ${print||openGroups.has(id)?'open':''}><summary><span>${esc(group.name)} <small>${integer(group.count||0)} claims</small></span><strong>${money(group.total)}</strong></summary>${detailTable(group.rows||[],print?'':id)}</details>`;}).join(''); }
  function agreementValue(external,name,months) { const set=cleanMonths(months),values=external?.agreements?.[name]||{};if(!set.length)return null;const found=set.map(month=>numeric(values[month]));return found.every(value=>value!==null)?found.reduce((sum,value)=>sum+value,0):null; }
  function carrierSummary(carrier,data,index,external={},year=inputYear) {
    const months=data.meta?.months||[],agreements=agreementValue(external,carrier.name,months),agreementNote=months.length?`Informação Externa · ${year}`:'Selecione o mês para consultar';
    return `<article class="materials-page materials-carrier-page">${pageHeader('carriers',carrier.name,negotiationPeriod(data),1)}<div class="materials-carrier-band"><span class="materials-carrier-position">${String(index+1).padStart(2,'0')}</span><div><p>Maiores Carteiras Em Negociação</p><h3>${esc(carrier.name)}</h3></div><div><small>Reclamado Em Negociação</small><strong>${money(carrier.total)}</strong></div></div><div class="materials-carrier-kpis"><span><strong>${integer(carrier.count||0)}</strong> claims pendentes</span><span><strong>${integer((carrier.byReason||[]).length)}</strong> motivos</span><span><strong>${agreements===null?'—':integer(agreements)}</strong> acordos finalizados<small>${esc(agreementNote)}</small></span></div><div class="materials-editorial-grid"><div>${rank('Negociações Por Motivo',carrier.byReason,carrier.total,{limit:9})}</div><div>${countries(carrier.byCountry,carrier.total)}</div></div>${pageFooter(data,'Armador '+(index+1)+' de '+(data.carriers||[]).length)}</article>`;
  }
  function carriersOverview(data) {
    const carriers=data.carriers||[],universe=data.carrierUniverse||{},total=carriers.reduce((sum,carrier)=>sum+(carrier.total||0),0),count=carriers.reduce((sum,carrier)=>sum+(carrier.count||0),0),share=value=>numeric(universe.total)!==null&&universe.total>0?(value/universe.total*100).toLocaleString('pt-BR',{maximumFractionDigits:1})+'%':'—',max=Math.max(0,...carriers.map(carrier=>carrier.total||0));
    return `<article class="materials-page materials-carriers-overview">${pageHeader('carriers','Panorama Dos Armadores',negotiationPeriod(data),0)}<div class="materials-panorama-lead"><p>Top 3 Por Valor Pendente Em Negociação</p><span>Do maior para o menor · USD reclamado</span></div><div class="materials-panorama-summary"><div><span>Total Dos ${carriers.length} Armadores</span><strong>${money(total)}</strong></div><div><span>Claims Pendentes</span><strong>${integer(count)}</strong></div><div><span>Participação No Universo De Armadores</span><strong>${share(total)}</strong></div></div><section class="materials-carrier-ranking"><div class="materials-carrier-rank-head"><span>Posição / Armador</span><span>Claims</span><span>Negociações · USD</span><span>Participação</span></div>${carriers.map((carrier,index)=>`<div class="materials-carrier-rank-row"><div><span class="materials-carrier-rank-index">${String(index+1).padStart(2,'0')}</span><div><strong>${esc(carrier.name)}</strong><div class="materials-bar-track"><span style="width:${max?Math.max(0,Math.min(100,carrier.total/max*100)):0}%"></span></div></div></div><span>${integer(carrier.count||0)}</span><strong>${money(carrier.total)}</strong><span>${share(carrier.total)}</span></div>`).join('')}<div class="materials-universe-total"><span>Universo: ${integer(universe.carrierCount)} Armadores · ${integer(universe.count)} Claims</span><strong>${money(universe.total)}</strong></div>${foot('BD')}</section>${pageFooter(data,'Panorama · Top 3')}</article>`;
  }
  function carrierDetailPages(carrier,data) {
    const pages=[];let blocks=[],used=0;
    const flush=()=>{if(!blocks.length)return;pages.push(`<article class="materials-page materials-detail-page">${pageHeader('carriers',carrier.name,negotiationPeriod(data),1)}${blocks.join('')}${foot('BD','Status corresponde à pendência')}${pageFooter(data,'Detalhamento Por Motivo')}</article>`);blocks=[];used=0;};
    for(const group of carrier.byReason||[]){
      const id=tableId(carrier.name,group.name),rows=filteredDetails(group.rows||[],id),filtered=Boolean(global.MinervaTableFilters?.has(id)),filteredTotal=rows.reduce((sum,row)=>sum+(row.claimed||0),0);
      for(let offset=0;offset<rows.length;){
        if(10-used-2<1)flush();const size=Math.min(10-used-2,rows.length-offset),chunk=rows.slice(offset,offset+size);
        blocks.push(`<section class="materials-print-group"><div class="materials-detail-title"><h3>${esc(group.name)}${offset?' · Continuação':''}</h3><span>${integer(group.count||0)} claims no motivo · ${money(group.total)}</span></div>${detailTable(chunk)}<div class="materials-detail-page-note">${offset+1}–${offset+size} de ${rows.length} registros deste motivo${filtered?` · Filtro da tabela: ${money(filteredTotal)}`:''} · Dias em aberto na posição do relatório</div></section>`);
        offset+=size;used+=size+2;if(offset<rows.length)flush();
      }
    }
    flush();return pages;
  }
  function carrierPages(data,external={},year=inputYear,print=false) {
    const carriers=data.carriers||[];if(!carriers.length)return [`<article class="materials-page">${pageHeader('carriers','Carteiras em negociação',negotiationPeriod(data))}${empty('Nenhum armador com negociação pendente neste recorte.')}${pageFooter(data,'Armadores')}</article>`];
    const pages=[carriersOverview(data)];
    carriers.forEach((carrier,index)=>{
      pages.push(carrierSummary(carrier,data,index,external,year));
      if(!print){pages.push(`<section class="materials-base"><div class="materials-base-heading"><div><h3>Claims de ${esc(carrier.name)}</h3><span>Por motivo · maior valor primeiro</span></div><div><button type="button" data-material-action="expand">Expandir Todos</button><button type="button" data-material-action="collapse">Recolher Todos</button></div></div>${carrierGroups(carrier)}${foot('BD','Status corresponde à pendência')}</section>`);return;}
      pages.push(...carrierDetailPages(carrier,data));
    });
    return pages;
  }
  function buildPages(data,tab,external={},year=inputYear,print=false) { return tabName(tab)==='carriers'?carrierPages(data,external,year,print):directorsPages(data,external,year); }
  function canEdit() { return global.MINERVA_HOSTED!==true||['admin','editor'].includes(global.MinervaTeam?.getProfile?.()?.role); }
  function canRead() { return global.MINERVA_HOSTED!==true||Boolean(global.MinervaTeam?.getProfile?.()); }
  function filters(tab,data) {
    const local=states[tab],years=data.meta?.yearsAvailable||data.meta?.years||[],yearId='materials-'+tab+'-years',monthId='materials-'+tab+'-months',applyId='materials-'+tab+'-apply';
    const select=(id,label,values,options,placeholder)=>`<label class="filter-field"><span>${label}</span><select id="${id}" multiple data-multi-select data-placeholder="${placeholder}" data-filter-title="${label} do material" data-apply-target="#${applyId}" aria-label="${label} do material">${options.map(([value,name])=>`<option value="${value}"${values.includes(value)?' selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
    return `<details class="materials-filters" ${local.filtersOpen?'open':''}><summary>Filtros Deste Material <span>${esc(period({...data.meta,years:local.years,months:local.months}))}</span></summary><form data-material-filter="${tab}" class="materials-filter-form">${select(yearId,'Ano',local.years,cleanYears(years).map(year=>[year,String(year)]),'Todos os anos')}${select(monthId,'Mês',local.months,MONTHS.map((month,index)=>[index+1,month]),'Todos Os Meses')}<button class="button button-primary" id="${applyId}" type="submit">Aplicar</button><button class="button button-outline" type="button" data-material-action="clear">Todos os anos e meses</button></form></details>`;
  }
  function editor(tab,data) {
    if(!canEdit())return '';
    const value=inputs.periods?.[String(inputYear)]||{},disabled=saving||(global.MINERVA_HOSTED===true&&!inputsLoaded);
    const input=(key,label,unit)=>`<label><span>${esc(label)} <small>${esc(unit)}</small></span><input name="${key}" type="number" min="0" step="${key==='freightUsd'?'0.01':'1'}" value="${numeric(value[key])===null?'':value[key]}" placeholder="Não informado"></label>`;
    return `<details class="materials-editor" ${states[tab].editorOpen?'open':''}><summary>${icon('edit')} Informações Externas <span>Editar Contexto E Acordos</span></summary><form data-material-inputs="${tab}"><div class="materials-editor-period"><label><span>Ano Da Informação</span><input data-material-input-year type="number" min="2000" max="2100" value="${inputYear}"></label><p>Esses campos complementam o material. A BD continua sendo a fonte dos claims.</p></div><div class="materials-input-grid">${FIELDS.map(field=>input(...field)).join('')}</div><label class="materials-note-field"><span>Observação Do Contexto Anual</span><input name="note" type="text" maxlength="240" value="${esc(value.note||'')}" placeholder="Fonte ou contexto da informação"></label>${tab==='carriers'&&data.carriers?.length?`<fieldset class="materials-agreements"><legend>Acordos Finalizados · informação externa</legend><label><span>Mês Dos Acordos</span><select data-material-agreement-month>${MONTHS.map((month,index)=>`<option value="${index+1}"${agreementMonth===index+1?' selected':''}>${month}</option>`).join('')}</select></label>${data.carriers.map(carrier=>`<label><span>${esc(carrier.name)}</span><input type="number" min="0" step="1" data-material-agreement="${esc(carrier.name)}" value="${numeric(value.agreements?.[carrier.name]?.[agreementMonth])===null?'':value.agreements[carrier.name][agreementMonth]}" placeholder="Não informado"></label>`).join('')}</fieldset>`:''}<div class="materials-editor-actions"><button class="button button-primary" type="submit"${disabled?' disabled':''}>${saving?'Salvando…':'Salvar Informações'}</button><span role="status" data-material-save-message>${esc(inputError||(!inputsLoaded&&global.MINERVA_HOSTED===true?'Carregando informações compartilhadas…':'Vazio significa não informado.'))}</span></div></form></details>`;
  }
  function build() { const local=states[currentTab];return global.MinervaMaterialsData?.build(model,{years:local.years,months:local.months,tab:currentTab}); }
  function dataFor(tab) { const local=states[tab];return global.MinervaMaterialsData?.build(model,{years:local.years,months:local.months,tab}); }
  function render(nextModel,tab=currentTab) {
    if(nextModel!==undefined)model=nextModel;currentTab=tabName(tab);if(states.directors.years===null)states.directors.years=[currentYear()];
    const host=doc?.getElementById(hostId(currentTab));if(!host)return;
    if(!model||!canRead()){host.innerHTML=empty('Carregue as bases para preparar este material.');return;}
    const data=build();if(!data){host.innerHTML=empty('Preparando o material. Atualize a página se ele não aparecer.');return;}
    const values=inputs.periods?.[String(inputYear)]||{};
    host.classList.add('materials-host');host.innerHTML=`<div class="materials-toolbar"><p><strong>Prévia Do Material</strong>${inputError?`<span role="status" data-material-save-message>${esc(inputError)}</span>`:''}</p><div><button type="button" class="button button-outline" data-material-action="pdf">${icon('download')}Exportar PDF</button><button type="button" class="button button-outline" data-material-action="excel">${icon('download')}Excel</button></div></div>${filters(currentTab,data)}${editor(currentTab,data)}<div class="materials-pages">${buildPages(data,currentTab,values,inputYear).join('')}</div>`;
    global.MinervaMultiSelect?.refresh?.();loadInputs();
  }
  async function loadInputs(force=false) {
    if(inputRequest||inputsLoaded&&!force)return;
    if(global.MINERVA_HOSTED!==true){inputsLoaded=true;try{const saved=global.localStorage?.getItem('minerva-materials-demo-inputs-v1');if(saved){inputs=JSON.parse(saved);render();}}catch{}return;}
    if(!canRead()||!global.MinervaTeam?.getMaterialInputs)return;
    const request={version:sessionVersion,key:profileKey()};inputRequest=request;inputsLoading=true;
    const current=()=>inputRequest===request&&request.version===sessionVersion&&request.key===profileKey()&&canRead();
    try{const loaded=await global.MinervaTeam.getMaterialInputs();if(!current())return;inputs=loaded&&typeof loaded==='object'?loaded:{revision:null,periods:{}};inputsLoaded=true;inputError='';}
    catch(error){if(current())inputError=error?.message||'Não foi possível carregar as informações.';}
    finally{if(inputRequest===request){inputRequest=null;inputsLoading=false;if(request.version===sessionVersion){const host=doc?.getElementById(hostId(currentTab));if(inputsLoaded&&host)render();else host?.querySelectorAll('[data-material-save-message]').forEach(node=>node.textContent=inputError);}}}
  }
  async function saveInputs(form) {
    if(!canEdit()||saving)return;const year=inputYear,values=structuredClone(inputs.periods?.[String(year)]||{}),request={version:sessionVersion,key:profileKey()};saveRequest=request;saving=true;
    const current=()=>saveRequest===request&&request.version===sessionVersion&&request.key===profileKey()&&canEdit();
    try{for(const [key] of FIELDS){const raw=form.elements.namedItem(key)?.value?.trim()||'';values[key]=raw===''?null:Number(raw);if(values[key]!==null&&(!Number.isFinite(values[key])||values[key]<0||(key!=='freightUsd'&&!Number.isInteger(values[key]))))throw Error('Confira os valores: use números positivos e volumes inteiros.');}values.note=String(form.elements.namedItem('note')?.value||'').trim();values.agreements=values.agreements||{};
      for(const input of form.querySelectorAll('[data-material-agreement]')){const raw=input.value.trim(),value=raw===''?null:Number(raw);if(value!==null&&(!Number.isInteger(value)||value<0))throw Error('A quantidade de acordos precisa ser um inteiro positivo.');const key=input.dataset.materialAgreement;values.agreements[key]={...(values.agreements[key]||{}),[agreementMonth]:value};}
      inputError='';form.querySelector('button[type="submit"]').disabled=true;
      if(global.MINERVA_HOSTED===true){if(!inputsLoaded||!global.MinervaTeam?.saveMaterialInputs)throw Error('Aguarde o carregamento das informações compartilhadas.');const saved=await global.MinervaTeam.saveMaterialInputs({revision:inputs.revision,year,values});if(!current())return;inputs=saved;}
      else{inputs={...inputs,periods:{...inputs.periods,[String(year)]:values}};try{global.localStorage?.setItem('minerva-materials-demo-inputs-v1',JSON.stringify(inputs));}catch{}}
      inputError='Informações salvas.';
    }catch(error){if(current())inputError=error?.message||'Não foi possível salvar. Tente novamente.';}
    finally{if(saveRequest===request){saveRequest=null;saving=false;if(request.version===sessionVersion)render();}}
  }
  function sanitizeViewState(value) {const source=value&&typeof value==='object'&&!Array.isArray(value)?value:{};return Object.fromEntries(['directors','carriers'].map(name=>{const entry=source[name]&&typeof source[name]==='object'&&!Array.isArray(source[name])?source[name]:{};return [name,{years:Array.isArray(entry.years)?cleanYears(entry.years).slice(0,100):name==='directors'?[currentYear()]:[],months:cleanMonths(entry.months)}];}));}
  function getViewState() { return sanitizeViewState(states); }
  function setViewState(value,tab) { if(tab==='fup')return;const source=tab&&!value?.directors&&!value?.carriers?{[tabName(tab)]:value}:value,safe=sanitizeViewState(source);for(const name of tab?[tabName(tab)]:['directors','carriers']){states[name].years=safe[name].years;states[name].months=safe[name].months;} }
  function stopPrint() {printing=false;doc?.body.classList.remove('materials-printing');doc?.getElementById('materialsPrintRoot')?.remove();}
  function canExport() {if(!canRead())return false;if(global.MINERVA_HOSTED===true&&!inputsLoaded){inputError=inputError||'Aguarde o carregamento das informações e tente novamente.';render();return false;}return true;}
  async function exportPdf(tab=currentTab) {
    const name=tabName(tab),data=dataFor(name),version=sessionVersion;if(!data||!doc||printing||!canExport())return;
    printing=true;global.MinervaMultiSelect?.close?.();const root=doc.createElement('div');root.id='materialsPrintRoot';root.className='materials-print-root';root.innerHTML=buildPages(data,name,inputs.periods?.[String(inputYear)]||{},inputYear,true).join('');doc.body.append(root);doc.body.classList.add('materials-printing');
    try{await doc.fonts?.ready;await Promise.all(Array.from(root.querySelectorAll('img')).map(image=>image.decode?.().catch(()=>{})||Promise.resolve()));if(version!==sessionVersion||!canRead()||!root.isConnected){stopPrint();return;}global.print();}catch{stopPrint();}
  }
  function workbook(data,tab,external={},year=inputYear) {
    const X=global.XLSX;if(!X)throw Error('A biblioteca de Excel não está disponível. Atualize a página.');const wb=X.utils.book_new();
    const add=(name,headers,rows,numbers=[])=>{const sheet=X.utils.aoa_to_sheet([headers,...rows]);sheet['!cols']=headers.map((_,index)=>({wch:numbers.includes(index)?23:34}));sheet['!autofilter']={ref:X.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:headers.length-1}})};for(let row=1;row<=rows.length;row++)for(const col of numbers){const cell=sheet[X.utils.encode_cell({r:row,c:col})];if(cell?.t==='n')cell.z=headers[col].includes('USD')?'#,##0.00':'#,##0';}X.utils.book_append_sheet(wb,sheet,name);};
    const groups=(name,rows)=>add(name,['Descrição','Reclamado USD','Claims'],(rows||[]).map(row=>[row.name,row.total,row.count]),[1,2]);
    if(tabName(tab)==='directors'){add('Resumo',['Indicador','Valor USD','Quantidade'],[['Reclamado Procedente',data.directors?.total,data.directors?.count],['Em negociação',data.negotiation?.total,data.negotiation?.count],['Jurídico',data.negotiation?.legalTotal,null],['Total Geral negociações',data.negotiation?.grandTotal,null]],[1,2]);groups('Motivos procedentes',data.directors?.byReason);groups('Origem procedentes',data.directors?.byCountry);groups('Causadores procedentes',data.directors?.bySupplier);groups('Negociações fornecedores',data.negotiation?.bySupplier);groups('Negociações países',data.negotiation?.byCountry);}
    else {groups('Top 3 armadores',data.carriers);const universe=data.carrierUniverse||{},topTotal=(data.carriers||[]).reduce((sum,carrier)=>sum+(carrier.total||0),0),topCount=(data.carriers||[]).reduce((sum,carrier)=>sum+(carrier.count||0),0);add('Resumo Armadores',['Indicador','Valor USD','Claims','Armadores'],[['Top 3',topTotal,topCount,(data.carriers||[]).length],['Universo De Armadores',universe.total,universe.count,universe.carrierCount]],[1,2,3]);}
    const rows=tabName(tab)==='carriers'?(data.carriers||[]).flatMap(carrier=>(carrier.byReason||[]).flatMap(group=>filteredDetails(group.rows||[],tableId(carrier.name,group.name)))):data.directors?.rows||[];
    const headers=['Armador','Fornecedor','Motivo','Ordem','Faturamento','Contêiner / NF','Abertura','Dias em aberto','Reclamado USD','Status','Situação','País','SGR','Linha BD'];
    const cells=row=>[row.armador||'',row.supplier,row.reason,row.order,row.invoiceDate||'',row.container||row.nf||'',row.openingDate||'',row.daysOpen,row.claimed,row.pending,row.status,row.country,row.sgr,row.row];
    add('Base Claims',headers,rows.map(cells),[7,8,13]);
    if(tabName(tab)==='directors')add('Base negociações',headers,(data.negotiation?.rows||[]).map(cells),[7,8,13]);
    add('Informações Externas',['Ano','Campo','Valor','Unidade'],FIELDS.map(([key,label,unit])=>[year,label,numeric(external[key]),unit]).concat([[year,'Observação',external.note||'','']]),[0,2]);
    if(wb.Sheets['Informações Externas'].C6?.t==='n')wb.Sheets['Informações Externas'].C6.z='#,##0.00';
    const agreements=Object.entries(external.agreements||{}).flatMap(([supplier,months])=>Object.entries(months||{}).filter(([,count])=>numeric(count)!==null).map(([month,count])=>[year,Number(month),supplier,count]));
    if(agreements.length)add('Acordos informados',['Ano','Mês','Armador','Acordos Finalizados'],agreements,[0,1,3]);
    add('Critérios',['Critério','Descrição'],[['Material',title(tabName(tab))],['Período',period(data.meta)],['Negociações',negotiationPeriod(data)],['Regra de negociação','Situação Em negociação procedente; excluir FUP Suprimentos e interferência externa; Jurídico somente no total separado.'],['Top 3 armadores','Maiores valores USD pendentes em negociação; classificação de armador na BD.'],['Campos externos','Informações digitadas separadamente; não alteram a BD nem o Controle.'],['Precisão','Centavos preservados na base; visuais arredondados.'],['Posição',data.meta?.asOf||'']]);return wb;
  }
  function exportExcel(tab=currentTab) { const name=tabName(tab),data=dataFor(name);if(!data||!canExport())return;try{const wb=workbook(data,name,inputs.periods?.[String(inputYear)]||{},inputYear);global.XLSX.writeFile(wb,`Minerva_${name==='carriers'?'Report_Armadores':'Claims_Diretoria'}_${data.meta?.asOf||'atual'}.xlsx`,{compression:true});return wb;}catch(error){inputError=error.message;render();} }
  if(doc){
    doc.addEventListener('submit',event=>{const filter=event.target.closest('[data-material-filter]'),form=event.target.closest('[data-material-inputs]');if(filter){event.preventDefault();const tab=tabName(filter.dataset.materialFilter),values=id=>global.MinervaMultiSelect?.values(doc.getElementById(id))||Array.from(doc.getElementById(id)?.selectedOptions||[]).map(option=>option.value);states[tab].years=cleanYears(values('materials-'+tab+'-years'));states[tab].months=cleanMonths(values('materials-'+tab+'-months'));render(undefined,tab);}else if(form){event.preventDefault();saveInputs(form);}});
    doc.addEventListener('click',event=>{const button=event.target.closest('[data-material-action]');if(!button)return;const action=button.dataset.materialAction;if(action==='pdf')exportPdf();else if(action==='excel')exportExcel();else if(action==='clear'){states[currentTab].years=[];states[currentTab].months=[];render();}else if(action==='expand'||action==='collapse')button.closest('.materials-base')?.querySelectorAll('.materials-reason').forEach(detail=>detail.open=action==='expand');});
    doc.addEventListener('change',event=>{if(event.target.matches('[data-material-input-year]')){const year=Number(event.target.value);if(Number.isInteger(year)&&year>=2000&&year<=2100){inputYear=year;render();}}else if(event.target.matches('[data-material-agreement-month]')){agreementMonth=Number(event.target.value);render();}});
    doc.addEventListener('toggle',event=>{if(event.target.matches?.('.materials-filters'))states[currentTab].filtersOpen=event.target.open;else if(event.target.matches?.('.materials-editor'))states[currentTab].editorOpen=event.target.open;else if(event.target.matches?.('[data-material-group]')){const id=event.target.dataset.materialGroup;event.target.open?openGroups.add(id):openGroups.delete(id);}},true);
    doc.addEventListener('minerva:session-updated',()=>{if(global.MINERVA_HOSTED!==true)return;const key=profileKey();if(key===sessionKey)return;const identity=profileIdentity(global.MinervaTeam?.getProfile?.()),changedIdentity=Boolean(sessionIdentity&&identity!==sessionIdentity);sessionKey=key;sessionIdentity=identity;sessionVersion++;inputRequest=saveRequest=null;inputsLoaded=inputsLoading=saving=false;inputs={revision:null,periods:{}};inputError='';openGroups.clear();states.directors.editorOpen=states.carriers.editorOpen=false;stopPrint();if(!canRead()||changedIdentity){model=null;for(const name of ['directors','carriers']){const host=doc.getElementById(hostId(name));if(host)host.innerHTML='';}}else if(model)render();});
    global.addEventListener?.('afterprint',stopPrint);
  }
  return {render,exportPdf,exportExcel,getViewState,setViewState,sanitizeViewState,buildPages,workbook,cleanYears,cleanMonths,period,agreementValue,loadInputs};
});
