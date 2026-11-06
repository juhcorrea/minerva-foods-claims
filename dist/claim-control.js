(function(global){
  'use strict';
  const PAGE_SIZE=50,EMPTY='Não informado';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleUpperCase('pt-BR').replace(/\s+/g,' ').trim();
  const number=value=>value===null||value===undefined||String(value).trim()===''?null:Number.isFinite(Number(value))?Number(value):null;
  const integer=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:0});
  const money=value=>number(value)===null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2,minimumFractionDigits:2});
  const days=value=>number(value)===null?'—':Number(value).toLocaleString('pt-BR',{maximumFractionDigits:1});
  const text=value=>String(value??'').trim()||EMPTY;
  const date=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10).split('-').reverse().join('/'):value?String(value):'—';
  const distinct=(rows,key)=>new Set(rows.map(r=>norm(r[key])).filter(v=>v&&v!==norm(EMPTY))).size;
  const byClaimed=(a,b)=>{const first=number(a.claimed),second=number(b.claimed);return first===null?(second===null?0:1):second===null?-1:second-first;};
  const statusRows=(rows,pattern)=>rows.filter(r=>pattern.test(norm(r.status)));
  const fields=[['country','País'],['status','Situação'],['pending','Pendência'],['analyst','Analista']];
  const columns=['SGR / ordem','País','Fornecedor','Situação','Pendência','Dias sem atualização','Reclamado · USD','Linha BD'];
  const types=['text','text','text','text','text','number','number','number'];
  const states={claims:{host:'claimRecords',table:'cc-claims-table',page:1,filters:{},rows:[],view:[]},procurement:{host:'procurementContent',table:'cc-procurement-table',page:1,filters:{},rows:[],view:[]}};
  const mounted=new WeakSet();
  let model=null,dialog=null,procurementDetail=null;

  function selectRows(rows,filters){
    const query=norm(filters.query);
    return rows.filter(r=>fields.every(([key])=>!filters[key]||text(r[key])===filters[key])&&(!filters.supplier||text(r.supplier)===filters.supplier)&&(!query||norm([r.sgr,r.order,r.nf,r.supplier,r.country,r.status,r.pending,r.analyst,r.reason,r.cause,r.armador,r.row].join(' ')).includes(query)));
  }
  function sortValues(row){return [row.sgr||row.order,row.country,row.supplier,row.status,row.pending,number(row.daysWithoutUpdate),number(row.claimed),number(row.row)];}
  function cells(row){
    const reference=row.sgr||row.order||'Ver registro';
    return ['<button type="button" class="cc-record-link" data-cc-detail="'+esc(row.row)+'">'+esc(reference)+'</button>'+(row.order&&row.order!==reference?'<small class="cc-cell-subtext">'+esc(row.order)+'</small>':''),esc(text(row.country)),esc(text(row.supplier)),'<span class="cc-status">'+esc(text(row.status))+'</span>',esc(text(row.pending)),esc(days(row.daysWithoutUpdate)),esc(money(row.claimed)),esc(row.row)];
  }
  function filtered(state){
    const rows=selectRows(state.rows,state.filters).sort(byClaimed);
    return global.MinervaTableFilters?global.MinervaTableFilters.prepare(state.table,columns,rows,cells,state===states.claims?'Controle de claims':'FUP Suprimentos',{types,sortValues}):rows;
  }
  function metric(label,value,sub='',title=''){return '<article class="cc-kpi"'+(title?' title="'+esc(title)+'"':'')+'><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(sub?'<small>'+esc(sub)+'</small>':'')+'</article>';}
  function metrics(rows,scope){
    const validDays=rows.map(r=>number(r.daysWithoutUpdate)).filter(n=>n!==null&&n>=0),oldest=validDays.length?Math.max(...validDays):null;
    const age=metric('Sem atualização',days(oldest),oldest===null?'BL sem informação':'Maior intervalo · dias','Dias sem atualização informados na coluna BL da BD.');
    if(scope==='procurement')return metric('Claims',integer(distinct(rows,'sgr')),'SGR únicos')+metric('Fornecedores',integer(distinct(rows,'supplier')))+metric('Países',integer(distinct(rows,'country')))+age;
    return metric('Claims',integer(distinct(rows,'sgr')),'SGR únicos')+metric('Em negociação',integer(distinct(statusRows(rows,/NEGOCIACAO/),'sgr')),'SGR únicos')+metric('Em análise',integer(distinct(statusRows(rows,/^EM ANALISE$/),'sgr')),'SGR únicos')+metric('Aguardando custos',integer(distinct(statusRows(rows,/^AGUARDANDO CUSTOS$/),'sgr')),'SGR únicos')+age;
  }
  function optionList(rows,key,selected){
    const values=[...new Set(rows.map(r=>text(r[key])))].sort((a,b)=>a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'}));
    if(selected&&!values.includes(selected))values.unshift(selected);
    return '<option value="">Todos</option>'+values.map(v=>'<option value="'+esc(v)+'"'+(v===selected?' selected':'')+'>'+esc(v)+'</option>').join('');
  }
  function filters(state,scope){
    return '<form class="cc-filters" data-cc-form="'+scope+'"><label class="cc-search"><span>Buscar claim</span><input type="search" name="query" value="'+esc(state.filters.query||'')+'" placeholder="SGR, ordem, NF ou fornecedor" autocomplete="off"></label>'+fields.map(([key,label])=>'<label><span>'+label+'</span><select name="'+key+'">'+optionList(state.rows,key,state.filters[key])+'</select></label>').join('')+'<div class="cc-filter-actions"><button type="submit" class="button button-primary">Aplicar</button><button type="button" class="button button-text" data-cc-clear="'+scope+'">Limpar</button></div></form>'+(state.filters.supplier?'<div class="cc-active-supplier">Fornecedor: <strong>'+esc(state.filters.supplier)+'</strong><button type="button" data-cc-clear-supplier="'+scope+'" aria-label="Remover filtro de fornecedor">×</button></div>':'');
  }
  function groups(rows,key){
    const map=new Map();for(const row of rows){const name=text(row[key]);if(!map.has(name))map.set(name,[]);map.get(name).push(row);}
    return [...map].map(([name,items])=>({name,count:distinct(items,'sgr'),lines:items.length})).sort((a,b)=>b.count-a.count||b.lines-a.lines||a.name.localeCompare(b.name,'pt-BR'));
  }
  function groupCard(rows,key,label){
    const list=groups(rows,key);
    return '<section class="cc-group-card"><header><h3>'+label+'</h3><span>SGR únicos</span></header><div class="cc-group-list" tabindex="0" aria-label="'+label+'">'+(list.length?list.map(item=>'<button type="button" data-cc-group="'+key+'" data-cc-value="'+esc(item.name)+'"><span>'+esc(item.name)+'</span><strong>'+integer(item.count)+'</strong></button>').join(''):'<p class="cc-empty">Sem registros</p>')+'</div></section>';
  }
  function table(state,scope){
    const rows=state.view,totalPages=Math.max(1,Math.ceil(rows.length/PAGE_SIZE));state.page=Math.min(Math.max(1,state.page),totalPages);
    const start=(state.page-1)*PAGE_SIZE,visible=rows.slice(start,start+PAGE_SIZE),F=global.MinervaTableFilters;
    const filterText=F?.describe(state.table)||'';
    return '<div class="cc-table-heading"><div><h3>'+(scope==='claims'?'Registros da BD':'Pendências de Suprimentos')+'</h3><span>'+integer(rows.length)+' linhas'+(rows.some(r=>!norm(r.sgr))?' · '+integer(rows.filter(r=>!norm(r.sgr)).length)+' sem SGR':'')+'</span></div><button type="button" class="button secondary" data-cc-export="'+scope+'"'+(!rows.length?' disabled':'')+'>Exportar Excel</button></div>'+(filterText?'<div class="cc-table-criteria"><span>'+esc(filterText)+'</span>'+(F.has(state.table)?'<button type="button" data-clear-table="'+state.table+'">Limpar filtros de coluna</button>':'')+(F.hasSort(state.table)?'<button type="button" data-reset-table-sort="'+state.table+'">Restaurar ordem</button>':'')+'</div>':'')+'<div class="cc-table-wrap table-container" tabindex="0" role="region" aria-label="'+(scope==='claims'?'Registros dos claims':'Pendências de Suprimentos')+'"><table class="cc-table" data-table-id="'+state.table+'"><caption class="sr-only">'+(scope==='claims'?'Controle operacional de claims':'FUP Suprimentos')+'</caption><thead><tr>'+columns.map((label,i)=>'<th scope="col" aria-sort="'+(F?.ariaSort(state.table,i)||'none')+'">'+(F?F.heading(state.table,i,esc(label)):esc(label))+'</th>').join('')+'</tr></thead><tbody>'+(visible.length?visible.map(row=>'<tr'+(row.financialEligible===false?' class="cc-excluded-row"':'')+'>'+cells(row).map((value,i)=>'<td'+(i>=5?' class="cc-number"':'')+'>'+value+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+columns.length+'" class="cc-empty">Nenhum registro neste filtro.</td></tr>')+'</tbody></table></div><div class="cc-pagination"><span>'+(rows.length?integer(start+1)+'–'+integer(Math.min(start+PAGE_SIZE,rows.length))+' de '+integer(rows.length):'0 registros')+'</span><div><button type="button" class="button secondary" data-cc-page="'+scope+'" data-cc-step="-1"'+(state.page<=1?' disabled':'')+'>Anterior</button><span>Página '+state.page+' de '+totalPages+'</span><button type="button" class="button secondary" data-cc-page="'+scope+'" data-cc-step="1"'+(state.page>=totalPages?' disabled':'')+'>Próxima</button></div></div>';
  }
  function renderScope(scope){
    if(scope==='procurement'){renderProcurement();return;}
    const state=states[scope],host=document.getElementById(state.host);if(!host)return;
    state.view=filtered(state);
    host.classList.add('cc-root');
    if(!mounted.has(host)){host.addEventListener('submit',onSubmit);host.addEventListener('click',onClick);mounted.add(host);}
    const excluded=state.view.filter(r=>r.financialEligible===false).length;
    host.innerHTML='<div class="cc-kpis cc-kpis-'+scope+'">'+metrics(state.view,scope)+'</div><section class="cc-panel">'+filters(state,scope)+(scope==='procurement'?'<p class="cc-basis">FUP SUPRIMENTOS fora dos totais e listas. Jurídico somente no agregado.</p>':'')+'</section>'+(scope==='procurement'?'<div class="cc-groups">'+groupCard(state.view,'supplier','Por fornecedor')+groupCard(state.view,'country','Por país')+'</div>':'')+'<section class="cc-panel">'+table(state,scope)+'<p class="cc-basis">'+(excluded?integer(excluded)+' linhas fora do financeiro · ':'')+'Detalhes e critérios ao abrir o SGR. Valores e atualizações preservados da BD.</p></section><p class="cc-feedback" role="status" aria-live="polite"></p>';
    global.MinervaColumnLayout?.refresh();
  }
  function render(currentModel){
    if(model!==currentModel){for(const state of Object.values(states))state.page=1;if(dialog?.open)dialog.close();}
    model=currentModel;
    const rows=Array.isArray(model?.executiveReport?.controlClaims)?model.executiveReport.controlClaims:[];
    states.claims.rows=rows;states.procurement.rows=Array.isArray(model?.procurementReport?.rows)?model.procurementReport.rows.filter(row=>row.included!==false&&row.category!=='legal'):[];
    renderScope('claims');renderScope('procurement');
  }
  function onSubmit(event){
    const form=event.target.closest('[data-cc-form]');if(!form)return;event.preventDefault();
    const scope=form.dataset.ccForm,state=states[scope],data=new FormData(form);
    state.filters={query:String(data.get('query')||''),...Object.fromEntries(fields.map(([key])=>[key,String(data.get(key)||'')])),supplier:state.filters.supplier||''};state.page=1;renderScope(scope);
  }
  function clearColumns(state){
    // The shared filter manager owns per-column selection. Clear only this table.
    const clear=document.querySelector('[data-clear-table="'+state.table+'"]');if(clear)clear.click();
    if(global.MinervaTableFilters?.hasSort(state.table))global.MinervaTableFilters.resetSort(state.table);
  }
  function onClick(event){
    const button=event.target.closest('button');if(!button)return;
    if(button.dataset.ccSupplier!==undefined){showProcurementDetail(button.dataset.ccSupplier,true);return;}
    if(button.dataset.ccReason!==undefined&&procurementDetail){const key=button.dataset.ccReason;procurementDetail.openReasons.has(key)?procurementDetail.openReasons.delete(key):procurementDetail.openReasons.add(key);showProcurementDetail(procurementDetail.supplier);Array.from(dialog.querySelectorAll?.('[data-cc-reason]')||[]).find(el=>el.dataset.ccReason===key)?.focus();return;}
    if(button.dataset.ccReasonPage!==undefined&&procurementDetail){const key=button.dataset.ccReasonPage;procurementDetail.reasonPages.set(key,(procurementDetail.reasonPages.get(key)||1)+Number(button.dataset.ccStep));showProcurementDetail(procurementDetail.supplier);return;}
    if(button.dataset.ccMicroStep){if(procurementDetail){procurementDetail.page+=Number(button.dataset.ccMicroStep);showProcurementDetail(procurementDetail.supplier);}return;}
    if(button.dataset.ccExportSupplier!==undefined){exportFile('procurement',button.dataset.ccExportSupplier);return;}
    if(button.dataset.ccDetail!==undefined){const row=states.claims.rows.find(r=>String(r.row)===button.dataset.ccDetail);if(row)showDetail(row);return;}
    if(button.dataset.ccPage){const state=states[button.dataset.ccPage];state.page+=Number(button.dataset.ccStep);renderScope(button.dataset.ccPage);return;}
    if(button.dataset.ccClear){const scope=button.dataset.ccClear,state=states[scope];state.filters={};state.page=1;clearColumns(state);renderScope(scope);return;}
    if(button.dataset.ccClearSupplier){const scope=button.dataset.ccClearSupplier;delete states[scope].filters.supplier;states[scope].page=1;renderScope(scope);return;}
    if(button.dataset.ccGroup){states.procurement.filters[button.dataset.ccGroup]=button.dataset.ccValue;states.procurement.page=1;renderScope('procurement');return;}
    if(button.dataset.ccExport)exportFile(button.dataset.ccExport);
  }
  function showDetail(row){
    if(!dialog){dialog=document.createElement('dialog');dialog.id='ccDetailDialog';dialog.className='cc-dialog';dialog.setAttribute('aria-labelledby','ccDetailTitle');document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target.closest('[data-cc-close]'))dialog.close();});}
    dialog.classList.remove('cc-procurement-dialog');procurementDetail=null;
    const pairs=[['SGR',row.sgr],['Ordem',row.order],['NF',row.nf],['Fornecedor',row.supplier],['País',row.country],['Operação',row.operation],['Situação',row.status],['Pendência · H',row.pending],['Última posição · I',date(row.lastUpdateDate)],['Dias sem atualização · BL',days(row.daysWithoutUpdate)],['Analista · BE',row.analyst],['Abertura · N',date(row.openingDate)],['Reclamado · USD',money(row.claimed)],['Motivo',row.reason],['Causador',row.cause],['Armador',row.armador],['Linha BD',row.row]];
    dialog.innerHTML='<header class="cc-dialog-heading"><div><span>Controle de claim</span><h2 id="ccDetailTitle">'+esc(row.sgr||row.order||'Registro da BD')+'</h2></div><button type="button" class="cc-close" data-cc-close aria-label="Fechar detalhe">×</button></header><div class="cc-eligibility '+(row.financialEligible===false?'cc-eligibility-excluded':'')+'"><strong>'+(row.financialEligible===false?'Fora do financeiro':'Incluído no financeiro')+'</strong>'+(row.financialEligible===false?'<span>'+esc(row.reasonExcluded||'Conforme critérios do recorte financeiro.')+'</span>':'')+'</div><dl class="cc-detail-grid">'+pairs.map(([key,value])=>'<div><dt>'+esc(key)+'</dt><dd>'+esc(value===null||value===undefined||value===''?'—':value)+'</dd></div>').join('')+'</dl>';
    if(!dialog.open)dialog.showModal();
  }
  const procurementHeaders=['Fornecedor','Claims','Negociações · USD'];
  const microHeaders=['Motivo','Ordem','Data faturamento','Contêiner / NF','Abertura claim','Dias em aberto','Reclamado · USD','Status'];
  const procurementCount=rows=>new Set(rows.map(r=>norm(r.sgr)||'LINHA:'+r.row)).size;
  function todaySaoPaulo(){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(p=>[p.type,p.value]));return parts.year+'-'+parts.month+'-'+parts.day;}
  function dateSerial(value){const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);if(!match)return null;const d=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));return d.toISOString().slice(0,10)===match[1]+'-'+match[2]+'-'+match[3]?d.getTime()/86400000:null;}
  function openDays(row){const opening=dateSerial(row.openingDate),today=dateSerial(todaySaoPaulo());return opening===null||today===null||opening>today?null:today-opening;}
  function aggregateProcurement(rows){
    const map=new Map();for(const row of rows){const supplier=text(row.supplier),key=norm(supplier);if(!map.has(key))map.set(key,{supplier,negotiation:0,legal:0,total:0,claimCount:0,records:[],excluded:0});const group=map.get(key);group.records.push(row);if(row.included===false){group.excluded++;continue;}const value=number(row.claimed)||0;if(row.category==='legal')group.legal+=value;else group.negotiation+=value;group.total+=value;}
    for(const group of map.values())group.claimCount=procurementCount(group.records.filter(r=>r.included!==false));
    return [...map.values()].sort((a,b)=>b.total-a.total||a.supplier.localeCompare(b.supplier,'pt-BR'));
  }
  function procurementCells(group){return ['<button type="button" class="cc-record-link" data-cc-supplier="'+esc(group.supplier)+'">'+esc(group.supplier)+'</button>',integer(group.claimCount),'<strong>'+money(group.negotiation)+'</strong>'];}
  function procurementSelection(){
    const state=states.procurement,groups=aggregateProcurement(selectRows(state.rows,state.filters).sort(byClaimed)),F=global.MinervaTableFilters;
    const view=F?F.prepare(state.table,procurementHeaders,groups,procurementCells,'FUP Suprimentos · fornecedores',{types:['text','number','number'],sortValues:r=>[r.supplier,r.claimCount,r.negotiation]}):groups;
    state.view=view;state.filteredRows=view.flatMap(group=>group.records);return view;
  }
  function procurementFilters(state){return '<form class="cc-filters cc-procurement-filters" data-cc-form="procurement"><label class="cc-search"><span>Buscar</span><input type="search" name="query" value="'+esc(state.filters.query||'')+'" placeholder="Fornecedor, SGR, ordem ou NF" autocomplete="off"></label><label><span>País</span><select name="country">'+optionList(state.rows,'country',state.filters.country)+'</select></label><label><span>Status</span><select name="pending">'+optionList(state.rows,'pending',state.filters.pending)+'</select></label><div class="cc-filter-actions"><button type="submit" class="button button-primary">Aplicar</button><button type="button" class="button button-text" data-cc-clear="procurement">Limpar</button></div></form>';}
  function renderProcurement(){
    const state=states.procurement,host=document.getElementById(state.host);if(!host)return;host.classList.add('cc-root');
    if(!mounted.has(host)){host.addEventListener('submit',onSubmit);host.addEventListener('click',onClick);mounted.add(host);}
    const groups=procurementSelection(),rows=state.filteredRows,F=global.MinervaTableFilters,report=model?.procurementReport||{};
    const negotiation=number(report.negotiationTotal??report.summary?.negotiation),legal=number(report.legalTotal??report.summary?.legal),grand=number(report.grandTotal??report.summary?.total);
    const incomplete=[report.meta?.criteriaIncomplete?'Pendência H indisponível: confira a base.':'',report.meta?.amountIncomplete?'Há valores reclamados ausentes; totais parciais.':''].filter(Boolean);
    const filteredTotal=groups.reduce((n,g)=>n+g.negotiation,0),totalPages=Math.max(1,Math.ceil(groups.length/PAGE_SIZE));state.page=Math.min(Math.max(1,state.page),totalPages);const start=(state.page-1)*PAGE_SIZE,visible=groups.slice(start,start+PAGE_SIZE),description=F?.describe(state.table)||'';
    host.innerHTML='<div class="cc-scope-heading"><span>Carteira aberta · Todos os anos</span><small>Dias em aberto até '+esc(date(todaySaoPaulo()))+'</small></div><div class="cc-kpis cc-kpis-procurement">'+metric('Negociações · USD',money(negotiation))+metric('Jurídico · USD',money(legal))+metric('Total geral · USD',money(grand))+'</div>'+(incomplete.length?'<p class="cc-incomplete" role="status">'+esc(incomplete.join(' '))+'</p>':'')+'<section class="cc-panel">'+procurementFilters(state)+'</section><section class="cc-panel"><div class="cc-table-heading"><div><h3>Negociações por fornecedor</h3><span>Clique no fornecedor para abrir os claims</span></div><button type="button" class="button secondary" data-cc-export="procurement"'+(!rows.length?' disabled':'')+'>Exportar Excel</button></div>'+(description?'<div class="cc-table-criteria"><span>'+esc(description)+'</span>'+(F.has(state.table)?'<button type="button" data-clear-table="'+state.table+'">Limpar filtros de coluna</button>':'')+(F.hasSort(state.table)?'<button type="button" data-reset-table-sort="'+state.table+'">Restaurar ordem</button>':'')+'</div>':'')+'<div class="cc-table-wrap table-container" role="region" tabindex="0" aria-label="Negociações por fornecedor"><table class="cc-table cc-macro-table" data-table-id="'+state.table+'"><caption class="sr-only">FUP Suprimentos: negociações por fornecedor</caption><thead><tr>'+procurementHeaders.map((label,i)=>'<th scope="col" aria-sort="'+(F?.ariaSort(state.table,i)||'none')+'">'+(F?F.heading(state.table,i,esc(label)):esc(label))+'</th>').join('')+'</tr></thead><tbody>'+(visible.length?visible.map(group=>'<tr>'+procurementCells(group).map((cell,i)=>'<td'+(i?' class="cc-number"':'')+'>'+cell+'</td>').join('')+'</tr>').join(''):'<tr><td class="cc-empty" colspan="3">Sem claims abertos neste filtro.</td></tr>')+'</tbody><tfoot><tr><td>Total do filtro</td><td class="cc-number">'+integer(procurementCount(rows))+'</td><td class="cc-number">'+money(filteredTotal)+'</td></tr></tfoot></table></div><div class="cc-pagination"><span>'+integer(groups.length)+' fornecedores</span><div><button type="button" class="button secondary" data-cc-page="procurement" data-cc-step="-1"'+(state.page<=1?' disabled':'')+'>Anterior</button><span>Página '+state.page+' de '+totalPages+'</span><button type="button" class="button secondary" data-cc-page="procurement" data-cc-step="1"'+(state.page>=totalPages?' disabled':'')+'>Próxima</button></div></div><p class="cc-basis">Cards: carteira global. Filtros locais: tabela e Excel. Jurídico somente no total agregado.</p></section><p class="cc-feedback" role="status" aria-live="polite"></p>';
    global.MinervaColumnLayout?.refresh();
  }
  function microCells(row){const age=openDays(row);return [esc(text(row.reason))+(row.included===false?'<small class="cc-exclusion-note" title="'+esc(row.exclusionReason||'Fora dos totais')+'">Fora do total</small>':''),esc(row.order||row.sgr||'—'),esc(date(row.invoiceDate)),esc(row.container||row.nf||'—')+(!row.originalContainer&&row.nf?'<small class="cc-cell-subtext">NF</small>':''),esc(date(row.openingDate)),'<span'+(age!==null&&age<0?' title="Abertura em data futura"':'')+'>'+esc(days(age))+'</span>',esc(money(row.claimed)),esc(text(row.pending))];}
  function detailRows(supplier){const rows=(states.procurement.filteredRows||[]).filter(row=>norm(row.supplier)===norm(supplier)).sort(byClaimed),F=global.MinervaTableFilters;return F?F.prepare('detail-cc-procurement',microHeaders,rows,microCells,'FUP · claims do fornecedor',{types:['text','text','date','text','date','number','number','text'],sortValues:r=>[r.reason,r.order||r.sgr,r.invoiceDate,r.container||r.nf,r.openingDate,openDays(r),number(r.claimed),r.pending]}):rows;}
  function reasonGroups(rows){const map=new Map();for(const row of rows){const label=text(row.reason),key=norm(label);if(!map.has(key))map.set(key,{key,label,rows:[],amount:0,count:0});const group=map.get(key);group.rows.push(row);group.amount+=number(row.claimed)||0;}for(const group of map.values())group.count=procurementCount(group.rows);return [...map.values()].sort((a,b)=>b.amount-a.amount||a.label.localeCompare(b.label,'pt-BR',{sensitivity:'base',numeric:true}));}
  function showProcurementDetail(supplier,fresh=false){
    if(fresh||!procurementDetail){global.MinervaTableFilters?.clearDetails();procurementDetail={supplier,page:1,openReasons:new Set(),reasonPages:new Map()};}
    if(!dialog){dialog=document.createElement('dialog');dialog.id='ccDetailDialog';dialog.className='cc-dialog';document.body.append(dialog);dialog.addEventListener('click',event=>{if(event.target.closest('[data-cc-close]'))dialog.close();});}
    dialog.setAttribute('aria-labelledby','ccDetailTitle');dialog.classList.add('cc-procurement-dialog');if(!dialog.dataset.ccEvents){dialog.addEventListener('click',onClick);dialog.dataset.ccEvents='true';}
    const rows=detailRows(supplier),groups=reasonGroups(rows);procurementDetail.view=rows;const totalPages=Math.max(1,Math.ceil(groups.length/PAGE_SIZE));procurementDetail.page=Math.min(Math.max(1,procurementDetail.page),totalPages);const start=(procurementDetail.page-1)*PAGE_SIZE,visible=groups.slice(start,start+PAGE_SIZE),F=global.MinervaTableFilters;
    const total=rows.reduce((sum,row)=>sum+(number(row.claimed)||0),0),desc=F?.describe('detail-cc-procurement')||'';
    const bodies=visible.map((group,index)=>{const open=procurementDetail.openReasons.has(group.key),pages=Math.max(1,Math.ceil(group.rows.length/PAGE_SIZE)),page=Math.min(Math.max(1,procurementDetail.reasonPages.get(group.key)||1),pages),offset=(page-1)*PAGE_SIZE,id='cc-reason-'+(start+index);procurementDetail.reasonPages.set(group.key,page);
      return '<tbody class="cc-pivot-heading"><tr><td colspan="8"><button type="button" class="cc-pivot-toggle" data-cc-reason="'+esc(group.key)+'" aria-expanded="'+open+'" aria-controls="'+id+'"><span class="cc-pivot-arrow" aria-hidden="true">›</span><strong>'+esc(group.label)+'</strong><span>'+integer(group.count)+' claims'+(group.rows.length!==group.count?' · '+integer(group.rows.length)+' linhas':'')+'</span><b>USD '+money(group.amount)+'</b></button></td></tr></tbody><tbody id="'+id+'" class="cc-pivot-records"'+(open?'':' hidden')+'>'+group.rows.slice(offset,offset+PAGE_SIZE).map(row=>'<tr>'+microCells(row).map((cell,i)=>'<td'+(i===5||i===6?' class="cc-number"':'')+'>'+(i===0?'<span class="cc-pivot-child" title="'+esc(group.label)+'">↳</span>':cell)+'</td>').join('')+'</tr>').join('')+(pages>1?'<tr><td colspan="8"><div class="cc-pagination"><span>'+integer(offset+1)+'–'+integer(Math.min(offset+PAGE_SIZE,group.rows.length))+' de '+integer(group.rows.length)+' linhas deste motivo</span><div><button type="button" class="button secondary" data-cc-reason-page="'+esc(group.key)+'" data-cc-step="-1"'+(page<=1?' disabled':'')+'>Anterior</button><span>'+page+' / '+pages+'</span><button type="button" class="button secondary" data-cc-reason-page="'+esc(group.key)+'" data-cc-step="1"'+(page>=pages?' disabled':'')+'>Próxima</button></div></div></td></tr>':'')+'</tbody>';
    }).join('');
    dialog.innerHTML='<header class="cc-dialog-heading"><div><span>FUP Suprimentos · Todos os anos</span><h2 id="ccDetailTitle">'+esc(supplier)+'</h2></div><button type="button" class="cc-close" data-cc-close aria-label="Fechar detalhe">×</button></header><div class="cc-micro-summary"><strong>'+integer(procurementCount(rows))+' claims · USD '+money(total)+'</strong><span>'+integer(groups.length)+' motivos · Abra um grupo para ver os dados</span><button type="button" class="button secondary" data-cc-export-supplier="'+esc(supplier)+'">Exportar este fornecedor</button></div>'+(desc?'<div class="cc-table-criteria"><span>'+esc(desc)+'</span>'+(F.has('detail-cc-procurement')?'<button type="button" data-clear-table="detail-cc-procurement">Limpar filtros</button>':'')+(F.hasSort('detail-cc-procurement')?'<button type="button" data-reset-table-sort="detail-cc-procurement">Restaurar ordem</button>':'')+'</div>':'')+'<div class="cc-table-wrap table-container" tabindex="0" role="region" aria-label="Claims agrupados por motivo"><table class="cc-table cc-pivot-table" data-table-id="detail-cc-procurement"><caption class="sr-only">Fornecedor, motivos e claims abertos</caption><thead><tr>'+microHeaders.map((label,i)=>'<th scope="col" aria-sort="'+(F?.ariaSort('detail-cc-procurement',i)||'none')+'">'+(F?F.heading('detail-cc-procurement',i,esc(label)):esc(label))+'</th>').join('')+'</tr></thead>'+ (bodies||'<tbody><tr><td colspan="8" class="cc-empty">Sem registros neste filtro.</td></tr></tbody>')+'</table></div><div class="cc-pagination"><span>'+integer(rows.length)+' linhas · Dias em aberto até '+esc(date(todaySaoPaulo()))+'</span>'+(totalPages>1?'<div><button type="button" class="button secondary" data-cc-micro-step="-1"'+(procurementDetail.page<=1?' disabled':'')+'>Anterior</button><span>Página '+procurementDetail.page+' de '+totalPages+' motivos</span><button type="button" class="button secondary" data-cc-micro-step="1"'+(procurementDetail.page>=totalPages?' disabled':'')+'>Próxima</button></div>':'')+'</div>';
    if(!dialog.open)dialog.showModal();global.MinervaColumnLayout?.refresh();
  }
  function procurementWorksheets(wb,worksheet,supplier){
    procurementSelection();const rows=supplier!==undefined?detailRows(supplier):states.procurement.filteredRows,groups=supplier!==undefined?aggregateProcurement(rows):states.procurement.view,state=states.procurement,report=model?.procurementReport||{};
    if(supplier===undefined)worksheet(wb,'FUP Resumo',['Carteira global','USD'],[['Negociações',number(report.negotiationTotal??report.summary?.negotiation)],['Jurídico',number(report.legalTotal??report.summary?.legal)],['Total geral',number(report.grandTotal??report.summary?.total)]]);
    worksheet(wb,'FUP Fornecedores',procurementHeaders,groups.map(g=>[g.supplier,g.claimCount,g.negotiation]));
    const grouped=groups.flatMap(group=>reasonGroups(group.records).map(reason=>({supplier:group.supplier,...reason})));
    worksheet(wb,'FUP Motivos',['Fornecedor','Motivo','Claims','Linhas','Subtotal reclamado · USD'],grouped.map(group=>[group.supplier,group.label,group.count,group.rows.length,group.amount]));
    worksheet(wb,'FUP Claims',['Fornecedor',...microHeaders,'SGR','NF','País','Operação','Linha BD'],grouped.flatMap(group=>group.rows).map(r=>[r.supplier||'',r.reason||'',r.order||'',r.invoiceDate||'',r.container||r.nf||'',r.openingDate||'',openDays(r),number(r.claimed),r.pending||'',r.sgr||'',r.nf||'',r.country||'',r.operation||'',r.row]));
    worksheet(wb,'Critérios FUP',['Critério','Valor'],[['Carteira','Claims em negociação de todos os anos. Filtros globais de operação e fornecedor.'],['Data para dias em aberto',todaySaoPaulo()],['Dias em aberto','Hoje em São Paulo menos a abertura N; ausentes permanecem sem valor e datas futuras ficam para conferência.'],['Origem dos campos','Motivo K; ordem W; faturamento AU; contêiner AG (NF Y na ausência); abertura N; USD AJ; Status H.'],['Resumo','Valores da carteira global. Jurídico aparece somente como valor agregado; não há linhas jurídicas exportadas.'],['Registros','Negociações não jurídicas, sem pendências FUP Suprimentos excluídas pelo relatório. Nenhuma exclusão adicional pela interface.'],['Fornecedor do detalhe',supplier||'Todos do filtro'],['Busca',state.filters.query||'Todas'],['País',state.filters.country||'Todos'],['Status H',state.filters.pending||'Todos'],['Colunas macro',global.MinervaTableFilters?.describe(state.table)||'Nenhum filtro'],['Colunas micro',supplier!==undefined?global.MinervaTableFilters?.describe('detail-cc-procurement')||'Nenhum filtro':'Não aplicado'],['Claims únicos do filtro',procurementCount(rows)],['Contagem por fornecedor','SGR distintos por grupo. Um SGR em mais de um fornecedor participa de cada grupo, mas entra uma vez no total.'],['Linhas exportadas',rows.length],['Preservação','Valores, datas e pendências da BD não são alterados. Todos os registros filtrados são exportados, inclusive outras páginas.']]);
  }
  const exportHeaders=['Linha BD','SGR','Ordem','NF','Fornecedor','País','Operação','Situação','Pendência · H','Última posição · I','Dias sem atualização · BL','Analista · BE','Abertura claim · N','Reclamado · USD','Motivo','Causador','Armador','Incluído no financeiro','Motivo da exclusão'];
  const exportRow=row=>[row.row,row.sgr||'',row.order||'',row.nf||'',row.supplier||'',row.country||'',row.operation||'',row.status||'',row.pending||'',row.lastUpdateDate||'',number(row.daysWithoutUpdate),row.analyst||'',row.openingDate||'',number(row.claimed),row.reason||'',row.cause||'',row.armador||'',row.financialEligible===false?'Não':'Sim',row.reasonExcluded||''];
  function scopes(scope){return scope==='procurement'||scope==='fup'?['procurement']:scope==='claims'||scope==='claim-control'?['claims']:scope==='all'?['claims','procurement']:[];}
  function criteria(scope,rows){
    const state=states[scope],report=model?.executiveReport;
    return [['Origem','BD · Controle operacional'],['Recorte global',report?.meta?.controlClaimBasis||report?.controlClaimBasis||'Período de Data RNC, operações e fornecedor selecionados no painel. Todas as situações e motivos da BD.'],['Registros',rows.length],['Claims · SGR únicos',distinct(rows,'sgr')],['Filtro FUP',scope==='procurement'?'Pendência H contendo FUP SUPRIMENTOS é excluída dos totais e das listas.':'Não aplicado'],['Busca',state.filters.query||'Todas'],...fields.map(([key,label])=>[label,state.filters[key]||'Todos']),['Fornecedor local',state.filters.supplier||'Todos'],['Filtros de coluna',global.MinervaTableFilters?.describe(state.table)||'Nenhum'],['Atualização','Datas I e dias BL informados na BD. Não há prazo ou meta adicional.'],['Financeiro','financialEligible e motivo da exclusão identificam linhas fora do cálculo financeiro. Valores AJ são preservados por linha.'],['Escopo','Todas as linhas do filtro, inclusive outras páginas. Planilha original preservada.']];
  }
  function worksheets(wb,worksheet,scope='all',supplier){
    for(const kind of scopes(scope)){if(kind==='procurement'){procurementWorksheets(wb,worksheet,supplier);continue;}const rows=filtered(states[kind]);worksheet(wb,'Controle de claims',exportHeaders,rows.map(exportRow));worksheet(wb,'Critérios claims',['Critério','Valor'],criteria(kind,rows));}
  }
  function exportFile(scope,supplier){
    const host=document.getElementById(states[scope].host),feedback=host?.querySelector('.cc-feedback');
    try{const X=global.XLSX;if(!X)throw new Error('Exportação indisponível. Recarregue o painel.');const wb=X.utils.book_new();
      worksheets(wb,(book,title,headers,rows)=>{const sheet=X.utils.aoa_to_sheet([headers,...rows]);sheet['!cols']=headers.map((_,i)=>({wch:i===0?12:26}));if(rows.length)sheet['!autofilter']={ref:X.utils.encode_range({r:0,c:0},{r:rows.length,c:headers.length-1})};for(let c=0;c<headers.length;c++)if(/USD/.test(headers[c]))for(let r=1;r<=rows.length;r++){const cell=sheet[X.utils.encode_cell({r,c})];if(cell?.t==='n')cell.z='#,##0.00';}X.utils.book_append_sheet(wb,sheet,title);},scope,supplier);
      X.writeFile(wb,(scope==='claims'?'Controle_Claims':'FUP_Suprimentos')+'_Minerva.xlsx',{compression:true});if(feedback)feedback.textContent='Excel gerado com todos os registros filtrados.';
    }catch(error){if(feedback)feedback.textContent=error.message||'Não foi possível gerar o Excel.';}
  }
  const handlesTable=id=>id==='detail-cc-procurement'||Object.values(states).some(state=>state.table===id);
  function handleFilter(id){if(id==='detail-cc-procurement'&&procurementDetail){procurementDetail.page=1;showProcurementDetail(procurementDetail.supplier);return;}const scope=Object.keys(states).find(key=>states[key].table===id);if(scope){states[scope].page=1;renderScope(scope);}}
  global.MinervaClaimControl={render,handlesTable,handleFilter,worksheets};
})(window);
