(function (global) {
  'use strict';
  const records = new Set(), bySelect = new WeakMap();
  let active = null, observer = null, queued = false, serial = 0;
  const resolve = value => typeof value === 'string' ? document.getElementById(value) : value;
  const options = select => Array.from(select?.options || []).filter(option => option.value !== '');
  const values = value => [...new Set(Array.from(resolve(value)?.selectedOptions || []).map(option => option.value).filter(Boolean))];
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
  const label = option => option.label || option.textContent || option.value;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const title = select => select.dataset.filterTitle || select.getAttribute('aria-label') || select.closest('label')?.querySelector('span')?.textContent || 'Filtro';
  const placeholder = select => select.dataset.placeholder || Array.from(select.options).find(option => option.value === '')?.textContent || 'Todas as opções';
  function setValues(value, selected) {
    const select = resolve(value); if (!select) return [];
    const wanted = new Set((Array.isArray(selected) ? selected : selected == null ? [] : [selected]).map(String));
    for (const option of select.options) option.selected = option.value !== '' && wanted.has(option.value);
    const record = bySelect.get(select); if (record) sync(record);
    return values(select);
  }
  function close(restoreFocus = false) {
    if (!active) return;
    const record = active; active = null;
    record.popup.hidden = true; record.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && record.button.isConnected) record.button.focus();
  }
  function position(record) {
    if (!record.popup || record.popup.hidden) return;
    const rect = record.button.getBoundingClientRect(), viewportWidth = global.innerWidth, viewportHeight = global.innerHeight;
    if (rect.bottom < 0 || rect.top > viewportHeight) { close(); return; }
    const width = Math.min(220, viewportWidth - 16);
    const below = viewportHeight - rect.bottom - 12, above = rect.top - 12, useAbove = below < 230 && above > below;
    const available = Math.max(100, Math.min(viewportHeight - 16, useAbove ? above : below));
    record.popup.style.width = width + 'px'; record.popup.style.maxHeight = available + 'px';
    record.popup.style.left = Math.max(8, Math.min(rect.left, viewportWidth - width - 8)) + 'px';
    record.popup.style.top = (useAbove ? Math.max(8, rect.top - record.popup.getBoundingClientRect().height - 6) : Math.max(8, rect.bottom + 6)) + 'px';
  }
  const enabled = option => !option.disabled && option.parentElement?.disabled !== true;
  const visibleOptions = record => options(record.select).filter(option=>enabled(option)&&normalize(label(option)).includes(normalize(record.search.value.trim())));
  function refreshActions(record) {
    const visible=visibleOptions(record),selected=values(record.select),query=record.search.value.trim();
    const scope=query?visible:options(record.select).filter(enabled),wanted=new Set(selected);
    record.clearAction=scope.length>0&&scope.every(option=>wanted.has(option.value))&&selected.length===scope.length;
    setText(record.toggle,record.clearAction?'Limpar':'Marcar todos');
    record.toggle.disabled=!!query&&!visible.length;
    record.done.disabled=!!query&&!visible.length||record.selectionEdited&&!selected.length&&!record.resetRequested;
    setText(record.count,selected.length+' de '+options(record.select).length+' selecionados');
  }
  function refreshList(record) {
    if (!record.list) return;
    const query = normalize(record.search.value), all = options(record.select), fragment = document.createDocumentFragment();
    let count = 0;
    for (const option of all) {
      if (!normalize(label(option)).includes(query)) continue;
      const row = document.createElement('label'); row.className = 'multi-select-option';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.value = option.value; checkbox.checked = option.selected; checkbox.disabled = option.disabled || option.parentElement?.disabled === true;
      checkbox.dataset.multiValue = option.value;
      const text = document.createElement('span'); text.textContent = label(option); row.append(checkbox, text); fragment.append(row); count++;
    }
    if (!count) { const empty = document.createElement('p'); empty.className = 'multi-select-empty'; empty.textContent = 'Nenhuma opção encontrada.'; fragment.append(empty); }
    record.list.replaceChildren(fragment);
    refreshActions(record);
    position(record);
  }
  function commit(record, selected) {
    setValues(record.select, selected);
    record.select.dispatchEvent(new Event('change', {bubbles: true}));
  }
  function applySelection(record) {
    const query=record.search.value.trim();
    if(query&&!visibleOptions(record).length)return;
    if(query&&!record.selectionEdited)commit(record,visibleOptions(record).map(option=>option.value));
    if(record.selectionEdited&&!values(record.select).length&&!record.resetRequested)return;
    const selector = record.select.dataset.applyTarget;
    const target = selector ? document.querySelector(selector) : null;
    const form = record.select.closest('form');
    close(true);
    if (target) { target.click(); return; }
    if (form?.requestSubmit) { form.requestSubmit(); return; }
    record.select.dispatchEvent(new CustomEvent('minerva:filter-apply', {bubbles: true, detail: {selectId: record.select.id, values: values(record.select)}}));
  }
  function buildPopup(record) {
    const popup = document.createElement('div'); popup.id = record.button.getAttribute('aria-controls'); popup.className = 'multi-select-popover'; popup.hidden = true; popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label',title(record.select));
    const search = document.createElement('input'); search.type = 'search'; search.className = 'multi-select-search'; search.placeholder = 'Pesquisar…'; search.setAttribute('aria-label', 'Buscar em ' + title(record.select)); search.autocomplete = 'off';
    const list = document.createElement('div'); list.className = 'multi-select-options'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Opções de ' + title(record.select));
    const footer = document.createElement('div'); footer.className = 'multi-select-footer'; const count = document.createElement('span'); count.className='multi-select-count';count.setAttribute('role', 'status');
    const toggle=document.createElement('button');toggle.type='button';toggle.setAttribute('data-multi-action','toggle');
    toggle.addEventListener('click',()=>{
      if(toggle.disabled)return;record.selectionEdited=true;
      if(record.clearAction){search.value='';record.resetRequested=true;commit(record,[]);}
      else{record.resetRequested=false;commit(record,(search.value.trim()?visibleOptions(record):options(record.select).filter(enabled)).map(option=>option.value));}
      refreshList(record);
    });
    const done = document.createElement('button'); done.type = 'button';done.setAttribute('data-multi-action','apply'); done.textContent = 'Aplicar'; done.addEventListener('click', () => applySelection(record)); footer.append(toggle, done);
    popup.append(search, list, count, footer); document.body.append(popup);
    Object.assign(record, {popup, search, list, count,toggle,done});
    search.addEventListener('input', () => refreshList(record));
    list.addEventListener('change', event => {
      const checkbox = event.target.closest('input[data-multi-value]'); if (!checkbox) return;
      let selected = new Set(values(record.select));
      const allEnabled=options(record.select).filter(enabled);
      if(record.search.value.trim()&&!record.selectionEdited&&selected.size===allEnabled.length&&allEnabled.every(option=>selected.has(option.value)))selected=new Set(visibleOptions(record).map(option=>option.value));
      record.selectionEdited=true;record.resetRequested=false;
      checkbox.checked ? selected.add(checkbox.value) : selected.delete(checkbox.value); commit(record, [...selected]);
    });
    popup.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || event.target === search) return;
      const checkboxes = Array.from(list.querySelectorAll('input')).filter(input => !input.disabled), index = checkboxes.indexOf(document.activeElement); if (!checkboxes.length) return;
      event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? checkboxes.length - 1 : Math.max(0, Math.min(checkboxes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1))); checkboxes[next].focus();
    });
  }
  function open(record) {
    if (record.select.disabled) return;
    if (active === record) { close(true); return; }
    close(); if (!record.popup) buildPopup(record); active = record;
    record.selectionEdited=false;record.resetRequested=false;record.search.value='';record.popup.hidden = false; record.button.setAttribute('aria-expanded', 'true'); sync(record); refreshList(record); record.search.focus();
  }
  function sync(record) {
    const selected = options(record.select).filter(option => option.selected), count = selected.length;
    const summary = count === 0 ? placeholder(record.select) : count === 1 ? label(selected[0]) : count === 2 ? selected.map(label).join(', ') : count + ' selecionados';
    setText(record.label, summary); record.button.disabled = record.select.disabled;
    const accessible = title(record.select) + ': ' + summary; if (record.button.getAttribute('aria-label') !== accessible) record.button.setAttribute('aria-label', accessible);
    record.button.title = count ? selected.map(label).join('\n') : placeholder(record.select);
    if (!record.popup) return;
    if (record.select.disabled && active === record) close();
    const signature = JSON.stringify(options(record.select).map(option => [option.value, label(option), option.disabled, option.parentElement?.disabled === true]));
    if (record.signature !== signature) { record.signature = signature; refreshList(record); }
    else {
      const wanted = new Set(values(record.select)); for (const checkbox of record.list.querySelectorAll('input')) checkbox.checked = wanted.has(checkbox.value);
      refreshActions(record);
    }
  }
  function mount(select) {
    let record = bySelect.get(select); if (record) { sync(record); return; }
    const wrapper = document.createElement('div'); wrapper.className = 'multi-select-control';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'multi-select-button'; button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'multi-select-popup-' + (++serial));
    const text = document.createElement('span'); text.className = 'multi-select-value'; const caret = document.createElement('span'); caret.className = 'multi-select-caret'; caret.textContent = '⌄'; caret.setAttribute('aria-hidden', 'true'); button.append(text, caret); wrapper.append(button); select.parentElement.insertBefore(wrapper, select);
    select.classList.add('multi-select-native'); select.setAttribute('aria-hidden', 'true'); select.tabIndex = -1;
    record = {select, wrapper, button, label: text, popup: null, signature: null}; records.add(record); bySelect.set(select, record);
    button.addEventListener('click', () => open(record)); button.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); if (active !== record) open(record); } }); sync(record);
  }
  function refresh() {
    queued = false; observer?.disconnect();
    try {
      for (const record of records) if (!record.select.isConnected) { if (active === record) close(); record.wrapper.remove(); record.popup?.remove(); records.delete(record); }
      for (const select of document.querySelectorAll('select[multiple][data-multi-select]')) mount(select);
    } finally { observer?.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'label', 'value', 'selected', 'multiple', 'data-multi-select']}); }
  }
  function schedule() { if (!queued) { queued = true; global.requestAnimationFrame(refresh); } }
  document.addEventListener('change', event => { const record = bySelect.get(event.target); if (record) sync(record); });
  document.addEventListener('pointerdown', event => { if (active && !active.popup.contains(event.target) && !active.button.contains(event.target)) close(); });
  document.addEventListener('focusin', event => { if (active && !active.popup.contains(event.target) && !active.button.contains(event.target)) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) { event.preventDefault(); close(true); } });
  global.addEventListener('resize', () => { if (active) position(active); }); global.addEventListener('scroll', () => { if (active) position(active); }, true);
  document.addEventListener('minerva:model-updated', schedule);
  if (global.MutationObserver) observer = new global.MutationObserver(schedule);
  global.MinervaMultiSelect = {values, setValues, refresh, close}; refresh();
})(window);
