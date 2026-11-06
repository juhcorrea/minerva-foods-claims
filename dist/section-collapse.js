(function (global) {
  'use strict';
  const states = new Map(), bindings = new Map();
  let observer = null, queued = false, refreshing = false;
  const $ = selector => document.querySelector(selector);
  const all = selector => Array.from(document.querySelectorAll(selector));
  const idFor = value => { let hash = 2166136261; for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return 'sc-' + (hash >>> 0).toString(36); };
  const setAttribute = (node, name, value) => { if (node.getAttribute(name) !== String(value)) node.setAttribute(name, String(value)); };
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  function apply(binding) {
    const collapsed = states.get(binding.key) === true;
    for (const target of binding.targets) {
      target.classList.add('section-collapse-target');
      setAttribute(target, 'data-sc-kind', binding.kind);
      setAttribute(target, 'data-sc-collapsed', collapsed);
    }
    setAttribute(binding.button, 'aria-expanded', !collapsed);
    setText(binding.button, (collapsed ? 'Expandir ' : 'Recolher ') + (binding.kind === 'filters' ? 'filtros' : 'base'));
  }
  function bind(key, kind, targets, heading, label) {
    targets = targets.filter(Boolean);
    if (!targets.length) return;
    const id = idFor(key), primary = targets[0];
    let button = document.getElementById(id + '-button');
    if (!button) {
      const bar = document.createElement('div');
      bar.className = 'section-collapse-bar ' + (heading ? 'sc-heading-control' : 'sc-inline-control') + (kind === 'filters' ? ' sc-filter-control' : ' sc-base-control');
      if (!heading) {
        const title = document.createElement('span');
        title.className = 'section-collapse-label'; title.textContent = label || (kind === 'filters' ? 'Filtros' : 'Base de dados'); bar.append(title);
      }
      button = document.createElement('button'); button.type = 'button'; button.id = id + '-button'; button.className = 'section-collapse-button'; button.dataset.scKey = key;
      bar.append(button);
      if (heading) heading.append(bar); else primary.parentElement.insertBefore(bar, primary);
    }
    targets.forEach((target, index) => { if (!target.id) target.id = id + '-target-' + index; });
    setAttribute(button, 'aria-controls', targets.map(target => target.id).join(' '));
    const binding = {key, kind, targets, button}; bindings.set(key, binding); apply(binding);
  }
  function headingFor(target) {
    const panel = target.closest('.panel,.cc-panel,dialog');
    return panel?.querySelector(':scope > .panel-heading,:scope > .cc-table-heading,:scope > .dialog-heading') || null;
  }
  function tableTargets(target) {
    const targets = [target], parent = target.parentElement;
    if (!parent) return targets;
    for (const child of parent.children) if (child !== target && child.matches('.pagination,.cc-pagination,.meeting-detail-footer,.cc-table-criteria,.table-filter-summary,.cc-basis')) targets.push(child);
    return targets;
  }
  function syncGlobal() {
    const block = document.getElementById('globalFilterBlock'), original = document.getElementById('dashboardFiltersToggle');
    if (!block || !original) return;
    let button = document.getElementById('sectionGlobalFiltersToggle');
    if (!button) {
      const bar = document.createElement('div'); bar.className = 'section-collapse-bar sc-inline-control sc-global-control';
      const title = document.createElement('span'); title.className = 'section-collapse-label'; title.textContent = 'Filtros da análise';
      button = document.createElement('button'); button.id = 'sectionGlobalFiltersToggle'; button.type = 'button'; button.className = 'section-collapse-button'; button.dataset.scGlobal = 'true'; button.setAttribute('aria-controls', 'globalFilterBlock');
      bar.append(title, button); block.parentElement.insertBefore(bar, block);
    }
    const expanded = original.getAttribute('aria-expanded') !== 'false';
    setAttribute(button, 'aria-expanded', expanded); setText(button, expanded ? 'Recolher filtros' : 'Expandir filtros');
  }
  function refresh() {
    if (refreshing) return;
    refreshing = true; queued = false; observer?.disconnect();
    try {
      bindings.clear();
      const used = new Set();
      const addTable = (target, key) => {
        if (!target || [...used].some(existing => existing === target || existing.contains(target))) return;
        used.add(target); target.dataset.scBaseKey = key; bind(key, 'base', tableTargets(target), headingFor(target), target.getAttribute('aria-label') || 'Base de dados');
      };
      for (const id of ['overviewTable','supplierTable','processTable','installmentTable','correctionTable','issueTable']) addTable(document.getElementById(id), 'base:' + id);
      for (const [selector, key] of [['.analyst-summary-panel > .table-container','analyst-summary'],['.analyst-payments-panel > .table-container','analyst-payments'],['#claimRecords .cc-table-wrap','claim-records'],['#meetingDetailDialog .meeting-detail-scroll','meeting-detail']]) addTable($(selector), 'base:' + key);
      for (const target of all('.table-container,.table-wrap,.exec-detail-table-wrap')) {
        if (target.closest('.cc-procurement-root') || !target.querySelector('table')) continue;
        const table = target.querySelector('table'), view = target.closest('[id^="view-"],dialog');
        const key = table.dataset.tableId || target.id || table.id || (view?.id || 'detail') + ':' + (table.getAttribute('aria-label') || table.querySelector('caption')?.textContent || 'table');
        addTable(target, target.dataset.scBaseKey || 'base:table:' + key);
      }
      for (const [selector, key, label] of [
        ['.receipt-filters','receipts','Filtros do recebimento'],
        ['.correction-tools','corrections','Filtros das correções'],
        ['#analystYearForm','analysts','Filtros por analista'],
        ['#meetingFilters','meeting','Filtros da reunião']
      ]) { const target = $(selector); if (target) bind('filters:' + key, 'filters', [target], null, label); }
      const supplierSearch = document.getElementById('supplierSearch')?.closest('.search-field');
      if (supplierSearch) {
        const heading = supplierSearch.closest('.panel-heading');
        if (heading) {
          heading.classList.add('sc-supplier-heading');
          let controls = document.getElementById('scSupplierControls');
          if (!controls) {
            controls = document.createElement('div'); controls.id = 'scSupplierControls'; controls.className = 'sc-supplier-controls';
            const tools = heading.querySelector('.table-tools-extra'), apply = document.getElementById('applySupplierTable');
            heading.insertBefore(controls, supplierSearch);
            for (const element of [supplierSearch, tools, apply]) if (element) controls.append(element);
          }
          bind('filters:suppliers', 'filters', [controls], null, 'Filtros dos fornecedores');
        }
      }
      for (const form of all('.cc-filters')) {
        const scope = form.dataset.ccForm || form.closest('[id]')?.id || 'claims';
        bind('filters:cc-' + scope, 'filters', [form], null, 'Filtros ' + (scope === 'procurement' ? 'do FUP' : 'dos claims'));
      }
      syncGlobal();
    } finally {
      refreshing = false;
      observer?.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['aria-expanded']});
    }
  }
  function schedule() { if (!queued) { queued = true; (global.requestAnimationFrame || (callback => global.setTimeout(callback, 0)))(refresh); } }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-sc-key],[data-sc-global]');
    if (!button) return;
    if (button.dataset.scGlobal) {
      global.MinervaDashboardPresentation?.setFiltersCollapsed(button.getAttribute('aria-expanded') !== 'false'); syncGlobal(); return;
    }
    const binding = bindings.get(button.dataset.scKey); if (!binding) return;
    states.set(binding.key, states.get(binding.key) !== true); apply(binding);
    if (states.get(binding.key) !== true) global.requestAnimationFrame?.(() => global.MinervaColumnLayout?.refresh());
  });
  if (global.MutationObserver) observer = new global.MutationObserver(schedule);
  document.addEventListener('minerva:model-updated', schedule);
  refresh();
  global.MinervaSectionCollapse = {refresh, isCollapsed: key => states.get(key) === true};
})(window);
