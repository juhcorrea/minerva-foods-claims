(function (global) {
  'use strict';
  const headers = ['Fornecedor', 'Ano Entrada', 'Mercado', 'Recebido · USD', 'Parcelas pagas', 'Saldo em aberto · USD', 'Parcelas em aberto', 'Ordens / referências', 'A conferir'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits:0});
  const state = {model:null, audit:null, original:false, page:1, claimPage:1, printing:false};
  const filters = () => global.MinervaTableFilters;
  const tableId = () => 'correction-impact-' + (state.original ? 'original' : 'corrected');
  const label = () => state.original ? 'Sem correções · valores originais do Controle' : 'Com correções · referências da BD';
  const cells = row => [esc(row.supplier || 'Não informado'), esc(row.yearEntry ?? 'Não informado'), esc(row.market || 'Não informado'), amount(row.received), amount(row.receivedCount), amount(row.openBalance), amount(row.openCount), amount(row.orderCount), row.unresolvedRows ? `<span class="badge warning">${amount(row.unresolvedRows)} linhas</span>` : '<span class="badge positive">Conferido</span>'];
  const values = row => [row.supplier, row.yearEntry, row.market, row.received, row.receivedCount, row.openBalance, row.openCount, row.orderCount, row.unresolvedRows];
  const sourceRows = () => state.model?.[state.original ? 'original' : 'corrected'] || [];
  const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : amount(value);
  const claimTableId = () => 'correction-impact-claims-' + (state.original ? 'original' : 'corrected');
  const claimHeaders = original => ['Ordem / referência', 'Fornecedor · BD', original ? 'Integral · Controle U' : 'Integral · BD AJ', original ? 'Acordado · soma Controle O' : 'Acordado · BD AO', original ? 'Prejuízo · U − soma O' : 'Prejuízo · AJ − AO', 'Diferença · soma O − AO', 'Conferência', 'Linhas BD', 'Linhas Controle'];
  function claimValues(row, original = state.original) {
    return [row.reference, row.supplier, original ? row.originalClaimValue : row.claimed, original ? row.controlExpected : row.bdReceived, original ? row.originalPrejudice : row.prejudice, row.deltaReceived, row.status, (row.bdRows || []).join(', '), (row.controlRows || []).join(', ')];
  }
  function claimCells(row) {
    const values = claimValues(row), reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const warning = row.uncertain || row.hasClaimValueMismatch || row.hasReceivedMismatch;
    const status = `<span class="badge ${warning ? 'warning' : 'positive'}">${esc(row.status || 'A conferir')}</span>${reasons.length ? `<details class="claim-value-reasons"><summary>Ver conferência</summary><ul>${reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></details>` : ''}`;
    return [`<span class="reference-with-copy"><span>${esc(row.reference || 'Sem referência')}</span>${global.MinervaCopy?.button(row.reference) || ''}</span>`, esc(row.supplier || 'Não informado'), money(values[2]), money(values[3]), money(values[4]), money(row.deltaReceived), status, esc(values[7] || '—'), esc(values[8] || '—')];
  }
  function claimTotal(rows, field) {
    const missing = rows.filter(row => row[field] == null).length;
    return {value:missing || !rows.length ? null : rows.reduce((sum,row) => sum + row[field], 0), missing};
  }
  function financialSection() {
    if (!state.audit) return '';
    const id = claimTableId(), titles = claimHeaders(state.original), source = state.audit.rows || [];
    const rows = filters().prepare(id, titles, source, row => { const result = claimCells(row); result[0] = esc(row.reference); result[6] = esc(row.status || 'A conferir'); return result; }, 'Conferência financeira por claim · ' + label(), {types:['text','text','number','number','number','number','text','text','text'], sortValues:row => claimValues(row)});
    const size = state.printing ? Math.max(rows.length, 1) : 40, pages = Math.max(1, Math.ceil(rows.length / size));
    state.claimPage = Math.min(state.claimPage, pages);
    const page = rows.slice((state.claimPage - 1) * size, state.claimPage * size);
    const fields = state.original ? [['Integral dos claims · U','originalClaimValue'],['Acordado · soma O','controlExpected'],['Prejuízo · U − soma O','originalPrejudice']] : [['Integral dos claims · AJ','claimed'],['Acordado · AO','bdReceived'],['Prejuízo · AJ − AO','prejudice']];
    const metrics = fields.map(([title,field]) => {
      const total = claimTotal(rows, field);
      return `<article><span>${title}</span><strong>${total.value == null ? '—' : 'USD ' + money(total.value)}</strong><small>${total.missing ? `${amount(total.missing)} grupos com dados ausentes ou conflitantes; total não apresentado` : `${amount(rows.length)} grupos após os filtros, sem repetir o claim por parcela`}</small></article>`;
    }).join('');
    return `<section class="panel correction-impact-panel claim-value-panel"><div class="panel-heading"><div><span class="section-kicker">VALOR INTEGRAL E ACORDO</span><h2>Conferência financeira por claim</h2><p class="panel-description">Confira U do Controle contra AJ da BD e a soma de O de todas as parcelas contra AO da BD.</p></div><span id="claimAuditScenario" class="badge ${state.original ? 'warning' : 'positive'}">${esc(state.original ? 'Original · Controle' : 'Referência corrigida · BD')}</span></div><div class="correction-impact-status"><p>Claims do recorte da BD, com todos os lançamentos vinculados no Controle, de qualquer ano e status. A opção “Ver números sem correções” acima também alterna esta comparação.</p><p>${state.original ? 'Original: integral U, acordo pela soma de O e prejuízo U − soma O.' : 'Referência da BD: integral AJ, acordo AO e prejuízo AJ − AO.'} Todos os valores estão em USD.</p></div><div class="correction-impact-metrics claim-value-metrics">${metrics}</div><p class="correction-impact-note">O valor acordado inclui parcelas pagas, vencidas e no prazo. Ele é diferente do recebido efetivamente pago da coluna T. As parcelas O e os pagamentos T não são substituídos automaticamente. Referências que abrangem vários claims aparecem em conjunto, sem rateio; valores incompletos ficam “—”. O prejuízo por claim é separado da perda do comparativo, que continua Reclamado − (Recebido + Em negociação).</p>${filters().summary(id)}<div class="table-wrap correction-impact-scroll claim-value-scroll" tabindex="0" aria-label="Conferência financeira por claim"><table data-table-id="${id}"><caption class="sr-only">Conferência financeira por claim · ${esc(label())}</caption><thead><tr>${titles.map((header,index) => `<th scope="col" aria-sort="${filters().ariaSort(id,index)}">${filters().heading(id,index,header)}</th>`).join('')}</tr></thead><tbody>${page.length ? page.map(row => `<tr>${claimCells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${titles.length}" class="empty-table">Nenhum claim neste filtro.</td></tr>`}</tbody></table></div>${rows.length > size ? `<div class="pagination correction-impact-pagination"><span>Página ${state.claimPage} de ${pages} · ${amount(rows.length)} grupos de claims</span><button type="button" class="button secondary" data-claim-impact-page="${state.claimPage - 1}"${state.claimPage === 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="button secondary" data-claim-impact-page="${state.claimPage + 1}"${state.claimPage === pages ? ' disabled' : ''}>Próxima</button></div>` : ''}</section>`;
  }
  function render(model) {
    if (model) { state.model = model.correctionImpact || null; state.audit = model.claimValueAudit || null; state.original = model.meta?.correctionScenario === 'original'; }
    const host = document.getElementById('correctionImpact');
    if (!host) return;
    if (!state.model) { host.replaceChildren(); return; }
    const summary = state.model.summary, id = tableId();
    const scope = state.model.meta || {};
    const scopeText = `Controle integral · anos de R: ${(scope.years || []).join(' + ')} · Fornecedor: ${scope.supplier || 'Todos'} · Operação do Controle: ${scope.operation || 'Todas as operações'}`;
    const rows = filters().prepare(id, headers, sourceRows(), cells, label(), {types:['text','text','text','number','number','number','number','number','number'], sortValues:values});
    const size = state.printing ? Math.max(rows.length, 1) : 40, pages = Math.max(1, Math.ceil(rows.length / size));
    state.page = Math.min(state.page, pages);
    const page = rows.slice((state.page - 1) * size, state.page * size);
    const received = rows.reduce((total,row) => total + row.received, 0), open = rows.reduce((total,row) => total + row.openBalance, 0);
    host.innerHTML = `<section class="panel correction-impact-panel"><div class="panel-heading"><div><span class="section-kicker">ANTES E DEPOIS DA CONFERÊNCIA</span><h2>Original × corrigido</h2><p class="panel-description">Compare a distribuição dos recebimentos por fornecedor, ano de entrada e mercado.</p></div><label class="correction-scenario-toggle"><input id="correctionOriginalToggle" type="checkbox"${state.original ? ' checked' : ''}><span>Ver números sem correções</span></label></div><div class="correction-impact-status"><strong id="correctionScenarioLabel">${esc(label())}</strong><p>${esc(scopeText)}</p><p>Este cenário vale também para o comparativo, os indicadores, os gráficos e as exportações do painel. A marca “Já ajustei” é um acompanhamento separado.</p></div><div class="correction-impact-metrics"><article><span>Recebido nesta tabela</span><strong>USD ${amount(received)}</strong><small>${amount(rows.length)} grupos após os filtros da tabela</small></article><article><span>Saldo em aberto nesta tabela</span><strong>USD ${amount(open)}</strong><small>Parcelas de todos os anos, até a quitação</small></article><article><span>Linhas com mudança de cadastro</span><strong>${amount(summary.changedRows)}</strong><small>${amount(summary.changedOrders)} ordens / referências no recorte</small></article></div><p class="correction-impact-note">Os dois cenários usam os mesmos pagamentos: <strong>USD ${amount(summary.received)}</strong> no período. Corrigir fornecedor, ano de entrada ou mercado muda a distribuição, sem alterar o valor pago nem a data de compensação. Ano e mês do recebido vêm de R; o Ano Entrada é apenas o agrupamento. Vínculos incompletos ou conflitantes preservam os campos originais e ficam “A conferir”.${summary.missingExpectedAmounts ? ` O saldo está incompleto: ${amount(summary.missingExpectedAmounts)} parcelas sem valor previsto válido.` : ''}</p>${filters().summary(id)}<div class="table-wrap correction-impact-scroll" tabindex="0" aria-label="${esc(label())}"><table data-table-id="${id}"><caption class="sr-only">${esc(label())}</caption><thead><tr>${headers.map((header,index) => `<th scope="col" aria-sort="${filters().ariaSort(id,index)}">${filters().heading(id,index,header)}</th>`).join('')}</tr></thead><tbody>${page.length ? page.map(row => `<tr>${cells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-table">Nenhum grupo neste filtro.</td></tr>`}</tbody></table></div>${rows.length > size ? `<div class="pagination correction-impact-pagination"><span>Página ${state.page} de ${pages} · ${amount(rows.length)} grupos</span><button type="button" class="button secondary" data-impact-page="${state.page - 1}"${state.page === 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="button secondary" data-impact-page="${state.page + 1}"${state.page === pages ? ' disabled' : ''}>Próxima</button></div>` : ''}</section>` + financialSection();
  }
  function addWorksheets(workbook) {
    if (!state.model) return;
    const xlsx = global.XLSX;
    for (const [key,title] of [['original','Cenario original'],['corrected','Cenario corrigido']]) {
      const rows = state.model[key];
      const data = [headers, ...rows.map(row => values(row))];
      const sheet = xlsx.utils.aoa_to_sheet(data);
      sheet['!cols'] = headers.map((_,index) => ({wch:index === 0 ? 38 : 24}));
      if (rows.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:rows.length,c:headers.length-1})};
      for (let n = 2; n <= rows.length + 1; n++) for (const col of ['D','F']) if (sheet[col+n]) sheet[col+n].z = '#,##0';
      xlsx.utils.book_append_sheet(workbook, sheet, title);
    }
    if (state.audit) {
      for (const [original,title] of [[true,'Claim original'],[false,'Claim corrigido']]) {
        const titles = [...claimHeaders(original),'Analistas na BD','Valores U encontrados','Motivos da conferência'];
        const rows = state.audit.rows || [];
        const sheet = xlsx.utils.aoa_to_sheet([titles,...rows.map(row => [...claimValues(row,original),(row.analysts || []).join('; '),(row.originalClaimValues || []).join('; '),(row.reasons || []).join('; ')])]);
        sheet['!cols'] = titles.map((_,index) => ({wch:index < 2 ? 36 : index === 11 ? 65 : 25}));
        if (rows.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:rows.length,c:titles.length-1})};
        for (let row = 2; row <= rows.length + 1; row++) for (const col of ['C','D','E','F']) if (sheet[col+row]) sheet[col+row].z = '#,##0';
        xlsx.utils.book_append_sheet(workbook, sheet, title);
      }
      const corrections = state.audit.uCorrections || [];
      const titles = ['Ordem / referência','Fornecedor','Analista na BD','Linha Controle','Célula Controle','Campo','Valor original U','Valor correto AJ','Linhas BD','Regra'];
      const sheet = xlsx.utils.aoa_to_sheet([titles,...corrections.map(row => [row.reference,row.supplier,(row.analysts || []).join('; '),row.row,row.cell,row.field,row.original,row.corrected,(row.bdRows || []).join('; '),row.reason])]);
      sheet['!cols'] = titles.map((_,index) => ({wch:index === 9 ? 65 : 26}));
      if (corrections.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:corrections.length,c:titles.length-1})};
      for (let row = 2; row <= corrections.length + 1; row++) for (const col of ['G','H']) if (sheet[col+row]?.t === 'n') sheet[col+row].z = '#,##0';
      xlsx.utils.book_append_sheet(workbook, sheet, 'Ajustes valor integral U');
    }
  }
  function clear() { state.model = null; state.audit = null; state.original = false; state.page = 1; state.claimPage = 1; state.printing = false; document.getElementById('correctionImpact')?.replaceChildren(); }
  document.addEventListener('change', async event => {
    if (event.target.id !== 'correctionOriginalToggle') return;
    const requested = event.target.checked ? 'original' : 'corrected'; event.target.disabled = true; state.page = 1; state.claimPage = 1; await global.MinervaApp?.setCorrectionScenario(requested);
    document.getElementById('correctionOriginalToggle')?.focus();
  });
  document.addEventListener('click', event => { const button = event.target.closest('[data-impact-page],[data-claim-impact-page]'); if (button && !button.disabled) { if (button.dataset.claimImpactPage) state.claimPage = Number(button.dataset.claimImpactPage); else state.page = Number(button.dataset.impactPage); render(); } });
  document.addEventListener('minerva:model-updated', () => { if (!global.MinervaApp?.state.model) clear(); });
  global.MinervaCorrectionImpact = {render,clear,label,addWorksheets,handlesTable:id => id.startsWith('correction-impact-'),handleFilter:() => {state.page=1;state.claimPage=1;render();},beforePrint:() => {state.printing=true;render();},afterPrint:() => {state.printing=false;render();}};
})(window);
