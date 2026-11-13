(function(global){
  'use strict';
  const entries=new Map(),selections=new Map(),sorts=new Map();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const text=html=>{const template=document.createElement('template');template.innerHTML=String(html??'');template.content.querySelectorAll('.cell-subtext,.progress-bar').forEach(el=>el.remove());return (template.content.textContent||'').replace(/\s+/g,' ').trim()||'Sem informação';};
  const collator=new Intl.Collator('pt-BR',{numeric:true,sensitivity:'base'});
  let onChange=()=>{},popup=null,anchor=null;
  const selected=id=>selections.get(id)||new Map();
  const missing=value=>value==null||typeof value==='number'&&!Number.isFinite(value)||['','—','–','-','n/a','sem informacao','nao informado','sem previsao informada'].includes(normalize(value).trim());
  function numberKey(value){
    if(missing(value))return null;
    if(typeof value==='number')return value;
    let valueText=String(value).trim().replace(/\u2212/g,'-').replace(/\s+/g,'').replace(/^(?:USD|BRL|US\$|R\$|\$)/i,'');
    const negative=/^\(.*\)$/.test(valueText);if(negative)valueText=valueText.slice(1,-1);
    const percent=valueText.endsWith('%');if(percent)valueText=valueText.slice(0,-1);
    if(valueText.includes(',')){if(!/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d+$/.test(valueText))return null;valueText=valueText.replace(/\./g,'').replace(',','.');}
    else if(/^[+-]?\d{1,3}(?:\.\d{3})+$/.test(valueText))valueText=valueText.replace(/\./g,'');
    else if(!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(valueText))return null;
    let result=Number(valueText);if(!Number.isFinite(result))return null;if(negative)result=-result;if(percent)result/=100;return result;
  }
  function validDate(year,month,day){const value=Date.UTC(year,month-1,day),date=new Date(value);return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?value:null;}
  function dateKey(value){
    if(Array.isArray(value)){const dates=value.map(dateKey).filter(v=>v!==null);return dates.length?Math.min(...dates):null;}
    if(missing(value))return null;
    if(value instanceof Date)return Number.isFinite(value.getTime())?value.getTime():null;
    if(typeof value==='number')return Number.isFinite(value)?value:null;
    const dates=[];for(const match of String(value).matchAll(/(?:\b(\d{4})-(\d{2})-(\d{2})(?:\b|(?=T)))|(?:\b(\d{2})\/(\d{2})\/(\d{4})\b)/g)){const date=match[1]?validDate(Number(match[1]),Number(match[2]),Number(match[3])):validDate(Number(match[6]),Number(match[5]),Number(match[4]));if(date!==null)dates.push(date);}
    // A grouped cell can contain several RNC dates; sort by its earliest valid date.
    return dates.length?Math.min(...dates):null;
  }
  function inferType(header){const value=normalize(header);if(/data|previsao|compensacao/.test(value)&&!/quantidade/.test(value))return 'date';if(/usd|%|recebido \/ reclamado|ocorrencias|participacao|pareto|parcelas no filtro|pagas no filtro|vencidas no filtro|no prazo no filtro|^linha (excel|bd|controle)$/.test(value))return 'number';return 'text';}
  function key(value,type){if(type==='number')return numberKey(value);if(type==='date')return dateKey(value);return missing(value)?null:String(value).trim();}
  function labels(type){return type==='number'?['Do menor para o maior','Do maior para o menor']:type==='date'?['Da mais antiga para a mais recente','Da mais recente para a mais antiga']:['De A a Z','De Z a A'];}
  function prepare(id,headers,rows,cells,label,options={}){
    const values=rows.map(row=>cells(row).map(text)),plainHeaders=headers.map(text),types=plainHeaders.map((h,index)=>['text','number','date'].includes(options.types?.[index])?options.types[index]:inferType(h));
    const raw=typeof options.sortValues==='function'?rows.map((row,index)=>options.sortValues(row,index)):null;
    const previous=entries.get(id),activeFilters=selected(id);if(previous&&options.register!==false){for(const col of [...activeFilters.keys()])if(previous.headers[col]!==plainHeaders[col])activeFilters.delete(col);const activeSort=sorts.get(id);if(activeSort&&previous.headers[activeSort.column]!==plainHeaders[activeSort.column])sorts.delete(id);}
    if(options.register!==false)entries.set(id,{headers:plainHeaders,rows,values,types,label:label||id});
    const ignored=new Set((Array.isArray(options.ignoreColumns)?options.ignoreColumns:[]).filter(col=>Number.isInteger(col)&&col>=0&&col<headers.length)),filters=selected(id),sort=sorts.get(id);let indices=rows.map((_,index)=>index).filter(index=>[...filters].every(([col,allowed])=>ignored.has(col)||allowed.has(values[index][col])));
    if(sort&&sort.column<headers.length){const col=sort.column,type=types[col],direction=sort.direction==='desc'?-1:1,keys=indices.map(index=>[index,key(raw&&raw[index]&&Object.prototype.hasOwnProperty.call(raw[index],col)?raw[index][col]:values[index][col],type)]),lookup=new Map(keys);
      indices.sort((a,b)=>{const first=lookup.get(a),second=lookup.get(b);if(first===null)return second===null?a-b:1;if(second===null)return -1;const order=type==='text'?collator.compare(first,second):first-second;return order?direction*order:a-b;});
    }
    return indices.map(index=>rows[index]);
  }
  function has(id){return selected(id).size>0;}
  function getSort(id){const value=sorts.get(id);return value?{...value}:null;}
  function sanitizeState(snapshot){
    const tables=[],ids=new Set(),column=value=>Number.isInteger(value)&&value>=0&&value<=100;
    for(const item of (Array.isArray(snapshot?.tables)?snapshot.tables:[]).slice(0,100)){
      if(!item||typeof item.id!=='string'||!item.id||item.id.length>100||/[\u0000-\u001f\u007f]/.test(item.id)||ids.has(item.id))continue;
      const filters=[],columns=new Set();
      for(const filter of (Array.isArray(item.filters)?item.filters:[]).slice(0,101)){
        if(!filter||!column(filter.column)||columns.has(filter.column)||!Array.isArray(filter.values))continue;
        const values=[...new Set(filter.values.slice(0,500).filter(value=>typeof value==='string'&&value.length<=300&&!/[\u0000-\u001f\u007f]/.test(value)))];
        filters.push({column:filter.column,values});columns.add(filter.column);
      }
      const sort=column(item.sort?.column)&&['asc','desc'].includes(item.sort?.direction)?{column:item.sort.column,direction:item.sort.direction}:null;
      if(!filters.length&&!sort)continue;
      tables.push({id:item.id,filters,sort});ids.add(item.id);
    }
    return {tables};
  }
  function exportState(){return sanitizeState({tables:[...new Set([...selections.keys(),...sorts.keys()])].map(id=>({id,filters:[...selected(id)].map(([column,values])=>({column,values:[...values]})),sort:getSort(id)}))});}
  function importState(snapshot){
    const clean=sanitizeState(snapshot);selections.clear();sorts.clear();entries.clear();close();
    for(const item of clean.tables){if(item.filters.length)selections.set(item.id,new Map(item.filters.map(filter=>[filter.column,new Set(filter.values)])));if(item.sort)sorts.set(item.id,{...item.sort});}
    return clean;
  }
  function hasSort(id){return sorts.has(id);}
  function ariaSort(id,col){const value=sorts.get(id);return value?.column===col?value.direction==='asc'?'ascending':'descending':'none';}
  function resetSort(id){sorts.delete(id);close();onChange(id);}
  function describeFilters(id){const entry=entries.get(id);return entry?[...selected(id)].map(([col,values])=>entry.headers[col]+': '+([...values].join(', ')||'nenhum valor')).join(' · '):'';}
  function describeSort(id){const entry=entries.get(id),sort=sorts.get(id);return entry&&sort?'Ordenação: '+entry.headers[sort.column]+' · '+labels(entry.types[sort.column])[sort.direction==='desc'?1:0]+(entry.types[sort.column]==='date'?' (data válida mais antiga da célula)':''):'';}
  function describe(id){return [describeFilters(id),describeSort(id)].filter(Boolean).join(' · ');}
  function summary(id){
    if(!entries.has(id))return '';const filters=describeFilters(id),order=describeSort(id);const scope=/^detail-(exec|rx)-/.test(id)?'Filtro apenas deste detalhe; os indicadores mantêm o recorte original.':id.startsWith('detail-')?'Filtro apenas deste detalhe; a quitação continua considerando o acordo completo.':id==='processTable'?'Filtro apenas dos acordos; os indicadores acima seguem as parcelas.':id==='installmentTable'?'Este filtro atualiza as parcelas e os indicadores do Controle.':'Filtro desta tabela; os indicadores gerais mantêm o recorte principal.';
    return `<div class="table-filter-summary"><span>${filters?'Filtros desta tabela: '+esc(filters):order?'':'Filtre e ordene pelas setas nos títulos das colunas.'}${order?`<span class="table-sort-summary">${esc(order)}</span>`:''}<span class="filter-scope">${esc(scope)}</span></span><span class="table-summary-actions">${filters?`<button type="button" class="table-clear-filters" data-clear-table="${esc(id)}">Limpar filtros</button>`:''}${order?`<button type="button" class="table-clear-filters" data-reset-table-sort="${esc(id)}">Restaurar ordem</button>`:''}</span></div>`;
  }
  function heading(id,col,label){const sort=sorts.get(id),active=sort?.column===col;return `<span class="column-heading" data-column-type="${entries.get(id)?.types[col]||'text'}"><span>${label}</span>${active?`<span class="column-sort-indicator" aria-hidden="true">${sort.direction==='asc'?'↑':'↓'}</span>`:''}<button type="button" class="column-filter-trigger${selected(id).has(col)?' is-filtered':''}${active?' is-sorted':''}" data-filter-table="${esc(id)}" data-filter-column="${col}" aria-haspopup="dialog" aria-label="Filtrar e ordenar ${esc(text(label))}" title="Filtrar e ordenar ${esc(text(label))}" aria-expanded="false"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 5h14l-5.5 6v4l-3 1v-5Z"/></svg></button></span>`;}
  function close(focus=false){popup?.remove();popup=null;if(anchor){anchor.setAttribute('aria-expanded','false');if(focus&&anchor.isConnected)anchor.focus();}anchor=null;}
  function open(button){
    close();anchor=button;const id=button.dataset.filterTable,col=Number(button.dataset.filterColumn),entry=entries.get(id);if(!entry)return;
    // A column's choices follow the other filters, never its own selection.
    // Search is only a preview until Apply. Explicit checkbox edits retain a
    // multi-value draft across searches; bulk selection replaces that draft.
    const filters=selected(id),universe=[...new Set(entry.values.map(row=>row[col]))],all=[...new Set(entry.values.filter(row=>[...filters].every(([other,allowed])=>other===col||allowed.has(row[other]))).map(row=>row[col]))].sort(collator.compare);
    let draft=new Set(filters.get(col)||universe),draftAll=!filters.has(col),draftSort=getSort(id),query='',selectionEdited=false,resetRequested=false;
    popup=document.createElement('section');popup.className='column-filter-popup';popup.setAttribute('role','dialog');popup.setAttribute('aria-label','Filtrar e ordenar '+entry.headers[col]);
    popup.innerHTML='<label class="filter-search-label"><span class="sr-only">Pesquisar opções</span><input type="search" class="column-filter-search" placeholder="Pesquisar…" autocomplete="off"></label><div class="column-filter-options"></div><details class="column-sort-disclosure"><summary>Ordenar</summary><fieldset class="column-sort-options"><legend class="sr-only">Ordenar esta coluna</legend><button type="button" data-sort-direction="asc" aria-pressed="false"></button><button type="button" data-sort-direction="desc" aria-pressed="false"></button><button type="button" data-sort-direction="default" aria-pressed="false">Ordem padrão</button></fieldset></details><p class="column-filter-count" role="status"></p><div class="column-filter-footer"><button type="button" class="button secondary" data-filter-toggle>Marcar todos</button><button type="button" class="button button-filter" data-filter-apply>Aplicar</button></div>';
    (button.closest('dialog')||document.body).append(popup);button.setAttribute('aria-expanded','true');
    const sortLabels=labels(entry.types[col]);popup.querySelector('[data-sort-direction="asc"]').textContent=sortLabels[0];popup.querySelector('[data-sort-direction="desc"]').textContent=sortLabels[1];
    function renderSort(){popup.querySelectorAll('[data-sort-direction]').forEach(choice=>{const direction=choice.dataset.sortDirection;choice.setAttribute('aria-pressed',String(direction==='default'?!draftSort:draftSort?.column===col&&draftSort.direction===direction));});popup.querySelector('.column-sort-disclosure summary').textContent=draftSort?.column===col?'Ordenar · '+(draftSort.direction==='desc'?'↓':'↑'):'Ordenar';}
    popup.querySelectorAll('[data-sort-direction]').forEach(choice=>choice.addEventListener('click',()=>{const direction=choice.dataset.sortDirection;draftSort=direction==='default'?null:{column:col,direction};renderSort();}));
    const list=popup.querySelector('.column-filter-options'),count=popup.querySelector('.column-filter-count'),toggle=popup.querySelector('[data-filter-toggle]'),applyButton=popup.querySelector('[data-filter-apply]'),search=popup.querySelector('input[type=search]');
    const visibleOptions=()=>all.filter(value=>normalize(value).includes(normalize(query)));
    const clearAction=()=>{const scope=query?visibleOptions():universe;return scope.length>0&&scope.every(value=>draft.has(value))&&draft.size===scope.length;};
    function updateCount(){const marked=all.filter(value=>draft.has(value)).length,outside=draftAll?0:draft.size-marked;count.textContent=(query?visibleOptions().length+' resultado(s) na busca · ':'')+marked+' de '+all.length+' opções do recorte selecionadas'+(outside?' · '+outside+' seleção(ões) fora do recorte':'');toggle.textContent=clearAction()?'Limpar':'Marcar todos';toggle.disabled=applyButton.disabled=!!query&&!visibleOptions().length;}
    function apply(){
      if(query&&!visibleOptions().length)return;
      if(query&&!selectionEdited){draft=new Set(visibleOptions());draftAll=false;}
      const filters=new Map(selected(id));if(resetRequested||draftAll||universe.length>0&&universe.every(value=>draft.has(value))&&draft.size===universe.length)filters.delete(col);else filters.set(col,new Set(draft));selections.set(id,filters);if(draftSort)sorts.set(id,{...draftSort});else sorts.delete(id);close();onChange(id);document.querySelector(`[data-filter-table="${id}"][data-filter-column="${col}"]`)?.focus();
    }
    function render(){
      const visible=visibleOptions();list.replaceChildren();
      for(const value of visible){
        const option=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),span=document.createElement('span');
        option.className='column-filter-option';check.type='checkbox';check.checked=draft.has(value);span.textContent=value;
        check.addEventListener('change',()=>{if(query&&!selectionEdited&&(draftAll||draft.size===universe.length&&universe.every(item=>draft.has(item))))draft=new Set(visibleOptions());selectionEdited=true;resetRequested=false;draftAll=false;check.checked?draft.add(value):draft.delete(value);updateCount();});
        label.append(check,span);option.append(label);list.append(option);
      }
      if(!visible.length){const p=document.createElement('p');p.textContent=all.length?'Nenhuma opção encontrada.':'Nenhuma opção neste recorte. Confira os demais filtros.';list.append(p);}updateCount();
    }
    search.addEventListener('input',event=>{query=event.target.value.trim();render();});
    toggle.onclick=()=>{if(toggle.disabled)return;const clear=clearAction();selectionEdited=true;if(clear){query='';search.value='';draft.clear();draftAll=false;resetRequested=true;}else{draft=new Set(query?visibleOptions():universe);draftAll=!query;resetRequested=false;}render();};
    applyButton.onclick=apply;
    renderSort();render();const rect=button.getBoundingClientRect(),width=Math.min(220,innerWidth-24);popup.style.width=width+'px';popup.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';const height=Math.min(popup.getBoundingClientRect().height,innerHeight-24);popup.style.top=Math.max(12,Math.min(rect.bottom+7,innerHeight-height-12))+'px';search.focus();
  }
  document.addEventListener('click',event=>{const filter=event.target.closest('[data-filter-table]');if(filter){open(filter);return;}const clear=event.target.closest('[data-clear-table]');if(clear){const id=clear.dataset.clearTable;selections.delete(id);onChange(id);return;}const reset=event.target.closest('[data-reset-table-sort]');if(reset)resetSort(reset.dataset.resetTableSort);});
  document.addEventListener('pointerdown',event=>{if(popup&&!popup.contains(event.target)&&!anchor?.contains(event.target))close();});
  document.addEventListener('keydown',event=>{if(popup&&event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);}if(popup&&event.key==='Tab'){const items=[...popup.querySelectorAll('button,input,summary')].filter(el=>{const details=el.closest('details');return !el.disabled&&!el.hidden&&!el.closest('[hidden]')&&(!details||details.open||el.tagName==='SUMMARY');}),first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}},true);
  global.addEventListener('resize',()=>close());global.addEventListener('beforeprint',()=>close());
  global.MinervaTableFilters={prepare,heading,summary,has,describe,getSort,hasSort,ariaSort,resetSort,close,exportState,importState,sanitizeState,onChange:fn=>onChange=fn,clearColumn:(id,column)=>{selections.get(id)?.delete(column);},clear:()=>{selections.clear();sorts.clear();entries.clear();close();},clearDetails:(prefix='detail-')=>{for(const id of [...entries.keys()])if(id.startsWith(prefix)){entries.delete(id);selections.delete(id);sorts.delete(id);}},criteria:()=>[...entries].filter(([id])=>has(id)||hasSort(id)).map(([id,entry])=>[entry.label,describe(id)])};
})(window);
