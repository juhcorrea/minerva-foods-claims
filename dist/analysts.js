(function (global) {
  'use strict';
  const SUMMARY = 'analyst-summary', PAYMENTS = 'analyst-payments', PAGE_SIZE = 60;
  const TARGET_YEAR = 2026, TARGET_100 = 300000, TARGET_150 = 450000;
  const state = {model: null, year: null, draftYear: null, page: 1, printing: false, summary: [], payments: []};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
  const amount = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits: 0});
  const percent = value => (Number(value || 0) * 100).toLocaleString('pt-BR', {maximumFractionDigits: 0}) + '%';
  const date = value => { if (!value) return '—'; const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/); return match ? `${match[3]}/${match[2]}/${match[1]}` : String(value); };
  const report = () => state.model?.receiptReport;
  const years = () => [...new Set((report()?.years || []).map(Number).filter(Number.isFinite))].sort((a, b) => b - a);
  const annual = () => report()?.annual?.find(row => Number(row.year) === state.year) || {received: 0, count: 0, monthlyUnallocated: 0};
  const sourceRows = () => (report()?.rows || []).filter(row => Number(row.compensationYear) === state.year);
  const F = () => global.MinervaTableFilters;
  function heading(id, headers, numeric) {
    return '<thead><tr>' + headers.map((label, index) => `<th scope="col" class="${numeric.includes(index) ? 'num' : 'text-cell'}" aria-sort="${F()?.ariaSort(id, index) || 'none'}">${F() ? F().heading(id, index, esc(label)) : esc(label)}</th>`).join('') + '</tr></thead>';
  }
  function table(id, headers, rows, cells, numeric, label) {
    return `${F()?.summary(id) || ''}<div class="analyst-table-scroll table-wrap" tabindex="0" aria-label="${esc(label)} — role para ver todas as colunas"><table data-table-id="${id}"><caption class="sr-only">${esc(label)}</caption>${heading(id, headers, numeric)}<tbody>${rows.length ? rows.map(row => '<tr>' + cells(row).map((cell, index) => `<td class="${numeric.includes(index) ? 'num' : 'text-cell'}">${cell}</td>`).join('') + '</tr>').join('') : `<tr><td colspan="${headers.length}" class="empty-table">Nenhum recebimento corresponde aos filtros desta tabela.</td></tr>`}</tbody></table></div>`;
  }
  function prepareTables() {
    const total = Number(annual().received || 0);
    const summary = (report()?.analysts || []).filter(row => Number(row.year) === state.year).map(row => ({...row, share: total ? row.received / total : 0})).sort((a, b) => b.received - a.received || String(a.name).localeCompare(String(b.name), 'pt-BR'));
    const summaryHeaders = ['Analista · AF', 'Recebido USD · T', 'Parcelas pagas', '% do recebido no ano'];
    const summaryCells = row => [esc(row.name || 'Não informado'), amount(row.received), amount(row.count), percent(row.share)];
    const paymentHeaders = ['Ordem / NF', 'Fornecedor · Controle', 'Analista · AF', 'Tipo de negociação', 'Status · M', 'Ano da compensação · R', 'Compensação · R', 'Recebido USD · T', 'Linha Excel'];
    const paymentCells = row => [esc(row.reference || '—'), esc(row.originalSupplier || row.supplier || 'Não informado'), esc(row.receiptAnalyst || 'Não informado'), esc(row.type || '—'), '<span class="badge analyst-paid">Pago</span>', esc(row.compensationYear), esc(date(row.compDate)), amount(row.received), amount(row.row)];
    state.summary = F() ? F().prepare(SUMMARY, summaryHeaders, summary, summaryCells, 'Recebimento por analista — resumo', {types: ['text', 'number', 'number', 'number'], sortValues: row => [row.name, row.received, row.count, row.share]}) : summary;
    state.payments = F() ? F().prepare(PAYMENTS, paymentHeaders, sourceRows(), paymentCells, 'Recebimento por analista — parcelas pagas', {types: ['text', 'text', 'text', 'text', 'text', 'number', 'date', 'number', 'number'], sortValues: row => [row.reference, row.originalSupplier || row.supplier, row.receiptAnalyst, row.type, row.status, row.compensationYear, row.compDate, row.received, row.row]}) : sourceRows();
    return {summaryHeaders, summaryCells, paymentHeaders, paymentCells};
  }
  function goals(received) {
    if (state.year !== TARGET_YEAR) return `<div class="analyst-year-note">Consulta de ${state.year}. As metas de USD 300.000 e USD 450.000 foram definidas para 2026.</div>`;
    const delta100 = Math.max(0, TARGET_100 - received), delta150 = Math.max(0, TARGET_150 - received);
    const status = received >= TARGET_150 ? '150% atingido' : received >= TARGET_100 ? '100% atingido · rumo a 150%' : 'Rumo a 100%';
    const progress = Math.max(0, Math.min(100, received / TARGET_100 * 100));
    return `<section class="analyst-goal panel" aria-labelledby="analystGoalHeading"><div class="analyst-goal-heading"><div><p class="section-kicker">Meta da equipe · 2026</p><h3 id="analystGoalHeading">Cada recebimento aproxima a meta.</h3></div><span class="analyst-goal-status">${status}</span></div><div class="analyst-goal-progress-label"><span>Progresso até a meta de 100%</span><strong>${percent(Math.min(1, Math.max(0, received / TARGET_100)))}</strong></div><div class="analyst-goal-track" role="progressbar" aria-label="Progresso até a meta de 100%" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.toFixed(2)}"><span style="width:${progress}%"></span></div><div class="analyst-milestones"><div><span class="analyst-milestone-label">100% da meta</span><strong>USD ${amount(TARGET_100)}</strong><span data-analyst-delta="100">${delta100 > 0 ? `Faltam USD ${amount(delta100)}` : 'Meta atingida'}</span></div><div><span class="analyst-milestone-label">150% da meta</span><strong>USD ${amount(TARGET_150)}</strong><span data-analyst-delta="150">${delta150 > 0 ? `Faltam USD ${amount(delta150)}` : 'Meta atingida'}</span></div></div><p class="analyst-footnote">Meta única da equipe. Os valores por analista não representam metas individuais.</p></section>`;
  }
  function render(model) {
    if (model !== undefined) state.model = model;
    const container = document.getElementById('view-analysts');
    if (!container) return;
    container.classList.add('analyst-view');
    if (!report()) {
      container.innerHTML = '<div class="panel analyst-empty"><p class="section-kicker">Recebimento por analista</p><h2>Atualize a análise para consultar os recebimentos.</h2><p>Esta visão usa a aba Controle Recebimento: ano pela data R, status Pago em M, valor USD em T e analista em AF.</p></div>';
      return;
    }
    const available = years();
    if (!available.includes(state.year)) { state.year = available.includes(TARGET_YEAR) ? TARGET_YEAR : available[0] || TARGET_YEAR; state.draftYear = state.year; state.page = 1; }
    if (!available.includes(state.draftYear)) state.draftYear = state.year;
    const {summaryHeaders, summaryCells, paymentHeaders, paymentCells} = prepareTables();
    const current = annual(), received = Number(current.received || 0), count = Number(current.count || 0);
    const pages = Math.max(1, Math.ceil(state.payments.length / PAGE_SIZE));
    state.page = Math.min(Math.max(1, state.page), pages);
    const shown = state.printing ? state.payments : state.payments.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    const shownReceived = state.payments.reduce((total, row) => total + Number(row.received || 0), 0);
    const issueCount = report().issues?.length || 0;
    container.innerHTML = `<div class="analyst-title-row"><div><p class="section-kicker">Realizado do Controle</p><h2>Recebimento por analista</h2><p class="panel-description">Todo o recebido com status Pago, agrupado pelo ano de compensação e pelo analista do Controle.</p></div><div class="analyst-export-actions"><button type="button" class="button secondary" data-analyst-action="excel">Baixar Excel</button><button type="button" class="button secondary" data-analyst-action="pdf">Exportar PDF</button></div></div><form class="analyst-year-form panel" id="analystYearForm"><label for="analystReceiptYear">Ano da compensação · R<select id="analystReceiptYear" name="year">${(available.length ? available : [state.year]).map(year => `<option value="${year}"${year === state.draftYear ? ' selected' : ''}>${year}</option>`).join('')}</select></label><button type="submit" class="button button-filter">Aplicar</button><p id="analystYearStatus" role="status">Exibindo ${state.year}. Esta visão usa o Controle integral, sem os filtros de fornecedor, operação ou ano da BD.</p></form><div class="analyst-kpis"><article class="panel analyst-kpi"><span>Recebido em ${state.year}</span><strong data-analyst-kpi="received">${amount(received)}</strong><small>USD · Controle T · M = Pago · ano de R = ${state.year}</small></article><article class="panel analyst-kpi"><span>Parcelas pagas</span><strong data-analyst-kpi="count">${amount(count)}</strong><small>Linhas do Controle no ano selecionado</small></article><article class="panel analyst-kpi"><span>Analistas no ano</span><strong data-analyst-kpi="analysts">${amount((report().analysts || []).filter(row => Number(row.year) === state.year).length)}</strong><small>Identificação na coluna AF</small></article></div>${goals(received)}<section class="panel analyst-summary-panel" aria-labelledby="analystSummaryHeading"><div class="panel-heading"><div><p class="section-kicker">Participação no recebido</p><h3 id="analystSummaryHeading">Resultado por analista <span class="analyst-count">${state.summary.length}</span></h3><p class="panel-description">O percentual considera todo o recebido de ${state.year}. Os filtros desta tabela não alteram a meta da equipe nem as parcelas abaixo.</p></div></div><div class="table-container">${table(SUMMARY, summaryHeaders, state.summary, summaryCells, [1, 2, 3], 'Recebimento por analista em ' + state.year)}</div></section><section class="panel analyst-payments-panel" aria-labelledby="analystPaymentsHeading"><div class="panel-heading"><div><p class="section-kicker">Auditoria do realizado</p><h3 id="analystPaymentsHeading">Parcelas pagas <span class="analyst-count">${amount(state.payments.length)}</span></h3><p class="panel-description">No filtro desta tabela: USD ${amount(shownReceived)}. O ano e o mês vêm da data de compensação R. Os filtros desta tabela não alteram o resumo nem a meta.</p></div></div><div class="table-container">${table(PAYMENTS, paymentHeaders, shown, paymentCells, [5, 7, 8], 'Parcelas pagas no Controle em ' + state.year)}${!state.printing && pages > 1 ? `<div class="pagination analyst-pagination"><span>${amount(state.payments.length)} registros · página ${state.page} de ${pages}</span><button type="button" class="button secondary" data-analyst-page="${state.page - 1}"${state.page === 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="button secondary" data-analyst-page="${state.page + 1}"${state.page === pages ? ' disabled' : ''}>Próxima</button></div>` : ''}</div></section><div class="analyst-source-note"><strong>Critério do recebido:</strong> Controle Recebimento!M = Pago; ano e mês pela data R; valor em T; analista em AF. M/R/T confirmam o recebido, sem exigir validação na BD. Uma linha agrupada soma T uma vez, mesmo sem detalhamento por ordem. Valores originais e centavos são preservados no Excel.${issueCount ? ` Há ${amount(issueCount)} apontamentos de qualidade disponíveis na aba Conferência do Excel.` : ''}</div><p class="analyst-export-status" id="analystExportStatus" role="status"></p>`;
    global.MinervaColumnLayout?.refresh();
  }
  function filterText() {
    return [`Ano da compensação (R): ${state.year || '—'}`, 'Controle integral · M = Pago · T = USD · analista AF', F()?.describe(SUMMARY), F()?.describe(PAYMENTS)].filter(Boolean).join(' · ');
  }
  function appendSheet(workbook, name, headers, rows, numeric = [], ratios = []) {
    const sheet = global.XLSX.utils.aoa_to_sheet([headers, ...rows]);
    sheet['!cols'] = headers.map((_, index) => ({wch: numeric.includes(index) || ratios.includes(index) ? 22 : 29}));
    sheet['!autofilter'] = {ref: global.XLSX.utils.encode_range({s: {r: 0, c: 0}, e: {r: rows.length, c: headers.length - 1}})};
    for (let row = 1; row <= rows.length; row++) for (const column of [...numeric, ...ratios]) { const cell = sheet[global.XLSX.utils.encode_cell({r: row, c: column})]; if (cell?.t === 'n') cell.z = ratios.includes(column) ? '0%' : '#,##0'; }
    global.XLSX.utils.book_append_sheet(workbook, sheet, name);
  }
  function exportWorkbook() {
    if (!report() || !global.XLSX) return null;
    prepareTables();
    const workbook = global.XLSX.utils.book_new(), current = annual(), received = Number(current.received || 0);
    const appState = global.MinervaApp?.state, metadata = appState?.bd ? null : appState?.publishedMeta;
    const updated = metadata?.updatedAt ? new Intl.DateTimeFormat('pt-BR', {timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short'}).format(new Date(metadata.updatedAt)) : 'Prévia local — ainda não publicada';
    appendSheet(workbook, 'Resumo do ano', ['Indicador', 'Valor'], [['Ano de compensação', state.year], ['Recebido USD — Controle integral', received], ['Parcelas pagas', Number(current.count || 0)], ...(state.year === TARGET_YEAR ? [['Meta 100% USD', TARGET_100], ['Falta para 100% USD', Math.max(0, TARGET_100 - received)], ['Meta 150% USD', TARGET_150], ['Falta para 150% USD', Math.max(0, TARGET_150 - received)]] : [['Meta', 'Não definida para este ano']])], [1]);
    appendSheet(workbook, 'Por analista', ['Analista — Controle AF', 'Recebido USD', 'Parcelas pagas', 'Participação no ano'], state.summary.map(row => [row.name, row.received, row.count, row.share]), [1, 2], [3]);
    appendSheet(workbook, 'Parcelas pagas', ['Ordem / NF', 'Fornecedor — Controle', 'Analista — AF', 'Tipo de negociação', 'Status — M', 'Ano da compensação — R', 'Data compensação — R', 'Recebido USD — T', 'Linha Excel'], state.payments.map(row => [row.reference, row.originalSupplier || row.supplier, row.receiptAnalyst, row.type, row.originalStatus || row.status, row.compensationYear, date(row.compDate), row.received, row.row]), [5, 7, 8]);
    workbook.Sheets['Resumo do ano'].B2.z = '0';
    for (let row = 2; row <= state.payments.length + 1; row++) if (workbook.Sheets['Parcelas pagas']['F' + row]) workbook.Sheets['Parcelas pagas']['F' + row].z = '0';
    const issues = report().issues || [];
    if (issues.length) appendSheet(workbook, 'Conferencia', ['Linha Controle', 'Ordem / NF', 'Tipo', 'Detalhe'], issues.map(row => [row.row ?? row.controlRow ?? '', row.reference ?? '', row.type ?? row.code ?? '', row.message ?? row.detail ?? row.reason ?? JSON.stringify(row)]));
    appendSheet(workbook, 'Criterios', ['Critério', 'Valor'], [['Relatório', 'Recebimento por analista'], ['Responsável', 'Administração'], ['Ano aplicado — R', state.year], ['Escopo', 'Controle Recebimento integral; independente do vínculo, ano, fornecedor e operação da BD.'], ['Status elegível — M', 'Pago'], ['Valor recebido — T', 'Valor Recebido USD'], ['Analista — AF', 'Analista do Controle; não é a coluna BE da BD.'], ['Data compensação — R', 'Define o ano e o mês do recebido. Sem data válida, o pagamento não é somado; AE é apenas conferência.'], ['Resumo por analista', F()?.describe(SUMMARY) || 'Todos os analistas; maior recebido primeiro'], ['Parcelas pagas', F()?.describe(PAYMENTS) || 'Todas as parcelas pagas no ano'], ['Escopo dos filtros das tabelas', 'Cada tabela tem filtros e ordenação independentes; o resumo do ano e a meta mantêm todo o ano.'], ['Meta da equipe', '2026: USD 300.000 = 100%; USD 450.000 = 150%. Sem distribuição por analista.'], ['Precisão', 'Cálculos e valores exportados preservam centavos; exibição arredondada sem casas decimais.'], ['Publicação', metadata?.updatedBy || 'Prévia local'], ['Atualizado em — Brasília', updated], ['Arquivo Controle', appState?.controlName || 'Controle de Recebimento'], ['Fonte', report().meta?.source || 'Controle Recebimento: R, M, T e AF']]);
    return workbook;
  }
  function clear() { state.model = null; state.year = state.draftYear = null; state.page = 1; state.printing = false; state.summary = []; state.payments = []; render(); }
  function handleFilter(id) { if (!handlesTable(id)) return; if (id === PAYMENTS) state.page = 1; render(); }
  function handlesTable(id) { return id === SUMMARY || id === PAYMENTS; }
  document.addEventListener('change', event => { if (event.target.id !== 'analystReceiptYear') return; state.draftYear = Number(event.target.value); const status = document.getElementById('analystYearStatus'); if (status) status.textContent = state.draftYear === state.year ? `Exibindo ${state.year}. Controle integral, independente dos filtros da BD.` : `Seleção pendente: ${state.draftYear}. Clique em Aplicar para atualizar; o relatório ainda exibe ${state.year}.`; });
  document.addEventListener('submit', event => { if (event.target.id !== 'analystYearForm') return; event.preventDefault(); state.year = state.draftYear; state.page = 1; render(); });
  document.addEventListener('click', event => {
    const page = event.target.closest('[data-analyst-page]'); if (page) { state.page = Number(page.dataset.analystPage); render(); document.getElementById('analystPaymentsHeading')?.scrollIntoView({block: 'start'}); return; }
    const button = event.target.closest('[data-analyst-action]'); if (!button) return;
    if (button.dataset.analystAction === 'pdf') { document.getElementById('exportPdf')?.click(); return; }
    try { const workbook = exportWorkbook(); if (!workbook) throw new Error('A análise ainda não está disponível.'); global.XLSX.writeFile(workbook, `Minerva-Recebimentos-Analistas-${state.year}.xlsx`); document.getElementById('analystExportStatus').textContent = 'Excel gerado com os filtros aplicados e todas as parcelas selecionadas.'; }
    catch (error) { const status = document.getElementById('analystExportStatus'); if (status) status.textContent = 'Não foi possível gerar o Excel: ' + error.message; }
  });
  document.addEventListener('minerva:model-updated', () => render(global.MinervaApp?.state.model || null));
  document.addEventListener('minerva:session-updated', event => { if (global.MINERVA_HOSTED && !event.detail) clear(); });
  global.MinervaAnalysts = {render, handlesTable, handleFilter, exportWorkbook, filterText, clear, beforePrint: () => { state.printing = true; render(); }, afterPrint: () => { state.printing = false; render(); }};
})(window);
