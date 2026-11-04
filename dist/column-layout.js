(function (global) {
  'use strict';
  if (typeof document === 'undefined') return;
  const widths = new Map();
  const MIN = 112, MAX = 720;
  let queued = false, drag = null, profileKey;
  const scale = () => Math.max(1, Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--minerva-text-scale')) || 1);
  const headers = table => Array.from(table.tHead?.rows[0]?.cells || []);
  const key = table => table.dataset.tableId;
  const tables = () => Array.from(document.querySelectorAll('table[data-table-id]'));
  const find = id => tables().find(table => key(table) === id);
  const clamp = (value,minimum = MIN) => Math.max(minimum, Math.min(MAX, value));
  let measureContext;
  function minimum(table,index) {
    const cell = headers(table)[index],label = title(cell),style = getComputedStyle(cell),ratio = scale();
    if (!measureContext) measureContext = document.createElement('canvas').getContext('2d');
    let wordWidth = 0;
    if (measureContext) {measureContext.font = style.font;wordWidth = Math.max(0,...label.split(/[\s·/]+/).map(word => measureContext.measureText(word).width));}
    const controls = cell.querySelector('.column-heading') ? 72 : 12;
    const readable = (wordWidth + controls + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)) / ratio;
    const content = /situação|status|conciliação|vínculo|quitação/i.test(label) ? 176 : /fornecedor/i.test(label) ? 150 : MIN;
    return Math.min(MAX,Math.max(content,Math.ceil(readable)));
  }
  function title(cell) { return cell.querySelector('.column-heading>span')?.textContent.trim() || cell.textContent.trim(); }
  function announce(message) {
    let el = document.getElementById('columnLayoutStatus');
    if (!el) {el = document.createElement('span');el.id = 'columnLayoutStatus';el.className = 'sr-only';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.append(el);}
    el.textContent = message;
  }
  function existing(table) {
    const saved = widths.get(key(table));
    if (saved?.length === headers(table).length) return saved.slice();
    return headers(table).map((cell,index) => clamp(cell.getBoundingClientRect().width / scale(),minimum(table,index)));
  }
  function apply(table) {
    const values = widths.get(key(table));
    if (!values || values.length !== headers(table).length) return;
    let group = table.querySelector(':scope > colgroup[data-column-widths]');
    if (!group) {group = document.createElement('colgroup');group.dataset.columnWidths = '';table.insertBefore(group,table.tHead);}
    while (group.children.length < values.length) group.append(document.createElement('col'));
    while (group.children.length > values.length) group.lastElementChild.remove();
    const ratio = scale();
    values.forEach((value,index) => {group.children[index].style.width = value * ratio + 'px';});
    table.classList.add('columns-sized');table.style.width = values.reduce((sum,value) => sum + value * ratio,0) + 'px';
    headers(table).forEach((cell,index) => {const handle = cell.querySelector('.column-resize-handle');if (handle) {handle.setAttribute('aria-valuenow',String(Math.round(values[index] * ratio)));handle.setAttribute('aria-valuemin',String(Math.round(minimum(table,index) * ratio)));handle.setAttribute('aria-valuemax',String(Math.round(MAX * ratio)));}});
    const toolbar = table.previousElementSibling;
    if (toolbar?.classList.contains('column-layout-toolbar')) toolbar.querySelector('[data-column-action="reset"]').disabled = false;
    syncTools(table);
  }
  function save(table,values) {widths.set(key(table),values.map((value,index) => clamp(value,minimum(table,index))));apply(table);}
  function reset(id) {
    widths.delete(id);
    for (const table of tables().filter(table => key(table) === id)) {
      table.classList.remove('columns-sized');table.style.removeProperty('width');table.querySelector(':scope > colgroup[data-column-widths]')?.remove();
      const button = table.previousElementSibling?.querySelector('[data-column-action="reset"]');if (button) button.disabled = true;
      headers(table).forEach(cell => cell.querySelector('.column-resize-handle')?.removeAttribute('aria-valuenow'));
    }
  }
  function finishDrag(cancelled = false) {
    if (!drag) return;
    const current = drag;drag = null;
    document.documentElement.classList.remove('column-resizing');
    current.handle.removeEventListener('pointermove',moveDrag);current.handle.removeEventListener('pointerup',endDrag);current.handle.removeEventListener('pointercancel',cancelDrag);current.handle.removeEventListener('lostpointercapture',cancelDrag);
    try {if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);} catch {}
    if (cancelled) {if (current.saved) save(current.table,current.saved);else reset(key(current.table));}
    else announce('Largura da coluna '+title(headers(current.table)[current.index])+' ajustada.');
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.table.isConnected) {finishDrag(true);return;}
    event.preventDefault();const values = drag.initial.slice();values[drag.index] = clamp(drag.initial[drag.index] + (event.clientX - drag.x) / drag.scale,minimum(drag.table,drag.index));save(drag.table,values);
  }
  function endDrag(event) {if (drag && event.pointerId === drag.pointerId) {event.preventDefault();event.stopPropagation();finishDrag();}}
  function cancelDrag() {finishDrag(true);}
  function beginDrag(event,table,index,handle) {
    if (event.button !== 0) return;
    event.preventDefault();event.stopPropagation();finishDrag(true);
    const initial = existing(table),saved = widths.get(key(table))?.slice();
    drag = {table,index,handle,initial,saved,x:event.clientX,scale:scale(),pointerId:event.pointerId};
    save(table,initial);document.documentElement.classList.add('column-resizing');handle.focus({preventScroll:true});
    handle.addEventListener('pointermove',moveDrag);handle.addEventListener('pointerup',endDrag);handle.addEventListener('pointercancel',cancelDrag);handle.addEventListener('lostpointercapture',cancelDrag);
    try {handle.setPointerCapture(event.pointerId);} catch {finishDrag(true);}
  }
  function measure(table,index) {
    const cells = Array.from(table.rows).map(row => row.cells[index]).filter(cell => cell && cell.colSpan === 1);
    const holder = document.createElement('div');holder.className = 'column-measure';holder.setAttribute('aria-hidden','true');document.body.append(holder);
    let largest = MIN * scale();
    for (const cell of cells) {
      const copy = cell.cloneNode(true),style = getComputedStyle(cell);
      copy.querySelectorAll('.column-resize-handle').forEach(el => el.remove());copy.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));copy.removeAttribute('id');
      copy.style.font = style.font;copy.style.letterSpacing = style.letterSpacing;copy.style.lineHeight = style.lineHeight;
      holder.replaceChildren(copy);
      // Measure natural content width, including headings and filter controls,
      // while bounding the result so long audit notes remain usable.
      largest = Math.max(largest,copy.getBoundingClientRect().width + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + (cell.tagName === 'TH' ? 36 : 18));
    }
    holder.remove();return clamp(largest / scale(),minimum(table,index));
  }
  function fitColumn(id,index) {const table = find(id);if (!table || !headers(table)[index]) return;const values = existing(table);values[index] = measure(table,index);save(table,values);announce('Coluna '+title(headers(table)[index])+' ajustada ao conteúdo exibido.');}
  function autoFit(id) {const table = find(id);if (!table) return;save(table,headers(table).map((_,index) => measure(table,index)));announce('Larguras ajustadas ao conteúdo exibido desta tabela.');}
  function keyboard(event,table,index) {
    if (['ArrowLeft','ArrowRight','+','-','=','Home','Enter'].includes(event.key)) {
      event.preventDefault();event.stopPropagation();
      if (event.key === 'Home' || event.key === 'Enter') {fitColumn(key(table),index);return;}
      const values = existing(table),step = event.shiftKey ? 40 : 12,direction = event.key === 'ArrowLeft' || event.key === '-' ? -1 : 1;
      values[index] = clamp(values[index] + direction * step,minimum(table,index));save(table,values);announce('Largura '+Math.round(values[index]*scale())+' pixels.');
    } else if (event.key === 'Escape' && drag) {event.preventDefault();finishDrag(true);}
  }
  function mount(table) {
    if (!table.tHead || !key(table)) return;
    if (!table.previousElementSibling?.classList.contains('column-layout-toolbar')) {
      const toolbar = document.createElement('div');toolbar.className = 'column-layout-toolbar';toolbar.dataset.tableControls = key(table);
      const hint = document.createElement('span');hint.className = 'column-layout-hint';hint.textContent = 'Arraste a borda do título para ajustar a coluna.';
      const controls = document.createElement('div');controls.className = 'column-layout-actions';
      for (const [action,label] of [['autofit','Autoajustar colunas'],['reset','Restaurar larguras']]) {
        const button = document.createElement('button');button.type = 'button';button.dataset.columnAction = action;button.textContent = label;button.title = action === 'autofit' ? 'Ajustar as colunas ao conteúdo exibido nesta página' : 'Voltar às larguras automáticas da tabela';
        if (action === 'reset') button.disabled = !widths.has(key(table));
        button.addEventListener('click',() => {if (action === 'autofit') autoFit(key(table));else {reset(key(table));announce('Larguras automáticas restauradas.');}});controls.append(button);
      }
      const scrollControls = document.createElement('div');scrollControls.className = 'column-scroll-actions';scrollControls.setAttribute('role','group');scrollControls.setAttribute('aria-label','Navegar pelas colunas');
      for (const [direction,label,symbol] of [[-1,'Ver colunas à esquerda','←'],[1,'Ver colunas à direita','→']]) {
        const button = document.createElement('button');button.type = 'button';button.dataset.columnScroll = String(direction);button.textContent = symbol;button.setAttribute('aria-label',label);button.title = label;
        button.addEventListener('click',() => {const container = table.closest('.table-container,.table-wrap');container?.scrollBy({left:direction*Math.max(220,container.clientWidth*.75),behavior:'smooth'});});scrollControls.append(button);
      }
      toolbar.append(hint,controls,scrollControls);table.before(toolbar);
    }
    headers(table).forEach((cell,index) => {
      if (cell.querySelector('.column-resize-handle')) return;
      cell.classList.add('column-resizable');
      const handle = document.createElement('span');handle.className = 'column-resize-handle';handle.dataset.columnIndex = index;handle.tabIndex = 0;
      handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');handle.setAttribute('aria-label','Redimensionar coluna '+title(cell));handle.title = 'Arraste para ajustar. Duplo clique para autoajustar. Use ← e → pelo teclado.';
      const reportWidth = () => {handle.setAttribute('aria-valuenow',String(Math.round(cell.getBoundingClientRect().width || minimum(table,index)*scale())));handle.setAttribute('aria-valuemin',String(Math.round(minimum(table,index)*scale())));handle.setAttribute('aria-valuemax',String(Math.round(MAX*scale())));};reportWidth();handle.addEventListener('focus',reportWidth);
      handle.addEventListener('pointerdown',event => beginDrag(event,table,index,handle));handle.addEventListener('click',event => {event.preventDefault();event.stopPropagation();});handle.addEventListener('dblclick',event => {event.preventDefault();event.stopPropagation();fitColumn(key(table),index);});handle.addEventListener('keydown',event => keyboard(event,table,index));cell.append(handle);
    });apply(table);
    syncTools(table);
  }
  function syncTools(table) {
    const container = table.closest('.table-container,.table-wrap'),toolbar = table.previousElementSibling;
    if (container && toolbar?.classList.contains('column-layout-toolbar')) {container.style.setProperty('--column-tools-height',toolbar.getBoundingClientRect().height+'px');for (const button of toolbar.querySelectorAll('[data-column-scroll]')) button.disabled = container.scrollWidth <= container.clientWidth+1;}
  }
  function refresh() {queued = false;if (drag && !drag.table.isConnected) finishDrag(true);tables().forEach(mount);}
  function schedule() {if (!queued) {queued = true;requestAnimationFrame(refresh);}}
  function resetAll() {finishDrag(true);for (const id of widths.keys()) reset(id);widths.clear();}
  global.MinervaColumnLayout = {refresh,reset,resetAll,autoFit,fitColumn,getWidths:id => widths.get(id)?.slice() || null};
  function init() {
    refresh();new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','open']});
    new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:['data-text-size']});
    document.addEventListener('minerva:reset-columns',resetAll);
    document.addEventListener('minerva:session-updated',event => {const profile = event.detail,key = profile ? [profile.name,profile.email,profile.role].join('|') : '';if (profileKey !== undefined && profileKey !== key) resetAll();profileKey = key;});
    global.addEventListener('blur',() => finishDrag(true));
    global.addEventListener('resize',schedule);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);
