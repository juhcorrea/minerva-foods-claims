(function () {
  'use strict';
  const E = window.ClaimsEngine;
  const F = window.MinervaTableFilters;
  let activeDetail=null;
  const applied={supplierSearch:'',installmentSearch:'',typeFilter:'',statusFilter:'',correctionSearch:'',analystFilter:'',correctionProgressFilter:''};
  const filterValue=id=>applied[id]||'';
  const asList=value=>(Array.isArray(value)?value:value?[value]:[]).map(String).filter(Boolean);
  const filterValues=id=>asList(filterValue(id));
  const filterLabel=(id,fallback='Todos')=>filterValues(id).join(' · ')||fallback;
  const progressLabel=()=>filterValues('correctionProgressFilter').map(value=>({done:'Já ajustadas',pending:'Pendentes'})[value]||value).join(' · ')||'Todas';
  const selectValues=el=>{el=typeof el==='string'?$(el):el;return window.MinervaMultiSelect?.values(el)||asList(el?.selectedOptions?Array.from(el.selectedOptions).map(option=>option.value):el?.value);};
  function setSelected(el,values){el=typeof el==='string'?$(el):el;const list=asList(values);if(window.MinervaMultiSelect)return window.MinervaMultiSelect.setValues(el,list);for(const option of Array.from(el.options||[]))option.selected=list.length?list.includes(option.value):option.value==='';}
  const appliedGlobal=key=>state.model?.meta?.[key]??state.appliedGlobal?.[key]??'';
  const appliedGlobalValues=key=>asList(state.model?.meta?.[key+'s']??state.appliedGlobal?.[key+'s']??appliedGlobal(key));
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const wholeFormatter = new Intl.NumberFormat('pt-BR', {minimumFractionDigits:0,maximumFractionDigits:0});
  const exactFormatter = new Intl.NumberFormat('pt-BR', {minimumFractionDigits:2,maximumFractionDigits:2});
  const integerFormatter = new Intl.NumberFormat('pt-BR');
  const money = n => n == null || !Number.isFinite(Number(n)) ? '—' : wholeFormatter.format(Number(n));
  const moneyExact = n => n == null || !Number.isFinite(Number(n)) ? '—' : exactFormatter.format(Number(n));
  const integer = n => integerFormatter.format(Number(n || 0));
  const pct = n => n == null || !Number.isFinite(Number(n)) ? '—' : wholeFormatter.format(n * 100) + '%';
  const date = s => s ? String(s).slice(0,10).split('-').reverse().join('/') : '—';
  const normalize = v => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const state = {bd:null, control:null, bdName:'', controlName:'', model:null, demo:false, view:'overview', supplierMode:'summary', chartMonth:'', chartSupplierBusy:false, operation:'', controlOperation:'', correctionsPage:1, installmentsPage:1, processesPage:1, issuesPage:1, sort:'claimed', direction:-1};
  // User-defined indicator: subtract the sum of received and negotiating.
  const LOSS = window.MINERVA_LOSS_RULE || 'claimed-received-negotiating';
  const comparativeReceived = row => row.receivedComparable ?? row.receivedSameYear ?? row.received;
  const comparativeRate = row => row.claimed ? comparativeReceived(row)/row.claimed : null;
  const byClaimYear = (row,year) => row.receivedByClaimYear?.[year] ?? 0;
  const claimYearDisplayYears=()=>state.model?.meta?.claimYearDisplayYears||E.recentClaimYears();
  const claimYearKeys=()=>['other',...claimYearDisplayYears()];
  const claimYearLabels=()=>['Demais anos',...claimYearDisplayYears().map(year=>'claims '+year)];
  const claimYearValues=row=>claimYearKeys().map(year=>byClaimYear(row,year));
  const amountRank = value => value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value):-Infinity;
  const descendingAmount = (rows,select) => rows.sort((a,b)=>(amountRank(select(b))-amountRank(select(a)))||0);
  const installmentAmount = row => normalize(row.originalStatus||row.status).trim()==='PAGO'?row.received:row.expected;
  const loss = row => !LOSS ? null : LOSS === 'claimed-received-negotiating' ? row.claimed-comparativeReceived(row)-row.negotiating : LOSS === 'claimed-received-plus-negotiating' ? row.claimed-comparativeReceived(row)+row.negotiating : null;
  const lossFormula = () => !LOSS ? 'Cálculo de perda aguardando definição.' : LOSS === 'claimed-received-negotiating' ? 'Perda = Reclamado − (Recebido + Em negociação).' : 'Perda = Reclamado − Recebido + Em negociação.';
  const nextPaint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,30)));
  function say(message,error=false) {const el=$('statusMessage');if(el){el.textContent=message;el.classList.toggle('error',error);}}
  function setText(id,value){if($(id))$(id).textContent=value;}
  function notice(message,error=false){say(message,error);if(error)window.scrollTo({top:0,behavior:'smooth'});}
  function badge(status) {let cls='neutral';if(status==='Pago'||status==='Todas as parcelas pagas')cls='positive';else if(/Vencido|vencidas|prejuízo/i.test(status))cls='negative';else if(/Conferir|conferir/.test(status))cls='warning';return `<span class="badge ${cls}">${esc(status)}</span>`;}
  function linkBadge(status){return badge(({matched:'Vinculado',grouped:'Acordo com várias referências',review:'Conferir vínculo',unmatched:'Sem correspondência'})[status]||status);}
  function blank(message='Nenhum registro neste recorte.'){return `<div class="empty-table">${esc(message)}</div>`;}
  function table(headers,rows,opts={}){
    const id=opts.filterId;
    if(id&&!opts.prepared)rows=F.prepare(id,headers,rows,row=>row,opts.caption,{types:opts.types,sortValues:opts.sortValues?(_row,index)=>opts.sortValues[index]:undefined});
    const cls=i=>opts.numeric?opts.numeric.includes(i)?'num':'text-cell':/USD|%|recebido \/ reclamado|ocorrências|participação|pareto|parcelas no filtro|pagas no filtro|vencidas no filtro|no prazo no filtro|^Linha Excel$|^Linha BD$|^Linha Controle$/i.test(headers[i])?'num':'text-cell';
    const cells=(row,tag='td')=>row.map((cell,i)=>`<${tag} class="${cls(i)}">${cell}</${tag}>`).join('');
    return (id?F.summary(id):'')+`<table${id?' data-table-id="'+esc(id)+'"':''}><caption class="sr-only">${esc(opts.caption||'Dados da análise')}</caption><thead><tr>${headers.map((h,i)=>`<th scope="col" class="${cls(i)}"${id?' aria-sort="'+F.ariaSort(id,i)+'"':''}>${id?F.heading(id,i,h):h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${cells(row)}</tr>`).join(''):`<tr class="table-empty-row"><td colspan="${headers.length}">${esc(opts.empty||'Nenhum registro neste filtro. Use os títulos das colunas ou Limpar filtros para ajustar.')}</td></tr>`}</tbody>${opts.footer?`<tfoot><tr>${cells(opts.footer)}</tr></tfoot>`:''}</table>`;
  }
  function paged(containerId,headers,rows,pageKey,caption){
    const el=$(containerId);if(!el)return;const size=state.printing?Math.max(rows.length,1):60,totalPages=Math.max(1,Math.ceil(rows.length/size));state[pageKey]=Math.max(1,Math.min(state[pageKey],totalPages));const page=state[pageKey];
    el.innerHTML=table(headers,rows.slice((page-1)*size,page*size),{caption,filterId:containerId,prepared:true})+(rows.length>size?`<div class="pagination"><span>${integer(rows.length)} registros · página ${page} de ${totalPages}</span><button class="button secondary" data-page-key="${pageKey}" data-page="${page-1}" ${page<=1?'disabled':''}>Anterior</button><button class="button secondary" data-page-key="${pageKey}" data-page="${page+1}" ${page>=totalPages?'disabled':''}>Próxima</button></div>`:'');
  }
  const controlModel = () => state.model?.controlReport || state.model;
  const controlOperationLabel = () => controlModel()?.meta?.operation || 'Todas as operações';
  function captureOperation(){if(!['analysts','meeting','portfolio'].includes(state.view)){const key=state.view==='installments'?'controlOperation':'operation';state[key+'s']=selectValues('operationFilter');state[key]=state[key+'s'].join(' · ');}}
  function populateOperations(){
    const isControl=state.view==='installments',key=isControl?'controlOperations':'operations',el=$('operationFilter');
    const values=isControl?(state.model?.controlReport?.operationOptions||[]):(state.model?.operationOptions||[]);
    el.innerHTML='<option value="">'+'Todas as operações'+'</option>'+values.map(value=>'<option value="'+esc(value)+'">'+esc(value)+'</option>').join('');
    for(const value of asList(state[key]))if(!values.includes(value))el.add(new Option(value,value));
    setSelected(el,state[key]);
    el.setAttribute('aria-label',isControl?'Operação do Controle de recebimento':'Operação do comparativo');
    setText('yearFilterLabel',isControl?'Ano do recebimento · R':'Ano do claim e do recebimento');
    setText('sidebarScope',state.view==='portfolio'?'Claims · Gestão de ressarcimentos':['meeting','analysts'].includes(state.view)?'Todas as operações · Recebimentos':isControl?'Todas as operações · Controle':(state.operation||'Claims · Todas as operações'));
    setText('breadcrumbScope',state.view==='portfolio'?'Claims':['meeting','analysts','installments'].includes(state.view)?'Recebimentos':'Claims');
  }
  function view(name){
    if(!document.getElementById('view-'+name))return;
    const changed=name!==state.view;
    if(changed){filterScope().draft=readFilterDraft();state.viewVersion=(state.viewVersion||0)+1;state.detailRequestVersion=(state.detailRequestVersion||0)+1;if(state.detailLoading&&$('detailDialog')?.open)$('detailDialog').close();}
    window.scrollTo?.({top:0,left:0,behavior:'instant'});
    if(!changed)captureOperation();state.view=name;document.body.dataset.activeView=name;if(changed)restoreFilterDraft(filterScope().draft);else populateOperations();
    document.querySelectorAll('[id^="view-"]').forEach(el=>el.hidden=el.id!==`view-${name}`);
    document.querySelectorAll('[data-view]').forEach(el=>{const active=el.dataset.view===name;el.classList.toggle('active',active);if(active)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
    setText('viewLabel',({overview:'Visão geral',suppliers:'Fornecedores',installments:'Controle de recebimento',corrections:'Correção de base',claims:'Controle de claim',procurement:'FUP suprimentos',method:'Critérios da análise',analysts:'Recebimento por analista',meeting:'Reunião de resultados',portfolio:'Conheça o painel'})[name]);
    setText('appTitle',name==='overview'?'Indicadores Claim':$('viewLabel').textContent);
    const receiptView=['installments','analysts','meeting'].includes(name);
    $('receiptViews').hidden=!receiptView;
    document.querySelector('.main-nav [data-view="installments"]').classList.toggle('active',receiptView);
    document.querySelector('.main-nav [data-view="installments"]').toggleAttribute('aria-current',receiptView);
    if(receiptView)document.querySelector('.main-nav [data-view="installments"]').setAttribute('aria-current','page');
    const independent=['analysts','meeting','portfolio'].includes(name);
    document.querySelector('.filters-panel').hidden=independent;$('periodLabel').hidden=independent||name==='procurement';
    document.querySelector('.year-selector').hidden=['suppliers','procurement'].includes(name);$('asOf').closest('label').hidden=name==='procurement';
    if($('supplierYearField'))$('supplierYearField').hidden=name!=='suppliers';
    if($('supplierStatusField'))$('supplierStatusField').hidden=name!=='suppliers';
    document.body.classList.toggle('presentation-workspace',['meeting','portfolio'].includes(name));
    const scopeReady=refreshViewScope();
    if(scopeReady||!state.model){
      try{renderView(name);}catch(error){notice(error.message||'Não foi possível exibir esta aba.',true);refreshViewScope();}
    }
    if(!state.model&&!['overview','method','portfolio'].includes(name))say('Importe as duas planilhas para consultar esta visão.');
    const activeScope=state.analysisBusy&&state.requestedOptions?state.requestedOptions:state.model?.meta;
    if(!state.restoringView && state.model && (!sameReportScope(activeScope,filterScope().desired)||!reportSupportsView(activeScope,name)))analyze({fromNavigation:true});
  }
  function cleanYears(values){return [...new Set(asList(values).map(Number).filter(year=>Number.isInteger(year)&&year>=2000&&year<=2200))].sort((a,b)=>a-b);}
  function globalYears(){return cleanYears([...document.querySelectorAll('input[name="year"]:checked')].map(el=>el.value));}
  function requestedYearScope(name=state.view){const years=name==='suppliers'?cleanYears(state.supplierYears):globalYears();return {years:years.length?years:globalYears(),allYears:name==='suppliers'&&!years.length};}
  function sameYearScope(actual,expected){return Boolean(actual)&&Boolean(actual.allYears)===expected.allYears&&(expected.allYears||cleanYears(actual.years).join(',')===cleanYears(expected.years).join(','));}
  function reportSupportsView(meta,name=state.view){return name==='suppliers'||meta?.reportView!=='suppliers';}
  // Each pane owns its applied scope and its unfinished form edits. Navigation
  // loads the last requested scope, never silently applies another pane's draft.
  function normalizedFilters(value={}){
    const list=(plural,singular)=>asList(value[plural]??value[singular]);
    return {years:cleanYears(value.years),allYears:value.allYears===true,asOf:String(value.asOf||''),suppliers:list('suppliers','supplier'),operations:list('operations','operation'),controlOperations:list('controlOperations','controlOperation'),claimStatuses:list('claimStatuses','claimStatus'),correctionScenario:value.correctionScenario==='original'?'original':'corrected'};
  }
  function filterScope(name=state.view){
    const scopes=state.viewFilters||(state.viewFilters={});
    if(!state.filterDefaults)state.filterDefaults=normalizedFilters({years:globalYears(),asOf:state.model?.meta?.asOf||$('asOf')?.value});
    if(!scopes[name]){
      const defaults=normalizedFilters({...state.filterDefaults,allYears:name==='suppliers'&&!state.supplierYears?.length,...(name==='suppliers'&&state.supplierYears?.length?{years:state.supplierYears}:{})});
      const initial=!Object.keys(scopes).length&&name===state.view&&state.model&&sameYearScope(state.model.meta,defaults)?normalizedFilters({...defaults,...state.model.meta}):defaults;
      scopes[name]={draft:normalizedFilters(initial),desired:normalizedFilters(initial),applied:!Object.keys(scopes).length&&state.model?normalizedFilters(initial):null};
    }
    return scopes[name];
  }
  function readFilterDraft(){
    captureOperation();captureSupplierYears();
    return normalizedFilters({...requestedYearScope(),asOf:$('asOf')?.value,suppliers:selectValues('supplierFilter'),operations:state.operations,controlOperations:state.controlOperations,claimStatuses:state.view==='suppliers'?selectValues('supplierStatusFilter'):[],correctionScenario:$('correctionScenario')?.value});
  }
  function restoreFilterDraft(value){
    const draft=normalizedFilters(value);
    if(state.view==='suppliers')state.supplierYears=draft.allYears?[]:draft.years;
    else document.querySelectorAll('input[name="year"]').forEach(el=>el.checked=draft.years.includes(Number(el.value)));
    $('asOf').value=draft.asOf;$('correctionScenario').value=draft.correctionScenario;
    state.operations=draft.operations;state.controlOperations=draft.controlOperations;state.operation=draft.operations.join(' · ');state.controlOperation=draft.controlOperations.join(' · ');state.claimStatuses=draft.claimStatuses;
    for(const value of draft.suppliers)if(!Array.from($('supplierFilter').options||[]).some(option=>option.value===value))$('supplierFilter').add(new Option(value,value));
    setSelected('supplierFilter',draft.suppliers);populateOperations();populateSupplierYears();populateSupplierStatuses();window.MinervaMultiSelect?.refresh?.();
  }
  function sameReportScope(actual,expected){
    if(!sameYearScope(actual,expected))return false;
    const a=normalizedFilters(actual),b=normalizedFilters(expected),key=values=>[...new Set(values.map(value=>String(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase()))].sort().join('\u001f');
    return a.asOf===b.asOf&&a.correctionScenario===b.correctionScenario&&['suppliers','operations','controlOperations','claimStatuses'].every(field=>key(a[field])===key(b[field]));
  }
  function tableOwner(id){return id.startsWith('supplier-')?'suppliers':id==='overviewTable'?'overview':['installmentTable','processTable'].includes(id)?'installments':['correctionTable','issueTable'].includes(id)||id.startsWith('correction-')?'corrections':id.startsWith('cc-claims')?'claims':id.startsWith('cc-')?'procurement':id.startsWith('analyst')?'analysts':id.startsWith('meeting')?'meeting':null;}
  function clearActiveTableFilters(){
    if(!F.exportState||!F.importState){F.clear();return;}
    F.importState({tables:F.exportState().tables.filter(table=>tableOwner(table.id)!==state.view&&!table.id.startsWith('detail-'))});
  }
  function populateSupplierStatuses(model=state.model){
    const select=$('supplierStatusFilter');if(!select?.multiple)return;
    const selected=state.claimStatuses||[],values=[...new Set([...(model?.claimStatusOptions||[]),...selected])].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    select.innerHTML='<option value="">Todas as situações</option>'+values.map(value=>'<option value="'+esc(value)+'">'+esc(value)+'</option>').join('');setSelected(select,selected);
  }
  function localFilterIds(name=state.view){return name==='suppliers'?['supplierSearch']:name==='installments'?['installmentSearch','typeFilter','statusFilter']:name==='corrections'?['correctionSearch','analystFilter','correctionProgressFilter']:[];}
  function setupSupplierStatuses(){
    const anchor=$('supplierYearField');if(!anchor||$('supplierStatusFilter'))return;
    const field=document.createElement('label'),label=document.createElement('span'),select=document.createElement('select');field.id='supplierStatusField';field.className='filter-field';field.hidden=state.view!=='suppliers';label.textContent='Situação do claim';select.id='supplierStatusFilter';select.multiple=true;select.setAttribute('data-multi-select','');select.setAttribute('aria-label','Situação do claim');select.dataset.placeholder='Todas as situações';select.dataset.filterTitle='Situação do claim';select.dataset.applyTarget='#applyFilters';select.addEventListener('change',()=>{state.claimStatuses=selectValues(select);});field.append(label,select);anchor.parentElement.insertBefore(field,anchor.nextSibling);populateSupplierStatuses();
  }
  function captureSupplierYears(){const select=$('supplierYearFilter');if(state.view==='suppliers'&&select?.multiple)state.supplierYears=cleanYears(selectValues(select));}
  function populateSupplierYears(model=state.model){
    const select=$('supplierYearFilter');if(!select?.multiple)return;
    if(model?.meta?.allYears)state.supplierYearOptions=cleanYears(model.meta.years);
    const years=cleanYears([...(state.supplierYearOptions||[]),...[...document.querySelectorAll('input[name="year"]')].map(el=>el.value),...(state.supplierYears||[])]).reverse();
    select.innerHTML='<option value="">Todos os anos</option>'+years.map(year=>'<option value="'+year+'">'+year+'</option>').join('');setSelected(select,cleanYears(state.supplierYears));
  }
  function setupSupplierYears(){
    const anchor=document.querySelector('.year-selector');if(!anchor||$('supplierYearFilter'))return;
    const field=document.createElement('label'),label=document.createElement('span'),select=document.createElement('select');field.id='supplierYearField';field.className='filter-field supplier-year-field';field.hidden=state.view!=='suppliers';label.textContent='Ano dos fornecedores';select.id='supplierYearFilter';select.multiple=true;select.setAttribute('data-multi-select','');select.setAttribute('aria-label','Ano dos fornecedores');select.dataset.placeholder='Todos os anos';select.dataset.filterTitle='Ano dos fornecedores';select.dataset.applyTarget='#applyFilters';select.addEventListener('change',()=>{state.supplierYears=cleanYears(selectValues(select));});field.append(label,select);anchor.parentElement.insertBefore(field,anchor.nextSibling);populateSupplierYears();
  }
  function renderView(name=state.view,force=false){
    if(!state.model){state.renderedViews?.clear();if(!['overview','method'].includes(name))renderViewBody(name);return false;}
    // Stamps are numbers: hidden panes do not retain previous large model objects.
    const identities=state.renderModelIdentities||(state.renderModelIdentities=new WeakMap());
    if(!identities.has(state.model))identities.set(state.model,state.renderModelSerial=(state.renderModelSerial||0)+1);
    const key=identities.get(state.model),views=state.renderedViews||(state.renderedViews=new Map()),modules=state.renderedModules||(state.renderedModules={});
    const needsExecutive=['overview','claims'].includes(name),needsClaims=['claims','procurement'].includes(name);
    if(!force&&views.get(name)===key&&(!needsExecutive||modules.executive===key)&&(!needsClaims||modules.claims===key))return true;
    state.scopeRenderPending=true;refreshViewScope();
    renderViewBody(name);
    views.set(name,key);if(needsExecutive)modules.executive=key;if(needsClaims)modules.claims=key;
    state.scopeRenderPending=false;refreshViewScope();return true;
  }
  function viewScopeMatches(){
    return Boolean(state.model)&&!state.scopeRenderPending&&sameReportScope(state.model.meta,filterScope().desired)&&reportSupportsView(state.model.meta);
  }
  function refreshViewScope(){
    const ready=viewScopeMatches(),blocked=Boolean(state.model&&!ready)||Boolean(!state.model&&(state.analysisBusy||state.scopeLoadFailed));
    document.querySelectorAll('[id^="view-"]').forEach(el=>el.hidden=el.id!=='view-'+state.view||blocked);
    for(const id of ['exportReport','exportCorrections','exportPdf','exportControl','exportControlPdf','exportRules'])if($(id))$(id).disabled=!ready||Boolean(state.exportBookPending);
    let banner=$('viewScopeNotice');
    if(blocked&&!banner){
      const main=document.querySelector('main');
      if(main){
        banner=document.createElement('section');banner.id='viewScopeNotice';banner.className='scope-load-notice';banner.setAttribute('role','status');banner.setAttribute('aria-live','polite');
        const copy=document.createElement('div'),title=document.createElement('strong'),text=document.createElement('p'),retry=document.createElement('button');
        title.id='viewScopeTitle';text.id='viewScopeText';retry.id='viewScopeRetry';retry.type='button';retry.className='button button-outline';retry.textContent='Tentar novamente';retry.addEventListener('click',()=>analyze());
        copy.append(title,text);banner.append(copy,retry);const anchor=$('receiptViews');main.insertBefore(banner,anchor?.parentElement===main?anchor:main.firstChild);
      }
    }
    if(banner){
      banner.hidden=!blocked;
      if(blocked){
        const waiting=Boolean(state.analysisBusy);
        if($('viewScopeTitle'))$('viewScopeTitle').textContent=waiting?'Atualizando o recorte desta aba…':'Não foi possível atualizar este recorte.';
        if($('viewScopeText'))$('viewScopeText').textContent=waiting?'Os valores serão exibidos quando a atualização terminar.':'Tente novamente para consultar os valores desta aba.';
        if($('viewScopeRetry'))$('viewScopeRetry').disabled=waiting;
      }
    }
    return ready;
  }
  const currentScenario = () => state.model?.meta?.correctionScenario || state.appliedGlobal?.correctionScenario || 'corrected';
  const scenarioLabel = () => currentScenario()==='original' ? 'Sem correções · base original do Controle' : 'Com correções da BD';
  function renderScenarioStatus(){
    const original=currentScenario()==='original',pending=$('correctionScenario').value!==currentScenario();
    const label=scenarioLabel();
    setText('scenarioStatus',pending?'Alteração pendente · aplicar filtros':label+(state.scenarioFiltersReset?' · filtros de colunas limpos':''));
    $('scenarioStatus').title=original?'Fornecedor, ano e mercado originais do Controle. Valor T e data R preservados.':'Fornecedor, ano e mercado conferidos com a BD. Valor T e data R preservados.';
    $('scenarioStatus').classList.toggle('scenario-original',original);$('scenarioStatus').classList.toggle('scenario-pending',pending);
  }
  async function setCorrectionScenario(value){
    if(!['original','corrected'].includes(value))return;
    const origin=state.view,version=state.viewVersion||0;
    $('correctionScenario').value=value;renderScenarioStatus();await analyze();
    if(state.view!==origin||(state.viewVersion||0)!==version)return;
    if(currentScenario()!==value){$('correctionScenario').value=currentScenario();renderScenarioStatus();window.MinervaCorrectionImpact?.render(state.model);}
  }
  function openImports(){const d=$('importDialog');if(!d.open)d.showModal();}
  function options(intent={}){const scope=filterScope();scope.draft=readFilterDraft();if(!intent.useDesired)scope.desired=normalizedFilters(scope.draft);const value={...normalizedFilters(scope.desired),claimStatuses:state.view==='suppliers'?asList(scope.desired.claimStatuses):[],lossFormula:'subtract-negotiating',reportView:state.view==='suppliers'&&!state.bd&&!state.control?'suppliers':'full'};state.requestedOptions={...value};return value;}
  function appliedReportOptions(){
    const meta=state.model?.meta||{},previous=state.appliedGlobal||{},selections=(plural,singular)=>asList(meta[plural]??previous[plural]??meta[singular]??previous[singular]);
    return {years:cleanYears(meta.years??previous.years),allYears:meta.allYears===true,asOf:meta.asOf??previous.asOf,suppliers:selections('suppliers','supplier'),operations:selections('operations','operation'),controlOperations:selections('controlOperations','controlOperation'),claimStatuses:selections('claimStatuses','claimStatus'),correctionScenario:meta.correctionScenario||previous.correctionScenario||'corrected',lossFormula:'subtract-negotiating',reportView:'full'};
  }
  async function ensureFullModel(){
    if(!viewScopeMatches())return false;
    if(state.model.meta.reportView!=='suppliers')return true;
    if(state.analysisBusy||typeof state.serverLoader!=='function')return false;
    const source=state.model,origin=state.view,viewVersion=state.viewVersion||0;
    if(state.fullReportLoad?.source===source)return state.fullReportLoad.promise;
    const task={source};state.fullReportLoad=task;
    task.promise=(async()=>{
      try{
        const opts=appliedReportOptions();state.requestedOptions={...opts};
        const loaded=await state.serverLoader(opts);
        return loaded===true&&state.view===origin&&(state.viewVersion||0)===viewVersion&&!state.analysisBusy&&viewScopeMatches()&&state.model.meta.reportView!=='suppliers';
      }catch{return false;}
      finally{if(state.fullReportLoad===task)state.fullReportLoad=null;}
    })();
    return task.promise;
  }
  async function readFile(file,kind){
    if(!file)return;
    if(file.size>32*1024*1024)throw new Error('O arquivo excede 32 MB. Selecione um arquivo Excel menor.');
    const sheetName=kind==='bd'?'BD':'Controle Recebimento';
    const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,cellFormula:false,cellHTML:false,sheets:[sheetName]});
    const sheet=wb.Sheets[sheetName];if(!sheet)throw new Error(`A aba “${sheetName}” não foi encontrada em ${file.name}.`);
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:true});
    if(wb.Workbook?.WBProps?.date1904){const cols=kind==='bd'?[1]:[13,17];for(let i=1;i<rows.length;i++)for(const c of cols)if(typeof rows[i][c]==='number')rows[i][c]+=1462;}
    E.validateHeaders(rows,sheetName);if(rows.length<2)throw new Error(`A aba “${sheetName}” não contém registros.`);
    state[kind]=rows;state[kind+'Name']=file.name;setText(kind==='bd'?'bdFileInfo':'controlFileInfo',`${file.name} · ${integer(rows.length-1)} linhas · aba ${sheetName}`);
    return rows;
  }
  async function fileChanged(event,kind){
    const file=event.target.files[0];if(!file)return;
    if(state.demo){state.bd=state.control=null;state.demo=false;setText('bdFileInfo','Nenhum arquivo selecionado');setText('controlFileInfo','Nenhum arquivo selecionado');}
    invalidateAnalysis();
    const button=$('runAnalysis');button.disabled=true;
    try{setText(kind==='bd'?'bdFileInfo':'controlFileInfo','Lendo a planilha…');await nextPaint();await readFile(file,kind);say('Arquivo conferido. Carregue as duas planilhas para analisar.');}
    catch(e){state[kind]=null;setText(kind==='bd'?'bdFileInfo':'controlFileInfo',e.message);say(e.message,true);}
    finally{button.disabled=!(state.bd&&state.control);}
  }
  function invalidateAnalysis(){state.chartMonth='';F.clear();window.MinervaColumnLayout?.resetAll();window.MinervaAnalysts?.clear();window.MinervaCorrectionImpact?.clear();window.MinervaMeetings?.clear();window.MinervaPortfolio?.clear();window.MinervaPresentation?.close();state.model=null;$('loadedContent').hidden=true;$('emptyState').hidden=false;$('demoBanner').hidden=true;$('exportReport').disabled=$('exportCorrections').disabled=$('exportPdf').disabled=$('exportControl').disabled=$('exportControlPdf').disabled=true;['supplierTable','installmentTable','processTable','processSummary','correctionTable','issueTable'].forEach(id=>{if($(id))$(id).innerHTML=blank('Carregue e analise as duas planilhas para atualizar os dados.');});setText('correctionBadge','0');setText('correctionCount','0');setText('issueCount','0');$('dynamicMethod')?.remove();document.dispatchEvent(new CustomEvent('minerva:model-updated'));}
  function acceptScenarioModel(model){
    const scope=filterScope();
    if(!sameReportScope(model?.meta,scope.desired)||!reportSupportsView(model?.meta)){state.scopeRefreshPending=!state.fullReportLoad||Boolean(state.analysisBusy);return false;}
    if(scope.applied && scope.applied.correctionScenario !== (model.meta?.correctionScenario||'corrected')){
      clearActiveTableFilters();if(state.view==='installments')state.chartMonth='';state.scenarioFiltersReset=true;
    }
    scope.applied=normalizedFilters(model.meta);state.modelView=state.view;
    state.model=model;
    state.scopeRenderPending=true;
    state.scopeRefreshPending=false;
    return true;
  }
  function refreshScopeWhenReady(){if(state.scopeRefreshPending&&!state.analysisBusy){state.scopeRefreshPending=false;queueMicrotask(()=>analyze({fromNavigation:true}));}}
  async function analyze(intent={}){
    const remote=!state.bd&&!state.control&&typeof state.serverLoader==='function';
    const opts=options({useDesired:intent.fromNavigation===true});
    if(state.analysisBusy&&!remote){state.scopeRefreshPending=true;return false;}
    const version=state.analysisVersion=(state.analysisVersion||0)+1;
    state.scopeRefreshPending=false;
    state.scopeLoadFailed=false;
    if(!state.analysisBusy){
      const controls=[...document.querySelectorAll('.filters-panel input,.filters-panel select,.filters-panel button,#correctionOriginalToggle')];
      state.analysisControls=controls.map(control=>({control,disabled:control.disabled}));
      controls.forEach(control=>control.disabled=true);
    }
    state.analysisBusy=true;refreshViewScope();document.dispatchEvent(new CustomEvent('minerva:analysis-state',{detail:{busy:true}}));
    try{const result=await performAnalysis(opts);if(version===state.analysisVersion)state.scopeLoadFailed=Boolean(remote&&result===false&&!state.model);return result;}
    catch(error){if(version===state.analysisVersion){state.scopeLoadFailed=Boolean(remote&&!state.model);notice(error.message||'Não foi possível atualizar a análise.',true);}return false;}
    finally{
      if(version===state.analysisVersion){
        state.analysisBusy=false;
        for(const {control,disabled}of state.analysisControls||[])if(control.isConnected)control.disabled=disabled;
        state.analysisControls=null;
        refreshViewScope();
        document.dispatchEvent(new CustomEvent('minerva:analysis-state',{detail:{busy:false}}));
        refreshScopeWhenReady();
      }
    }
  }
  async function performAnalysis(opts=options()){
    if(!state.bd||!state.control){if(!state.bd&&!state.control&&state.serverLoader)return state.serverLoader(opts);openImports();return;}
    if(!opts.years.length){notice('Selecione pelo menos um ano para a análise.',true);return;}if(!opts.asOf){notice('Informe a data da análise.',true);return;}
    $('loadingOverlay').hidden=false;
    try{await nextPaint();if(!acceptScenarioModel(E.analyze(state.bd,state.control,opts)))return false;state.appliedGlobal={...opts};state.correctionsPage=state.installmentsPage=state.processesPage=state.issuesPage=1;
      $('emptyState').hidden=true;$('loadedContent').hidden=false;$('demoBanner').hidden=!state.demo;
      if($('importDialog').open)$('importDialog').close();
      populateSuppliers();render();state.scopeRenderPending=false;refreshViewScope();document.dispatchEvent(new CustomEvent('minerva:model-updated'));
      say(`${state.demo?'Demonstração fictícia. ':''}${integer(state.model.summary.recordCount)} registros da BD no recorte; ${integer(state.model.meta.linkedControlRows)} parcelas vinculadas. ${state.model.summary.reviewCount?'Há referências para conferir antes de fechar os totais.':'Conciliação concluída.'}`);
      return true;
    }catch(e){notice(e.message||'Não foi possível analisar os arquivos.',true);return false;}
    finally{$('loadingOverlay').hidden=true;}
  }
  function populateSuppliers(){
    const el=$('supplierFilter'),selected=selectValues(el);const raw=[...(state.bd?state.bd.slice(1).map(r=>String(r[28]||'').trim()).filter(Boolean):state.supplierOptions||[]),...(state.control?state.control.slice(1).map(r=>String(r[10]||'').trim()).filter(Boolean):[]),...(state.model?.controlReport?.supplierOptions||[]),...(state.model?.suppliers||[]).map(s=>s.name)];const values=[...new Set(raw)].sort((a,b)=>a.localeCompare(b,'pt-BR'));
    el.innerHTML='<option value="">Todos os fornecedores</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');setSelected(el,selected);
  }
  function supplierButton(name){return `<button class="table-action" data-supplier-detail="${esc(name)}">${esc(name)}</button>`;}
  function supplierCells(s){return [supplierButton(s.name),money(s.claimed),...claimYearValues(s).map(money),money(comparativeReceived(s)),`<span class="rate-value">${pct(comparativeRate(s))}</span><span class="progress-bar" aria-hidden="true"><span style="width:${Math.max(0,Math.min(100,(comparativeRate(s)||0)*100))}%"></span></span>`,money(loss(s)),pct(s.claimed?loss(s)/s.claimed:null),money(s.negotiating),integer(s.occurrences),pct(s.share),pct(s.pareto),moneyExact(s.openBalance),moneyExact(s.overdueBalance),s.reviewCount?`<span class="badge warning">${integer(s.reviewCount)} a conferir</span>`:'—'];}
  const supplierHeaders=()=>['Fornecedor / causador','Reclamado · USD',...claimYearLabels().map(label=>'Recebido · '+label+' · USD'),'Total recebido · claims do período · USD','Recebido / reclamado','Perda · USD','% Perda','Em negociação · USD','SGRs preenchidos · por linha','Participação','Pareto acumulado','Saldo em aberto · Controle · USD','Vencido · Controle · USD','Conferência'];
  const SUP_SORT_TYPES=['text',...Array(15).fill('number')];
  const supplierSortValues=s=>[s.name,s.claimed,...claimYearValues(s),comparativeReceived(s),comparativeRate(s),loss(s),s.claimed?loss(s)/s.claimed:null,s.negotiating,s.occurrences,s.share,s.pareto,s.openBalance,s.overdueBalance,s.reviewCount];
  const SUP_SORT={types:SUP_SORT_TYPES,sortValues:supplierSortValues};
  const supplierOpenTotals=()=>state.model.supplierOpenReport?.meta||state.model.summary;
  const earliestDate=values=>(values||[]).flatMap(v=>String(v||'').split(/[;·]/)).map(v=>E.parseDate(v.trim())).filter(Boolean).sort()[0]||null;
  function supplierFooter(){const s=state.model.summary,o=supplierOpenTotals();return ['Total do recorte',money(s.claimed),...claimYearValues(s).map(money),money(comparativeReceived(s)),pct(comparativeRate(s)),money(loss(s)),pct(s.claimed?loss(s)/s.claimed:null),money(s.negotiating),integer(s.occurrences),s.claimed?'100%':'—',s.claimed?'100%':'—',moneyExact(o.openBalance),moneyExact(o.overdueBalance),integer(s.reviewCount)];}
  function render(force=false){
    const draftOperations=state.fullReportLoad&&!state.analysisBusy?selectValues('operationFilter'):null;
    const m=state.model,s=m.summary;renderScenarioStatus();populateOperations();populateSupplierYears(m);populateSupplierStatuses(m);
    if(state.view==='installments'&&state.chartMonth&&!m.meta.years.includes(Number(state.chartMonth.slice(0,4))))state.chartMonth='';
    setText('periodLabel',`${m.meta.allYears?'Todos os anos':m.meta.years.join(' + ')} · posição em ${date(m.meta.asOf)}`);const reviewCount=m.meta.reportView==='suppliers'?m.meta.correctionQueueCount:reviewQueue().length;setText('correctionBadge',integer(reviewCount));setText('correctionCount',integer(reviewCount));setText('issueCount',integer(s.reviewCount));
    const badge=$('correctionBadge');if(badge){badge.hidden=!reviewCount;badge.title=`${integer(reviewCount)} referências para conferir`;badge.setAttribute('aria-label',badge.title);}
    renderView(state.view,force);
    if(draftOperations)setSelected('operationFilter',draftOperations);
  }
  function renderViewBody(name){
    const m=state.model;
    if(name==='overview')renderOverview();
    else if(name==='suppliers'){setText('supplierReceiptNote',receiptScopeNote());renderSuppliers();}
    else if(name==='installments')renderInstallments();
    else if(name==='corrections'){window.MinervaCorrectionImpact?.render(m);renderCorrections();}
    else if(name==='claims'){window.MinervaExecutive?.renderClaims(m,'claimAnalytics');window.MinervaClaimControl?.render(m);}
    else if(name==='procurement')window.MinervaClaimControl?.render(m);
    else if(name==='analysts')window.MinervaAnalysts?.render(m);
    else if(name==='meeting')window.MinervaMeetings?.render(m);
    else if(name==='portfolio')window.MinervaPortfolio?.render(m);
    else if(name==='method')renderMethodExtra();
  }
  function renderOverview(){
    const m=state.model,s=m.summary;
    setText('metricClaimed',money(s.claimed));setText('metricReceived',money(comparativeReceived(s)));setText('metricRecovery',pct(comparativeRate(s)));setText('metricBalance',money(loss(s)));setText('metricNegotiating',money(s.negotiating));setText('metricOverdue',integer(s.overdue));setText('metricOpenBalance',money(s.openBalance));
    document.querySelectorAll('[data-loss-formula],#lossFormula,#lossFormulaShort').forEach(el=>el.textContent=lossFormula());
    $('annualCards').innerHTML=m.annual.map(a=>`<article class="annual-card"><span class="eyebrow">ANO ${a.year}</span><div class="annual-values"><div><span>Reclamado · Data RNC</span><strong>${money(a.claimed)}</strong></div><div><span>Recebido · claims do período selecionado</span><strong>${money(comparativeReceived(a))}</strong></div><div><span>Recebido / reclamado</span><strong>${pct(comparativeRate(a))}</strong></div></div></article>`).join('');
    renderMonthly();renderRanking();window.MinervaExecutive?.render(m);
    $('qualityNotice').hidden=false;$('qualityNotice').innerHTML=`<strong>${s.reviewCount?`${integer(s.reviewCount)} apontamentos para conferência`:'Referências conciliadas'}</strong><span>${integer(s.unmatchedClaims)} encaminhados sem correspondência; ${integer(m.meta.ambiguousControlRows)} parcelas com vínculo a conferir. Recebimentos confirmados no Controle são contados mesmo sem as ordens detalhadas. ${integer(s.receivedWithoutClaimDetailCount||0)} pagamentos sem detalhamento: USD ${money(s.receivedWithoutClaimDetail||0)}. ${receiptOperationNote()}</span><button class="button secondary" data-view="corrections">Conferir a base</button>`;
    const overviewRows=F.prepare('overviewTable',supplierHeaders(),m.suppliers,supplierCells,'Resumo por fornecedor',SUP_SORT);
    $('overviewTable').innerHTML=table(supplierHeaders(),(F.has('overviewTable')?overviewRows:overviewRows.slice(0,6)).map(supplierCells),{caption:'Principais fornecedores por valor reclamado',filterId:'overviewTable',prepared:true,footer:F.has('overviewTable')?null:supplierFooter()});
  }
  function chartMonthLabel(month){return new Intl.DateTimeFormat('pt-BR',{month:'long',year:'numeric',timeZone:'America/Sao_Paulo'}).format(new Date(month+'-01T12:00:00Z'));}
  function renderMonthly(){
    const list=state.model.monthly,max=Math.max(1,...list.map(m=>m.received));
    $('monthlyChart').innerHTML=`<div class="chart-interaction-note"><span>${state.chartMonth?'Compensação selecionada: '+esc(chartMonthLabel(state.chartMonth)):'Clique em um mês para consultar seus recebimentos.'}</span>${state.chartMonth?'<button class="chart-clear-selection" type="button" data-clear-chart-month>Limpar mês</button>':''}</div><div class="monthly-bars" role="group" aria-label="Filtrar recebimentos por mês de compensação">${list.map(m=>{const v=Math.max(0,m.received),label=chartMonthLabel(m.month);return `<button type="button" class="month-column month-filter-button" data-chart-month="${esc(m.month)}" aria-pressed="${state.chartMonth===m.month}" aria-label="Consultar recebimentos de ${esc(label)}: USD ${money(m.received)}" title="${esc(label)} · USD ${money(m.received)} · Clique para consultar"><span class="month-track" aria-hidden="true"><span style="height:${v/max*100}%;${v?'min-height:3px':''}"></span></span><small>${esc(m.month.slice(5))}</small><span class="month-year">${esc(m.month.slice(0,4))}</span></button>`;}).join('')}</div>`;
  }
  function renderRanking(){
    const top=state.model.suppliers.slice(0,5),max=Math.max(1,...top.map(s=>s.claimed)),selected=appliedGlobal('supplier');
    const note=`<div class="chart-interaction-note"><span>${selected?'Fornecedor selecionado: '+esc(selected):'Clique em um fornecedor para filtrar todas as visões.'}</span>${selected?`<button type="button" class="chart-clear-selection" data-clear-chart-supplier ${state.chartSupplierBusy?'disabled':''}>Limpar fornecedor</button>`:''}</div>`;
    $('topSuppliers').innerHTML=note+(top.length?top.map((s,i)=>`<button type="button" class="rank-item rank-filter-button" data-chart-supplier="${esc(s.name)}" aria-pressed="${selected===s.name}" aria-label="Filtrar todas as visões por ${esc(s.name)}" ${state.chartSupplierBusy?'disabled':''}><span class="rank-number">${String(i+1).padStart(2,'0')}</span><span class="rank-content"><span class="rank-title"><span class="rank-name">${esc(s.name)}</span><strong>${pct(comparativeRate(s))}</strong></span><span class="bar-track" aria-hidden="true"><span class="bar-claimed" style="width:${Math.max(0,s.claimed/max*100)}%"></span><span class="bar-fill" style="width:${Math.max(0,Math.min(comparativeReceived(s),s.claimed)/max*100)}%"></span></span><small>USD ${money(comparativeReceived(s))} recebidos de claims do período · reclamado ${money(s.claimed)}</small></span></button>`).join(''):blank());
  }
  function renderChartMonthSelection(){
    let chip=$('chartMonthSelection');
    if(!chip){chip=document.createElement('div');chip.id='chartMonthSelection';chip.className='chart-month-selection';chip.setAttribute('role','status');document.querySelector('.receipt-filters').insertAdjacentElement('afterend',chip);}
    chip.hidden=!state.chartMonth;
    chip.innerHTML=state.chartMonth?`<div><strong>Compensação: ${esc(chartMonthLabel(state.chartMonth))}</strong><small>Seleção do gráfico · ${esc(state.chartMonth)}. Os demais filtros do Controle também se aplicam.</small></div><button type="button" class="chart-clear-selection" data-clear-chart-month>Limpar mês</button>`:'';
  }
  function selectChartMonth(month){
    if(!state.model||!state.model.monthly.some(m=>m.month===month))return;
    state.chartMonth=month;state.installmentsPage=state.processesPage=1;renderMonthly();renderInstallments();view('installments');$('view-installments').scrollIntoView({block:'start',behavior:'smooth'});
    say('Recebimentos por compensação em '+chartMonthLabel(month)+'. Use Limpar mês para voltar a todos os meses.');
  }
  function clearChartMonth(){state.chartMonth='';state.installmentsPage=state.processesPage=1;if(state.model){renderMonthly();renderInstallments();}say('Seleção de mês removida. Os demais filtros foram mantidos.');}
  async function selectChartSupplier(name){
    if(!state.model||state.chartSupplierBusy||name===appliedGlobal('supplier'))return;
    const origin=state.view,version=state.viewVersion||0;
    const meta=state.model.meta;
    // A chart click refines the applied report, without applying unfinished form edits.
    if(state.view==='suppliers'){state.supplierYears=meta.allYears?[]:cleanYears(meta.years);populateSupplierYears();}
    else if(!meta.allYears)document.querySelectorAll('input[name="year"]').forEach(el=>el.checked=meta.years.includes(Number(el.value)));
    $('asOf').value=meta.asOf;$('correctionScenario').value=currentScenario();state.operations=appliedGlobalValues('operation');state.controlOperations=asList(controlModel()?.meta?.operations??controlModel()?.meta?.operation);state.operation=state.operations.join(' · ');state.controlOperation=state.controlOperations.join(' · ');populateOperations();
    if(name&&!Array.from($('supplierFilter').options).some(option=>option.value===name))$('supplierFilter').add(new Option(name,name));
    setSelected('supplierFilter',name?[name]:[]);state.chartSupplierBusy=true;renderRanking();
    try{await analyze();}catch(error){notice(error.message||'Não foi possível aplicar o fornecedor.',true);}
    finally{state.chartSupplierBusy=false;if(state.model&&state.view===origin&&(state.viewVersion||0)===version){setSelected('supplierFilter',appliedGlobalValues('supplier'));renderRanking();}}
  }
  function supplierAnnual(s,year){
    if(state.model.meta.reportView==='suppliers'){
      const value=state.model.supplierAnnual?.find(row=>row.name===s.name&&row.year===year);
      if(!value)throw new Error('O comparativo anual está incompleto. Atualize a visão para tentar novamente.');
      return value;
    }
    const models=state.supplierAnnualModels||(state.supplierAnnualModels=new WeakMap());if(!models.has(state.model))models.set(state.model,new Map());const cache=models.get(state.model);
    let supplier=cache.get(s.name);if(!supplier){supplier=new Map();cache.set(s.name,supplier);}if(supplier.has(year))return supplier.get(year);
    const claims=state.model.claims.filter(c=>c.supplier===s.name&&c.year===year),rows=(state.model.receiptCohorts?.rows||[]).filter(i=>i.supplier===s.name&&i.compensationYear===year),sum=list=>list.reduce((a,r)=>a+r.received,0),claimed=claims.reduce((a,c)=>a+c.claimed,0),received=sum(rows.filter(r=>state.model.meta.years.includes(r.claimYear))),value={claimed,received,financialReceived:sum(rows),byYear:Object.fromEntries([...claimYearKeys(),'unknown'].map(origin=>[origin,sum(rows.filter(r=>origin==='unknown'?r.claimYear==null:origin==='other'?r.claimYear!=null&&!claimYearDisplayYears().includes(r.claimYear):r.claimYear===origin))])),rate:claimed?received/claimed:null};
    supplier.set(year,value);return value;
  }
  function supplierRows(mode=state.supplierMode){
    const list=state.model.suppliers.filter(s=>normalize(s.name).includes(normalize(filterValue('supplierSearch')))).sort((a,b)=>state.sort==='name'?state.direction*a.name.localeCompare(b.name,'pt-BR'):state.direction*((state.sort==='received'?comparativeReceived(a):state.sort==='recoveryRate'?comparativeRate(a)||0:a[state.sort]??0)-(state.sort==='received'?comparativeReceived(b):state.sort==='recoveryRate'?comparativeRate(b)||0:b[state.sort]??0)));
    const heads=mode==='annual'?['Fornecedor / causador',...state.model.meta.years.flatMap(y=>[`Reclamado ${y} · USD`,...claimYearLabels().map(label=>`Recebido ${y} · ${label}`),`Total do período em ${y} · USD`,`% ${y}`])]:supplierHeaders();
    const cells=mode==='annual'?s=>[supplierButton(s.name),...state.model.meta.years.flatMap(y=>{const a=supplierAnnual(s,y);return [money(a.claimed),...claimYearKeys().map(origin=>money(a.byYear[origin])),money(a.received),pct(a.rate)];})]:supplierCells;
    const sortOptions=mode==='annual'?{types:['text',...state.model.meta.years.flatMap(()=>['number','number','number','number','number','number'])],sortValues:s=>[s.name,...state.model.meta.years.flatMap(y=>{const a=supplierAnnual(s,y);return[a.claimed,...claimYearKeys().map(origin=>a.byYear[origin]),a.received,a.rate];})]}:SUP_SORT;
    return {heads,cells,list:F.prepare('supplier-'+mode,heads,list,cells,mode==='annual'?'Comparativo anual':'Comparativo por fornecedor',sortOptions)};
  }
  function renderSuppliers(){if(!state.model){$('supplierTable').innerHTML=blank('Carregue as planilhas para ver os fornecedores.');return;}let {heads,cells,list}=supplierRows();setText('supplierCount',integer(list.length));
    $('supplierTable').innerHTML=table(heads,list.map(cells),{filterId:'supplier-'+state.supplierMode,prepared:true,caption:'Comparativo por fornecedor',footer:state.supplierMode==='summary'&&!filterValue('supplierSearch')&&!F.has('supplier-summary')?supplierFooter():null});
  }
  function installmentRows(){if(!state.model)return[];const q=normalize(filterValue('installmentSearch')),type=filterValues('typeFilter'),status=filterValues('statusFilter');const rows=controlModel().installments.filter(i=>(!state.chartMonth||i.compensationMonth===state.chartMonth)&&(!q||normalize([i.reference,i.supplier,i.originalSupplier,i.confession].join(' ')).includes(q))&&(!type.length||type.some(value=>normalize(i.type)===normalize(value)))&&(!status.length||status.some(value=>value==='Sem previsão'?i.status==='Dentro do Prazo'&&i.noDueDate:i.status===value)));descendingAmount(rows,installmentAmount);return F.prepare('installmentTable',INST_HEADERS,rows,installmentCells,'Detalhe das parcelas',INST_SORT);}
  const safeInstallment = i => ['matched','grouped'].includes(i.linkState);
  const controlRecord = i => i.isControlRecord === true || safeInstallment(i);
  const confirmedInstallment = i => i.includedInConfirmed ?? (safeInstallment(i)&&i.inPeriod&&i.status==='Pago');
  function controlSummary(rows){const sum=(list,key)=>list.reduce((total,i)=>total+(Number(i[key])||0),0),safe=rows.filter(controlRecord),paid=safe.filter(confirmedInstallment),realized=safe.filter(i=>i.includedInRealized),overdue=safe.filter(i=>i.status==='Vencido'),onTime=safe.filter(i=>i.status==='Dentro do Prazo'),noDue=onTime.filter(i=>i.noDueDate),open=[...overdue,...onTime];return {total:rows.length,confirmed:sum(paid,'received'),realized:sum(realized,'received'),confirmedCount:paid.length,realizedCount:realized.length,open:sum(open,'expected'),openCount:open.length,overdue:sum(overdue,'expected'),overdueCount:overdue.length,onTime:sum(onTime,'expected'),onTimeCount:onTime.length,noDue:sum(noDue,'expected'),noDueCount:noDue.length,reviewCount:rows.filter(i=>!safeInstallment(i)).length,paymentReviewCount:safe.filter(i=>i.status.startsWith('Conferir')).length,missingExpected:open.filter(i=>i.expected==null||i.expectedMissing).length};}
  function filteredProcesses(rows){
    const byRow=new Map(rows.filter(controlRecord).map(i=>[i.row,i]));
    const procs=controlModel().processes.map(p=>{
      const selected=p.installments.map(row=>byRow.get(row)).filter(Boolean),filtered=controlSummary(selected);
      const amountFor=status=>selected.some(i=>i.status===status&&(i.expected==null||i.expectedMissing))?null:status==='Vencido'?filtered.overdue:filtered.onTime;
      return {...p,selected,filtered,filteredPaid:selected.filter(i=>i.status==='Pago').length,filteredOverdueAmount:amountFor('Vencido'),filteredOnTimeAmount:amountFor('Dentro do Prazo'),remainingOpen:Number(p.overdue||0)+Number(p.onTime||0)};
    }).filter(p=>p.selected.length);
    descendingAmount(procs,p=>p.agreed??p.receivedAllYears??p.agreementBalance);
    return F.prepare('processTable',PROC_HEADERS,procs,processCells,'Conferência de quitação',{types:['text','text','number','number','number','number','number','number','text'],sortValues:p=>[p.references.join(' · ')||p.id,p.supplier,p.agreed,p.receivedAllYears,p.agreementBalance,p.filteredOverdueAmount,p.filteredOnTimeAmount,p.agreementRate,p.status]});
  }
  const PROC_HEADERS=['Ordem / acordo','Fornecedor','Valor acordado · USD','Recebido no acordo · USD','Saldo do acordo · USD','Vencido no filtro · USD','No prazo no filtro · USD','% do claim acordado','Situação do acordo'];
  const processCells=p=>[
    `<button class="table-action" data-process-detail="${esc(p.id)}">${esc(p.references.join(' · ')||p.id)}</button>`,esc(p.supplier),money(p.agreed),money(p.receivedAllYears),money(p.agreementBalance),money(p.filteredOverdueAmount),money(p.filteredOnTimeAmount),
    `${pct(p.agreementRate)}<span class="cell-subtext">${esc(p.agreementStatus||'Conferir valor do acordo')}</span>`,
    `${badge(p.status)}<span class="cell-subtext">${p.remainingOpen?`Faltam ${integer(p.remainingOpen)} ${p.remainingOpen===1?'parcela':'parcelas'}`:'Sem parcelas abertas'} · ${integer(p.paid)} de ${integer(p.total)} pagas${p.review?` · ${integer(p.review)} a conferir`:''}</span>`
  ];
  function installmentLink(i){if(i.includedInRealized)return '<span class="badge positive">No comparativo</span>';if(!safeInstallment(i))return linkBadge(i.linkState);if(confirmedInstallment(i))return '<span class="badge neutral">Confirmado · fora do comparativo</span>';if(i.status==='Pago')return '<span class="badge warning">Ano de R fora do período</span>';return linkBadge(i.linkState);}
  function installmentCells(i){return [esc(i.reference||'Sem referência'),esc(i.supplier),esc(i.confession||'—'),esc(i.type),badge(i.status),i.noDueDate?'<span class="muted">Sem previsão informada</span>':date(i.dueDate),date(i.compDate),money(i.expected),money(i.received),installmentLink(i),integer(i.row),i.compensationYear==null?'—':esc(i.compensationYear),esc(i.receiptAnalyst||'Não informado'),esc((i.operations||[]).join(' · ')||'Não informada')];}
  const INST_HEADERS=['Ordem / NF','Fornecedor','Confissão','Negociação','Status na análise','Previsão · N','Compensação · R','Previsto USD · O','Recebido USD · T','Conciliação','Linha Excel','Ano da compensação · R','Analista recebimento · AF','Operação · BD'];
  const INST_SORT_TYPES=['text','text','text','text','text','date','date','number','number','text','number','number','text','text'];
  const installmentSortValues=i=>[i.reference,i.supplier,i.confession,i.type,i.status,i.dueDate,i.compDate,i.expected,i.received,installmentLink(i).replace(/<[^>]*>/g,''),i.row,i.compensationYear,i.receiptAnalyst,(i.operations||[]).join(' · ')];
  const INST_SORT={types:INST_SORT_TYPES,sortValues:installmentSortValues};
  function controlFilterText(){return `Operação: ${controlOperationLabel()} · Busca: ${filterValue('installmentSearch').trim()||'todas as referências'} · Negociação: ${filterLabel('typeFilter','todos os tipos')} · Status: ${filterLabel('statusFilter','todos')}${state.chartMonth?' · Mês de compensação: '+state.chartMonth:''}`;}
  function renderInstallments(){renderChartMonthSelection();if(!state.model){window.MinervaReceiptsExecutive?.render(null);$('installmentTable').innerHTML=blank('Carregue as planilhas para consultar o Controle de recebimento.');return;}const rows=installmentRows(),s=controlSummary(rows),procs=filteredProcesses(rows);window.MinervaReceiptsExecutive?.render(state.model,rows,s);setText('installmentCount',integer(rows.length));setText('processCount',integer(procs.length));setText('controlFilterSummary',`${integer(rows.length)} parcelas neste filtro · ${controlFilterText()}`);
    const stats=[['Recebido total no Controle',s.confirmed,`${integer(s.confirmedCount)} pagamentos · M = Pago · ano de R no período`],['Recebido financeiro no recorte',s.realized,'Operações selecionadas · inclui claims de outros anos'],['Saldo em aberto',s.open,`${integer(s.openCount)} parcelas · previsto na coluna O`],['Vencido',s.overdue,`${integer(s.overdueCount)} parcelas`],['Dentro do prazo',s.onTime,`${integer(s.onTimeCount)} parcelas · inclui sem previsão`],['Sem previsão informada',s.noDue,`${integer(s.noDueCount)} parcelas · parte do valor no prazo`]];
    $('processSummary').innerHTML=stats.map(([label,value,detail],index)=>`<div class="mini-stat${index===0?' receipt-primary':''}"><span>${label}</span><strong>USD ${money(value)}</strong><small>${detail}</small></div>`).join('');
    const notices=[];if(s.reviewCount)notices.push(`${integer(s.reviewCount)} parcelas têm vínculo com a BD a conferir. Seus valores válidos entram no Controle integral; apenas a conciliação permanece separada.`);if(s.paymentReviewCount)notices.push(`${integer(s.paymentReviewCount)} parcelas exigem conferir pagamento ou previsão.`);if(s.missingExpected)notices.push(`${integer(s.missingExpected)} parcelas em aberto sem valor previsto válido: o saldo em aberto está incompleto.`);const n=$('controlReviewNotice');if(n){n.hidden=!notices.length;n.textContent=notices.join(' ');}
    paged('processTable',PROC_HEADERS,procs.map(processCells),'processesPage','Ordens com parcelas no filtro e quitação do acordo completo');
    paged('installmentTable',INST_HEADERS,rows.map(installmentCells),'installmentsPage','Controle de recebimento: parcelas, datas previstas e pagamentos filtrados');
  }
  function correctionGroups(){if(!state.model)return[];if(Array.isArray(state.model.correctionGroups))return state.model.correctionGroups;const groups=new Map();for(const c of state.model.corrections){const id=normalize(c.reference).replace(/\s+/g,'');if(!groups.has(id))groups.set(id,{id,reference:c.reference,references:[],supplier:c.supplier,suppliers:[],rows:[],bdRows:[],rncDates:[],year:{originalValues:[],correctedValues:[],changes:[]},market:{originalValues:[],correctedValues:[],changes:[]},changes:[],correctionCount:0});const g=groups.get(id),field=c.cell.startsWith('B')?g.year:g.market;g.references.push(c.reference);g.suppliers.push(c.supplier);g.rows.push(c.row);g.bdRows.push(...c.bdRows);g.rncDates.push(...String(c.rncDate).split('; ').filter(Boolean));g.changes.push(c);field.changes.push(c);field.originalValues.push(c.original);field.correctedValues.push(c.corrected);g.correctionCount++;}return [...groups.values()].map(g=>{const unique=a=>[...new Set(a)];for(const key of ['references','suppliers','rows','bdRows','rncDates'])g[key]=unique(g[key]);for(const f of [g.year,g.market]){f.originalValues=unique(f.originalValues);f.correctedValues=unique(f.correctedValues);}g.rows.sort((a,b)=>a-b);g.bdRows.sort((a,b)=>a-b);g.hasYearCorrection=!!g.year.changes.length;g.hasMarketCorrection=!!g.market.changes.length;g.hasConflictingCorrections=g.year.correctedValues.length>1||g.market.correctedValues.length>1;return g;});}
  function groupChanges(g){return g.changes||[...(g.year?.changes||[]),...(g.market?.changes||[])];}
  function analystNames(item){if(Array.isArray(item.analysts))return [...new Set(item.analysts.map(v=>String(v||'').trim()).filter(Boolean))];if(item.analyst)return [String(item.analyst).trim()];const rows=new Set(item.bdRows||[]);return [...new Set((state.model?.claims||[]).filter(c=>rows.has(c.row)).flatMap(c=>c.analysts||[c.analyst]).map(v=>String(v||'').trim()).filter(Boolean))];}
  function analystText(item){return analystNames(item).join(' · ')||'Não informado';}
  function matchesAnalyst(item){const selected=filterValues('analystFilter'),names=analystNames(item);return !selected.length||selected.some(value=>value==='__missing__'?!names.length:names.includes(value));}
  function populateAnalysts(){const el=$('analystFilter'),selected=selectValues(el),items=reviewQueue(),names=[...new Set(items.flatMap(analystNames))].sort((a,b)=>a.localeCompare(b,'pt-BR'));el.innerHTML='<option value="">Todos os analistas</option>'+names.map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join('')+(items.some(item=>!analystNames(item).length)?'<option value="__missing__">Não informado na BD</option>':'');setSelected(el,selected);}
  const progressDate = value => value ? new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(value)) : '';
  const canMarkCorrections = () => !state.bd && !state.control && !!state.publishedMeta?.revision && ['admin','editor'].includes(window.MinervaTeam?.getProfile()?.role);
  function correctionProgressCell(g){
    const progress=g.progress||{},done=progress.done===true,enabled=canMarkCorrections()&&!!progress.key;
    const title=enabled?(done?'Desmarcar esta ordem':'Marcar que você já ajustou esta ordem na planilha'):(state.bd||state.control?'Publique a prévia para salvar marcações':'Marcação disponível para as administradoras');
    return `<div class="correction-progress-cell" data-progress-done="${done}"><button type="button" class="correction-progress-button" data-correction-progress="${esc(progress.key||'')}" aria-pressed="${done}" aria-label="${done?'Desmarcar ajuste':'Marcar como ajustada'}: ${esc(g.reference)}" title="${esc(title)}" ${enabled?'':'disabled'}><span aria-hidden="true">${done?'✓':'○'}</span>${done?'Já ajustei':'Marcar ajustado'}</button>${done?`<small>${esc(progress.updatedBy||'Administração')} · ${esc(progressDate(progress.updatedAt))}</small>`:''}</div>`;
  }
  async function toggleCorrectionProgress(button){
    const key=button.dataset.correctionProgress,g=correctionGroups().find(group=>group.progress?.key===key);
    if(!g||!canMarkCorrections()||button.disabled)return;
    const revision=state.publishedMeta.revision,meta=state.model.meta;
    button.disabled=true;button.setAttribute('aria-busy','true');setText('correctionProgressMessage','Salvando marcação…');
    try{
      const response=await window.MinervaTeam.setCorrectionProgress({key,done:!g.progress.done,reportRevision:revision,options:{years:meta.years,allYears:meta.allYears,asOf:meta.asOf,suppliers:meta.suppliers,operations:meta.operations,controlOperations:meta.controlOperations,correctionScenario:meta.correctionScenario||currentScenario()}});
      if(state.publishedMeta?.revision===revision){for(const group of correctionGroups())if(group.progress?.key===key)group.progress=response.progress;renderCorrections();if($('detailDialog').open)activeDetail?.();}
      setText('correctionProgressMessage',response.progress.done?'Marcado como ajustado. A marcação ficou salva para a equipe.':'Marcação removida. A ordem voltou para pendente.');
    }catch(error){button.disabled=false;button.removeAttribute('aria-busy');setText('correctionProgressMessage',error.status===409?'A base foi atualizada. Use Atualizar visão e confira a ordem novamente.':error.message||'Não foi possível salvar a marcação. Tente novamente.');}
  }
  const CORR_HEADERS=['Ordem / NF','Fornecedor','Analista na BD','Ano Entrada · original → BD','Mercado · original → BD','Valor integral · U → AJ USD','Linhas do Controle','Linhas BD','Data RNC','Rastreabilidade'];
  const correctionCells=g=>[`<span class="reference-with-copy"><button class="table-action" data-correction-detail="${esc(g.id)}">${esc(g.reference||'Sem referência')}</button>${window.MinervaCopy?.button(g.reference)||''}</span>${correctionProgressCell(g)}`,esc((g.suppliers||[g.supplier]).join(' · ')),esc(analystText(g)),correctionChangeCell(g.year),correctionChangeCell(g.market),correctionChangeCell(g.claimValue),`<strong>${integer(g.rows.length)} linhas</strong><span class="cell-subtext">${esc(rowRanges(g.rows))}</span>`,esc(rowRanges(g.bdRows)),esc((g.rncDates||[]).map(date).join(' · ')),`${g.hasConflictingCorrections?'<span class="badge warning">Conferir diferenças por linha</span>':''}<button class="table-action" data-correction-detail="${esc(g.id)}">Ver ${integer(g.correctionCount)} ajustes</button>`];
  const ISSUE_HEADERS=['Ordem / NF','Fornecedor','Analista na BD','Origem / linha','Valor USD','O que conferir'];
  const issueCells=i=>[esc(i.reference||'—'),esc(i.supplier||'—'),esc(analystText(i)),`${window.MinervaCorrectionImpact.issueSource(i)} · ${i.row==null?'—':integer(i.row)}`,money(i.amount),esc(i.detail)];
  function correctionRows(){const q=normalize(filterValue('correctionSearch')),progress=filterValues('correctionProgressFilter');const rows=correctionGroups().filter(g=>(!progress.length||progress.some(value=>value==='done'?g.progress?.done===true:g.progress?.done!==true))&&matchesAnalyst(g)&&(!q||normalize([analystText(g),g.reference,...(g.references||[]),g.supplier,...(g.suppliers||[]),...(g.rows||[]),...groupChanges(g).flatMap(c=>[c.cell,c.field,c.original,c.corrected])].join(' ')).includes(q)));return F.prepare('correctionTable',CORR_HEADERS,rows,g=>{const cells=correctionCells(g);cells[0]=esc(g.reference||'Sem referência');return cells;},'Ordens com correções',{types:['text','text','text','text','text','text','number','number','date','number'],sortValues:g=>[g.reference,(g.suppliers||[g.supplier]).join(' · '),analystText(g),originalValues(g.year?.originalValues)+' → '+originalValues(g.year?.correctedValues),originalValues(g.market?.originalValues)+' → '+originalValues(g.market?.correctedValues),originalValues(g.claimValue?.originalValues)+' → '+originalValues(g.claimValue?.correctedValues),g.rows.length,Math.min(...g.bdRows),earliestDate(g.rncDates),g.correctionCount]});}
  function issueRows(){if(!state.model)return[];const q=normalize(filterValue('correctionSearch'));const rows=state.model.issues.filter(i=>matchesAnalyst(i)&&(!q||normalize([analystText(i),i.reference,i.supplier,i.detail,i.row].join(' ')).includes(q)));descendingAmount(rows,i=>i.amount);return F.prepare('issueTable',ISSUE_HEADERS,rows,issueCells,'Correspondências e pendências',{types:['text','text','text','text','number','text'],sortValues:i=>[i.reference,i.supplier,analystText(i),issueCells(i)[3],i.amount,i.detail]});}
  function rowRanges(values){const rows=[...new Set(values)].sort((a,b)=>a-b),ranges=[];for(let i=0;i<rows.length;i++){const start=rows[i];let end=start;while(i+1<rows.length&&rows[i+1]===end+1)end=rows[++i];ranges.push(start===end?String(start):`${start}–${end}`);}return ranges.join(', ');}
  function originalValues(values){return (values||[]).map(v=>v==null||String(v).trim()===''?'Sem informação':String(v)).join(' · ')||'—';}
  function correctionChangeCell(field){if(!field?.changes?.length)return '<span class="muted">Sem alteração</span>';return `<span class="correction-change"><span class="original-value">${esc(originalValues(field.originalValues))}</span><span class="change-arrow" aria-label="corrigido para">→</span><span class="corrected-value">${esc(originalValues(field.correctedValues))}</span></span>`;}
  const REVIEW_HEADERS=['Ordem / referência','Fornecedor','Conferência','Reclamado de referência · USD','Analista na BD','Linhas de origem','Data RNC','Acompanhamento'];
  const reviewQueue=()=>window.MinervaCorrectionImpact.buildQueue(state.model,correctionGroups());
  const needsSourceReview=r=>(r.issues||[]).some(issue=>issue.reconciliation===true);
  const reviewProgress=r=>needsSourceReview(r)?'Conferir na origem':r.groups.length?(r.doneCount===r.groups.length?'Já ajustadas':r.doneCount?`${r.doneCount} de ${r.groups.length} ajustadas`:'Pendentes'):'Conferir na origem';
  const reviewValues=r=>[r.reference,r.supplier,r.types.join(' · '),r.referenceAmount,analystText(r),`BD: ${rowRanges(r.bdRows)||'—'} · Controle: ${rowRanges(r.controlRows)||'—'}`,earliestDate(r.rncDates),reviewProgress(r)];
  function reviewCells(r){return [`<span class="reference-with-copy"><button class="table-action" data-correction-detail="${esc(r.id)}">${esc(r.reference)}</button>${window.MinervaCopy?.button(r.reference)||''}</span>${r.sgrs?.length?`<span class="cell-subtext">SGR ${esc(r.sgrs.join(' · '))}</span>`:''}`,esc(r.supplier||'—'),r.types.map(type=>`<span class="badge warning">${esc(type)}</span>`).join(' '),moneyExact(r.referenceAmount),esc(analystText(r)),esc(reviewValues(r)[5]),esc(r.rncDates.map(date).join(' · ')||'—'),r.groups.length===1&&!needsSourceReview(r)?correctionProgressCell(r.groups[0]):`<button class="table-action" data-correction-detail="${esc(r.id)}">${esc(reviewProgress(r))}</button>`];}
  function reviewRows(){
    const q=normalize(filterValue('correctionSearch')),progress=filterValues('correctionProgressFilter');
    const rows=reviewQueue().filter(r=>matchesAnalyst(r)&&(!progress.length||progress.some(value=>value==='done'?!needsSourceReview(r)&&r.doneCount>0:needsSourceReview(r)||!r.groups.length||r.doneCount<r.groups.length))&&(!q||normalize([r.reference,r.supplier,analystText(r),...(r.sgrs||[]),...(r.sourceCells||[]),...r.types,...r.bdRows,...r.controlRows,...r.groups.flatMap(g=>groupChanges(g).flatMap(c=>[c.cell,c.field,c.original,c.corrected])),...r.issues.flatMap(i=>[i.detail,i.order,i.nf]),...r.audits.flatMap(a=>a.reasons||[])].join(' ')).includes(q)));
    return F.prepare('correctionTable',REVIEW_HEADERS,rows,r=>reviewValues(r).map(v=>esc(v??'—')),'Fila única de conferência',{types:['text','text','text','number','text','text','date','text'],sortValues:reviewValues});
  }
  function renderCorrections(){
    if(!state.model){$('correctionTable').innerHTML=blank('As divergências aparecerão depois da importação.');return;}
    populateAnalysts();const rows=reviewRows(),all=reviewQueue();
    setText('correctionFilterSummary',`Base completa · todos os anos · ${integer(rows.length)} referências de ${integer(all.length)} · ${integer(correctionGroups().filter(g=>g.progress?.done).length)} ordens marcadas como ajustadas`);
    setText('correctionCount',integer(rows.length));setText('correctionBadge',integer(all.length));$('correctionBadge').hidden=!all.length;$('correctionBadge').title=`${integer(all.length)} referências para conferir`;$('correctionBadge').setAttribute('aria-label',`${integer(all.length)} referências para conferir`);
    paged('correctionTable',REVIEW_HEADERS,rows.map(reviewCells),'correctionsPage','Fila única de conferência: correções, valores e pendências vinculadas');
    $('correctionTable').querySelectorAll('[data-progress-done]').forEach(el=>el.closest('tr').classList.toggle('correction-complete',el.dataset.progressDone==='true'));
  }
  function correctionDetail(id){
    activeDetail=()=>correctionDetail(id);const row=reviewQueue().find(r=>r.id===id||r.groups.some(g=>g.id===id));if(!row)return;
    const changes=row.groups.flatMap(g=>groupChanges(g).map(c=>({g,c}))),parts=[];
    parts.push(`<p class="correction-detail-sources">BD: <strong>${esc(rowRanges(row.bdRows)||'—')}</strong> · Controle: <strong>${esc(rowRanges(row.controlRows)||'—')}</strong> · Analista: ${esc(analystText(row))}${row.sgrs?.length?` · SGR: <strong>${esc(row.sgrs.join(' · '))}</strong>`:''}</p>`);
    if(row.groups.length)parts.push(`<div class="correction-detail-progress">${row.groups.map(g=>`<div><strong>${esc(g.reference)}</strong>${correctionProgressCell(g)}</div>`).join('')}</div>`);
    if(row.audits.length){const heads=['Referência','Integral U · USD','Integral AJ · USD','Acordado O · USD','Acordado AO · USD','O − AO · USD','Prejuízo U − O · USD','Prejuízo AJ − AO · USD','Conferência','Linhas BD / Controle'];const raw=a=>[a.reference,a.originalClaimValue,a.claimed,a.controlExpected,a.bdReceived,a.deltaReceived,a.originalPrejudice,a.prejudice,a.status,`BD ${rowRanges(a.bdRows||[])} / Controle ${rowRanges(a.controlRows||[])}`];parts.push(`<h3>Valores lado a lado</h3><div class="table-wrap">${table(heads,row.audits.map(a=>raw(a).map((value,index)=>index>=1&&index<=7?moneyExact(value):esc(value))),{caption:'Valores originais do Controle e referências da BD, sem rateio',filterId:'detail-correction-financial',types:['text',...Array(7).fill('number'),'text','text'],sortValues:row.audits.map(raw)})}</div>${row.audits.some(a=>a.reasons?.length)?`<ul class="correction-detail-reasons">${row.audits.flatMap(a=>(a.reasons||[]).map(reason=>`<li><strong>${esc(a.reference)}:</strong> ${esc(reason)}</li>`)).join('')}</ul>`:''}`);}
    if(changes.length){const cells=changes.map(({g,c})=>[integer(c.row),esc(c.cell),esc(analystText(c)),esc(c.field),esc(c.reference||g.reference),esc(originalValues([c.original])),esc(originalValues([c.corrected])),esc(rowRanges(c.bdRows||g.bdRows)),esc(String(c.rncDate||'').split('; ').map(date).join(' · ')),esc(c.reason||'Referência da BD')]);parts.push(`<h3>Correções por célula</h3>${row.groups.some(g=>g.hasConflictingCorrections)?'<p class="receipt-notice">Há valores de destino diferentes. Confira cada linha antes de alterar a planilha.</p>':''}<div class="table-wrap">${table(['Linha Controle','Célula','Analista na BD','Campo','Referência original','Valor original','Valor adotado da BD','Linhas BD','Data RNC','Critério'],cells,{caption:'Rastreabilidade de cada correção',filterId:'detail-correction',types:['number','text','text','text','text','text','text','number','date','text'],sortValues:changes.map(({g,c})=>[c.row,c.cell,analystText(c),c.field,c.reference||g.reference,c.original,c.corrected,Math.min(...(c.bdRows||g.bdRows)),earliestDate([c.rncDate]),c.reason])})}</div>`);}
    if(row.issues.length)parts.push(`<h3>Pendências vinculadas</h3><div class="table-wrap">${table(ISSUE_HEADERS,row.issues.map(issueCells),{caption:'Apontamentos preservados da origem',filterId:'detail-correction-issues',types:['text','text','text','text','number','text'],sortValues:row.issues.map(i=>[i.reference,i.supplier,analystText(i),issueCells(i)[3],i.amount,i.detail])})}</div>`);
    showDetail(`Conferência · ${row.reference}`,parts.join(''));
  }
  function renderMethodExtra(){let el=$('dynamicMethod');if(!el){el=document.createElement('div');el.id='dynamicMethod';el.className='method-card';$('view-method').append(el);}const m=state.model;el.innerHTML=`<h3>Rastreabilidade desta análise</h3><p><strong>${esc(scenarioLabel())}</strong>. O cenário altera os cadastros do Controle usados no resultado; reclamado e negociação permanecem na BD, e pagamentos T / datas R não são substituídos.</p><p>${esc(state.bdName)} · aba BD<br>${esc(state.controlName)} · aba Controle Recebimento</p><p>${esc(m.meta.occurrenceDefinition)}</p><p>O reclamado reúne todas as situações da BD, exceto EM ANALISE, AGUARDANDO CUSTOS e RESPONDIDO-NÃO PROCEDE, preservando o período, as operações e o expurgo de INTERFERÊNCIA EXTERNA. Em negociação considera somente EM NEGOCIAÇÃO - PROCEDENTE.</p><p>O recebido soma T somente com M = Pago, pelo ano e mês da data R — Data compensação. R ausente ou inválida fica para conferência; AE serve apenas para apontar divergências. O recebimento por analista usa AF e todo o Controle, independente do recorte da BD.</p><p>O recebido do comparativo vem dos pagamentos confirmados no Controle, inclusive recebimentos agrupados sem referências detalhadas. A BD valida fornecedor, ano e operação quando possível; a ausência de vínculo não anula o pagamento. No recorte geral entram todas as operações, inclusive não identificadas; ao escolher uma operação específica, ficam apenas as identificadas nessa operação. Ele é separado entre mesmo ano do claim, outros anos e ano a conferir. A aba Controle de recebimento usa a planilha integral: M = Pago, ano da data R no período e T válido. O recebido total independe do ano RNC, da situação, do expurgo e do vínculo com a BD. O subtotal do comparativo permanece separado.</p><p>Valores pagos pela data R fora dos anos selecionados: USD ${money(m.meta.receivedOutsidePeriod)}. Valores pagos com vínculo ambíguo no período: USD ${money(m.meta.ambiguousReceived)}. Pagamentos ligados a claims ainda em negociação: USD ${money(m.meta.receivedNegotiating)}. Pagamentos de outros status elegíveis: USD ${money(m.meta.receivedOtherStatuses||0)}.</p><p><strong>${esc(lossFormula())}</strong></p><p><strong>Visão executiva:</strong> ${esc(m.executiveReport?.meta?.scope||'Somente Claim. Recebimentos pelo caixa M/R/T; negociação e motivos pela BD.')}</p><p>${esc(m.executiveReport?.meta?.slaBasis||'SLA: média dos indicadores já informados na BD, pelo mês da data do evento. Análise por J/BF; negociação por I/BJ somente encaminhados; abertura por N/BK.')}</p><p>Saldo em aberto por fornecedor: soma do valor previsto em USD (O) das linhas com Status Pagamento (M) igual a Dentro do Prazo ou Vencido, de qualquer ano. Vencido é a parte desse saldo marcada como Vencido na coluna M; não é somado novamente ao total. O fornecedor segue o cenário original/corrigido selecionado e o recorte de operações. A previsão N não reclassifica esses saldos. O Controle de recebimento mantém a coluna Status na análise, calculada pela data de referência, para acompanhamento.</p>`;}
  function showDetail(title,content){setText('detailTitle',title);$('detailContent').innerHTML=content;if(!$('detailDialog').open)$('detailDialog').showModal();}
  async function openSupplierDetail(name){
    if(!state.model||!viewScopeMatches())return;
    if(state.model.meta.reportView!=='suppliers'){supplierDetail(name);return;}
    const version=state.detailRequestVersion=(state.detailRequestVersion||0)+1,origin=state.view;state.detailLoading=true;
    showDetail(name,'<p role="status">Carregando os detalhes deste fornecedor…</p>');
    const loaded=await ensureFullModel();
    if(version!==state.detailRequestVersion||state.view!==origin||!$('detailDialog').open)return;
    state.detailLoading=false;
    if(!loaded){$('detailContent').textContent='Não foi possível carregar os detalhes. Feche esta janela e selecione o fornecedor para tentar novamente.';return;}
    supplierDetail(name);
  }
  const cohortLabel = key => ({same:'Mesmo ano do claim',different:'Outro ano do claim',unknown:'Ano do claim a conferir'})[key]||'A conferir';
  function receiptOperationNote(){const meta=state.model?.receiptCohorts?.meta||{};return meta.excludedUnknownOperationCount?`Neste filtro específico de operação, ${integer(meta.excludedUnknownOperationCount)} pagamentos (USD ${money(meta.excludedUnknownOperationAmount)}) não têm operação identificada. Selecione Todas as operações para incluí-los.`:'';}
  function receiptScopeNote(){const summary=state.model?.summary||{};return `${scenarioLabel()}. As colunas ${claimYearDisplayYears().join(" e ")} indicam os dois anos mais recentes do calendário de Brasília. Demais anos soma todos os outros anos conhecidos de origem do claim. O total considera pagamentos e claims dos anos selecionados; a organização das colunas não altera esse recorte. Ano a conferir: USD ${money(byClaimYear(summary,"unknown"))}, preservado separadamente no Controle e no detalhe dos recebimentos. O Controle preserva o recebido financeiro completo. ${integer(summary.receivedWithoutClaimDetailCount||0)} pagamentos sem detalhamento das ordens somam USD ${money(summary.receivedWithoutClaimDetail||0)} e estão incluídos, uma única vez. ${receiptOperationNote()}`;}
  function supplierReceiptDetail(name){
    const rows=descendingAmount((state.model.receiptCohorts?.rows||[]).filter(r=>r.supplier===name),r=>r.received);
    const headers=['Ordem / NF','Ano pagamento R','Ano de referência','Classificação','Recebido USD','Compensação R','Linha Controle','Origem do ano','Conferência com a BD'];
    const source=r=>r.yearSource||(currentScenario()==='original'?'Controle B':'Data RNC da BD');
    const validation=r=>r.validationState==='control-only'?'Recebimento sem detalhamento das ordens · informado no Controle':r.validationState==='partial'?'Controle com validação parcial na BD':'Conferido com a BD';
    return '<h3>Recebido por ano do claim</h3><p class="muted">Mesmo ano + outros anos + ano a conferir = recebido total. O pagamento usa a data R e o valor T do Controle. A origem do ano está indicada por linha; pagamentos agrupados são contados uma única vez, sem rateio.</p><div class="table-wrap">'+table(headers,rows.map(r=>[esc(r.reference),esc(r.compensationYear),esc(r.claimYear??((r.claimYears||[]).join(' / ')||'A conferir')),esc(cohortLabel(r.cohort)),money(r.received),date(r.compDate),integer(r.row),esc(source(r)),esc(validation(r))+((r.validationReasons||[]).length?'<span class="cell-subtext">'+esc(r.validationReasons.join(' · '))+'</span>':'')]),{filterId:'detail-receipt-years',caption:'Recebimentos e origem do ano de referência',types:['text','number','text','text','number','date','number','text','text'],sortValues:rows.map(r=>[r.reference,r.compensationYear,r.claimYear,cohortLabel(r.cohort),r.received,r.compDate,r.row,source(r),validation(r)])})+'</div>';
  }
  function supplierOpenDetail(s){
    const rows=descendingAmount([...(s.openInstallments||[])],r=>r.expected),headers=['Linha Controle','Ordem / NF','Fornecedor no Controle · K','Status informado · M','Previsto · O · USD','Previsão · N','Ano informado · B'];
    return '<h3>Composição do saldo em aberto</h3><p>Todos os anos. O saldo soma Dentro do Prazo e Vencido, conforme o status informado no Controle. O vencido já está incluído no total em aberto.</p><div class="detail-stats"><div><span>Dentro do prazo</span><strong>USD '+moneyExact(s.onTimeBalance)+'</strong></div><div><span>Vencido · incluído no saldo</span><strong>USD '+moneyExact(s.overdueBalance)+'</strong></div></div>'+(s.missingExpectedAmounts?'<p class="table-note">Saldo incompleto: '+integer(s.missingExpectedAmounts)+' parcela(s) sem valor previsto válido. Confira as linhas abaixo.</p>':'')+'<div class="table-wrap">'+table(headers,rows.map(i=>[integer(i.row),esc(i.reference||'Sem referência'),esc(i.originalSupplier||i.supplier),badge(i.status),moneyExact(i.expected),date(i.dueDate),esc(i.originalYear??'—')]),{filterId:'detail-supplier-open',caption:'Parcelas do saldo em aberto',types:['number','text','text','text','number','date','text'],sortValues:rows.map(i=>[i.row,i.reference,i.originalSupplier||i.supplier,i.status,i.expected,i.dueDate,i.originalYear])})+'</div>';
  }
  function supplierDetail(name){activeDetail=()=>supplierDetail(name);const m=state.model,s=m.suppliers.find(x=>x.name===name);if(!s)return;const cs=descendingAmount(m.claims.filter(c=>c.supplier===name),c=>c.claimed);const ins=descendingAmount(m.installments.filter(i=>i.supplier===name),installmentAmount);showDetail(name,`<div class="detail-stats"><div><span>Reclamado</span><strong>USD ${money(s.claimed)}</strong></div><div><span>Recebido financeiro · todos os anos de origem</span><strong>USD ${money(s.received)}</strong><small>No total de claims do período: USD ${money(comparativeReceived(s))}</small></div><div><span>Em negociação</span><strong>USD ${money(s.negotiating)}</strong></div><div><span>Saldo em aberto · Controle</span><strong>USD ${moneyExact(s.openBalance)}</strong><small>Dentro do prazo + vencido · todos os anos</small></div></div>${supplierOpenDetail(s)}${supplierReceiptDetail(name)}<h3>Ocorrências da BD</h3><div class="table-wrap">${table(['Linha BD','SGR','Ordem','NF','Data RNC','Mercado','Situação','Reclamado USD','Vínculo'],cs.map(c=>[integer(c.row),esc(c.sgr),esc(c.order),esc(c.nf),date(c.rncDate),esc(c.market),esc(c.status),money(c.claimed),linkBadge(c.linkState)]),{filterId:'detail-claims',caption:'Ocorrências da BD',types:['number','text','text','text','date','text','text','number','text'],sortValues:cs.map(c=>[c.row,c.sgr,c.order,c.nf,c.rncDate,c.market,c.status,c.claimed,linkBadge(c.linkState).replace(/<[^>]*>/g,'')])})}</div><h3>Parcelas vinculadas aos claims do período</h3><div class="table-wrap">${table(INST_HEADERS,ins.map(installmentCells),{filterId:'detail-supplier-installments',caption:'Parcelas do fornecedor',types:INST_SORT_TYPES,sortValues:ins.map(installmentSortValues)})}</div>`);}
  function processDetail(id){activeDetail=()=>processDetail(id);const p=controlModel().processes.find(x=>x.id===id);if(!p)return;const rows=descendingAmount((controlModel().allInstallments||controlModel().installments).filter(i=>p.installments.includes(i.row)),installmentAmount),visible=new Set(installmentRows().map(i=>i.row)),filteredCount=rows.filter(i=>visible.has(i.row)).length;showDetail(`Acordo · ${p.supplier}`,`<p>${esc(p.references.join(' · '))}</p><p>${badge(p.status)} · ${integer(p.paid)} de ${integer(p.total)} parcelas vinculadas pagas.</p><div class="detail-stats"><div><span>Valor acordado · V</span><strong>USD ${money(p.agreed)}</strong><small>${pct(p.agreementRate)} do valor integral U</small></div><div><span>Recebido no acordo · T</span><strong>USD ${money(p.receivedAllYears)}</strong><small>Todos os pagamentos com data R válida</small></div><div><span>Saldo do acordo</span><strong>USD ${money(p.agreementBalance)}</strong><small>Acordado menos recebido</small></div><div><span>Parcelas lançadas · O</span><strong>USD ${money(p.scheduledTotal)}</strong><small>Soma de todos os lançamentos</small></div></div><p class="muted">Percentual acordado é V ÷ U e não significa quitação. O saldo do acordo (V − T) pode diferir do total de parcelas em aberto (O), por exemplo quando o USD efetivamente pago difere do previsto. ${esc((p.agreementReasons||[]).join(' '))}</p><p class="muted">Este detalhe mostra todas as ${integer(rows.length)} parcelas do acordo; ${integer(filteredCount)} passam pelos filtros atuais do Controle. A quitação considera o acordo completo.</p><p class="muted">${p.claimed==null?'Não há valor reclamado atribuído com segurança a este acordo.':'O valor reclamado de USD '+money(p.claimed)+' é contado uma vez.'} A quitação considera também pagamentos de outros anos.</p><div class="table-wrap">${table(INST_HEADERS,rows.map(installmentCells),{filterId:'detail-process',caption:'Parcelas do acordo',types:INST_SORT_TYPES,sortValues:rows.map(installmentSortValues)})}</div>`);}
  function worksheet(wb,title,headers,rows){const sh=XLSX.utils.aoa_to_sheet([headers,...rows]);sh['!cols']=headers.map((_,i)=>({wch:i<3?26:22}));for(let r=1;r<=rows.length;r++)for(let c=0;c<headers.length;c++){const cell=sh[XLSX.utils.encode_cell({r,c})];if(cell?.t==='n'){if(/%|recebido \/ reclamado|participação|pareto/i.test(headers[c]))cell.z='0%';else if(/USD/i.test(headers[c]))cell.z=['Fornecedores','Saldo aberto fornecedores'].includes(title)?'#,##0.00':'#,##0';}}if(rows.length)sh['!autofilter']={ref:XLSX.utils.encode_range({r:0,c:0},{r:rows.length,c:headers.length-1})};XLSX.utils.book_append_sheet(wb,sh,title);}
  function controlWorksheets(wb){const rows=installmentRows(),s=controlSummary(rows),procs=filteredProcesses(rows);
    worksheet(wb,'Resumo recebimentos',['Indicador','Valor USD','Parcelas','Critério'],[['Recebido total no Controle',s.confirmed,s.confirmedCount,'Controle integral: M = Pago, ano de R no período e T válido; independente de vínculo, ano RNC ou situação da BD'],['Recebido financeiro no recorte',s.realized,s.realizedCount,'Pagamentos no recorte de operações, incluindo claims de outros anos; o total do comparativo considera claims dos anos selecionados'],['Saldo em aberto',s.open,s.openCount,'Coluna O das parcelas vencidas ou dentro do prazo'],['Vencido',s.overdue,s.overdueCount,'Previsão anterior à data da análise e sem pagamento confirmado'],['Dentro do prazo',s.onTime,s.onTimeCount,'Inclui parcelas sem previsão'],['Sem previsão informada',s.noDue,s.noDueCount,'Subconjunto de Dentro do prazo; não somar novamente'],['Vínculo a conferir',null,s.reviewCount,'Não exclui valores próprios do Controle; conciliação separada'],['Pagamento ou previsão a conferir',null,s.paymentReviewCount,'Conferir as datas e os valores de origem'],['Saldo incompleto: parcela sem valor previsto',null,s.missingExpected,'Parcelas em aberto sem valor válido na coluna O']]);
    worksheet(wb,'Controle de recebimento',['Linha Controle','Ordem / NF','Fornecedor na análise','Fornecedor original','Confissão','Tipo negociação','Status original','Status na análise','Previsão N','Compensação R','Previsto USD O','Recebido USD T','Recebido confirmado no período','No comparativo executivo','Situação BD','Ano Data RNC · referência BD','Mercado BD · referência','Linhas BD','Vínculo','Ano da compensação R','Analista recebimento AF','Operação BD'],rows.map(i=>[i.row,i.reference,i.supplier,i.originalSupplier,i.confession,i.type,i.originalStatus,i.status,i.dueDate,i.compDate,i.expected,i.received,confirmedInstallment(i)?'Sim':'Não',i.includedInRealized?'Sim':'Não',i.claimStatus,i.year,i.market,i.bdRows.join('; '),i.linkState,i.compensationYear,i.receiptAnalyst,(i.operations||[]).join('; ')]));
    worksheet(wb,'Ordens e acordos',['Ordem / acordo','Fornecedor','Parcelas no filtro','Pagas no filtro','Vencidas no filtro','No prazo no filtro','Recebido confirmado no filtro USD','Recebido comparativo no filtro USD','Saldo em aberto no filtro USD','Total parcelas do acordo','Total pagas do acordo','Quitação do acordo completo','Linhas Controle no filtro','Todas as linhas do acordo','Valor integral Controle U USD','Valor acordado V USD','% do claim acordado','Recebido no acordo T USD - todos os anos','Saldo do acordo V menos T USD','Parcelas lançadas O USD','Situação do acordo','Vencido no filtro USD','No prazo no filtro USD','Parcelas em aberto no acordo','Parcelas a conferir no acordo','Parcelas com prejuízo no acordo'],procs.map(p=>[p.references.join('; '),p.supplier,p.selected.length,p.filteredPaid,p.filtered.overdueCount,p.filtered.onTimeCount,p.filtered.confirmed,p.filtered.realized,p.filtered.open,p.total,p.paid,p.status,p.selected.map(i=>i.row).join('; '),p.installments.join('; '),p.integralControl,p.agreed,p.agreementRate,p.receivedAllYears,p.agreementBalance,p.scheduledTotal,p.agreementStatus,p.filteredOverdueAmount,p.filteredOnTimeAmount,p.remainingOpen,p.review,p.loss]));
  }
  function correctionWorksheets(wb){const queue=reviewRows(),groups=[...new Set(queue.flatMap(row=>row.groups))],issues=queue.flatMap(row=>row.issues),changes=groups.flatMap(g=>groupChanges(g).map(c=>({g,c})));
    worksheet(wb,'Fila de conferencia',REVIEW_HEADERS,queue.map(reviewValues));
    worksheet(wb,'Correcoes',['Ordem / NF','Fornecedor BD','Analista na BD','Ano original','Ano correto BD','Mercado original','Mercado correto BD','Integral original U USD','Integral correto AJ USD','Quantidade linhas Controle','Linhas Controle','Células corrigidas','Referências originais no Controle','Linhas BD','Data RNC','Quantidade ajustes','Conferência','Arquivo de origem','Aba','Ajustado na planilha','Marcado por','Marcado em (Brasília)'],groups.map(g=>[g.reference,(g.suppliers||[g.supplier]).join('; '),analystText(g),g.year?.changes?.length?originalValues(g.year.originalValues):'Sem alteração',g.year?.changes?.length?originalValues(g.year.correctedValues):'Sem alteração',g.market?.changes?.length?originalValues(g.market.originalValues):'Sem alteração',g.market?.changes?.length?originalValues(g.market.correctedValues):'Sem alteração',g.claimValue?.changes?.length?originalValues(g.claimValue.originalValues):'Sem alteração',g.claimValue?.changes?.length?originalValues(g.claimValue.correctedValues):'Sem alteração',g.rows.length,g.rows.join('; '),groupChanges(g).map(c=>c.cell).join('; '),(g.references||[g.reference]).join('; '),g.bdRows.join('; '),(g.rncDates||[]).join('; '),g.correctionCount,g.hasConflictingCorrections?'Conferir valores diferentes por linha':'Aplicar os ajustes indicados às linhas listadas',state.controlName,'Controle Recebimento',g.progress?.done?'Sim':'Não',g.progress?.done?g.progress.updatedBy:'',g.progress?.done?progressDate(g.progress.updatedAt):'']));
    worksheet(wb,'Auditoria correcoes',['Ordem agrupada','Arquivo de origem','Aba','Linha Excel','Célula','Referência original','Fornecedor BD','Analista na BD','Campo','Valor original','Valor corrigido','Linhas BD','Data RNC','Regra aplicada'],changes.map(({g,c})=>[g.reference,state.controlName,'Controle Recebimento',c.row,c.cell,c.reference||g.reference,c.supplier||g.supplier,analystText(c),c.field,c.original,c.corrected,(c.bdRows||g.bdRows).join('; '),c.rncDate,c.reason]));
    worksheet(wb,'Conferencias',['Tipo','Linha','Ordem / NF','Fornecedor','Analista na BD','Linhas BD','Valor USD','Detalhe','SGR','NF','Células de origem'],issues.map(i=>[i.type||i.kind,i.row,i.reference,i.supplier,analystText(i),(i.bdRows||[]).join('; '),i.amount,i.detail,i.sgr||'',i.nf||'',(i.sourceCells||[]).join('; ')]));
  }
  function prepareExportViews(scope){
    const views=scope==='meeting'?['meeting']:scope==='analysts'?['analysts']:['claims','procurement'].includes(scope)?[scope]:scope==='control'?['installments']:scope===true?['corrections']:['overview','claims','corrections','installments','analysts','meeting'];
    for(const name of views)renderView(name);
  }
  function makeWorkbook(scope=false){if(!viewScopeMatches())throw new Error('Atualize o período desta aba antes de exportar.');if(state.model.meta.reportView==='suppliers')throw new Error('Carregue os detalhes completos pelo botão Exportar antes de gerar a planilha.');prepareExportViews(scope);if(scope==='meeting')return window.MinervaMeetings?.exportWorkbook();if(scope==='analysts')return window.MinervaAnalysts.exportWorkbook();if(!state.model)throw new Error('Importe as duas planilhas primeiro.');const m=state.model,wb=XLSX.utils.book_new(),correctionsOnly=scope===true,controlOnly=scope==='control';
    if(['claims','procurement'].includes(scope)){window.MinervaClaimControl.worksheets(wb,worksheet,scope);return wb;}
    if(controlOnly)controlWorksheets(wb);else {correctionWorksheets(wb);window.MinervaCorrectionImpact?.addWorksheets(wb);}
    worksheet(wb,'Criterios',['Critério','Valor'],[['Relatório',controlOnly?'Controle de recebimento':correctionsOnly?'Correções agrupadas por ordem':'Análise completa'],['Responsável','Administração'],['Cenário dos resultados',scenarioLabel()],['Data da análise',m.meta.asOf],['Publicado por',!state.bd&&state.publishedMeta?.updatedBy||'Prévia local — não publicada'],['Atualização (Brasília)',!state.bd&&state.publishedMeta?.updatedAt?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(state.publishedMeta.updatedAt)):'—'],['Anos dos claims / recebimentos',m.meta.years.join(', ')],['Fornecedor selecionado',appliedGlobal('supplier')||'Todos'],['Situações dos claims',asList(m.meta.claimStatuses).join(' · ')||'Todas as situações'],['Operação selecionada',controlOnly?controlOperationLabel():(appliedGlobal('operation')||'Todas as operações')],['Operação do Controle',controlOperationLabel()],['Escopo de operações do Controle','Controle integral, incluindo operações não identificadas. Recebidos por M/R/T; abertas de todos os anos até quitação. Filtros de fornecedor/operação podem restringir o recorte, sem exigir vínculo ou elegibilidade da BD.'],['Filtro do Controle',controlFilterText()],['Busca de correções',filterValue('correctionSearch').trim()||'Todas as ordens'],['Acompanhamento das correções',progressLabel()],['Marcação de ajuste','Conferência manual compartilhada; não altera os arquivos nem o cálculo financeiro. Novas divergências voltam a pendente.'],['Analista na BD',filterLabel('analystFilter','Todos os analistas')],['Origem do analista','BD!BE; todos os analistas das linhas vinculadas. Não identifica autoria de edição no Controle.'],['BD',state.bdName],['Controle',state.controlName],['Moeda','USD'],['Escopo do reclamado','Todas as situações da BD!G, exceto EM ANALISE, AGUARDANDO CUSTOS e RESPONDIDO-NÃO PROCEDE. Todas as operações, com filtro opcional; exclui INTERFERÊNCIA EXTERNA dos valores reclamados.'],['Em negociação','EM NEGOCIAÇÃO - PROCEDENTE; exclui pendência H contendo FUP'],['Data de entrada','BD!B — Data RNC'],['Ano do realizado','Controle Recebimento!R — Data compensação'],['Status do realizado','Controle Recebimento!M — somente Pago'],['Data para detalhamento mensal','Controle Recebimento!R — Data compensação; ano e mês vêm desta data'],['Valor realizado','Controle Recebimento!T — Valor Recebido USD'],['Realizado do comparativo','M = Pago, ano da data R no período e T positivo; fornecedor informado no Controle ou validado na BD; todas as operações, inclusive não identificadas, na opção geral; pagamentos sem referências detalhadas são contados uma vez. Inclui claims de outros anos e situações; separa mesmo ano, outros anos e ano a conferir.'],['Recebido confirmado no Controle','Todo o Controle com M = Pago, ano de R no período e T positivo; independente de vínculo, ano RNC, situação ou expurgo da BD. Com todos os fornecedores e operações, coincide com o recebido por analista.'],['Total recebido no comparativo',m.receiptCohorts.meta.comparableDefinition+' '+m.receiptCohorts.meta.claimYearColumns],['Perda',lossFormula()],['Prejuízo por claim','AJ menos AO da BD. AO é confrontado com a soma de O de todas as parcelas, independentemente de status ou ano. Não confundir AO/acordado com T efetivamente pago.'],['Saldo em aberto por fornecedor','Soma de O das linhas com M = Dentro do Prazo ou Vencido, de todos os anos; fornecedor do cenário selecionado e recorte de operações. Vencido é apenas a parte com M = Vencido e já está incluído no aberto. N não reclassifica esses saldos.'],['Status na análise do Controle','O acompanhamento do Controle mantém o status calculado pela data da análise; os saldos por fornecedor usam o status informado em M.'],['Quitação dos acordos','Contagens no filtro; quitação considera todas as parcelas. Percentual acordado = V/U, sem repetir valores por parcela; 100% acordado não significa recebido. Saldo do acordo = V menos T pago em todos os anos; saldo das parcelas = O das parcelas abertas.'],['Ocorrências',m.meta.occurrenceDefinition],['Vínculos','O Controle é a fonte do recebido. Referências sem detalhamento não excluem pagamentos confirmados; nomes/anos originais são preservados quando a BD não permite validar. Operações conhecidas fora do recorte não entram; operação não identificada entra no filtro geral, mas não em uma operação específica.'],['Correções','Uma linha por ordem em Correcoes; auditoria por célula em Auditoria correcoes. Linhas e valores originais preservados.'],['Originais','Os arquivos de origem não foram alterados. Correções aplicadas somente na análise.'],['Demonstração',state.demo?'DADOS FICTÍCIOS':'Não']]);
    if(!correctionsOnly&&!controlOnly){
      window.MinervaExecutive?.worksheets(wb,worksheet);
      window.MinervaClaimControl?.worksheets?.(wb,worksheet,'all');
      worksheet(wb,'Recebidos por ano do claim',['Ordem / NF','Fornecedor','Ano do pagamento R','Ano de referência','Classificação','Recebido USD','Data compensação R','Linha Controle','Linhas BD','Origem do ano','Validação BD','Observações'],(m.receiptCohorts?.rows||[]).map(r=>[r.reference,r.supplier,r.compensationYear,r.claimYear??(r.claimYears||[]).join('; '),cohortLabel(r.cohort),r.received,r.compDate,r.row,(r.bdRows||[]).join('; '),r.yearSource||'',r.validationState||'',(r.validationReasons||[]).join('; ')]));
      const overview=F.prepare('overviewTable',supplierHeaders(),m.suppliers,supplierCells,'Resumo por fornecedor',SUP_SORT);
      worksheet(wb,'Resumo visão geral',['Fornecedor','Reclamado USD',...claimYearLabels().map(label=>'Recebido '+label+' USD'),'Total recebido claims do período USD','Recebido / reclamado','Perda USD','Em negociação USD'],(F.has('overviewTable')?overview:overview.slice(0,6)).map(s=>[s.name,s.claimed,...claimYearValues(s),comparativeReceived(s),comparativeRate(s),loss(s),s.negotiating]));
      worksheet(wb,'Fornecedores',['Fornecedor','Reclamado USD',...claimYearLabels().map(label=>'Recebido '+label+' USD'),'Total recebido claims do período USD','Recebido / reclamado','Perda USD','% Perda','Em negociação USD','Ocorrências','Participação','Pareto acumulado','Saldo em aberto Controle USD','Vencido USD'],supplierRows('summary').list.map(s=>[s.name,s.claimed,...claimYearValues(s),comparativeReceived(s),comparativeRate(s),loss(s),s.claimed&&LOSS?loss(s)/s.claimed:null,s.negotiating,s.occurrences,s.share,s.pareto,s.openBalance,s.overdueBalance]));
      worksheet(wb,'Saldo aberto fornecedores',['Fornecedor no cenário','Fornecedor no Controle K','Linha Controle','Ordem / NF','Status informado M','Previsto O USD','Previsão N','Ano informado B','Origem do fornecedor'],supplierRows('summary').list.flatMap(s=>(s.openInstallments||[]).map(i=>[s.name,i.originalSupplier,i.row,i.reference,i.status,i.expected,i.dueDate,i.originalYear,i.supplierSource||'Controle K'])));
      worksheet(wb,'Comparativo anual',['Fornecedor','Ano','Reclamado USD por Data RNC',...claimYearLabels().map(label=>'Recebido '+label+' USD'),'Total recebido claims do período USD','Recebido / reclamado'],supplierRows('annual').list.flatMap(s=>m.meta.years.map(y=>{const a=supplierAnnual(s,y);return [s.name,y,a.claimed,...claimYearKeys().map(origin=>a.byYear[origin]),a.received,a.rate];})));
      controlWorksheets(wb);
      worksheet(wb,'Ocorrencias BD',['Linha BD','SGR','Ordem','NF','Fornecedor','Analista na BD','Data RNC','Ano','Mercado','Situação','Reclamado USD','Linhas Controle','Vínculo'],m.claims.map(c=>[c.row,c.sgr,c.order,c.nf,c.supplier,analystText(c),c.rncDate,c.year,c.market,c.status,c.claimed,c.matchedControlRows.join('; '),c.linkState]));
    }
    worksheet(wb,'Filtros das tabelas',['Tabela','Filtros e classificação aplicados'],F.criteria());
    return wb;
  }
  async function exportBook(scope){
    if(state.exportBookPending)return;const origin=state.view;state.exportBookPending=true;refreshViewScope();
    try{
      if(!await ensureFullModel()){if(state.view===origin)notice('Não foi possível carregar os dados completos para exportar. Tente novamente.',true);return;}
      if(scope==='procurement'){prepareExportViews(scope);window.MinervaClaimControl.exportProcurement();say('Excel de reunião gerado com o recorte do FUP.');return;}
      const wb=makeWorkbook(scope),prefix=scope==='meeting'?'Reuniao_Resultados':scope==='analysts'?'Recebimentos_Analistas':scope==='control'?'Controle_Recebimento':scope===true?'Correcoes':'Relatorio';XLSX.writeFile(wb,`${prefix}_Minerva_Claims_${state.model.meta.asOf}${state.demo?'_DEMONSTRACAO':''}.xlsx`,{compression:true});say('Planilha gerada com os filtros informados nos critérios. Os arquivos originais foram preservados.');
    }catch(e){notice(e.message,true);}
    finally{state.exportBookPending=false;refreshViewScope();}
  }
  function demo(){
    const demoAsOf='2026-03-31';
    const bd=Array.from({length:64},(_,i)=>'Coluna '+(i+1));Object.assign(bd,{0:'Nº SGR',1:'Data RNC',2:'Data Inclusão',3:'Mercado',5:'Status',6:'Situação',7:'Pendência',8:'Data ultima posição',9:'Data Fim Análise',10:'Motivo',11:'Data Log',12:'Tempo resposta',13:'Abertura claim',19:'País',22:'Ordem',24:'NF',25:'Operação',28:'Negociação',31:'Cia Maritima',32:'Nº container',35:'Reclamado (USD)',46:'Data NF',49:'Causador',56:'Analista',57:'SLA 25 Dias',61:'Prazo Neg. Claims',62:'Media Abertura Claim',63:'Dias Sem Atualização'});
    const cr=Array.from({length:32},(_,i)=>'Coluna '+(i+1));Object.assign(cr,{0:'Setor',1:'Ano Entrada',3:'Mercado',4:'País Origem',5:'País destíno',7:'Referência (Ordem/NF)',9:'N° Confissão',10:'Fornecedor',11:'Tipo de Negociação',12:'Status Pagamento',13:'Data Pagamento',14:'Valor USD',17:'Data compensação',19:'Valor Recebido USD',23:'Pagamento',30:'ANO COMPENSAÇÃO',31:'ANALISTA'});
    const claims=[],controls=[];
    for(let i=0;i<6;i++){const r=Array(64).fill(null);Object.assign(r,{56:'ANALISTA DEMONSTRAÇÃO',0:'DEMO-'+(i+1),1:i%2?'2026-02-10':'2025-06-12',2:'2026-03-01',3:'ME',5:i===5?'EM ABERTO':'CONCLUÍDO',6:i===5?'EM NEGOCIAÇÃO - PROCEDENTE':'RESSARCIMENTO ENCAMINHADO',7:i===5?'NEGOCIAÇÃO COM FORNECEDOR':'RECEBIMENTO EM ACOMPANHAMENTO',8:'2026-03-20',9:'2026-03-10',10:['AVARIA','OSCILAÇÃO DE TEMPERATURA','ATRASO NA ENTREGA','AVARIA','DOCUMENTAÇÃO INCORRETA','OSCILAÇÃO DE TEMPERATURA'][i],11:'2026-03-01',12:i%2?30:20,13:'2026-03-0'+(i+3),19:['BRA','ARG','COL','PRY','URY','BRA'][i],22:'DEMO/ORD-'+(i+1),24:900001+i,25:i<3?'EXPORTAÇÃO - CTNR':'EXPORTAÇÃO - CARRETA',28:['ARMADOR ALFA','ARMADOR BETA','ARMADOR GAMA','TRANSPORTADORA DELTA','TRANSPORTADORA ÉPSILON','ARMADOR ALFA'][i],31:i<3?['ARMADOR ALFA','ARMADOR BETA','ARMADOR GAMA'][i]:'',32:i<3?'DEMO-CONT-00'+(i+1):'',35:[120000,85000,65000,40000,24000,30000][i],46:i%2?'2026-02-01':'2025-06-01',49:['OPERADOR EXEMPLO A','OPERADOR EXEMPLO B','OPERADOR EXEMPLO A','TRANSPORTADORA EXEMPLO C','TRANSPORTADORA EXEMPLO D','OPERADOR EXEMPLO B'][i],57:i%2?0:1,61:[20,30,40,50,60,25][i],62:[5,10,15,20,25,30][i],63:11});claims.push(r);if(i===5)continue;for(let j=0;j<4;j++){const c=Array(32).fill(null);const paid=j<2;Object.assign(c,{0:i===3?'SGR MI':'SGR ME',1:2026,3:i===3?'MERCADO INTERNO':'MERCADO EXTERNO',4:r[19],5:'DESTINO DEMONSTRAÇÃO',7:r[22],9:'CONF. DEMO '+(i+1),10:r[28]+' LTDA',11:['Boleto','Depósito','Desconto','Rebate'][i%4],12:paid?'Pago':j===2?'Vencido':'Dentro do Prazo',13:j===3?null:'2026-03-10',14:r[35]/4,17:paid?`2026-0${j+2}-15`:null,19:paid?r[35]/4:0,23:paid?'Reembolsado':'Aguardando Pagamento',30:paid?2026:null,31:'ANALISTA DEMONSTRAÇÃO'});controls.push(c);}}
    const pipeline=[
      {supplier:'TRANSPORTADORA ETA',country:'BRA',status:'EM ANÁLISE',pending:'ANÁLISE DE DOCUMENTOS',amount:18000,reason:'AVARIA',operation:'IMPORTAÇÃO - CTNR'},
      {supplier:'ARMADOR DELTA',country:'ARG',status:'AGUARDANDO CUSTOS',pending:'INFORME DE CUSTOS',amount:12000,reason:'ATRASO NA ENTREGA',operation:'EXPORTAÇÃO - CTNR'},
      {supplier:'ARMADOR DELTA',country:'PRY',status:'EM NEGOCIAÇÃO - PROCEDENTE',pending:'AGUARDANDO RETORNO DO FORNECEDOR',amount:20000,reason:'OSCILAÇÃO DE TEMPERATURA',operation:'EXPORTAÇÃO - CTNR'},
      {supplier:'JURÍDICO — DEMONSTRAÇÃO',country:'BRA',status:'EM NEGOCIAÇÃO - PROCEDENTE',pending:'ANÁLISE JURÍDICA',amount:10000,reason:'AVARIA',operation:'COMERCIAL'},
      {supplier:'TRANSPORTADORA ZETA',country:'URY',status:'EM NEGOCIAÇÃO - PROCEDENTE',pending:'FUP SUPRIMENTOS — DEMONSTRAÇÃO',amount:25000,reason:'DOCUMENTAÇÃO INCORRETA',operation:'EXPORTAÇÃO - CARRETA'},
      {supplier:'ARMADOR DELTA',country:'COL',status:'EM NEGOCIAÇÃO - PROCEDENTE',pending:'NEGOCIAÇÃO EM ANDAMENTO',amount:15000,reason:'ATRASO NA ENTREGA',operation:'EXPORTAÇÃO - CTNR',rncDate:'2024-10-01',openingDate:'2024-10-15',invoiceDate:'2024-09-20'}
    ];
    pipeline.forEach((item,i)=>{const r=Array(64).fill(null);Object.assign(r,{0:'DEMO-'+(i+7),1:item.rncDate||'2026-02-15',2:item.rncDate||'2026-02-16',3:'ME',5:'EM ABERTO',6:item.status,7:item.pending,8:'2026-03-25',9:null,10:item.reason,11:'2026-03-01',13:item.openingDate||'2026-03-05',19:item.country,22:'DEMO/ORD-'+(i+7),24:900007+i,25:item.operation,28:item.supplier,31:item.supplier.startsWith('ARMADOR')?item.supplier:'',32:i===1?'DEMO-CONT-008':'',35:item.amount,46:item.invoiceDate||'2026-02-01',49:'CAUSADOR DEMONSTRAÇÃO '+(i+1),56:'ANALISTA DEMONSTRAÇÃO',57:null,61:null,62:item.openingDate?null:20,63:6});claims.push(r);});
    state.bd=[bd,...claims];state.control=[cr,...controls];state.bdName='BD — demonstração fictícia';state.controlName='Controle — demonstração fictícia';state.demo=true;setSelected('supplierFilter',[]);$('asOf').value=demoAsOf;document.querySelectorAll('input[name="year"]').forEach(el=>el.checked=Number(el.value)===2026);analyze();
  }
  function exportPdf(){
    if(!viewScopeMatches()){refreshViewScope();return;}
    renderView(state.view);
    if(state.view==='portfolio')return window.MinervaPortfolio?.exportPdf();
    if(state.view==='meeting')return window.MinervaMeetings?.exportPdf();
    if(!state.model)return;
    state.printing=true;
    const isAnalysts=state.view==='analysts';
    if(isAnalysts)window.MinervaAnalysts?.beforePrint();
    if(state.view==='corrections'){renderCorrections();window.MinervaCorrectionImpact?.beforePrint();}
    if(state.view==='installments')renderInstallments();
    const meta=state.bd&&state.control?null:state.publishedMeta;
    const updated=meta?.updatedAt?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(meta.updatedAt)):'Prévia local — ainda não publicada';
    const area=({overview:'Visão geral',suppliers:'Comparativo por fornecedor',installments:'Controle de recebimento',corrections:'Correção de base',claims:'Controle de claim',procurement:'FUP suprimentos',method:'Critérios da análise',analysts:'Recebimento por analista'})[state.view];
    const localFilters=isAnalysts?window.MinervaAnalysts.filterText():state.view==='installments'?controlFilterText():state.view==='corrections'?'Analista na BD: '+(filterLabel('analystFilter'))+' · Busca: '+(filterValue('correctionSearch').trim()||'Todas as ordens')+' · Acompanhamento: '+progressLabel():'';
    const scope=isAnalysts?'<p>Recebimentos do Controle integral · USD</p>':'<p>Período: '+esc(state.view==='procurement'||state.model.meta.allYears?'Todos os anos':state.model.meta.years.join(' + '))+' · '+(state.view==='procurement'?'Dias em aberto até '+date(state.model.procurementReport?.meta?.agingDate||E.today()):'Posição em '+date(state.model.meta.asOf))+' · USD</p><p>Fornecedor: '+esc(appliedGlobal('supplier')||'Todos')+' · Operação: '+esc(state.view==='installments'?controlOperationLabel():(appliedGlobal('operation')||'Todas as operações'))+'</p>'+(state.view==='suppliers'?'<p>Situações: '+esc(asList(state.model.meta.claimStatuses).join(' · ')||'Todas')+'</p>':'');
    $('printMetadata').innerHTML='<img src="/assets/minerva-logo.png" alt="Minerva Foods"><div><strong>Claims e recebimentos · '+esc(area)+'</strong><p>Responsável: Administração</p>'+scope+(!isAnalysts?'<p>'+esc(scenarioLabel())+'</p>':'')+'<p>'+esc(meta?.updatedBy?'Publicado por '+meta.updatedBy+' em '+updated+' (Brasília)':updated)+'</p>'+(localFilters?'<p>'+esc(localFilters)+'</p>':'')+'</div>';
    window.print();
  }
  function extraControls(){const el=$('supplierSearch');if(el){const wrap=document.createElement('div');wrap.className='table-tools-extra';wrap.innerHTML='<label>Exibição <select id="supplierMode"><option value="summary">Consolidado</option><option value="annual">Comparativo por ano</option></select></label><label>Ordem inicial <select id="supplierSort"><option value="claimed">Maior reclamado</option><option value="received">Maior recebido</option><option value="recoveryRate">Maior % recebido</option><option value="name">Nome do fornecedor</option></select></label>';el.parentElement.insertAdjacentElement('afterend',wrap);$('supplierMode').addEventListener('change',e=>{state.supplierMode=e.target.value;renderSuppliers();});$('supplierSort').addEventListener('change',e=>{state.sort=e.target.value;state.direction=e.target.value==='name'?1:-1;F.resetSort('supplier-'+state.supplierMode);renderSuppliers();});}}
  document.addEventListener('click',event=>{
    const progressButton=event.target.closest('[data-correction-progress]');if(progressButton){event.preventDefault();toggleCorrectionProgress(progressButton);return;}
    const chart=event.target.closest('[data-chart-month],[data-clear-chart-month],[data-chart-supplier],[data-clear-chart-supplier]');
    if(chart){if(chart.hasAttribute('data-chart-month'))selectChartMonth(chart.dataset.chartMonth);else if(chart.hasAttribute('data-clear-chart-month'))clearChartMonth();else selectChartSupplier(chart.dataset.chartSupplier||'');return;}
    const b=event.target.closest('[data-view],[data-supplier-detail],[data-process-detail],[data-correction-detail],[data-page-key]');if(!b)return;
    if(b.dataset.view)view(b.dataset.view);else if(b.dataset.supplierDetail)openSupplierDetail(b.dataset.supplierDetail);else if(b.dataset.processDetail)processDetail(b.dataset.processDetail);else if(b.dataset.correctionDetail)correctionDetail(b.dataset.correctionDetail);else if(b.dataset.pageKey){state[b.dataset.pageKey]=Number(b.dataset.page);['installmentsPage','processesPage'].includes(b.dataset.pageKey)?renderInstallments():renderCorrections();}
  });
  ['openImports','emptyImport'].forEach(id=>$(id)?.addEventListener('click',openImports));$('closeImports').addEventListener('click',()=>$('importDialog').close());$('closeDetail').addEventListener('click',()=>$('detailDialog').close());
  $('bdFile').addEventListener('change',e=>fileChanged(e,'bd'));$('controlFile').addEventListener('change',e=>fileChanged(e,'control'));
  $('correctionScenario').addEventListener('change',renderScenarioStatus);
  $('runAnalysis').addEventListener('click',analyze);$('applyFilters').addEventListener('click',analyze);$('demoButton').addEventListener('click',demo);
  document.querySelector('.year-options').addEventListener('change',event=>{const input=event.target;if(input.name!=='year')return;if(!document.querySelector('input[name="year"]:checked')){input.checked=true;say('Mantenha pelo menos um ano selecionado.');return;}if(state.model)analyze();});
  function applySection(ids,renderFn){ids.forEach(id=>applied[id]=$(id).multiple?selectValues(id):$(id).value);state.correctionsPage=state.issuesPage=state.installmentsPage=state.processesPage=1;renderFn();}
  function addApply(id,host,ids,renderFn){const button=document.createElement('button');button.id=id;button.type='button';button.className='button button-filter section-filter-apply';button.textContent='Aplicar';host.append(button);button.addEventListener('click',()=>applySection(ids,renderFn));ids.forEach(inputId=>$(inputId).addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();button.click();}}));}
  addApply('applySupplierTable',$('supplierSearch').closest('.panel-heading'),['supplierSearch'],renderSuppliers);
  addApply('applyControlFilters',document.querySelector('.receipt-filters'),['installmentSearch','typeFilter','statusFilter'],renderInstallments);
  addApply('applyCorrectionFilters',document.querySelector('.correction-tools'),['correctionSearch','analystFilter','correctionProgressFilter'],renderCorrections);
  function handleTableChange(id){if(window.MinervaClaimControl?.handlesTable(id)){window.MinervaClaimControl.handleFilter(id);return;}if(window.MinervaCorrectionImpact?.handlesTable(id)){window.MinervaCorrectionImpact.handleFilter();return;}if(window.MinervaMeetings?.handlesTable(id)){window.MinervaMeetings.handleFilter(id);return;}if(window.MinervaAnalysts?.handlesTable(id)){window.MinervaAnalysts.handleFilter(id);return;}state.correctionsPage=state.issuesPage=state.installmentsPage=state.processesPage=1;if(id.startsWith('detail-'))activeDetail?.();else if(state.model){const name=id.startsWith('supplier-')?'suppliers':id==='overviewTable'?'overview':['installmentTable','processTable'].includes(id)?'installments':['correctionTable','issueTable'].includes(id)?'corrections':state.view;renderView(name,true);}}
  F.onChange(handleTableChange);
  $('detailDialog').addEventListener('close',()=>{state.detailRequestVersion=(state.detailRequestVersion||0)+1;state.detailLoading=false;F.close();activeDetail=null;F.clearDetails();});
  document.addEventListener('minerva:session-updated',event=>{if(window.MINERVA_HOSTED&&!event.detail){state.viewFilters={};state.filterDefaults=null;state.claimStatuses=[];state.chartMonth='';state.chartSupplierBusy=false;F.clear();window.MinervaColumnLayout?.resetAll();window.MinervaAnalysts?.clear();window.MinervaCorrectionImpact?.clear();window.MinervaMeetings?.clear();window.MinervaPortfolio?.clear();window.MinervaPresentation?.close();activeDetail=null;for(const key of Object.keys(applied))applied[key]='';}});
  document.addEventListener('minerva:model-updated',()=>{if(!state.model){F.clear();window.MinervaMeetings?.clear();window.MinervaPortfolio?.clear();window.MinervaPresentation?.close();}});
  window.addEventListener('afterprint',()=>{state.printing=false;if(state.view==='analysts')window.MinervaAnalysts?.afterPrint();if(state.view==='corrections')window.MinervaCorrectionImpact?.afterPrint();if(state.model)renderView(state.view,true);});$('exportRules').addEventListener('click',()=>window.MinervaCalculationRules.exportPdf(state.model));
  $('exportPdf').addEventListener('click',exportPdf);$('exportReport').addEventListener('click',()=>exportBook(['claims','procurement'].includes(state.view)?state.view:state.view==='meeting'?'meeting':state.view==='analysts'?'analysts':state.view==='installments'?'control':false));$('exportCorrections').addEventListener('click',()=>exportBook(true));$('exportControl').addEventListener('click',()=>exportBook('control'));$('exportControlPdf').addEventListener('click',()=>{view('installments');exportPdf();});
  $('clearFiles')?.addEventListener('click',()=>{state.bd=state.control=state.model=null;state.chartMonth='';F.clear();window.MinervaColumnLayout?.resetAll();window.MinervaAnalysts?.clear();window.MinervaCorrectionImpact?.clear();window.MinervaMeetings?.clear();window.MinervaPortfolio?.clear();window.MinervaPresentation?.close();state.demo=false;$('bdFile').value=$('controlFile').value='';setText('bdFileInfo','Nenhum arquivo selecionado');setText('controlFileInfo','Nenhum arquivo selecionado');$('runAnalysis').disabled=true;$('emptyState').hidden=false;$('loadedContent').hidden=true;$('demoBanner').hidden=true;$('exportReport').disabled=$('exportCorrections').disabled=$('exportPdf').disabled=$('exportControl').disabled=$('exportControlPdf').disabled=true;['supplierTable','installmentTable','processTable','processSummary','correctionTable','issueTable'].forEach(id=>{if($(id))$(id).innerHTML=blank('Importe as planilhas para consultar os dados.');});setText('correctionBadge','0');say('Arquivos removidos da memória desta página.');view('overview');});
  $('brandLogo')?.addEventListener('error',event=>{event.target.hidden=true;const fallback=$('brandFallback');if(fallback)fallback.hidden=false;});
  for(const id of ['supplierFilter','operationFilter','typeFilter','statusFilter','analystFilter','correctionProgressFilter']){const el=$(id);if(el){el.multiple=true;el.setAttribute('data-multi-select','');el.dataset.placeholder=el.options[0]?.textContent||'Todos';el.dataset.applyTarget=['supplierFilter','operationFilter'].includes(id)?'#applyFilters':['typeFilter','statusFilter'].includes(id)?'#applyControlFilters':'#applyCorrectionFilters';}}
  const currentYear=Number(E.today().slice(0,4));
  document.querySelector('.year-options').innerHTML=[currentYear-1,currentYear].map(year=>'<label><input type="checkbox" name="year" value="'+year+'"'+(year===currentYear?' checked':'')+'><span>'+year+'</span></label>').join('');
  $('asOf').value=E.today();$('runAnalysis').disabled=true;$('exportReport').disabled=$('exportCorrections').disabled=$('exportPdf').disabled=$('exportControl').disabled=$('exportControlPdf').disabled=true;extraControls();setupSupplierYears();setupSupplierStatuses();state.filterDefaults=normalizedFilters({years:globalYears(),asOf:E.today()});
  document.querySelectorAll('[data-loss-formula],#lossFormula,#lossFormulaShort').forEach(el=>el.textContent=lossFormula());
  function setPublishedReport(payload){if(!acceptScenarioModel(payload.model)){refreshScopeWhenReady();return false;}state.appliedGlobal={...(state.requestedOptions||options())};state.bdName=payload.files.bd;state.controlName=payload.files.control;state.demo=false;state.publishedMeta={revision:payload.revision,updatedAt:payload.updatedAt,updatedBy:payload.updatedBy};if(payload.model.controlReport?.supplierOptions)state.supplierOptions=payload.model.controlReport.supplierOptions;else if(!$('supplierFilter').value)state.supplierOptions=payload.model.suppliers.map(s=>s.name);state.correctionsPage=state.installmentsPage=state.processesPage=state.issuesPage=1;$('emptyState').hidden=true;$('loadedContent').hidden=false;$('demoBanner').hidden=true;populateSuppliers();render();state.scopeRenderPending=false;state.scopeLoadFailed=false;refreshViewScope();document.dispatchEvent(new CustomEvent('minerva:model-updated'));say('Relatório compartilhado carregado.');}
  // Saved views contain configuration only; current bases are always reanalyzed.
  function sanitizeView(value={}){
    const raw=value&&typeof value==='object'?value:{},global=raw.global||{},list=input=>[...new Set(asList(input).slice(0,100).map(v=>v.slice(0,200)))],string=input=>String(input||'').slice(0,200);
    const locals={};for(const id of Object.keys(applied))locals[id]=['supplierSearch','installmentSearch','correctionSearch'].includes(id)?string(raw.local?.[id]):list(raw.local?.[id]);
    const claimFilters=input=>{const result={query:string(input?.query)};for(const key of ['country','status','pending','analyst','supplier'])result[key]=list(input?.[key]);return result;};
    const view=['overview','suppliers','installments','corrections','claims','procurement','analysts','meeting','portfolio','method'].includes(raw.view)?raw.view:'overview';
    return {version:1,view,supplierYears:cleanYears(raw.supplierYears).slice(0,30),global:{years:list(global.years).map(Number).filter(v=>Number.isInteger(v)&&v>=2000&&v<=2200).slice(0,30),asOf:/^\d{4}-\d{2}-\d{2}$/.test(global.asOf)?global.asOf:'',operations:list(global.operations),controlOperations:list(global.controlOperations),claimStatuses:list(global.claimStatuses),suppliers:list(global.suppliers),correctionScenario:global.correctionScenario==='original'?'original':'corrected'},local:locals,claims:{claims:claimFilters(raw.claims?.claims),procurement:claimFilters(raw.claims?.procurement),supplier:string(raw.claims?.supplier)},tableState:F.sanitizeState?.(raw.tableState)||{tables:[]},supplierMode:raw.supplierMode==='annual'?'annual':'summary',sort:['claimed','received','recoveryRate','name'].includes(raw.sort)?raw.sort:'claimed',chartMonth:/^\d{4}-(0[1-9]|1[0-2])$/.test(raw.chartMonth)?raw.chartMonth:'',analystYear:Number.isInteger(raw.analystYear)?raw.analystYear:null,meeting:{year:Number.isInteger(raw.meeting?.year)?raw.meeting.year:null,month:Number.isInteger(raw.meeting?.month)&&raw.meeting.month>=-1&&raw.meeting.month<=12?raw.meeting.month:0}};
  }
  function captureView(){
    if(!state.model)throw new Error('Carregue uma análise antes de salvar a visão.');
    if(!viewScopeMatches())throw new Error('Aguarde a atualização desta aba antes de salvar a visão.');
    const appliedOptions=state.appliedGlobal||state.model.meta||{};
    return sanitizeView({view:state.view,supplierYears:state.view==='suppliers'?(state.model.meta.allYears?[]:state.model.meta.years):state.supplierYears,global:{years:state.view==='suppliers'?globalYears():appliedOptions.years,asOf:appliedOptions.asOf,operations:appliedGlobalValues('operation'),controlOperations:appliedGlobalValues('controlOperation'),claimStatuses:asList(appliedOptions.claimStatuses),suppliers:appliedGlobalValues('supplier'),correctionScenario:currentScenario()},local:applied,claims:window.MinervaClaimControl?.getViewState(),tableState:F.exportState?.(),supplierMode:state.supplierMode,sort:state.sort,chartMonth:state.chartMonth,analystYear:window.MinervaAnalysts?.getViewState?.().year,meeting:window.MinervaMeetings?.getViewState?.()});
  }
  async function restoreView(value){
    if(state.analysisBusy||state.restoringSavedView)throw new Error('Aguarde a análise atual terminar.');
    if(!state.model)throw new Error('Carregue uma análise antes de aplicar a visão.');
    const saved=sanitizeView(value),years=[...document.querySelectorAll('input[name="year"]')],available=years.map(el=>Number(el.value));
    if(!saved.global.years.length||saved.global.years.some(year=>!available.includes(year)))throw new Error('O período desta visão não está disponível nos filtros atuais.');
    if(!saved.global.asOf)throw new Error('Esta visão não possui uma data de análise válida.');
    state.restoringSavedView=true;
    try{
      state.restoringView=true;try{view(saved.view);}finally{state.restoringView=false;}
      const viewVersion=state.viewVersion||0;
      clearActiveTableFilters();if(saved.view==='installments')state.chartMonth='';
      if(saved.view==='suppliers'){state.supplierYears=saved.supplierYears;state.claimStatuses=saved.global.claimStatuses;populateSupplierYears();populateSupplierStatuses();}
      state.operations=saved.global.operations;state.controlOperations=saved.global.controlOperations;state.operation=state.operations.join(' · ');state.controlOperation=state.controlOperations.join(' · ');populateOperations();
      for(const value of saved.global.suppliers)if(!Array.from($('supplierFilter').options).some(option=>option.value===value))$('supplierFilter').add(new Option(value,value));
      setSelected('supplierFilter',saved.global.suppliers);years.forEach(el=>el.checked=saved.global.years.includes(Number(el.value)));$('asOf').value=saved.global.asOf;$('correctionScenario').value=saved.global.correctionScenario;
      const analyzed=await analyze();if(analyzed!==true||!state.model||state.view!==saved.view||(state.viewVersion||0)!==viewVersion||!viewScopeMatches())throw new Error('Não foi possível atualizar os dados desta visão. Tente novamente.');
      const activeLocal=Object.fromEntries(localFilterIds(saved.view).map(id=>[id,saved.local[id]]));Object.assign(applied,activeLocal);for(const[id,value]of Object.entries(activeLocal)){const el=$(id);if(!el)continue;if(el.multiple){for(const selected of asList(value))if(!Array.from(el.options).some(option=>option.value===selected))el.add(new Option(selected,selected));setSelected(el,value);}else el.value=value;}
      if(saved.view==='suppliers'){state.supplierMode=saved.supplierMode;state.sort=saved.sort;state.direction=saved.sort==='name'?1:-1;}if(saved.view==='installments')state.chartMonth=saved.chartMonth;state.correctionsPage=state.installmentsPage=state.processesPage=state.issuesPage=1;
      if($('supplierMode'))$('supplierMode').value=state.supplierMode;if($('supplierSort'))$('supplierSort').value=state.sort;
      if(['claims','procurement'].includes(saved.view)){const previous=window.MinervaClaimControl?.getViewState?.()||{};window.MinervaClaimControl?.setViewState({...previous,[saved.view]:saved.claims[saved.view],supplier:saved.view==='procurement'?saved.claims.supplier:previous.supplier});}
      if(saved.view==='analysts')window.MinervaAnalysts?.setViewState?.({year:saved.analystYear});if(saved.view==='meeting')window.MinervaMeetings?.setViewState?.(saved.meeting);
      F.importState?.({tables:[...(F.exportState?.().tables||[]).filter(table=>tableOwner(table.id)!==saved.view),...saved.tableState.tables.filter(table=>tableOwner(table.id)===saved.view)]});state.renderedViews?.delete(saved.view);render(true);
      // Keep unavailable saved choices explicit instead of presenting an empty selection as Todos.
      for(const[id,value]of Object.entries({...activeLocal,supplierFilter:saved.global.suppliers})){const el=$(id);if(!el)continue;if(el.multiple){for(const selected of asList(value))if(!Array.from(el.options).some(option=>option.value===selected))el.add(new Option(selected,selected));setSelected(el,value);}else el.value=value;}
      window.MinervaMultiSelect?.refresh?.();say('Visão aplicada aos dados atuais.');return true;
    }finally{state.restoringSavedView=false;}
  }
  window.MinervaApp={state,analyze,captureView,restoreView,sanitizeView,setCorrectionScenario,scenarioLabel,makeWorkbook,getOptions:options,setPublishedReport,setServerLoader:fn=>state.serverLoader=fn,loadRows:async(bd,control,names={})=>{state.bd=bd;state.control=control;state.bdName=names.bd||'BD.xlsx';state.controlName=names.control||'Controle de Recebimento.xlsx';state.demo=false;await analyze();},view};
})();
