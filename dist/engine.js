/* Minerva Claims — deterministic, browser-local reconciliation.
 * Input: worksheet arrays of arrays, including header row; Excel row IDs are 1-based.
 * Public dates are civil ISO YYYY-MM-DD. Ratios are fractions; zero denominator -> null.
 * Never mutates source arrays. Never allocates one receipt across ambiguous claims.
 * Occurrences count distinct nonempty SGR, falling back to worksheet row for missing SGR.
 * Financial values remain per BD row; repeated SGR never removes claimed values.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ClaimsEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DAY = 86400000;
  const FORWARDED = 'RESSARCIMENTO ENCAMINHADO';
  const NEGOTIATING = 'EM NEGOCIACAO - PROCEDENTE';
  const EXCLUDED_STATUSES = new Set(['EM ANALISE', 'AGUARDANDO CUSTOS', 'RESPONDIDO - NAO PROCEDE']);
  const OPS = new Set(['EXPORTACAO - CTNR', 'EXPORTACAO - CARRETA']);
  const OMIT = new Set(['', 'NA', 'N/A', 'NAN', 'NONE', 'NULL', '0', '-', '--', 'NAO ACIONADO', 'SEM REFERENCIA', 'SEM INFORMACAO', 'CCO', 'COURO']);
  const text = v => v == null ? '' : String(v).trim();
  const norm = v => text(v).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/\s+/g, ' ');
  const normalizeStatus = v => norm(v).replace(/\s*[-–—]\s*/g, ' - ');
  const headerKey = v => norm(v).replace(/[^A-Z0-9]/g, '');
  const unique = values => [...new Set(values)];
  const money = n => Math.round((n + Number.EPSILON * Math.sign(n)) * 100) / 100;
  const ratio = (a, b) => b === 0 ? null : a / b;
  const sum = (xs, k) => xs.reduce((s, x) => s + (x[k] || 0), 0);

  function number(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (v == null || text(v) === '' || typeof v === 'boolean') return null;
    let s = text(v).replace(/(?:USD|US\$|R\$|\$)/gi, '').replace(/\s/g, '');
    if (!/^[-+]?\d[\d.,]*$/.test(s)) return null;
    if (s.includes(',')) s = s.includes('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(',', '.');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function parseDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || v <= 0 || v > 2958465) return null;
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * DAY);
      return d.toISOString().slice(0, 10);
    }
    const s = text(v);
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
    if (!m) {
      const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (br) m = [br[0], br[3], br[2], br[1]];
    }
    if (!m) return null;
    const y = Number(m[1]), mon = Number(m[2]), d = Number(m[3]);
    if (y < 1900 || y > 9999 || mon < 1 || mon > 12 || d < 1 || d > 31) return null;
    const value = new Date(Date.UTC(y, mon - 1, d));
    if (value.getUTCFullYear() !== y || value.getUTCMonth() !== mon - 1 || value.getUTCDate() !== d) return null;
    return `${String(y).padStart(4, '0')}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function today() {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  function normalizeRef(v) {
    if (v == null) return null;
    let s = typeof v === 'number' && Number.isInteger(v) ? String(v) : text(v);
    s = s.normalize('NFKC').toUpperCase().replace(/\s+/g, ' ').replace(/\s*([/-])\s*/g, '$1');
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    return OMIT.has(norm(s)) ? null : s;
  }

  function splitRefParts(v) {
    if (v == null) return [];
    if (typeof v === 'number') return [String(v)];
    return String(v).split(/[\n\r;,|]+|\s+\/\s+|\s+e\s+|\s+[-–—]\s+(?=[A-Z]{1,6}\/)/i).map(text).filter(Boolean);
  }

  function tokenizeRefs(v) {
    return unique(splitRefParts(v).map(normalizeRef).filter(Boolean));
  }

  function normalizeMarket(v) {
    const n = norm(v);
    if (n === 'ME' || n === 'MERCADO EXTERNO') return 'ME';
    if (n === 'MI' || n === 'MERCADO INTERNO') return 'MI';
    return n;
  }

  // A numeric NF is not globally unique. Independent business context can
  // disprove the link, while an explicit order match remains authoritative.
  function controlMatches(source,index) {
    const keys=tokenizeRefs(source[7]),unresolvedParts=splitRefParts(source[7]).filter(part=>!normalizeRef(part));
    const livestock=normalizeMarket(source[3])==='MI'&&/\bGADO\b/.test(norm(source[0])+' '+norm(source[2]));
    const generic=new Set(['TRANSPORTE','TRANSPORTES','TRANSPORTADORA','TRANSPORTADOR','TRANS','LOGISTICA','LOGISTICO','LOGISTICOS','LTDA','LIMITADA','SA','S','A','ME','EPP','E','DE','DA','DO','DAS','DOS','COMERCIO','SERVICOS']);
    const identifiers=value=>norm(value).split(/[^A-Z0-9]+/).filter(token=>token.length>1&&!generic.has(token));
    const original=identifiers(source[10]),matched=[],rejected=[],unknownKeys=[];
    for(const key of keys){
      let found=false;
      for(const claim of index.get(key)||[]){
        const order=claim.order??claim.source?.[22],supplier=claim.supplier??claim.source?.[28],operation=claim.operation??claim.source?.[25];
        const orders=tokenizeRefs(order),explicitOrder=keys.some(reference=>orders.includes(reference));
        const target=identifiers(supplier),distinct=original.length>0&&target.length>0&&!original.some(token=>target.includes(token));
        if(livestock&&/^\d+$/.test(key)&&!explicitOrder&&OPS.has(normalizeStatus(operation))&&distinct){rejected.push(claim);continue;}
        found=true;matched.push(claim);
      }
      if(!found)unknownKeys.push(key);
    }
    return {keys,unresolvedParts,unknownKeys,matched:unique(matched),rejected:unique(rejected),complete:keys.length>0&&!unknownKeys.length&&!unresolvedParts.length};
  }

  function contextCollisionIssue(source,row,rejected) {
    return {kind:'NF_CONTEXT_COLLISION',row,reference:text(source[7]),supplier:text(source[10]),bdRows:rejected.map(claim=>claim.row),amount:number(source[19]),detail:'Coincidência numérica de NF rejeitada: Controle de Gado e fornecedor distinto de uma ocorrência de exportação na BD, sem Ordem explícita correspondente. B, D e K do Controle foram preservados; o recebimento M/R/T não foi excluído.'};
  }

  // M identifies a paid installment. R determines its year and month; AE is
  // retained only for diagnostic comparison. Source rows are never modified.
  function receiptAt(r, row, asOf) {
    const yearValue = number(r[30]);
    const reportedYear = Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 9999 ? yearValue : null;
    const received = number(r[19]), compDate = parseDate(r[17]);
    const compensationYear = compDate ? Number(compDate.slice(0, 4)) : null;
    const markedPaid = norm(r[12]) === 'PAGO';
    const validReceived = received != null && received > 0;
    const confirmedPaid = markedPaid && compensationYear != null && validReceived;
    const compensationMonth = compDate ? compDate.slice(0, 7) : null;
    const receiptAnalyst = text(r[31]).replace(/\s+/g, ' ') || 'Não informado';
    const issues = [];
    const add = (kind, detail) => issues.push({kind, row, reference: text(r[7]), supplier: text(r[10]), receiptAnalyst, compensationYear, originalCompensationYear: r[30] ?? null, amount: received, detail});
    if (markedPaid && reportedYear == null) add('INVALID_COMPENSATION_YEAR', 'AE — Ano Compensação está vazio ou inválido. O ano do recebido é obtido de R — Data compensação; AE não altera o total.');
    if (markedPaid && !validReceived) add('PAID_WITHOUT_VALID_AMOUNT', 'M está Pago, mas T — Valor Recebido USD não contém um valor positivo válido. Recebimento não somado.');
    if (markedPaid && !compDate) add(text(r[17]) ? 'INVALID_COMPENSATION_DATE' : 'MISSING_COMPENSATION_DATE', 'R — Data compensação está vazia ou inválida. Recebimento excluído por não ser possível identificar o ano e o mês do pagamento; conferir a data na base.');
    if (markedPaid && compDate && reportedYear != null && compensationYear !== reportedYear) add('COMPENSATION_YEAR_MISMATCH', `Ano de R (${compensationYear}) difere de AE (${reportedYear}). Os totais anual e mensal usam R. Nenhuma dessas células foi corrigida automaticamente.`);
    if (markedPaid && compDate && compDate > asOf) add('FUTURE_COMPENSATION', 'R contém uma compensação posterior à data da análise. Recebimento mantido pela regra M=Pago, ano de R e T; conferir a data informada.');
    if (markedPaid && norm(r[23]) === 'PREJUIZO MINERVA') add('CONFLICTING_PAYMENT_FIELD', 'M está Pago e X registra Prejuízo Minerva. O recebimento segue o status M, conforme o critério escolhido; conferir o conflito.');
    if (markedPaid && norm(r[23]) === 'AGUARDANDO PAGAMENTO') add('CONFLICTING_PAYMENT_FIELD', 'M está Pago e X registra Aguardando Pagamento. O recebimento segue M, R e T; conferir a divergência sem excluir automaticamente o valor.');
    if (!markedPaid && validReceived) add('PAYMENT_STATUS_NOT_PAID', 'T contém valor recebido, mas M não está Pago. Valor excluído do recebido; o andamento da parcela segue o status e a previsão N.');
    return {compensationYear, compensationMonth, compDate, received, receiptAnalyst, markedPaid, validReceived, confirmedPaid, issues};
  }

  function validateHeaders(rows, kind) {
    if (!Array.isArray(rows) || !Array.isArray(rows[0])) throw new Error(`A aba ${kind} está vazia ou não contém cabeçalho.`);
    const expected = kind === 'BD' ? {1: 'Data RNC', 3: 'Mercado', 6: 'Situação', 10: 'Motivo', 22: 'Ordem', 24: 'NF', 25: 'Operação', 28: 'Negociação', 35: 'Reclamado (USD)', 56: 'Analista'} : {1: 'Ano Entrada', 3: 'Mercado', 7: 'Referência (Ordem/NF)', 11: 'Tipo de Negociação', 12: 'Status Pagamento', 13: 'Data Pagamento', 14: 'Valor USD', 17: 'Data compensação', 19: 'Valor Recebido USD', 30: 'Ano Compensação', 31: 'Analista'};
    const bad = Object.entries(expected).filter(([i, name]) => headerKey(rows[0][Number(i)]) !== headerKey(name));
    if (bad.length) throw new Error(`A aba ${kind} não tem as colunas esperadas: ${bad.map(([, name]) => name).join(', ')}. Confira se selecionou o arquivo correto e preservou os cabeçalhos.`);
    return true;
  }

  function analyzeScope(bdRows, controlRows, options = {}, allOperations = false, includeReceipts = true) {
    validateHeaders(bdRows, 'BD');
    validateHeaders(controlRows, 'Controle Recebimento');
    const years = unique((options.years || [2025, 2026]).map(Number).filter(y => Number.isInteger(y) && y >= 1900 && y <= 9999)).sort();
    const yearSet = new Set(years);
    const asOf = parseDate(options.asOf || today());
    if (!asOf) throw new Error('Informe uma data de análise válida.');
    const supplierFilter = norm(options.supplier);
    const operationFilter = normalizeStatus(options.operation);
    const lossFormula = options.lossFormula === 'pending' ? 'pending' : options.lossFormula === 'add-negotiating' ? 'add-negotiating' : 'subtract-negotiating';
    const issues = [], corrections = [], installments = [], unmatchedControls = [];
    const all = [];
    const analystAt = row => text(bdRows[row - 1]?.[56]).replace(/\s+/g, ' ') || 'Não informado';
    const issue = (kind, data) => {
      const analysts = unique((data.bdRows?.length ? data.bdRows.map(analystAt) : all.filter(c => c.eligible && norm(c.supplier) === norm(data.supplier)).map(c => c.analyst)));
      issues.push({kind, row: null, reference: '', supplier: '', detail: '', bdRows: [], amount: null, ...data, analysts: analysts.length ? analysts : ['Não informado']});
    };
    const index = new Map();
    let excludedWar = 0, excludedWarAmount = 0;
    for (let a = 1; a < bdRows.length; a++) {
      const r = bdRows[a];
      if (!r || !r.slice(0, 36).some(v => v != null && v !== '')) continue;
      const statusKey = normalizeStatus(r[6]), opKey = normalizeStatus(r[25]);
      const rncDate = parseDate(r[1]), year = rncDate ? Number(rncDate.slice(0, 4)) : null;
      const supplier = text(r[28]) || '(SEM NEGOCIAÇÃO)';
      const keys = unique([...tokenizeRefs(r[22]), ...tokenizeRefs(r[24])]);
      const claimedValue = number(r[35]);
      const otherFilters = (allOperations || OPS.has(opKey)) && !EXCLUDED_STATUSES.has(statusKey) && (!operationFilter || opKey === operationFilter) && (!supplierFilter || norm(supplier) === supplierFilter);
      const periodEligible = !!rncDate && yearSet.has(year) && rncDate <= asOf;
      const war = norm(r[10]) === 'INTERFERENCIA EXTERNA';
      const c = {
        row: a + 1, sgr: text(r[0]), order: text(r[22]), nf: text(r[24]), supplier, analyst: analystAt(a + 1),
        supplierKey: norm(supplier), rncDate, year, market: text(r[3]), marketKey: normalizeMarket(r[3]),
        status: text(r[6]), statusKey, operation: text(r[25]), claimed: claimedValue ?? 0,
        keys, war, baseEligible: (allOperations || OPS.has(opKey)) && !EXCLUDED_STATUSES.has(statusKey) && !war,
        eligible: otherFilters && periodEligible && !war, matchedControlRows: [], candidateControlRows: [], linkState: 'unmatched',
      };
      all.push(c);
      for (const k of keys) {
        if (!index.has(k)) index.set(k, new Set());
        index.get(k).add(c);
      }
      if (otherFilters && periodEligible && war) { excludedWar++; excludedWarAmount += c.claimed; }
      if (otherFilters && !war && !rncDate) issue('INVALID_RNC_DATE', { row: c.row, reference: c.order || c.nf, supplier, bdRows: [c.row], detail: 'Data RNC vazia ou inválida; ocorrência fora dos totais por ano.' });
      if (c.eligible && claimedValue == null) issue('INVALID_CLAIM_AMOUNT', { row: c.row, reference: c.order || c.nf, supplier, bdRows: [c.row], detail: 'Reclamado (USD) vazio ou inválido. Valor não somado; conferir a célula AJ.' });
      if (c.eligible && !statusKey) issue('MISSING_CLAIM_STATUS', { row: c.row, reference: c.order || c.nf, supplier, bdRows: [c.row], detail: 'Situação da BD vazia. Reclamado incluído pela regra de exclusão; confirmar a classificação antes de conciliar recebimentos.' });
      if (c.eligible && !keys.length) issue('MISSING_CLAIM_REFERENCE', { row: c.row, supplier, bdRows: [c.row], detail: 'Ocorrência sem Ordem/NF válida para cruzamento.' });
    }
    const claims = all.filter(c => c.eligible);
    const suppliersMap = new Map();
    const supplierNames = new Map();
    for (const c of claims) if (!supplierNames.has(c.supplierKey)) supplierNames.set(c.supplierKey, c.supplier);
    const annualMap = new Map(years.map(year => [year, {year, claimed: 0, forwarded: 0, negotiating: 0, otherClaimed: 0, received: 0, receivedNegotiating: 0, receivedOtherStatuses: 0}]));
    const monthlyMap = new Map();
    for (const year of years) for (let month = 1; month <= 12; month++) monthlyMap.set(`${year}-${String(month).padStart(2, '0')}`, {month: `${year}-${String(month).padStart(2, '0')}`, received: 0});
    function supplierRow(key) {
      if (!suppliersMap.has(key)) suppliersMap.set(key, {name: supplierNames.get(key) || key, claimed: 0, forwarded: 0, negotiating: 0, otherClaimed: 0, received: 0, receivedNegotiating: 0, receivedOtherStatuses: 0, receivedConfirmed: 0, balance: 0, recoveryRate: null, occurrences: 0, _occurrences: new Set(), recordCount: 0, share: 0, pareto: 0, paid: 0, overdue: 0, onTime: 0, loss: 0, explicitLoss: 0, openBalance: 0, overdueBalance: 0, onTimeBalance: 0, noDueBalance: 0, missingExpectedAmounts: 0, lossInstallments: 0, installments: 0, reviewCount: 0, unmatchedClaims: 0, processes: 0, settledProcesses: 0});
      return suppliersMap.get(key);
    }
    for (const c of claims) {
      c.supplier = supplierNames.get(c.supplierKey);
      const s = supplierRow(c.supplierKey), a = annualMap.get(c.year);
      s.claimed += c.claimed; s._occurrences.add(c.sgr ? `SGR:${norm(c.sgr)}` : `ROW:${c.row}`); s.recordCount++; a.claimed += c.claimed;
      if (c.statusKey === FORWARDED) {s.forwarded += c.claimed; a.forwarded += c.claimed;}
      else if (c.statusKey === NEGOTIATING) {s.negotiating += c.claimed; a.negotiating += c.claimed;}
      else {s.otherClaimed += c.claimed; a.otherClaimed += c.claimed;}
    }

    const occurrenceDefinition = 'Nº SGR distinto; sem SGR, cada linha BD é uma ocorrência. Valores reclamados são somados por linha, sem deduplicação financeira. A mesma SGR em fornecedores diferentes aparece em cada fornecedor, mas uma vez no total geral.';
    const meta = {asOf, years, supplier: text(options.supplier), operation: text(options.operation), lossFormula, occurrenceDefinition, countOccurrenceDefinition: occurrenceDefinition, selectedBDRows: claims.length, totalBDRows: all.length, totalControlRows: 0, unmatchedControlRows: 0, outsideScopeControlRows: 0, ambiguousControlRows: 0, linkedControlRows: 0, receivedOutsidePeriod: 0, receivedNegotiating: 0, receivedOtherStatuses: 0, excludedWarAmount: 0, invalidAmounts: 0, missingExpectedAmounts: 0, normalization: 'Ordem/NF exata, com normalização de caixa/espaços e separação de referências compostas; sem aproximação por nome.', claimedBasis: 'Todas as situações da BD, exceto EM ANÁLISE, AGUARDANDO CUSTOS e RESPONDIDO - NÃO PROCEDE; mantidos período, operações e expurgo de INTERFERÊNCIA EXTERNA.', excludedStatuses: [...EXCLUDED_STATUSES], receiptBasis: 'M=Pago; ano de R — Data compensação selecionado; T=Valor Recebido USD positivo. Realizado executivo vinculado somente a RESSARCIMENTO ENCAMINHADO. R determina ano e mês do recebimento; AE serve somente para conferência.', confirmedReceiptBasis: 'Recebido conciliado no Controle: M=Pago, ano de R no período, T positivo e vínculo seguro com os claims selecionados, independentemente da situação elegível da BD. Inclui realizado executivo, pagamentos em negociação e de outros status. O relatório por analista usa o Controle integral e não depende de vínculos ou filtros da BD.', missingIsNotUnpaid: true};

    Object.assign(meta, {receivedWithoutMonthlyDate: 0, confirmedReceivedWithoutMonthlyDate: 0, incompatibleStatusExcludedAmount: 0, excludedYearUnknownAmount: 0, excludedYearUnknownCount: 0});
    const receiptReport = {years: [], annual: [], analysts: [], monthly: [], rows: [], issues: [], meta: {scope: 'Controle Recebimento integral; independente dos vínculos, situações, operações, anos de RNC e filtros de fornecedor da BD.', source: 'M=Pago; R=Data compensação, fonte do ano e mês; AF=Analista; T=Valor Recebido USD positivo. AE serve somente para conferência.', analystDefinition: 'Analista do recebimento conforme AF no Controle Recebimento, distinto do analista da ocorrência em BE na BD. Nomes não são atribuídos por inferência.', receivedWithoutMonthlyDate: 0, incompatibleStatusExcludedAmount: 0, excludedYearUnknownAmount: 0, excludedYearUnknownCount: 0, invalidPaidAmountCount: 0}};
    const receiptAnnualMap = new Map(), receiptAnalystsMap = new Map(), receiptMonthlyMap = new Map();
    function recordReceipt(r, row, payment) {
      receiptReport.issues.push(...payment.issues);
      if (!payment.markedPaid && payment.validReceived) receiptReport.meta.incompatibleStatusExcludedAmount += payment.received;
      if (payment.markedPaid && payment.compensationYear == null) {
        receiptReport.meta.excludedYearUnknownCount++;
        if (payment.validReceived) receiptReport.meta.excludedYearUnknownAmount += payment.received;
      }
      if (payment.markedPaid && !payment.validReceived) receiptReport.meta.invalidPaidAmountCount++;
      if (!payment.confirmedPaid) return;
      const {compensationYear: year, compensationMonth: month, received, receiptAnalyst: name} = payment;
      receiptReport.rows.push({row, reference: text(r[7]), receiptAnalyst: name, compensationYear: year, compensationMonth: month, compDate: payment.compDate, received, status: 'Pago', originalStatus: text(r[12]), originalSupplier: text(r[10]), supplier: text(r[10]), type: text(r[11]) || 'Não informado'});
      if (!receiptAnnualMap.has(year)) receiptAnnualMap.set(year, {year, received: 0, count: 0, monthlyUnallocated: 0});
      const annual = receiptAnnualMap.get(year); annual.received += received; annual.count++;
      const key = JSON.stringify([year, norm(name)]);
      if (!receiptAnalystsMap.has(key)) receiptAnalystsMap.set(key, {year, name, received: 0, count: 0});
      const analyst = receiptAnalystsMap.get(key); analyst.received += received; analyst.count++;
      if (month) {
        if (!receiptMonthlyMap.has(month)) receiptMonthlyMap.set(month, {month, received: 0, count: 0});
        const monthly = receiptMonthlyMap.get(month); monthly.received += received; monthly.count++;
      } else {annual.monthlyUnallocated += received; receiptReport.meta.receivedWithoutMonthlyDate += received;}
    }

    function addCorrection(inst, matched, field, col, original, corrected, reason) {
      corrections.push({row: inst.row, cell: `${col}${inst.row}`, field, reference: inst.reference, supplier: inst.supplier, analysts: unique(matched.map(c => c.analyst)), original: original == null ? '' : original, corrected, bdRows: matched.map(c => c.row), rncDate: unique(matched.map(c => c.rncDate).filter(Boolean)).join('; '), reason});
    }

    for (let a = 1; a < controlRows.length; a++) {
      const r = controlRows[a];
      if (!r || !r.slice(0, 20).some(v => v != null && v !== '')) continue;
      meta.totalControlRows++;
      const payment = receiptAt(r, a + 1, asOf);
      if (includeReceipts) recordReceipt(r, a + 1, payment);
      const {keys,unresolvedParts,unknownKeys,matched,rejected} = controlMatches(r,index);
      if(rejected.length)issue('NF_CONTEXT_COLLISION',contextCollisionIssue(r,a+1,rejected));
      const selected = matched.filter(c => c.eligible);
      if (!selected.length) {
        if (matched.length) meta.outsideScopeControlRows++;
        else {
          meta.unmatchedControlRows++;
          unmatchedControls.push({row: a + 1, reference: text(r[7]), supplier: text(r[10]), originalStatus: text(r[12]), received: number(r[19]), detail: keys.length ? 'Referência não localizada na BD.' : 'Referência vazia ou genérica; vínculo não realizado.'});
        }
        continue;
      }
      const supplierKeys = unique(matched.map(c => c.supplierKey));
      const matchedYears = unique(matched.map(c => c.year));
      const matchedMarkets = unique(matched.map(c => c.marketKey));
      const matchedStatuses = unique(matched.map(c => c.statusKey));
      const allSelected = matched.every(c => c.eligible);
      const complete = keys.length > 0 && unknownKeys.length === 0 && unresolvedParts.length === 0;
      const safe = complete && allSelected && supplierKeys.length === 1 && matchedYears.length === 1 && matchedMarkets.length === 1 && matchedStatuses.length === 1;
      const {received: receivedValue, compDate, compensationYear, compensationMonth, receiptAnalyst, confirmedPaid, markedPaid, validReceived} = payment;
      const expectedValue = number(r[14]), dueDate = parseDate(r[13]);
      const noDueDate = r[13] == null || text(r[13]) === '';
      const originalStatus = text(r[12]);
      const isLoss = !markedPaid && (norm(r[12]) === 'PREJUIZO MINERVA' || norm(r[23]) === 'PREJUIZO MINERVA');
      let status;
      if (confirmedPaid) status = 'Pago';
      else if (markedPaid) status = 'Conferir pagamento';
      else if (isLoss) status = 'Prejuízo Minerva';
      else if (!noDueDate && !dueDate) status = 'Conferir previsão';
      else status = dueDate && dueDate < asOf ? 'Vencido' : 'Dentro do Prazo';
      const expectedMissing = expectedValue == null && ['Vencido', 'Dentro do Prazo'].includes(status);
      const inPeriod = confirmedPaid && yearSet.has(compensationYear);
      const linkedSupplier = supplierKeys.length === 1 ? (supplierNames.get(supplierKeys[0]) || matched[0].supplier) : '(VÍNCULO A CONFERIR)';
      const inst = {
        row: a + 1, reference: text(r[7]), supplier: linkedSupplier, originalSupplier: text(r[10]), analysts: unique(matched.map(c => c.analyst)), confession: text(r[9]), type: text(r[11]) || 'Não informado', status, originalStatus,
        dueDate, compDate, compensationYear, compensationMonth, receiptAnalyst, expected: expectedValue, received: receivedValue, inPeriod, bdRows: matched.map(c => c.row), year: matchedYears.length === 1 ? matchedYears[0] : null,
        market: matchedMarkets.length === 1 ? matched[0].market : null, originalYear: r[1] ?? null, originalMarket: text(r[3]), noDueDate, expectedMissing, linkState: safe ? matched.length > 1 ? 'grouped' : 'matched' : 'review',
        includedInRealized: safe && inPeriod && matchedStatuses[0] === FORWARDED, includedInConfirmed: safe && inPeriod, grouped: matched.length > 1, claimStatus: matchedStatuses.length === 1 ? matched[0].status : 'Múltiplas situações', _keys: keys,
      };
      inst.operations = unique(matched.map(c => text(c.operation)).filter(Boolean));
      installments.push(inst);
      selected.forEach(c => c.candidateControlRows.push(inst.row));
      const issueBase = {row: inst.row, reference: inst.reference, supplier: inst.supplier, bdRows: inst.bdRows, amount: receivedValue};
      if (!safe) {
        meta.ambiguousControlRows++;
        const reasons = [];
        if (unknownKeys.length) reasons.push(`Referências não localizadas: ${unknownKeys.join('; ')}`);
        if (unresolvedParts.length) reasons.push(`Referências genéricas ou incompletas: ${unresolvedParts.join('; ')}`);
        if (!allSelected) reasons.push('A referência também abrange ocorrência fora dos filtros, do período ou expurgada');
        if (supplierKeys.length > 1) reasons.push('Mais de um fornecedor na BD');
        if (matchedYears.length > 1) reasons.push('Mais de um ano de Data RNC');
        if (matchedMarkets.length > 1) reasons.push('Mercados conflitantes');
        if (matchedStatuses.length > 1) reasons.push('Situações BD diferentes, sem regra de rateio');
        issue('AMBIGUOUS_LINK', {...issueBase, detail: `${reasons.join('. ')}. Recebimento não atribuído automaticamente.`});
      } else {
        meta.linkedControlRows++;
        matched.forEach(c => c.matchedControlRows.push(inst.row));
        const s = supplierRow(supplierKeys[0]);
        s.installments++;
        if (expectedMissing) s.missingExpectedAmounts++;
        if (status === 'Pago') s.paid++;
        if (status === 'Vencido') {s.overdue++; s.overdueBalance += expectedValue || 0; s.openBalance += expectedValue || 0;}
        if (status === 'Dentro do Prazo') {s.onTime++; s.onTimeBalance += expectedValue || 0; s.openBalance += expectedValue || 0; if (noDueDate) s.noDueBalance += expectedValue || 0;}
        if (status === 'Prejuízo Minerva') {s.explicitLoss += expectedValue || 0; s.lossInstallments++;}
        if (inPeriod) {
          s.receivedConfirmed += receivedValue;
          if (!compensationMonth) meta.confirmedReceivedWithoutMonthlyDate += receivedValue;
          if (matchedStatuses[0] === FORWARDED) {
            s.received += receivedValue;
            annualMap.get(compensationYear).received += receivedValue;
            if (compensationMonth) monthlyMap.get(compensationMonth).received += receivedValue;
            else meta.receivedWithoutMonthlyDate += receivedValue;
          } else if (matchedStatuses[0] === NEGOTIATING) {
            s.receivedNegotiating += receivedValue;
            meta.receivedNegotiating += receivedValue;
            annualMap.get(compensationYear).receivedNegotiating += receivedValue;
            issue('PAYMENT_ON_NEGOTIATING_CLAIM', {...issueBase, detail: 'M registra Pago e R/T são válidos, mas a BD ainda está em negociação. Valor separado do realizado encaminhado; conferir a situação da BD.'});
          } else {
            s.receivedOtherStatuses += receivedValue;
            meta.receivedOtherStatuses += receivedValue;
            annualMap.get(compensationYear).receivedOtherStatuses += receivedValue;
            issue('PAYMENT_ON_OTHER_CLAIM_STATUS', {...issueBase, detail: `Pagamento confirmado no Controle, vinculado à situação BD “${matched[0].status || 'Não informada'}”. Valor visível separadamente; fora do realizado executivo, que considera somente RESSARCIMENTO ENCAMINHADO.`});
          }
        } else if (confirmedPaid) meta.receivedOutsidePeriod += receivedValue;
      }
      const correctionSafe = complete && matched.every(c => c.baseEligible);
      if (correctionSafe) {
        if (matchedYears.length === 1 && matchedYears[0] != null && number(r[1]) !== matchedYears[0]) addCorrection(inst, matched, 'Ano Entrada', 'B', r[1], matchedYears[0], 'Ano obtido de BD!B — Data RNC. Data Pagamento e Data compensação preservadas.');
        if (matchedMarkets.length === 1 && matchedMarkets[0] && normalizeMarket(r[3]) !== matchedMarkets[0]) addCorrection(inst, matched, 'Mercado', 'D', text(r[3]), matched[0].market, 'Mercado obtido de BD!D. ME/MERCADO EXTERNO e MI/MERCADO INTERNO são equivalentes.');
      }
      if (receivedValue == null && r[19] != null && text(r[19]) !== '') {meta.invalidAmounts++; issue('INVALID_RECEIPT_AMOUNT', {...issueBase, detail: 'T — Valor Recebido USD contém um valor inválido; não somado.'});}
      if (expectedMissing) {meta.missingExpectedAmounts++; issue('MISSING_EXPECTED_AMOUNT', {...issueBase, amount: null, detail: `O${inst.row} — Valor USD está vazio ou inválido em uma parcela pendente. O saldo em aberto inclui somente valores conhecidos; completar o valor da parcela.`});}
      for (const warning of payment.issues) issue(warning.kind, {...warning, ...issueBase, detail: warning.detail});
      if (!noDueDate && !dueDate) issue('INVALID_DUE_DATE', {...issueBase, detail: 'N contém uma data inválida; não foi tratada como previsão vazia.'});
      if (!markedPaid && validReceived && yearSet.has(compensationYear)) meta.incompatibleStatusExcludedAmount += receivedValue;
      if (markedPaid && compensationYear == null) {meta.excludedYearUnknownCount++; if (validReceived) meta.excludedYearUnknownAmount += receivedValue;}
    }

    for (const c of claims) {
      const linked = installments.filter(i => c.matchedControlRows.includes(i.row));
      c.linkState = linked.length ? linked.some(i => i.grouped) ? 'grouped' : 'matched' : c.candidateControlRows.length ? 'review' : 'unmatched';
      if (c.linkState === 'unmatched' && c.statusKey === FORWARDED) {
        supplierRow(c.supplierKey).unmatchedClaims++;
        issue('CLAIM_WITHOUT_LINK', {row: c.row, reference: c.order || c.nf, supplier: c.supplier, bdRows: [c.row], amount: c.claimed, detail: 'Sem correspondência no Controle. Isso não comprova ausência de pagamento; revisar a referência.'});
      }
    }

    // Connected groups keep one installment in only one process even when an
    // agreement mentions several orders. An ambiguous installment prevents quitado.
    const parents = new Map(claims.map(c => [c.row, c.row]));
    const find = x => {let r = x; while (parents.get(r) !== r) r = parents.get(r); while (parents.get(x) !== x) {const n = parents.get(x); parents.set(x, r); x = n;} return r;};
    const union = (a, b) => {a = find(a); b = find(b); if (a !== b) parents.set(b, a);};
    for (const i of installments) if (i.linkState !== 'review') {const ids = i.bdRows.filter(id => parents.has(id)); for (const id of ids.slice(1)) union(ids[0], id);}
    const processMap = new Map();
    for (const c of claims) {
      const id = find(c.row);
      if (!processMap.has(id)) processMap.set(id, {id: `BD-${id}`, supplier: c.supplier, analysts: [], bdRows: [], references: [], installments: [], claimed: 0, received: 0, total: 0, paid: 0, overdue: 0, onTime: 0, loss: 0, review: 0, settled: false, status: 'Sem vínculo'});
      const p = processMap.get(id); p.bdRows.push(c.row); p.references.push(c.order || c.nf); p.analysts.push(c.analyst); p.claimed += c.claimed;
    }
    for (const i of installments) {
      const ids = unique(i.bdRows.filter(id => parents.has(id)).map(find));
      if (i.linkState === 'review') {for (const id of ids) processMap.get(id).review++; continue;}
      if (!ids.length) continue;
      const p = processMap.get(ids[0]); p.installments.push(i.row); p.total++;
      if (i.status === 'Pago') p.paid++;
      if (i.status === 'Vencido') p.overdue++;
      if (i.status === 'Dentro do Prazo') p.onTime++;
      if (i.status === 'Prejuízo Minerva') p.loss++;
      if (i.status.startsWith('Conferir')) p.review++;
      if (i.includedInRealized) p.received += i.received;
    }
    const processes = [...processMap.values()].map(p => {
      p.references = unique(p.references).filter(Boolean); p.analysts = unique(p.analysts); p.claimed = money(p.claimed); p.received = money(p.received);
      p.settled = p.total > 0 && p.paid === p.total && p.review === 0 && p.loss === 0;
      p.status = p.review ? 'Conferir vínculo' : !p.total ? 'Sem vínculo' : p.settled ? 'Todas as parcelas pagas' : p.overdue ? 'Com parcelas vencidas' : p.loss ? 'Com prejuízo registrado' : 'Parcelas em aberto';
      const s = supplierRow(norm(p.supplier)); s.processes++; if (p.settled) s.settledProcesses++;
      return p;
    });

    for (const s of suppliersMap.values()) {
      s.occurrences = s._occurrences.size;
      delete s._occurrences;
      s.balance = s.claimed - s.received - s.negotiating;
      s.loss = lossFormula === 'pending' ? null : s.claimed - s.received + (lossFormula === 'add-negotiating' ? s.negotiating : -s.negotiating);
      s.lossRate = s.loss == null ? null : ratio(s.loss, s.claimed);
      s.openBalanceIncomplete = s.missingExpectedAmounts > 0;
      s.recoveryRate = ratio(s.received, s.claimed);
      if (s.forwarded - s.received < -0.005) issue('RECEIVED_ABOVE_FORWARDED', {supplier: s.name, amount: s.forwarded - s.received, detail: 'Recebido executivo supera o reclamado encaminhado. Diferença negativa preservada; revisar valores, câmbio e vínculos. Outros status no reclamado não compensam esse excesso.'});
    }
    for (const s of suppliersMap.values()) s.reviewCount = issues.filter(i => norm(i.supplier) === norm(s.name)).length;
    const suppliers = [...suppliersMap.values()].sort((a, b) => b.claimed - a.claimed || a.name.localeCompare(b.name, 'pt-BR'));
    const totalClaimed = sum(suppliers, 'claimed');
    const rawTotals = Object.fromEntries(['forwarded', 'negotiating', 'otherClaimed', 'received', 'receivedNegotiating', 'receivedOtherStatuses', 'receivedConfirmed', 'balance', 'explicitLoss', 'openBalance', 'overdueBalance', 'onTimeBalance', 'noDueBalance'].map(k => [k, sum(suppliers, k)]));
    let cumulative = 0;
    for (const s of suppliers) {
      s.share = ratio(s.claimed, totalClaimed); cumulative += s.claimed; s.pareto = ratio(cumulative, totalClaimed);
      for (const k of ['claimed', 'forwarded', 'negotiating', 'otherClaimed', 'received', 'receivedNegotiating', 'receivedOtherStatuses', 'receivedConfirmed', 'balance', 'loss', 'explicitLoss', 'openBalance', 'overdueBalance', 'onTimeBalance', 'noDueBalance']) if (s[k] != null) s[k] = money(s[k]);
    }
    const summary = {
      claimed: money(totalClaimed), forwarded: money(rawTotals.forwarded), negotiating: money(rawTotals.negotiating), otherClaimed: money(rawTotals.otherClaimed), received: money(rawTotals.received),
      receivedNegotiating: money(rawTotals.receivedNegotiating), receivedOtherStatuses: money(rawTotals.receivedOtherStatuses), receivedConfirmed: money(rawTotals.receivedConfirmed), balance: money(rawTotals.balance), recoveryRate: ratio(rawTotals.received, totalClaimed), occurrences: unique(claims.map(c => c.sgr ? `SGR:${norm(c.sgr)}` : `ROW:${c.row}`)).length, recordCount: claims.length,
      installments: sum(suppliers, 'installments'), paid: sum(suppliers, 'paid'), overdue: sum(suppliers, 'overdue'), onTime: sum(suppliers, 'onTime'), loss: null, lossRate: null, explicitLoss: money(rawTotals.explicitLoss), openBalance: money(rawTotals.openBalance), overdueBalance: money(rawTotals.overdueBalance), onTimeBalance: money(rawTotals.onTimeBalance), noDueBalance: money(rawTotals.noDueBalance), missingExpectedAmounts: sum(suppliers, 'missingExpectedAmounts'), openBalanceIncomplete: sum(suppliers, 'missingExpectedAmounts') > 0, lossInstallments: sum(suppliers, 'lossInstallments'),
      unmatchedClaims: claims.filter(c => c.linkState === 'unmatched' && c.statusKey === FORWARDED).length, reviewCount: issues.length, correctionCount: corrections.length, excludedWar, excludedWarAmount: money(excludedWarAmount), processes: processes.length, settledProcesses: processes.filter(p => p.settled).length,
    };
    // Keep the reported formula exact at the displayed two-decimal precision.
    summary.balance = money(summary.claimed - summary.received - summary.negotiating);
    summary.loss = lossFormula === 'pending' ? null : money(summary.claimed - summary.received + (lossFormula === 'add-negotiating' ? summary.negotiating : -summary.negotiating));
    summary.lossRate = summary.loss == null ? null : ratio(summary.loss, summary.claimed);
    meta.uniqueSgr = unique(claims.map(c => c.sgr).filter(Boolean)).length;
    meta.rounding = 'Totais acumulados com a precisão original das células; arredondamento para duas casas somente na saída. Subtotais exibidos podem ter diferença de arredondamento de centavos.';
    meta.unmatchedNegotiating = claims.filter(c => c.linkState === 'unmatched' && c.statusKey === NEGOTIATING).length;
    meta.receivedOutsidePeriod = money(meta.receivedOutsidePeriod); meta.receivedNegotiating = money(meta.receivedNegotiating); meta.receivedOtherStatuses = money(meta.receivedOtherStatuses); meta.excludedWarAmount = money(excludedWarAmount);
    meta.ambiguousReceived = money(sum(installments.filter(i => i.linkState === 'review' && i.inPeriod), 'received'));
    const statusBreakdown = new Map();
    for (const c of claims) {
      if (!statusBreakdown.has(c.statusKey)) statusBreakdown.set(c.statusKey, {status: c.status || 'Não informada', statusKey: c.statusKey, rows: 0, claimed: 0});
      const s = statusBreakdown.get(c.statusKey); s.rows++; s.claimed += c.claimed;
    }
    meta.statusBreakdown = [...statusBreakdown.values()].map(s => ({...s, claimed: money(s.claimed)}));
    const allByRow = new Map(all.map(c => [c.row, c]));
    const correctionGroupMap = new Map();
    const emptyFieldChanges = () => ({originalValues: [], correctedValues: [], changes: []});
    for (const change of corrections) {
      const sources = change.bdRows.map(row => allByRow.get(row)).filter(Boolean);
      const orders = unique(sources.flatMap(c => tokenizeRefs(c.order))).sort();
      const referenceKeys = orders.length ? orders : tokenizeRefs(change.reference).sort();
      const key = `${orders.length ? 'order' : 'reference'}:${referenceKeys.join('|') || `row-${change.row}`}`;
      if (!correctionGroupMap.has(key)) correctionGroupMap.set(key, {id: '', reference: referenceKeys.join('; ') || change.reference, orders, references: [], supplier: '', suppliers: [], analysts: [], rows: [], bdRows: [], rncDates: [], year: emptyFieldChanges(), market: emptyFieldChanges(), changes: [], correctionCount: 0, rowCount: 0, hasYearCorrection: false, hasMarketCorrection: false, hasConflictingCorrections: false, hasVaryingOriginals: false});
      const group = correctionGroupMap.get(key);
      group.references.push(change.reference);
      group.suppliers.push(...sources.map(c => c.supplier).filter(Boolean));
      group.analysts.push(...change.analysts);
      group.rows.push(change.row); group.bdRows.push(...change.bdRows);
      group.rncDates.push(...sources.map(c => c.rncDate).filter(Boolean));
      group.changes.push(change);
      const field = change.field === 'Ano Entrada' ? group.year : group.market;
      field.originalValues.push(change.original); field.correctedValues.push(change.corrected); field.changes.push(change);
    }
    const correctionGroups = [...correctionGroupMap.values()].sort((a, b) => a.reference.localeCompare(b.reference, 'pt-BR')).map((g, i) => {
      g.id = `correction-order-${i + 1}`;
      g.references = unique(g.references); g.suppliers = unique(g.suppliers); g.analysts = unique(g.analysts);
      g.supplier = g.suppliers.join('; ');
      g.rows = unique(g.rows).sort((a, b) => a - b); g.bdRows = unique(g.bdRows).sort((a, b) => a - b); g.rncDates = unique(g.rncDates).sort();
      g.changes.sort((a, b) => a.row - b.row || a.field.localeCompare(b.field, 'pt-BR'));
      for (const f of [g.year, g.market]) {
        f.originalValues = unique(f.originalValues); f.correctedValues = unique(f.correctedValues);
        f.changes.sort((a, b) => a.row - b.row);
      }
      g.correctionCount = g.changes.length; g.rowCount = g.rows.length;
      g.hasYearCorrection = g.year.changes.length > 0; g.hasMarketCorrection = g.market.changes.length > 0;
      g.hasConflictingCorrections = unique(g.year.correctedValues.map(v => number(v))).length > 1 || unique(g.market.correctedValues.map(normalizeMarket)).length > 1;
      g.hasVaryingOriginals = g.year.originalValues.length > 1 || g.market.originalValues.length > 1;
      return g;
    });
    summary.correctionGroupCount = correctionGroups.length;
    meta.analystDefinition = 'Analista vinculado à ordem na coluna BE da BD. Não identifica, por si só, quem digitou ou alterou a informação no Controle Recebimento.';
    meta.correctionGroupingDefinition = 'Uma linha por Ordem da BD (ou conjunto de ordens do mesmo vínculo). Referências por NF e por Ordem que apontam às mesmas ordens são reunidas. Todas as mudanças por célula e parcela permanecem em corrections e nos changes do grupo.';
    const annual = [...annualMap.values()].map(a => ({...a, claimed: money(a.claimed), forwarded: money(a.forwarded), negotiating: money(a.negotiating), otherClaimed: money(a.otherClaimed), received: money(a.received), receivedNegotiating: money(a.receivedNegotiating), receivedOtherStatuses: money(a.receivedOtherStatuses), receivedConfirmed: money(a.received + a.receivedNegotiating + a.receivedOtherStatuses), recoveryRate: ratio(a.received, a.claimed)}));
    const monthly = [...monthlyMap.values()].map(m => ({...m, received: money(m.received)}));
    receiptReport.annual = [...receiptAnnualMap.values()].sort((a, b) => a.year - b.year).map(a => ({...a, received: money(a.received), monthlyUnallocated: money(a.monthlyUnallocated)}));
    receiptReport.years = receiptReport.annual.map(a => a.year);
    receiptReport.analysts = [...receiptAnalystsMap.values()].sort((a, b) => a.year - b.year || b.received - a.received || a.name.localeCompare(b.name, 'pt-BR')).map(a => ({...a, received: money(a.received)}));
    receiptReport.monthly = [...receiptMonthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month)).map(m => ({...m, received: money(m.received)}));
    for (const k of ['receivedWithoutMonthlyDate', 'confirmedReceivedWithoutMonthlyDate', 'incompatibleStatusExcludedAmount', 'excludedYearUnknownAmount']) {
      meta[k] = money(meta[k]);
      if (k in receiptReport.meta) receiptReport.meta[k] = money(receiptReport.meta[k]);
    }
    meta.monthlyBasis = 'Ano e mês obtidos de R — Data compensação. Pagamentos sem data R válida ficam fora do recebido e são sinalizados para conferência; datas futuras são sinalizadas, sem excluir valores marcados Pago.';
    claims.forEach(c => {delete c.supplierKey; delete c.marketKey; delete c.statusKey; delete c.keys; delete c.eligible; delete c.baseEligible;});
    installments.forEach(i => delete i._keys);
    return {summary, suppliers, claims, installments, corrections, correctionGroups, issues, monthly, annual, processes, unmatchedControls, receiptReport, meta};
  }
  // The Control is a ledger in its own right. BD matching enriches the rows,
  // but never determines whether a valid payment or open installment exists.
  function analyze(bdRows, controlRows, options = {}) {
    const correctionScenario = options.correctionScenario === 'original' ? 'original' : 'corrected', useOriginal = correctionScenario === 'original';
    const model = analyzeScope(bdRows, controlRows, options);
    model.meta.correctionScenario = correctionScenario;
    model.meta.correctionScenarioNote = useOriginal ? 'Visão original: fornecedor K, ano de entrada B, mercado D e valor integral U do Controle. Reclamado e negociação continuam na BD; datas R e valores recebidos T não mudam.' : 'Visão corrigida: fornecedor e classificação seguem vínculos seguros com a BD; U segue AJ somente para um claim único. Reclamado e negociação continuam na BD; datas R e valores recebidos T não mudam.';
    const unknownOperation = 'SEM OPERAÇÃO IDENTIFICADA';
    const labels = new Map(), supplierLabels = new Map(), index = new Map();
    for (let n = 1; n < bdRows.length; n++) {
      const row = bdRows[n];
      if (!row || !row.slice(0, 36).some(v => v != null && v !== '')) continue;
      const label = text(row[25]).replace(/\s+/g, ' ').replace(/\s*[-–—]\s*/g, ' - ');
      if (label && !labels.has(normalizeStatus(label))) labels.set(normalizeStatus(label), label);
      const supplier = text(row[28]) || '(SEM NEGOCIAÇÃO)';
      if (!supplierLabels.has(norm(supplier))) supplierLabels.set(norm(supplier), supplier);
      const date = parseDate(row[1]);
      const claim = {row:n+1, order:text(row[22]), supplier, analyst:text(row[56]) || 'Não informado', operation:label, year:date ? Number(date.slice(0,4)) : null, market:text(row[3]), status:text(row[6]), claimed:number(row[35])};
      for (const key of unique([...tokenizeRefs(row[22]), ...tokenizeRefs(row[24])])) {
        if (!index.has(key)) index.set(key, new Set()); index.get(key).add(claim);
      }
    }
    for (const installment of model.installments) installment.operations = unique(installment.operations.map(label => labels.get(normalizeStatus(label)) || label));
    const operation = labels.get(normalizeStatus(options.controlOperation)) || text(options.controlOperation);
    const operationFilter = normalizeStatus(operation), supplierFilter = norm(options.supplier);
    const yearSet = new Set(model.meta.years), asOf = model.meta.asOf;
    const executiveRows = new Set(model.installments.filter(i => i.includedInRealized).map(i => i.row));
    const all = [], issues = [], processMap = new Map(), impactRows = [], activeAttribution = new Map();
    const agreementSources = {integral:headerKey(controlRows[0]?.[20]) === 'VALORINTEGRALCLAIM', agreed:headerKey(controlRows[0]?.[21]) === 'VALORNEGOCIADOCLAIM'};
    const meta = {isIntegral:true, correctionScenario, asOf, years:model.meta.years, operation, supplier:text(options.supplier), operationScope:'all', comparativeOperation:text(options.operation), totalControlRows:0, linkedControlRows:0, ambiguousControlRows:0, unmatchedControlRows:0, receivedOutsidePeriod:0, excludedYearUnknownAmount:0, excludedYearUnknownCount:0, incompatibleStatusExcludedAmount:0, receivedWithoutMonthlyDate:0, confirmedReceivedWithoutMonthlyDate:0,
      receiptBasis:'Controle integral: M=Pago, ano de R selecionado e T positivo. Vínculo, ano Data RNC, situação e expurgo da BD não excluem o recebido. Operação e fornecedor são filtros explícitos. O recebido do comparativo conserva somente as parcelas também incluídas no comparativo executivo.',
      openBasis:'Todas as parcelas em aberto, de todos os anos, até a quitação. N define vencimento; sem previsão permanece dentro do prazo. O ano de R filtra somente pagamentos confirmados.'};
    for (let n = 1; n < controlRows.length; n++) {
      const row = controlRows[n];
      if (!row || !row.slice(0,20).some(v => v != null && v !== '')) continue;
      meta.totalControlRows++;
      const payment = receiptAt(row,n+1,asOf), linkage = controlMatches(row,index);
      const {keys,matched,complete,rejected}=linkage,unresolved=linkage.unresolvedParts.length>0;
      const supplierKeys = unique(matched.map(c => norm(c.supplier))), years = unique(matched.map(c => c.year)), markets = unique(matched.map(c => normalizeMarket(c.market))), statuses = unique(matched.map(c => normalizeStatus(c.status)));
      const supplierSafe = complete && supplierKeys.length === 1 && !!supplierKeys[0] && supplierKeys[0] !== '(SEM NEGOCIACAO)';
      const safe = supplierSafe && years.length === 1 && markets.length === 1 && statuses.length === 1;
      const operationKeys = unique(matched.map(c => normalizeStatus(c.operation)));
      const operations = complete && operationKeys.length === 1 && operationKeys[0] ? [labels.get(operationKeys[0])] : [unknownOperation];
      const originalSupplier = text(row[10]);
      const correctedSupplier = supplierSafe ? supplierLabels.get(supplierKeys[0]) : originalSupplier || '(SEM FORNECEDOR)';
      const supplier = useOriginal ? originalSupplier || '(SEM FORNECEDOR)' : correctedSupplier;
      const activeYear = !useOriginal && complete && years.length === 1 && years[0] != null ? years[0] : row[1] ?? null;
      const activeMarket = !useOriginal && complete && markets.length === 1 && !!markets[0] ? matched[0].market : text(row[3]);
      activeAttribution.set(n+1,{supplier,year:activeYear,market:activeMarket,originalSupplier,originalYear:row[1]??null,originalMarket:text(row[3])});
      if (originalSupplier && !supplierLabels.has(norm(originalSupplier))) supplierLabels.set(norm(originalSupplier),originalSupplier);
      if (operations[0] === unknownOperation && !labels.has(normalizeStatus(unknownOperation))) labels.set(normalizeStatus(unknownOperation),unknownOperation);
      const dueDate = parseDate(row[13]), noDueDate = row[13] == null || text(row[13]) === '', expected = number(row[14]);
      const isLoss = !payment.markedPaid && (norm(row[12]) === 'PREJUIZO MINERVA' || norm(row[23]) === 'PREJUIZO MINERVA');
      const status = payment.confirmedPaid ? 'Pago' : payment.markedPaid ? 'Conferir pagamento' : isLoss ? 'Prejuízo Minerva' : !noDueDate && !dueDate ? 'Conferir previsão' : dueDate && dueDate < asOf ? 'Vencido' : 'Dentro do Prazo';
      const inPeriod = payment.confirmedPaid && yearSet.has(payment.compensationYear);
      const inst = {row:n+1, reference:text(row[7]), supplier, originalSupplier, analysts:unique(matched.map(c => c.analyst)), confession:text(row[9]), type:text(row[11]) || 'Não informado', status, originalStatus:text(row[12]), dueDate, compDate:payment.compDate, compensationYear:payment.compensationYear, compensationMonth:payment.compensationMonth, receiptAnalyst:payment.receiptAnalyst, expected, received:payment.received, inPeriod, bdRows:matched.map(c => c.row), rejectedBdRows:rejected.map(c=>c.row), contextCollision:rejected.length>0, year:activeYear, market:activeMarket, originalYear:row[1] ?? null, originalMarket:text(row[3]), noDueDate, expectedMissing:expected == null && ['Vencido','Dentro do Prazo'].includes(status), linkState:!matched.length ? 'unmatched' : safe ? matched.length > 1 ? 'grouped' : 'matched' : 'review', includedInConfirmed:inPeriod, includedInRealized:inPeriod && executiveRows.has(n+1), grouped:matched.length > 1, claimStatus:statuses.length === 1 ? matched[0].status : matched.length ? 'Múltiplas situações' : 'Sem vínculo com a BD', operations, isControlRecord:true};
      const scoped = (!operationFilter || operations.some(label => normalizeStatus(label) === operationFilter)) && (!supplierFilter || norm(supplier) === supplierFilter || (!useOriginal && norm(originalSupplier) === supplierFilter));
      if (!scoped) continue;
      if(rejected.length)issues.push(contextCollisionIssue(row,n+1,rejected));
      // Both correction views use exactly the same ledger rows and amounts.
      // Resolve each descriptive field independently, only with a complete link.
      if (inPeriod || ['Vencido','Dentro do Prazo'].includes(status)) {
        const supplierResolved = supplierSafe && matched[0].supplier !== '(SEM NEGOCIAÇÃO)';
        const yearResolved = complete && years.length === 1 && years[0] != null;
        const marketResolved = complete && markets.length === 1 && !!markets[0];
        const original = {supplier:originalSupplier || '(SEM FORNECEDOR)', yearEntry:row[1] == null || text(row[1]) === '' ? null : row[1], market:text(row[3])};
        const corrected = {supplier:supplierResolved ? matched[0].supplier : original.supplier, yearEntry:yearResolved ? years[0] : original.yearEntry, market:marketResolved ? matched[0].market : original.market};
        const changed = norm(original.supplier) !== norm(corrected.supplier) || (number(original.yearEntry) == null ? text(original.yearEntry) !== text(corrected.yearEntry) : number(original.yearEntry) !== number(corrected.yearEntry)) || normalizeMarket(original.market) !== normalizeMarket(corrected.market);
        const orders = complete ? unique(matched.flatMap(claim => tokenizeRefs(claim.order))) : [];
        impactRows.push({row:inst.row, reference:inst.reference, orders:orders.length ? orders : keys.length ? keys : ['Linha '+inst.row], original, corrected, changed, unresolved:!(supplierResolved && yearResolved && marketResolved), received:inPeriod ? payment.received : 0, receivedCount:inPeriod ? 1 : 0, openBalance:['Vencido','Dentro do Prazo'].includes(status) ? expected || 0 : 0, openCount:['Vencido','Dentro do Prazo'].includes(status) ? 1 : 0, missingExpectedAmount:expected == null && ['Vencido','Dentro do Prazo'].includes(status)});
      }
      issues.push(...payment.issues);
      if (payment.confirmedPaid && !inPeriod) meta.receivedOutsidePeriod += payment.received;
      if (payment.markedPaid && payment.compensationYear == null) { meta.excludedYearUnknownCount++; if (payment.validReceived) meta.excludedYearUnknownAmount += payment.received; }
      if (!payment.markedPaid && payment.validReceived) meta.incompatibleStatusExcludedAmount += payment.received;
      const references = keys.length && !unresolved ? [...keys].sort() : [];
      const agreementRefs = safe ? matched.map(c => 'BD:'+c.row).sort() : references.length ? references : ['ROW:'+inst.row];
      const processKey = JSON.stringify([agreementRefs,norm(supplier),norm(inst.confession)]);
      if (!processMap.has(processKey)) processMap.set(processKey,{id:'CONTROL-'+inst.row,supplier,analysts:[],bdRows:[],references:references.length ? references : [inst.reference || 'Sem referência'],installments:[],claimed:0,received:0,total:0,paid:0,overdue:0,onTime:0,loss:0,review:0,settled:false,status:'',_claims:new Map(),_safe:true,_integral:[],_originalIntegral:[],_integralSources:new Set(),_integralCorrectedRows:[],_agreed:[],_scheduled:[],_receivedAllYears:0});
      const process = processMap.get(processKey); inst.processId = process.id;
      process.installments.push(inst.row); process.total++; process.references.push(...references); process.analysts.push(...inst.analysts); process.bdRows.push(...inst.bdRows);
      process._safe = process._safe && safe;
      const rawIntegral = agreementSources.integral ? number(row[20]) : null;
      const canApplyIntegral = !useOriginal && agreementSources.integral && complete && matched.length === 1 && matched[0].claimed != null && matched[0].claimed >= 0;
      process._originalIntegral.push(rawIntegral);
      process._integral.push(canApplyIntegral ? matched[0].claimed : rawIntegral);
      process._integralSources.add(canApplyIntegral ? 'BD!AJ' : 'Controle!U');
      if (canApplyIntegral && (rawIntegral == null || Math.abs(rawIntegral-matched[0].claimed)>.010000001)) process._integralCorrectedRows.push(inst.row);
      process._agreed.push(agreementSources.agreed ? number(row[21]) : null);
      process._scheduled.push(expected);
      if (payment.confirmedPaid) process._receivedAllYears += payment.received;
      for (const claim of matched) process._claims.set(claim.row,claim.claimed);
      if (status === 'Pago') process.paid++;
      if (status === 'Vencido') process.overdue++;
      if (status === 'Dentro do Prazo') process.onTime++;
      if (status === 'Prejuízo Minerva') process.loss++;
      if (status.startsWith('Conferir')) process.review++;
      if (inst.includedInRealized) process.received += inst.received;
      all.push(inst);
    }
    const installments = all.filter(i => i.status !== 'Pago' || i.inPeriod);
    const visibleProcesses = new Set(installments.map(i => i.processId));
    const allInstallments = all.filter(i => visibleProcesses.has(i.processId));
    const processes = [...processMap.values()].filter(p => visibleProcesses.has(p.id)).map(p => {
      p.references = unique(p.references); p.analysts = unique(p.analysts); p.bdRows = unique(p.bdRows); p.claimed = p._safe && [...p._claims.values()].every(v => v != null) ? money([...p._claims.values()].reduce((a,b)=>a+b,0)) : null; p.received = money(p.received);
      p.settled = p.total > 0 && p.paid === p.total && p.review === 0 && p.loss === 0;
      p.status = p.review ? 'Conferir pagamento ou previsão' : p.settled ? 'Todas as parcelas pagas' : p.overdue ? 'Com parcelas vencidas' : p.loss ? 'Com prejuízo registrado' : 'Parcelas em aberto';
      const uniqueAmount = values => values.length && values.every(value => value != null && value >= 0) && unique(values.map(money)).length === 1 ? values[0] : null;
      const integral = uniqueAmount(p._integral), agreed = uniqueAmount(p._agreed);
      p.integralControl = integral == null ? null : money(integral);
      const originalIntegral = uniqueAmount(p._originalIntegral);
      p.originalIntegralControl = originalIntegral == null ? null : money(originalIntegral);
      p.integralSource = [...p._integralSources].join(' + '); p.integralCorrectedRows = p._integralCorrectedRows;
      p.correctionScenario = correctionScenario;
      p.agreed = agreed == null ? null : money(agreed);
      p.agreementRate = integral != null && integral > 0 && agreed != null ? agreed / integral : null;
      p.receivedAllYears = money(p._receivedAllYears);
      p.agreementBalance = agreed == null ? null : money(agreed - p._receivedAllYears);
      p.scheduledTotal = p._scheduled.every(value => value != null) ? money(p._scheduled.reduce((total,value) => total + value,0)) : null;
      p.agreementReasons = [];
      if (!agreementSources.integral) p.agreementReasons.push('Coluna U — Valor Integral Claim indisponível.');
      else if (integral == null) p.agreementReasons.push('U deve conter um único valor integral válido, repetido entre as parcelas.');
      else if (integral === 0) p.agreementReasons.push('Valor integral igual a zero; percentual de acordo não calculado.');
      if (!agreementSources.agreed) p.agreementReasons.push('Coluna V — Valor negociado Claim indisponível.');
      else if (agreed == null) p.agreementReasons.push('V deve conter um único valor negociado válido, repetido entre as parcelas.');
      if (p.scheduledTotal == null) p.agreementReasons.push('O contém parcelas sem valor previsto válido; total programado incompleto.');
      if (p.review) p.agreementReasons.push('Há parcelas com pagamento ou previsão a conferir.');
      p.agreementReview = p.agreementReasons.length > 0;
      p.agreementStatus = p.agreementRate == null ? 'Conferir valores do acordo' : p.agreementRate >= 1 ? '100% do claim acordado' : p.agreementRate === 0 ? 'Sem valor acordado' : 'Claim parcialmente acordado';
      delete p._safe; delete p._claims; delete p._integral; delete p._originalIntegral; delete p._integralSources; delete p._integralCorrectedRows; delete p._agreed; delete p._scheduled; delete p._receivedAllYears; return p;
    });
    for (const inst of installments) {
      if (['matched','grouped'].includes(inst.linkState)) meta.linkedControlRows++; else if (inst.linkState === 'unmatched') meta.unmatchedControlRows++; else meta.ambiguousControlRows++;
      if (inst.includedInConfirmed && !inst.compensationMonth) meta.confirmedReceivedWithoutMonthlyDate += inst.received;
      if (inst.includedInRealized && !inst.compensationMonth) meta.receivedWithoutMonthlyDate += inst.received;
    }
    for (const key of ['receivedOutsidePeriod','excludedYearUnknownAmount','incompatibleStatusExcludedAmount','receivedWithoutMonthlyDate','confirmedReceivedWithoutMonthlyDate']) meta[key] = money(meta[key]);
    meta.receivedConfirmed = money(sum(installments.filter(i => i.includedInConfirmed),'received'));
    meta.paidCount = installments.filter(i => i.includedInConfirmed).length;
    meta.openBalance = money(sum(installments.filter(i => ['Vencido','Dentro do Prazo'].includes(i.status)),'expected'));
    meta.openCount = installments.filter(i => ['Vencido','Dentro do Prazo'].includes(i.status)).length;
    for (const installment of model.installments) { const active=activeAttribution.get(installment.row); if(useOriginal&&active)Object.assign(installment,{supplier:active.supplier,year:active.year,market:active.market}); }
    for (const receipt of model.receiptReport.rows) { const active=activeAttribution.get(receipt.row); if(active)Object.assign(receipt,{supplier:active.supplier,yearEntry:active.year,market:active.market,originalYear:active.originalYear,originalMarket:active.originalMarket}); }
    model.receiptReport.meta.correctionScenario = correctionScenario;
    model.controlReport = {installments, allInstallments, processes, issues, meta, operationOptions:[...labels.values()].sort((a,b)=>a.localeCompare(b,'pt-BR')), supplierOptions:[...supplierLabels.values()].sort((a,b)=>a.localeCompare(b,'pt-BR'))};
    model.correctionImpact = correctionImpact(impactRows, meta);
    model.claimValueAudit = claimValueAudit(model, bdRows, controlRows);
    appendClaimValueCorrections(model, bdRows);
    applyReceiptCohorts(model, controlRows, index, options);
    return model;
  }
  function correctionImpact(rows, scope) {
    const total = {received:0, receivedCount:0, openBalance:0, openCount:0, rowCount:rows.length, orderCount:0, changedRows:0, changedOrders:0, unresolvedRows:0, missingExpectedAmounts:0};
    const orders = new Set(), changedOrders = new Set(), maps = {original:new Map(), corrected:new Map()};
    for (const row of rows) {
      for (const field of ['received','receivedCount','openBalance','openCount']) total[field] += row[field];
      if (row.changed) total.changedRows++;
      if (row.unresolved) total.unresolvedRows++;
      if (row.missingExpectedAmount) total.missingExpectedAmounts++;
      row.orders.forEach(order => {orders.add(order); if (row.changed) changedOrders.add(order);});
      for (const mode of ['original','corrected']) {
        const values = row[mode], key = JSON.stringify([norm(values.supplier),text(values.yearEntry),norm(values.market)]);
        if (!maps[mode].has(key)) maps[mode].set(key,{...values, received:0, receivedCount:0, openBalance:0, openCount:0, rowCount:0, orderCount:0, changedRows:0, unresolvedRows:0, missingExpectedAmounts:0, rows:[], references:[], _orders:new Set()});
        const group = maps[mode].get(key);
        for (const field of ['received','receivedCount','openBalance','openCount']) group[field] += row[field];
        group.rowCount++; if (row.changed) group.changedRows++; if (row.unresolved) group.unresolvedRows++;
        if (row.missingExpectedAmount) group.missingExpectedAmounts++;
        group.rows.push(row.row); group.references.push(row.reference); row.orders.forEach(order => group._orders.add(order));
      }
    }
    total.received = money(total.received); total.openBalance = money(total.openBalance);
    total.orderCount = orders.size; total.changedOrders = changedOrders.size;
    const groups = mode => [...maps[mode].values()].map(group => {
      group.received = money(group.received); group.openBalance = money(group.openBalance);
      group.orderCount = group._orders.size; group.references = unique(group.references);
      delete group._orders; return group;
    }).sort((a,b) => a.supplier.localeCompare(b.supplier,'pt-BR') || text(a.yearEntry).localeCompare(text(b.yearEntry),'pt-BR',{numeric:true}) || a.market.localeCompare(b.market,'pt-BR'));
    return {summary:total, original:groups('original'), corrected:groups('corrected'), meta:{scope:'Controle integral no mesmo recorte de fornecedor e operação, com pagamentos no período selecionado e parcelas em aberto de todos os anos.', years:[...scope.years], supplier:scope.supplier, operation:scope.operation, fields:['Fornecedor — K / Negociação — BD!AC','Ano Entrada — B / ano da Data RNC — BD!B','Mercado — D / BD!D'], basis:'Recebido: M = Pago, ano e mês de R e valor USD de T. Em aberto: N e valor previsto O.', invariant:'A alternância reclassifica fornecedor, ano de entrada e mercado. Não altera valores recebidos ou previstos, datas, filtros nem totais do Controle.', resolution:'Cada campo segue a BD somente com referência completa e valor único válido; sem resolução segura, mantém o original.', rounding:'Somatórios preservam a precisão da base e são arredondados apenas no resultado. Subtotais de grupos distintos podem diferir por centavos de arredondamento.'}};
  }

  // Financial audit uses all matching Control installments, independently of
  // payment status/date. Connected components prevent reusing an installment
  // for several BD claims; grouped amounts are never allocated arbitrarily.
  function claimValueAudit(model, bdRows, controlRows) {
    const available = {AJ:true, AO:['RECEBIDOUSD','VALORRECEBIDOUSD'].includes(headerKey(bdRows[0]?.[40])), O:true, U:headerKey(controlRows[0]?.[20]) === 'VALORINTEGRALCLAIM'};
    const selected = new Set(model.claims.map(claim => claim.row));
    const claims = new Map(), controls = new Map(), index = new Map(), parents = new Map();
    const find = node => {let key=node;while(parents.get(key)!==key)key=parents.get(key);while(node!==key){const next=parents.get(node);parents.set(node,key);node=next;}return key;};
    const ensure = node => {if(!parents.has(node))parents.set(node,node);};
    const join = (a,b) => {ensure(a);ensure(b);const aa=find(a),bb=find(b);if(aa!==bb)parents.set(bb,aa);};
    for(let n=1;n<bdRows.length;n++){
      const source=bdRows[n];if(!source||!source.slice(0,36).some(value=>value!=null&&value!==''))continue;
      const row=n+1,keys=unique([...tokenizeRefs(source[22]),...tokenizeRefs(source[24])]);
      const claim={row,source,keys};claims.set(row,claim);ensure('b'+row);
      for(const key of keys){if(!index.has(key))index.set(key,[]);index.get(key).push(claim);}
    }
    for(let n=1;n<controlRows.length;n++){
      const source=controlRows[n];if(!source||!source.slice(0,21).some(value=>value!=null&&value!==''))continue;
      const linkage=controlMatches(source,index),matched=linkage.matched.map(claim=>claim.row);if(!matched.length)continue;
      const row=n+1,complete=linkage.complete;
      controls.set(row,{row,source,complete});for(const claimRow of matched)join('b'+claimRow,'c'+row);
    }
    const components=new Map();
    for(const claim of claims.values()){
      const key=find('b'+claim.row);if(!components.has(key))components.set(key,{claims:[],controls:[]});components.get(key).claims.push(claim);
    }
    for(const control of controls.values())components.get(find('c'+control.row)).controls.push(control);
    const sumComplete=values=>values.length&&values.every(value=>value!=null)?values.reduce((a,b)=>a+b,0):null;
    const different=(a,b)=>a==null||b==null||Math.abs(a-b)>.010000001;
    const rows=[],uCorrections=[];
    for(const component of components.values()){
      const scoped=component.claims.filter(claim=>selected.has(claim.row));if(!scoped.length)continue;
      component.controls.sort((a,b)=>a.row-b.row);scoped.sort((a,b)=>a.row-b.row);
      const outside=component.claims.filter(claim=>!selected.has(claim.row)),complete=component.controls.length>0&&!outside.length&&component.controls.every(control=>control.complete);
      const rawClaimed=sumComplete(scoped.map(claim=>number(claim.source[35])));
      const rawBdReceived=available.AO?sumComplete(scoped.map(claim=>number(claim.source[40]))):null;
      const rawControlExpected=sumComplete(component.controls.map(control=>number(control.source[14])));
      const originalClaimValues=available.U?unique(component.controls.map(control=>control.source[20]??'')):[];
      const originalNumbers=available.U?component.controls.map(control=>number(control.source[20])):[];
      const uniqueOriginalNumbers=unique(originalNumbers.filter(value=>value!=null).map(money));
      const single=component.claims.length===1&&scoped.length===1;
      const rawOriginalClaim=single&&available.U&&originalNumbers.length&&originalNumbers.every(value=>value!=null)&&uniqueOriginalNumbers.length===1?originalNumbers[0]:null;
      const reasons=[];
      if(!available.AO)reasons.push('Coluna BD!AO — Recebido (USD) ausente ou com cabeçalho diferente.');
      else if(rawBdReceived==null)reasons.push('AO contém valor vazio ou inválido em pelo menos uma linha BD.');
      if(!available.U)reasons.push('Coluna Controle!U — Valor Integral Claim ausente ou com cabeçalho diferente.');
      if(!component.controls.length)reasons.push('Nenhuma parcela do Controle foi vinculada a esta ocorrência.');
      if(component.controls.length&&rawControlExpected==null)reasons.push('O contém valor vazio ou inválido em pelo menos uma parcela; soma incompleta.');
      if(rawClaimed==null)reasons.push('AJ contém valor vazio ou inválido na BD.');
      if(outside.length)reasons.push('O mesmo vínculo também contém linhas BD fora do recorte: '+outside.map(claim=>claim.row).join(', ')+'.');
      if(component.controls.some(control=>!control.complete))reasons.push('Referência do Controle contém partes desconhecidas ou genéricas; conferir o vínculo completo.');
      if(component.claims.length>1)reasons.push('Conjunto de claims ligado às mesmas referências; valores agrupados uma vez, sem rateio nem correção automática de U.');
      if(available.U&&single&&component.controls.length&&rawOriginalClaim==null)reasons.push('U está vazio, inválido ou varia entre as parcelas; não há valor integral original único.');
      const canCorrectClaimValue=complete&&single&&available.U&&rawClaimed!=null;
      const hasClaimValueMismatch=canCorrectClaimValue&&component.controls.some(control=>different(number(control.source[20]),rawClaimed));
      const deltaReceived=complete&&rawBdReceived!=null&&rawControlExpected!=null?money(rawControlExpected-rawBdReceived):null;
      const hasReceivedMismatch=deltaReceived!=null&&Math.abs(deltaReceived)>.010000001;
      const prejudice=rawClaimed!=null&&rawBdReceived!=null?money(rawClaimed-rawBdReceived):null;
      const originalPrejudice=complete&&rawOriginalClaim!=null&&rawControlExpected!=null?money(rawOriginalClaim-rawControlExpected):null;
      const uncertain=!complete||rawClaimed==null||rawBdReceived==null||rawControlExpected==null||!available.U||(single&&rawOriginalClaim==null);
      const references=unique(scoped.flatMap(claim=>tokenizeRefs(claim.source[22]).length?tokenizeRefs(claim.source[22]):tokenizeRefs(claim.source[24]))).sort();
      const supplier=unique(scoped.map(claim=>text(claim.source[28])||'(SEM NEGOCIAÇÃO)')).join('; '),analysts=unique(scoped.map(claim=>text(claim.source[56])||'Não informado'));
      const reference=references.join('; ')||'Linha BD '+scoped.map(claim=>claim.row).join(', ');
      const status=!component.controls.length?'Sem correspondência':!complete?'Conferir vínculo':uncertain?'Dados incompletos':hasClaimValueMismatch||hasReceivedMismatch?'Divergência de valores':component.claims.length>1?'Agrupado sem rateio':'Conferido';
      const result={id:'claim-values-'+scoped.map(claim=>claim.row).join('-'),reference,supplier,analysts,bdRows:scoped.map(claim=>claim.row),connectedBdRows:component.claims.map(claim=>claim.row).sort((a,b)=>a-b),outsideScopeBdRows:outside.map(claim=>claim.row),controlRows:component.controls.map(control=>control.row),claimed:rawClaimed==null?null:money(rawClaimed),bdReceived:rawBdReceived==null?null:money(rawBdReceived),controlExpected:rawControlExpected==null?null:money(rawControlExpected),originalClaimValues,originalClaimValue:rawOriginalClaim==null?null:money(rawOriginalClaim),prejudice,originalPrejudice,deltaReceived,hasClaimValueMismatch,hasReceivedMismatch,status,uncertain,reasons,grouped:component.claims.length>1,canCorrectClaimValue,complete};
      rows.push(result);
      if(canCorrectClaimValue)for(const control of component.controls){
        if(!different(number(control.source[20]),rawClaimed))continue;
        uCorrections.push({row:control.row,cell:'U'+control.row,field:'Valor Integral Claim',original:control.source[20]??'',corrected:rawClaimed,bdRows:[scoped[0].row],reference:text(control.source[7]),supplier,analysts,rncDate:parseDate(scoped[0].source[1])||'',reason:'Valor integral obtido de BD!AJ para uma única ocorrência com vínculo completo. O valor de cada parcela em O e o recebido em T são preservados.'});
      }
    }
    rows.sort((a,b)=>a.reference.localeCompare(b.reference,'pt-BR'));
    const summary={claims:selected.size,groups:rows.length,controlRows:unique(rows.flatMap(row=>row.controlRows)).length,claimValueMismatches:rows.filter(row=>row.hasClaimValueMismatch).length,claimValueCorrectionRows:uCorrections.length,receivedMismatches:rows.filter(row=>row.hasReceivedMismatch).length,uncertainGroups:rows.filter(row=>row.uncertain).length,groupedClaims:rows.filter(row=>row.grouped).length,missingAmounts:{},knownTotals:{}};
    for(const field of ['claimed','bdReceived','controlExpected','prejudice','originalClaimValue','originalPrejudice']){
      const values=rows.map(row=>row[field]),missing=values.filter(value=>value==null).length;
      summary.missingAmounts[field]=missing;summary.knownTotals[field]=values.some(value=>value!=null)?money(values.reduce((total,value)=>total+(value??0),0)):null;
      summary[field]=rows.length&&!missing?summary.knownTotals[field]:null;
    }
    return {rows,summary,uCorrections,meta:{sourcesAvailability:available,scope:'Claims selecionados na BD; todas as parcelas do Controle ligadas pelas referências de ordem/NF, independentemente de status, ano de entrada ou data de compensação.',receivedDefinition:'AO — Recebido (USD) da BD deve corresponder à soma de O — Valor USD de todas as parcelas vinculadas. Não é o recebido realizado de T.',claimDefinition:'U — Valor Integral Claim do Controle deve corresponder a AJ da BD somente quando o vínculo identifica uma única ocorrência.',prejudiceFormula:'Prejuízo do claim = AJ − AO.',originalPrejudiceFormula:'Visão original = U único do claim − soma de O das parcelas.',lossDistinction:'A Perda agregada do painel permanece Reclamado − (Recebido realizado em T + Em negociação).',allocation:'Componentes de referências compartilhadas são somados uma vez, sem distribuir valores entre claims. Vínculos incompletos ficam para conferência.',totals:'Cada claim e parcela aparece em um único grupo. Totais com dados incompletos ficam indisponíveis; knownTotals informa somente o subtotal conhecido.',toleranceUSD:.01}};
  }
  function appendClaimValueCorrections(model,bdRows){
    const changes=model.claimValueAudit.uCorrections;if(!changes.length)return;
    const empty=()=>({originalValues:[],correctedValues:[],changes:[]});
    for(const group of model.correctionGroups)if(!group.claimValue)group.claimValue=empty();
    for(const change of changes){
      model.corrections.push(change);
      const claimRow=change.bdRows[0],source=bdRows[claimRow-1],orders=tokenizeRefs(source[22]).sort(),reference=orders.join('; ')||tokenizeRefs(source[24]).join('; ')||change.reference;
      let group=model.correctionGroups.find(group=>group.bdRows.includes(claimRow)||(orders.length&&group.orders?.length&&JSON.stringify([...group.orders].sort())===JSON.stringify(orders)));
      if(!group){group={id:'',reference,orders,references:[],supplier:change.supplier,suppliers:[],analysts:[],rows:[],bdRows:[],rncDates:[],year:empty(),market:empty(),claimValue:empty(),changes:[],correctionCount:0,rowCount:0,hasYearCorrection:false,hasMarketCorrection:false,hasClaimValueCorrection:false,hasConflictingCorrections:false,hasVaryingOriginals:false};model.correctionGroups.push(group);}
      group.references.push(change.reference);group.suppliers.push(change.supplier);group.analysts.push(...change.analysts);group.rows.push(change.row);group.bdRows.push(...change.bdRows);if(change.rncDate)group.rncDates.push(change.rncDate);
      group.changes.push(change);group.claimValue.originalValues.push(change.original);group.claimValue.correctedValues.push(change.corrected);group.claimValue.changes.push(change);
    }
    model.correctionGroups.sort((a,b)=>a.reference.localeCompare(b.reference,'pt-BR')).forEach((group,index)=>{
      group.id='correction-order-'+(index+1);group.references=unique(group.references);group.suppliers=unique(group.suppliers);group.supplier=group.suppliers.join('; ');group.analysts=unique(group.analysts);group.rows=unique(group.rows).sort((a,b)=>a-b);group.bdRows=unique(group.bdRows).sort((a,b)=>a-b);group.rncDates=unique(group.rncDates).sort();group.changes.sort((a,b)=>a.row-b.row||a.field.localeCompare(b.field,'pt-BR'));
      group.claimValue.originalValues=unique(group.claimValue.originalValues);group.claimValue.correctedValues=unique(group.claimValue.correctedValues);group.claimValue.changes.sort((a,b)=>a.row-b.row);
      group.correctionCount=group.changes.length;group.rowCount=group.rows.length;group.hasClaimValueCorrection=group.claimValue.changes.length>0;group.hasConflictingCorrections=group.hasConflictingCorrections||unique(group.claimValue.correctedValues.map(number)).length>1;group.hasVaryingOriginals=group.hasVaryingOriginals||group.claimValue.originalValues.length>1;
    });
    model.summary.correctionCount=model.corrections.length;model.summary.correctionGroupCount=model.correctionGroups.length;
  }


  // Cash follows the compensation date, even when the claim originated in a
  // different year. Claim eligibility still governs claimed/negotiating amounts.
  function applyReceiptCohorts(model,controlRows,index,options){
    const years=new Set(model.meta.years),supplierFilter=norm(options.supplier),operationFilter=normalizeStatus(options.operation),useOriginal=model.meta.correctionScenario==='original';
    const rows=[],excluded=[],suppliers=new Map(),annual=new Map(),monthly=new Map(),canonicalSuppliers=new Map(model.suppliers.map(supplier=>[norm(supplier.name),supplier.name]));
    const meta={years:[...years],supplier:text(options.supplier),operation:text(options.operation),scope:'Recebimentos do Controle no período de R. A BD valida a classificação; referência ausente ou incompleta não exclui o caixa. Sem filtro de operação, entram exportação CTNR/carreta e operação não identificada. Com operação específica, somente a operação validada entra.',sameYearDefinition:'Ano da compensação R igual ao ano único de Data RNC validado na BD, ou ao Ano Entrada B quando não houver validação segura.',differentYearDefinition:'Ano da compensação R diferente do ano único de Data RNC validado na BD, ou do Ano Entrada B quando não houver validação segura.',unknownYearDefinition:'Não há ano de claim seguro na BD nem Ano Entrada B válido no Controle; pagamento mantido em Ano a conferir.',receivedBasis:'M = Pago; R = Data compensação válida; T = Valor Recebido USD positivo. Cada linha do Controle é contada uma vez, inclusive referências agregadas.',unresolvedCount:0,unresolvedAmount:0,outsideOperationCount:0,outsideOperationAmount:0,excludedUnknownOperationCount:0,excludedUnknownOperationAmount:0,receivedWithoutClaimDetailCount:0,receivedWithoutClaimDetail:0};
    const accum=(map,key,base,row)=>{
      if(!map.has(key))map.set(key,{...base,received:0,sameYear:0,differentYear:0,unknownYear:0,count:0,receivedWithoutClaimDetail:0,receivedWithoutClaimDetailCount:0,receivedComparable:0,receivedByClaimYear:{2024:0,2025:0,2026:0,other:0}});
      const value=map.get(key);value.received+=row.received;value.count++;value[row.cohort==='same'?'sameYear':row.cohort==='different'?'differentYear':'unknownYear']+=row.received;
      value.receivedByClaimYear[[2024,2025,2026].includes(row.claimYear)?row.claimYear:'other']+=row.received;
      if(years.has(row.claimYear))value.receivedComparable+=row.received;
      if(row.validationState==='control-only'){value.receivedWithoutClaimDetail+=row.received;value.receivedWithoutClaimDetailCount++;}
    };
    for(let n=1;n<controlRows.length;n++){
      const source=controlRows[n];if(!source)continue;
      const payment=receiptAt(source,n+1,model.meta.asOf);if(!payment.confirmedPaid||!years.has(payment.compensationYear))continue;
      const {matched,complete,rejected}=controlMatches(source,index);
      const operations=unique(matched.map(claim=>normalizeStatus(claim.operation))),supplierKeys=unique(matched.map(claim=>norm(claim.supplier)));
      const supplierResolved=complete&&supplierKeys.length===1&&supplierKeys[0]&&supplierKeys[0]!=='(SEM NEGOCIACAO)';
      const knownOperation=complete&&operations.length>0&&operations.every(operation=>!!operation);
      const eligibleOperation=knownOperation&&operations.every(operation=>OPS.has(operation)&&(!operationFilter||operation===operationFilter));
      const activeSupplier=!useOriginal&&supplierResolved ? matched[0].supplier : text(source[10])||'(SEM FORNECEDOR)',activeSupplierKey=norm(activeSupplier);
      const supplier=canonicalSuppliers.get(activeSupplierKey)||activeSupplier;if(!canonicalSuppliers.has(activeSupplierKey))canonicalSuppliers.set(activeSupplierKey,supplier);if(supplierFilter&&norm(supplier)!==supplierFilter)continue;
      if(knownOperation&&!eligibleOperation){meta.outsideOperationCount++;meta.outsideOperationAmount+=payment.received;excluded.push({row:n+1,reference:text(source[7]),received:payment.received,bdRows:matched.map(claim=>claim.row),reason:'Operação validada fora do filtro selecionado.'});continue;}
      if(!knownOperation&&operationFilter){meta.excludedUnknownOperationCount++;meta.excludedUnknownOperationAmount+=payment.received;excluded.push({row:n+1,reference:text(source[7]),received:payment.received,bdRows:matched.map(claim=>claim.row),reason:'Operação não identificada; não é possível atribuir o pagamento à operação específica selecionada.'});continue;}
      const bdClaimYears=unique(matched.map(claim=>claim.year)),entryYear=number(source[1]),originalClaimYear=Number.isInteger(entryYear)&&entryYear>=1900&&entryYear<=9999?entryYear:null;
      const yearResolved=complete&&bdClaimYears.length===1&&bdClaimYears[0]!=null;
      const claimYear=!useOriginal&&yearResolved?bdClaimYears[0]:originalClaimYear,claimYears=claimYear==null?[]:[claimYear];
      const cohort=claimYear==null?'unknown':claimYear===payment.compensationYear?'same':'different';
      const validationState=!complete?'control-only':supplierResolved&&yearResolved&&knownOperation?'matched':'partial',validationReasons=[];
      if(rejected.length)validationReasons.push('Coincidência numérica de NF rejeitada por contexto de Gado e fornecedor incompatíveis com a exportação da BD; classificação do Controle preservada.');
      if(!complete)validationReasons.push('Referência agregada, incompleta ou não localizada na BD; recebimento preservado conforme Controle.');
      if(!supplierResolved)validationReasons.push('Fornecedor não validado de forma única na BD; mantido K do Controle.');
      if(!yearResolved)validationReasons.push(originalClaimYear==null?'Ano do claim sem validação na BD e B inválido; conferir.':'Ano do claim sem validação na BD; mantido B do Controle.');
      if(!knownOperation)validationReasons.push('Operação não identificada; incluída somente na visão sem operação específica.');
      const yearSource=useOriginal?'Controle B (original)':yearResolved?'BD B — Data RNC':'Controle B (não validado na BD)',supplierSource=!useOriginal&&supplierResolved?'BD AC — Negociação':'Controle K',operationSource=knownOperation?'BD Z — Operação':'Não identificada';
      const row={row:n+1,reference:text(source[7]),supplier,originalSupplier:text(source[10]),compensationYear:payment.compensationYear,claimYears,claimYear,bdClaimYears,originalClaimYear,correctionScenario:model.meta.correctionScenario,cohort,compDate:payment.compDate,compensationMonth:payment.compensationMonth,received:payment.received,bdRows:matched.map(claim=>claim.row).sort((a,b)=>a-b),rejectedBdRows:rejected.map(claim=>claim.row),contextCollision:rejected.length>0,claimStatuses:unique(matched.map(claim=>claim.status)),operations:knownOperation?unique(matched.map(claim=>claim.operation)):[],receiptAnalyst:payment.receiptAnalyst,validationState,validationReasons,yearSource,supplierSource,operationSource};
      if(validationState!=='matched'){meta.unresolvedCount++;meta.unresolvedAmount+=payment.received;}
      if(validationState==='control-only'){meta.receivedWithoutClaimDetailCount++;meta.receivedWithoutClaimDetail+=payment.received;}
      rows.push(row);accum(suppliers,norm(supplier),{name:supplier},row);accum(annual,payment.compensationYear,{year:payment.compensationYear},row);accum(monthly,payment.compensationMonth,{month:payment.compensationMonth},row);
    }
    const balancedCohort=value=>{
      const keys=['sameYear','differentYear','unknownYear'],result={received:money(value?.received||0)};
      for(const key of keys)result[key]=money(value?.[key]||0);
      const residue=Math.round(result.received*100)-keys.reduce((total,key)=>total+Math.round(result[key]*100),0);
      const existing=keys.filter(key=>(value?.[key]||0)>0).sort((a,b)=>value[b]-value[a]);
      if(residue&&existing.length)result[existing[0]]=money(result[existing[0]]+residue/100);
      return result;
    };
    const balancedClaimYears=value=>{
      const keys=['2024','2025','2026','other'],raw=value?.receivedByClaimYear||{},result={};
      for(const key of keys)result[key]=money(raw[key]||0);
      const residue=Math.round(money(value?.received||0)*100)-keys.reduce((total,key)=>total+Math.round(result[key]*100),0);
      const existing=keys.filter(key=>(raw[key]||0)>0).sort((a,b)=>raw[b]-raw[a]);
      if(residue&&existing.length)result[existing[0]]=money(result[existing[0]]+residue/100);
      return result;
    };
    const comparableAmounts=(target,cohort)=>{
      target.receivedByClaimYear=balancedClaimYears(cohort);
      target.receivedComparable=money(cohort?.receivedComparable||0);
      const claimed=typeof target.claimed==='number'&&Number.isFinite(target.claimed)?target.claimed:null;
      target.comparableRecoveryRate=claimed==null?null:ratio(target.receivedComparable,claimed);
      target.comparableLoss=claimed==null?null:money(claimed-(target.receivedComparable+(target.negotiating||0)));
      target.comparableLossRate=target.comparableLoss==null?null:ratio(target.comparableLoss,claimed);
    };
    const finish=values=>[...values].map(value=>{const result={...value,...balancedCohort(value),receivedWithoutClaimDetail:money(value.receivedWithoutClaimDetail||0)};comparableAmounts(result,value);return result;});
    meta.correctionScenario=model.meta.correctionScenario;
    if(useOriginal){meta.scope+=' Visão original: fornecedor K e Ano Entrada B do Controle, preservados sem classificação pela BD.';meta.sameYearDefinition='Ano da compensação R igual ao Ano Entrada B original do Controle.';meta.differentYearDefinition='Ano da compensação R diferente do Ano Entrada B original do Controle.';meta.unknownYearDefinition='Ano Entrada B original vazio ou inválido; pagamento mantido em Ano a conferir.';}
    meta.rounding='Valores de origem preservados. Totais e grupos são arredondados a centavos; o resíduo entre os três grupos de ano é reconciliado no maior grupo que já contém recebimentos, para que a soma corresponda ao total.';
    meta.claimYearColumns='receivedByClaimYear agrupa todo o caixa do período de R pelo ano de origem do claim: 2024, 2025, 2026; other reúne demais anos e ano a conferir. O ano segue o cenário ativo. O resíduo de arredondamento é reconciliado no maior grupo de origem que já contém recebimentos.';
    meta.comparableDefinition='receivedComparable inclui pagamentos cujo ano de compensação R e ano de origem do claim pertencem aos anos selecionados. Com 2025 e 2026 selecionados, claim 2025 pago em 2026 entra no total; claim 2024 permanece visível na coluna de origem 2024, fora desse total. received preserva todo o caixa do recorte. receivedSameYear continua como diagnóstico de igualdade entre os dois anos.';
    meta.comparableLossFormula='Reclamado − (Recebido comparável + Em negociação). Taxas e perda ficam nulas nos grupos sem denominador reclamado, como a série mensal de caixa.';
    const receiptCohorts={rows,suppliers:finish(suppliers.values()).sort((a,b)=>b.received-a.received||a.name.localeCompare(b.name,'pt-BR')),annual:finish(annual.values()).sort((a,b)=>a.year-b.year),monthly:finish(monthly.values()).sort((a,b)=>a.month.localeCompare(b.month)),excluded,meta};
    for(const key of ['unresolvedAmount','outsideOperationAmount','excludedUnknownOperationAmount','receivedWithoutClaimDetail'])meta[key]=money(meta[key]);
    model.receiptCohorts=receiptCohorts;
    const supplierMap=new Map(model.suppliers.map(supplier=>[norm(supplier.name),supplier]));
    for(const cohort of receiptCohorts.suppliers)if(!supplierMap.has(norm(cohort.name))){
      const supplier={name:cohort.name,claimed:0,forwarded:0,negotiating:0,otherClaimed:0,received:0,receivedNegotiating:0,receivedOtherStatuses:0,receivedConfirmed:0,balance:0,recoveryRate:null,occurrences:0,recordCount:0,share:0,pareto:0,paid:0,overdue:0,onTime:0,loss:0,explicitLoss:0,openBalance:0,overdueBalance:0,onTimeBalance:0,noDueBalance:0,missingExpectedAmounts:0,lossInstallments:0,installments:0,reviewCount:0,unmatchedClaims:0,processes:0,settledProcesses:0};supplierMap.set(norm(cohort.name),supplier);model.suppliers.push(supplier);
    }
    const normalizedStatus=row=>row.claimStatuses.length===1?normalizeStatus(row.claimStatuses[0]):null;
    const addAmounts=(target,cohort)=>{
      target.receivedLinkedClaims=target.received;
      const balanced=balancedCohort(cohort);
      target.received=balanced.received;target.receivedConfirmed=target.received;
      target.receivedSameYear=balanced.sameYear;target.receivedDifferentYear=balanced.differentYear;target.receivedUnknownYear=balanced.unknownYear;target.receivedCount=cohort?.count||0;
      target.receivedWithoutClaimDetail=money(cohort?.receivedWithoutClaimDetail||0);target.receivedWithoutClaimDetailCount=cohort?.receivedWithoutClaimDetailCount||0;
      target.recoveryRate=ratio(target.received,target.claimed);
      target.balance=money(target.claimed-target.received-target.negotiating);target.loss=model.meta.lossFormula==='pending'?null:money(target.claimed-target.received+(model.meta.lossFormula==='add-negotiating'?target.negotiating:-target.negotiating));target.lossRate=target.loss==null?null:ratio(target.loss,target.claimed);
      comparableAmounts(target,cohort);
    };
    for(const supplier of model.suppliers){
      const ownRows=rows.filter(row=>norm(row.supplier)===norm(supplier.name));
      addAmounts(supplier,suppliers.get(norm(supplier.name)));
      supplier.receivedNegotiating=money(sum(ownRows.filter(row=>normalizedStatus(row)===NEGOTIATING),'received'));
      supplier.receivedOtherStatuses=money(sum(ownRows.filter(row=>![FORWARDED,NEGOTIATING].includes(normalizedStatus(row))),'received'));
      supplier.paid=supplier.receivedCount;
    }
    model.suppliers.sort((a,b)=>b.claimed-a.claimed||a.name.localeCompare(b.name,'pt-BR'));
    let cumulative=0;for(const supplier of model.suppliers){supplier.share=ratio(supplier.claimed,model.summary.claimed)||0;cumulative+=supplier.share;supplier.pareto=cumulative;}
    const aggregate={received:sum(rows,'received'),sameYear:sum(rows.filter(row=>row.cohort==='same'),'received'),differentYear:sum(rows.filter(row=>row.cohort==='different'),'received'),unknownYear:sum(rows.filter(row=>row.cohort==='unknown'),'received'),count:rows.length,receivedWithoutClaimDetail:meta.receivedWithoutClaimDetail,receivedWithoutClaimDetailCount:meta.receivedWithoutClaimDetailCount};
    aggregate.receivedByClaimYear={2024:0,2025:0,2026:0,other:0};for(const row of rows)aggregate.receivedByClaimYear[[2024,2025,2026].includes(row.claimYear)?row.claimYear:'other']+=row.received;
    aggregate.receivedComparable=sum(rows.filter(row=>years.has(row.claimYear)),'received');
    addAmounts(model.summary,aggregate);model.summary.paid=rows.length;
    model.summary.receivedNegotiating=money(sum(rows.filter(row=>normalizedStatus(row)===NEGOTIATING),'received'));
    model.summary.receivedOtherStatuses=money(sum(rows.filter(row=>![FORWARDED,NEGOTIATING].includes(normalizedStatus(row))),'received'));
    for(const year of model.annual){addAmounts(year,annual.get(year.year));const ownRows=rows.filter(row=>row.compensationYear===year.year);year.receivedNegotiating=money(sum(ownRows.filter(row=>normalizedStatus(row)===NEGOTIATING),'received'));year.receivedOtherStatuses=money(sum(ownRows.filter(row=>![FORWARDED,NEGOTIATING].includes(normalizedStatus(row))),'received'));}
    for(const month of model.monthly){month.receivedLinkedClaims=month.received;const source=monthly.get(month.month),value=balancedCohort(source);month.received=value.received;month.receivedSameYear=value.sameYear;month.receivedDifferentYear=value.differentYear;month.receivedUnknownYear=value.unknownYear;comparableAmounts(month,source);}
    const rowMap=new Map(rows.map(row=>[row.row,row]));
    for(const installment of model.installments)installment.includedInRealized=rowMap.has(installment.row);
    for(const installment of [...model.controlReport.installments,...model.controlReport.allInstallments])installment.includedInRealized=rowMap.has(installment.row);
    for(const process of [...model.processes,...model.controlReport.processes])process.received=money(process.installments.reduce((total,row)=>total+(rowMap.get(row)?.received||0),0));
    model.meta.receiptBasis=meta.scope+' '+meta.receivedBasis;model.meta.confirmedReceiptBasis='O recebido do comparativo inclui o mesmo ano do claim, outros anos e ano a conferir. '+(useOriginal?'Na visão original, fornecedor e ano vêm de K/B do Controle. ':'Na visão corrigida, fornecedor e ano seguem a BD somente quando a validação é segura; caso contrário, são mantidos K/B do Controle. ')+'Referências sem detalhe não excluem recebimentos. O Controle integral mantém também as demais operações.';
    model.meta.receivedLinkedClaims=model.summary.receivedLinkedClaims;model.meta.receivedSameYear=model.summary.receivedSameYear;model.meta.receivedDifferentYear=model.summary.receivedDifferentYear;model.meta.receivedUnknownYear=model.summary.receivedUnknownYear;
    model.meta.receivedNegotiating=model.summary.receivedNegotiating;model.meta.receivedOtherStatuses=model.summary.receivedOtherStatuses;
    model.meta.ambiguousReceived=money(sum(model.installments.filter(installment=>installment.linkState==='review'&&installment.inPeriod&&!rowMap.has(installment.row)),'received'));
    for(const issue of model.issues){
      if(!rowMap.has(issue.row))continue;
      if(issue.kind==='AMBIGUOUS_LINK')issue.detail='O vínculo aos claims do recorte exige conferência. O pagamento entra no recebido por M = Pago, R e T válidos; referências incompletas e divergências de classificação não retiram o caixa do Controle.';
      if(issue.kind==='PAYMENT_ON_NEGOTIATING_CLAIM')issue.detail='Pagamento incluído no recebido por M = Pago, R e T válidos. A ocorrência ainda está em negociação na BD; conferir sua situação. O valor em negociação segue a classificação da BD.';
      if(issue.kind==='PAYMENT_ON_OTHER_CLAIM_STATUS')issue.detail='Pagamento incluído no recebido por M = Pago, R e T válidos, independentemente da situação do claim na BD.';
    }
    model.controlReport.meta.comparativeReceiptBasis=model.meta.receiptBasis;
  }

  return {analyze, validateHeaders, normalizeRef, tokenizeRefs, normalizeMarket, normalizeStatus, parseDate, number, today, version: '1.4.0'};
});
