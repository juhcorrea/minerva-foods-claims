(function (global) {
  'use strict';
  const headers = ['Fornecedor', 'Ano Entrada', 'Mercado', 'Recebido · USD', 'Parcelas pagas', 'Saldo em aberto · USD', 'Parcelas em aberto', 'Ordens / referências', 'A conferir'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount = value => Number(value || 0).toLocaleString('pt-BR', {maximumFractionDigits:0});
  const state = {model:null, audit:null, reconciliation:null, original:false, page:1, claimPage:1, printing:false, criteria:{distribution:false,financial:false}};
  const filters = () => global.MinervaTableFilters;
  const criteria = (key, body) => `<details hidden class="correction-impact-criteria" data-correction-criteria="${key}"${state.printing || state.criteria[key] ? ' open' : ''}><summary>Critérios</summary><div>${body}</div></details>`;
  const filterSummary = id => filters().has?.(id) || filters().hasSort?.(id) ? filters().summary(id) : '';
  const tableId = () => 'correction-impact-' + (state.original ? 'original' : 'corrected');
  const label = () => state.original ? 'Sem correções · valores originais do Controle' : 'Com correções · referências da BD';
  const cells = row => [esc(row.supplier || 'Não informado'), esc(row.yearEntry ?? 'Não informado'), esc(row.market || 'Não informado'), moneyExact(row.received), amount(row.receivedCount), moneyExact(row.openBalance), amount(row.openCount), amount(row.orderCount), row.unresolvedRows ? `<span class="badge warning">${amount(row.unresolvedRows)} linhas</span>` : '<span class="badge positive">Conferido</span>'];
  const values = row => [row.supplier, row.yearEntry, row.market, row.received, row.receivedCount, row.openBalance, row.openCount, row.orderCount, row.unresolvedRows];
  const financialRows = (rows,field) => [...(rows||[])].sort((a,b)=>{const first=a[field]==null?null:Number(a[field]),second=b[field]==null?null:Number(b[field]);return first==null||!Number.isFinite(first)?(second==null||!Number.isFinite(second)?0:1):second==null||!Number.isFinite(second)?-1:second-first;});
  const sourceRows = () => financialRows(state.model?.[state.original ? 'original' : 'corrected'],'received');
  const money = value => value == null || !Number.isFinite(Number(value)) ? '—' : amount(value);
  const issueSource = issue => issue.source === 'BD' || /^(?:CLAIM_|INVALID_RNC_DATE$|INVALID_CLAIM_AMOUNT$|MISSING_CLAIM_)/.test(issue.kind || '') ? 'BD' : 'Controle';
  const sourceCell = (sheet, column, row) => `${sheet}!${column}${Number.isInteger(row) && row > 0 ? row : ''}`;
  const sourceColumns = (sheet, columns, row) => columns.map(column => sourceCell(sheet,column,row)).join(' / ');
  const shown = value => value == null || String(value).trim() === '' ? 'vazio' : String(value);
  const usdFormatter = new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const moneyExact = value => value == null || !Number.isFinite(Number(value)) ? '—' : usdFormatter.format(Number(value));
  const shownUsd = value => typeof value === 'number' && Number.isFinite(value) ? 'USD '+usdFormatter.format(value) : shown(value);
  const problemText = problem => [problem.title,problem.where,problem.action].filter(Boolean).join(' · ');
  function issueProblem(issue) {
    const row=issue.row, source=issueSource(issue), location=columns=>sourceColumns(source,columns,row);
    const linkedRows=[...new Set((issue.bdRows||[]).filter(value=>Number.isInteger(value)&&value>0))].sort((a,b)=>a-b);
    const claimReferences=linkedRows.length?linkedRows.map(value=>sourceColumns('BD',['W','Y'],value)).join(' / '):'BD!W / BD!Y';
    const definitions={
      CLAIM_FORWARDED_WITHOUT_CONTROL:['Ressarcimento encaminhado sem registro correspondente no Controle',sourceColumns('BD',['G','Q','W','Y'],row),'Não encontramos esta ordem/NF no Controle. Confira a referência em BD W/Y e Controle H; se o lançamento realmente não existir, cadastre o ressarcimento no Controle. Isso não comprova ausência de pagamento.'],
      CLAIM_WITHOUT_LINK:['Ordem/NF da BD sem correspondência no Controle',sourceColumns('BD',['W','Y'],row),'Confira a ordem/NF da BD e a referência no Controle H. Não encontrar o vínculo não significa que o pagamento não ocorreu.'],
      CONTROL_WITHOUT_BD:['Referência do Controle não localizada na BD',location(['H']),'Confira esta referência com Ordem (BD W) e NF (BD Y); corrija a referência ou verifique o cadastro na BD. O pagamento confirmado é preservado.'],
      CONTROL_PARTIAL_LINK:['Parte da referência do Controle não foi localizada na BD',location(['H']),'Confira cada ordem/NF informada nesta célula com BD W/Y. Complete ou corrija as referências antes de atribuir o recebimento.'],
      CONTROL_AMBIGUOUS_RNC_YEAR:['Não há um único ano de Data RNC para esta referência',location(['B','H'])+' / BD!B','Confira as datas RNC dos claims vinculados: há data inválida ou mais de um ano. Não adote um ano por suposição.'],
      CONTROL_RNC_YEAR_MISMATCH:['Ano Entrada do Controle diferente do ano da Data RNC',location(['B'])+' / BD!B',`Conferir Ano Entrada: ${shown(issue.originalYear)} → ${shown(issue.correctedYear)}, conforme a Data RNC da BD. Corrija o Controle e importe novamente.`],
      BD_MISSING_OPERATION:['Operação em branco na BD',location(['Z']),'Confira e preencha a operação na BD; depois importe novamente. Não inferir a operação pelo fornecedor ou pela ordem.'],
      INVALID_RNC_DATE:['Data RNC vazia ou inválida na BD',location(['B']),'Corrija a Data RNC na BD para identificar o ano do claim.'],
      INVALID_CLAIM_AMOUNT:['Valor reclamado vazio ou inválido na BD',location(['AJ']),'Confira e informe o valor reclamado numérico em USD na BD.'],
      MISSING_CLAIM_STATUS:['Situação não informada na BD',location(['G']),'Preencha a situação correta do claim na BD e importe novamente.'],
      MISSING_CLAIM_REFERENCE:['Ordem/NF não informada ou inválida na BD',location(['W','Y']),'Confira e preencha a referência da ocorrência na BD.'],
      AMBIGUOUS_LINK:['Referência não permite atribuir o recebimento com segurança',location(['H'])+' / '+claimReferences,'Confira todas as ordens/NFs e os fornecedores/anos envolvidos. Não repartir o valor entre claims por suposição.'],
      NF_CONTEXT_COLLISION:['NF coincide com um claim de contexto diferente',location(['H','K','D'])+' / '+claimReferences,'Confira a ordem, o fornecedor e o mercado nas duas planilhas antes de vincular a NF. O pagamento confirmado é preservado.'],
      INVALID_RECEIPT_AMOUNT:['Valor recebido inválido no Controle',location(['T']),'Confira e informe o valor numérico recebido em USD; valores inválidos não são somados.'],
      MISSING_EXPECTED_AMOUNT:['Parcela em aberto sem valor válido',location(['O','M']),'Preencha o valor previsto da parcela em Controle O. O saldo está incompleto enquanto esse valor faltar.'],
      PAID_WITHOUT_VALID_AMOUNT:['Parcela marcada Pago sem valor recebido válido',location(['M','T']),'Confira o status Pago e informe em T o valor positivo efetivamente recebido.'],
      MISSING_COMPENSATION_DATE:['Pagamento sem data de compensação',location(['R','M']),'Informe a data real de compensação em R para identificar o mês e o ano do recebido.'],
      INVALID_COMPENSATION_DATE:['Data de compensação inválida',location(['R']),'Corrija a data de compensação em R; o pagamento não entra nos totais por período enquanto a data for inválida.'],
      INVALID_COMPENSATION_YEAR:['Ano Compensação vazio ou inválido',location(['AE','R']),'Confira AE com o ano da data R. Os totais continuam usando R.'],
      COMPENSATION_YEAR_MISMATCH:['Ano Compensação diferente do ano da data R',location(['AE','R']),'Confira as duas células e corrija a informação na origem. Os totais usam a data R.'],
      FUTURE_COMPENSATION:['Data de compensação posterior à data da análise',location(['R']),'Confira a data informada e a data de referência da análise. O valor não é excluído automaticamente.'],
      CONFLICTING_PAYMENT_FIELD:['Campos de pagamento do Controle se contradizem',location(['M','X']),'Confira Status Pagamento (M) e Pagamento (X) com o registro real e atualize a origem.'],
      PAYMENT_STATUS_NOT_PAID:['Valor recebido informado, mas status não é Pago',location(['T','M']),'Confirme se o pagamento ocorreu e corrija o campo divergente. Não mudar o status apenas para incluir o valor.'],
      INVALID_DUE_DATE:['Data prevista de pagamento inválida',location(['N']),'Corrija a data prevista na coluna N do Controle.'],
      PAYMENT_ON_NEGOTIATING_CLAIM:['Pagamento confirmado com claim ainda em negociação',location(['M','R','T'])+' / BD!G','Confira e atualize a situação do claim na BD, conforme o andamento real.'],
      PAYMENT_ON_OTHER_CLAIM_STATUS:['Pagamento confirmado com outra situação na BD',location(['M','R','T'])+' / BD!G','Confira a situação do claim na BD e a referência no Controle H; o pagamento confirmado permanece registrado.'],
      RECEIVED_ABOVE_FORWARDED:['Recebido supera o reclamado encaminhado do fornecedor','BD!G / BD!AJ / Controle!H / Controle!T','Confira valores, câmbio e referências entre as planilhas. A diferença negativa é preservada.']
    };
    const known=definitions[issue.kind], exact=(issue.sourceCells||[]).join(' / ');
    if(issue.kind==='INSURANCE_MIXED_REFERENCE'){
      const references=[...new Set((issue.insuranceReferences||[]).map(value=>String(value).trim()).filter(Boolean))];
      return {title:'Pagamentos de claim e seguro na mesma referência',where:exact||location(['H'])+' / '+claimReferences,action:(issue.detail||'Esta referência reúne pagamentos de claim e seguro. Confira a qual registro pertence o recebimento. O valor não foi dividido entre os registros.')+(references.length?' Referência de seguro: '+references.join(' · ')+'.':'')};
    }
    const specific=['AMBIGUOUS_LINK','NF_CONTEXT_COLLISION'].includes(issue.kind)?String(issue.detail||'').trim():'';
    return known ? {title:known[0],where:exact||known[1],action:specific?specific+(/[.!?]$/.test(specific)?' ':'. ')+known[2]:known[2]} : {title:issue.type && !/^(Pendências|Vínculo\s*\/\s*dados)$/i.test(issue.type)?issue.type:'Informação de origem precisa de conferência',where:exact||`${source}${row?' · linha '+row:''}`,action:issue.detail||'Abra o detalhe e confira os campos indicados na planilha de origem.'};
  }
  function reviewProblems(entry) {
    const result=[],add=(title,where,action)=>result.push({title,where,action});
    for(const group of entry.groups||[])for(const change of group.changes||[]){
      const cell=change.cell||'',column=cell.replace(/\d/g,''),bdRows=change.bdRows||group.bdRows||[];
      const fields={B:['Ano Entrada diferente da Data RNC','B','Ano Entrada'],D:['Mercado diferente entre as planilhas','D','Mercado'],K:['Fornecedor diferente entre as planilhas','AC','Fornecedor'],U:['Valor integral do claim diferente entre as planilhas','AJ','Valor integral']},field=fields[column];
      if(column==='B'&&(entry.issues||[]).some(issue=>issue.kind==='CONTROL_RNC_YEAR_MISMATCH'&&issue.row===change.row))continue;
      const show=column==='U'?shownUsd:shown;
      add(field?.[0]||`${change.field||'Campo'} diferente entre as planilhas`,sourceCell('Controle',column,change.row)+' / '+(field?bdRows.map(row=>sourceCell('BD',field[1],row)).join(' / '):'BD'),`${field?.[2]||change.field||'Valor'}: ${show(change.original)} → ${show(change.corrected)}. Confira a célula no Controle com a referência da BD; após ajustar a planilha, importe novamente.`);
    }
    for(const audit of entry.audits||[]){
      const bd=columns=>(audit.bdRows||[]).flatMap(row=>columns.map(column=>sourceCell('BD',column,row))).join(' / '),control=columns=>(audit.controlRows||[]).flatMap(row=>columns.map(column=>sourceCell('Controle',column,row))).join(' / ');
      if(audit.hasClaimValueMismatch&&!(entry.groups||[]).some(group=>(group.changes||[]).some(change=>/^U\d+$/.test(change.cell||'')&&(audit.controlRows||[]).includes(change.row))))add('Valor integral do claim diferente entre BD (AJ) e Controle (U)',[bd(['AJ']),control(['U'])].filter(Boolean).join(' / '),`BD AJ: ${shownUsd(audit.claimed)}; Controle U: ${shownUsd(audit.originalClaimValue)}. Confira o valor integral; não substitua o valor de cada parcela em O.`);
      if(audit.hasReceivedMismatch)add('Valor de recebimento diferente entre BD (AO) e Controle (O)',[bd(['AO']),control(['O'])].filter(Boolean).join(' / '),`BD AO: ${shownUsd(audit.bdReceived)}; soma Controle O: ${shownUsd(audit.controlExpected)}${audit.deltaReceived==null?'':'; diferença O − AO: '+shownUsd(audit.deltaReceived)}. Confira qual registro precisa ser ajustado. O inclui parcelas pagas e em aberto; não é o recebido efetivo de T.`);
      if(audit.uncertain||!audit.complete&&audit.status!=='Conferido'){
        if(!(audit.controlRows||[]).length)add('Ordem/NF da BD sem correspondência no Controle',bd(['W','Y']),'Confira a referência com Controle H. Ausência de vínculo não comprova ausência de pagamento.');
        else if(audit.complete===false)add('Referências incompletas impedem comparar os valores',[control(['H']),bd(['W','Y'])].filter(Boolean).join(' / '),'Confira todas as ordens/NFs deste grupo. A comparação não usa apenas uma parte das referências nem divide valores por estimativa.');
        for(const [field,title,where,action] of [['claimed','Valor reclamado vazio ou inválido',bd(['AJ']),'Confira o valor reclamado em BD AJ.'],['bdReceived','Valor de recebimento vazio ou inválido na BD',bd(['AO']),'Confira o valor registrado em BD AO antes de compará-lo às parcelas.'],['controlExpected','Valor das parcelas vazio ou inválido',control(['O']),'Confira O em cada parcela; a soma fica incompleta se houver valor ausente ou inválido.'],['originalClaimValue','Valor integral do Controle ausente ou diferente entre parcelas',control(['U']),'Confira U nas parcelas vinculadas; não há um valor integral único para comparar.']])if(audit[field]==null&&where&&(field!=='originalClaimValue'||!audit.grouped))add(title,where,action);
      }
    }
    result.push(...(entry.issues||[]).map(issueProblem));
    const unique=new Map();for(const item of result){
      const missing=/^(Ordem\/NF da BD sem correspondência no Controle|Ressarcimento encaminhado sem registro correspondente no Controle)$/.test(item.title),key=missing?'missing-control':item.title+'|'+item.action,prior=unique.get(key);
      if(!prior){unique.set(key,item);continue;}
      const preferred=missing&&item.title.startsWith('Ressarcimento')?item:prior;
      unique.set(key,{...preferred,where:[...new Set([prior.where,item.where].flatMap(where=>(where||'').split(' / ')).filter(Boolean))].join(' / ')});
    }
    return [...unique.values()];
  }
  const problemMarkup = problems => problems?.length ? `<ul class="correction-problem-list">${problems.map(problem=>`<li><strong>${esc(problem.title)}</strong>${problem.where?`<span class="correction-problem-location">${esc(problem.where)}</span>`:''}<span>${esc(problem.action)}</span></li>`).join('')}</ul>` : '';
  // Display groups use only explicit source-row links. Each source object stays
  // intact; no amounts, corrections or ambiguous references are deduplicated.
  function buildQueue(model, groups = model?.correctionGroups || []) {
    const claimDates=new Map([...(model?.executiveReport?.controlClaims||[]),...(model?.claims||[])].map(claim=>[claim.row,claim.rncDate]));
    const entries=global.ClaimsEngine.buildCorrectionReviewItems(model,groups);
    const unique=values=>[...new Set(values.filter(value=>value!=null&&String(value).trim()!==''))];
    return entries.map((entry,index)=>{
      const sources=[...entry.groups,...entry.audits,...entry.issues],references=unique(sources.flatMap(row=>row.references?.length?row.references:[row.reference])),suppliers=unique(sources.flatMap(row=>row.suppliers?.length?row.suppliers:[row.supplier])),analysts=unique(sources.flatMap(row=>row.analysts||[row.analyst]));
      const problems=reviewProblems(entry),types=unique(problems.map(problem=>problem.title));
      const known=entry.audits.length&&entry.audits.every(audit=>audit.claimed!=null&&Number.isFinite(Number(audit.claimed)));
      const referenceAmount=known?entry.audits.reduce((sum,audit)=>sum+Number(audit.claimed),0):null;
      return {...entry,id:'review-'+index,reference:references.join(' · ')||'Sem referência',references,sgrs:unique(entry.issues.map(issue=>issue.sgr)),sourceCells:unique(entry.issues.flatMap(issue=>issue.sourceCells||[])),supplier:suppliers.join(' · '),suppliers,analysts,bdRows:unique(entry.bdRows).sort((a,b)=>a-b),controlRows:unique(entry.controlRows).sort((a,b)=>a-b),rncDates:unique([...entry.groups.flatMap(group=>group.rncDates||[]),...entry.issues.flatMap(issue=>issue.rncDates||[]),...entry.bdRows.map(row=>claimDates.get(row))]),types:types.length?types:['Conferir os campos indicados na origem'],problems,referenceAmount,doneCount:entry.groups.filter(group=>group.progress?.done===true).length};
    }).sort((a,b)=>(b.referenceAmount??-Infinity)-(a.referenceAmount??-Infinity)||a.reference.localeCompare(b.reference,'pt-BR'));
  }
  const claimTableId = () => 'correction-impact-claims-' + (state.original ? 'original' : 'corrected');
  function auditComparisons(row) {
    const finite=value=>typeof value==='number'&&Number.isFinite(value),linked=row.complete===true&&(row.controlRows||[]).length>0;
    const single=row.grouped!==true&&new Set(row.connectedBdRows||row.bdRows||[]).size===1;
    const result=(ready,mismatch)=>!ready||typeof mismatch!=='boolean'?'A conferir':mismatch?'Divergência':'Confere';
    return {claimValue:result(linked&&single&&finite(row.claimed)&&finite(row.originalClaimValue),row.hasClaimValueMismatch),installments:result(linked&&finite(row.bdReceived)&&finite(row.controlExpected)&&finite(row.deltaReceived),row.hasReceivedMismatch)};
  }
  function auditResultMarkup(value) {
    const kind=value==='Confere'?'ok':value==='Divergência'?'error':'review';
    const mark=kind==='ok'?'<path d="m6 12 4 4 8-8"/>':kind==='error'?'<path d="m8 8 8 8m0-8-8 8"/>':'<path d="M12 7v6m0 4h.01"/>';
    return `<span class="comparison-result comparison-result--${kind}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="10"/>${mark}</svg><strong>${esc(value)}</strong></span>`;
  }
  const claimHeaders = original => ['Ordem / referência', 'Fornecedor · BD', original ? 'Valor integral · Controle · USD' : 'Valor reclamado · BD · USD', original ? 'Total das parcelas · Controle · USD' : 'Total registrado · BD · USD', 'Diferença parcelas − BD · USD', 'Reclamado × integral', 'Total registrado × parcelas', 'O que conferir', 'Linhas BD', 'Linhas Controle'];
  function claimValues(row, original = state.original) {
    const comparison=auditComparisons(row);
    return [row.reference, row.supplier, original ? row.originalClaimValue : row.claimed, original ? row.controlExpected : row.bdReceived, row.deltaReceived, comparison.claimValue, comparison.installments, reviewProblems({audits:[row]}).map(problemText).join(' · '), (row.bdRows || []).join(', '), (row.controlRows || []).join(', ')];
  }
  function claimCells(row) {
    const values = claimValues(row), reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const badge=auditResultMarkup;
    const status = problemMarkup(reviewProblems({audits:[row]}))+`${reasons.length ? `<details class="claim-value-reasons"><summary>Ver observações da origem</summary><ul>${reasons.map(reason => `<li>${esc(reason)}</li>`).join('')}</ul></details>` : ''}`;
    return [`<span class="reference-with-copy"><span>${esc(row.reference || 'Sem referência')}</span>${global.MinervaCopy?.button(row.reference) || ''}</span>`, esc(row.supplier || 'Não informado'), moneyExact(values[2]), moneyExact(values[3]), moneyExact(values[4]), badge(values[5]), badge(values[6]), status||'—', esc(values[8] || '—'), esc(values[9] || '—')];
  }
  function claimTotal(rows, field) {
    const missing = rows.filter(row => row[field] == null).length;
    return {value:missing || !rows.length ? null : rows.reduce((sum,row) => sum + row[field], 0), missing};
  }
  function financialSection() {
    if (!state.audit) return '';
    const id = claimTableId(), titles = claimHeaders(state.original), source = financialRows(state.audit.rows,state.original?'originalClaimValue':'claimed');
    const rows = filters().prepare(id, titles, source, row => { const result = claimCells(row),values=claimValues(row); result[0] = esc(row.reference); result[7] = esc(values[7]); return result; }, 'Conferência financeira por claim · ' + label(), {types:['text','text','number','number','number','text','text','text','text','text'], sortValues:row => claimValues(row)});
    const size = state.printing ? Math.max(rows.length, 1) : 40, pages = Math.max(1, Math.ceil(rows.length / size));
    state.claimPage = Math.min(state.claimPage, pages);
    const page = rows.slice((state.claimPage - 1) * size, state.claimPage * size);
    const fields = state.original ? [['Valor integral · Controle','originalClaimValue'],['Total das parcelas · Controle','controlExpected']] : [['Valor reclamado · BD','claimed'],['Total registrado · BD','bdReceived']];
    const metrics = fields.map(([title,field]) => {
      const total = claimTotal(rows, field);
      return `<article><span>${title}</span><strong>${total.value == null ? '—' : 'USD ' + money(total.value)}</strong><small>${total.missing ? `${amount(total.missing)} grupos incompletos · total indisponível` : `${amount(rows.length)} grupos filtrados`}</small></article>`;
    }).join('');
    return `<section class="panel correction-impact-panel claim-value-panel"><div class="panel-heading"><div><span class="section-kicker">VALORES NAS DUAS PLANILHAS</span><h2>Conferência financeira por claim</h2></div><span id="claimAuditScenario" class="badge ${state.original ? 'warning' : 'positive'}">${esc(state.original ? 'Original · Controle' : 'Referência corrigida · BD')}</span></div><div class="correction-impact-metrics claim-value-metrics">${metrics}</div>${criteria('financial', `<p class="panel-description">Confira U do Controle contra AJ da BD e a soma de O de todas as parcelas contra AO da BD.</p><div class="correction-impact-status"><p>Somente claims em RESSARCIMENTO ENCAMINHADO, exceto Área negociação (BD!Q) = Seguro. Considera todas as parcelas vinculadas no Controle, de qualquer ano e status. Referências que misturam claims deste escopo com Seguro ou outras situações não são comparadas parcialmente nem rateadas. A opção “Ver números sem correções” também alterna esta comparação.</p><p>${state.original ? 'Original: valor integral e total das parcelas do Controle.' : 'Referência da BD: valor reclamado e total registrado.'} Todos os valores estão em USD.</p></div><p class="correction-impact-note">A soma de O inclui os valores previstos de parcelas pagas, vencidas e no prazo. Ela é diferente do recebido efetivamente pago da coluna T. As parcelas O e os pagamentos T não são substituídos automaticamente. Referências que abrangem vários claims aparecem em conjunto, sem rateio; valores incompletos ficam “—”.</p><p>Os filtros e a ordenação estão nos títulos das colunas. Cada claim entra uma vez nos totais, sem repetição por parcela.</p>`)}${filterSummary(id)}<div class="table-wrap correction-impact-scroll claim-value-scroll" tabindex="0" aria-label="Conferência financeira por claim"><table data-table-id="${id}"><caption class="sr-only">Conferência financeira por claim · ${esc(label())}</caption><thead><tr>${titles.map((header,index) => `<th scope="col" aria-sort="${filters().ariaSort(id,index)}">${filters().heading(id,index,header)}</th>`).join('')}</tr></thead><tbody>${page.length ? page.map(row => `<tr>${claimCells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${titles.length}" class="empty-table">Nenhum claim neste filtro.</td></tr>`}</tbody></table></div>${rows.length > size ? `<div class="pagination correction-impact-pagination"><span>Página ${state.claimPage} de ${pages} · ${amount(rows.length)} grupos de claims</span><button type="button" class="button secondary" data-claim-impact-page="${state.claimPage - 1}"${state.claimPage === 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="button secondary" data-claim-impact-page="${state.claimPage + 1}"${state.claimPage === pages ? ' disabled' : ''}>Próxima</button></div>` : ''}</section>`;
  }
  function renderArchive(model) {
    if (model) { state.model = model.correctionImpact || null; state.audit = model.claimValueAudit || null; state.reconciliation = model.baseReconciliation?.meta || null; state.original = model.meta?.correctionScenario === 'original'; }
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
    host.innerHTML = `<section class="panel correction-impact-panel"><div class="panel-heading"><div><span class="section-kicker">CONFERÊNCIA</span><h2>Original × corrigido</h2></div><label class="correction-scenario-toggle"><input id="correctionOriginalToggle" type="checkbox"${state.original ? ' checked' : ''}><span>Ver números sem correções</span></label></div><div class="correction-impact-status"><strong id="correctionScenarioLabel">${esc(label())}</strong><span class="correction-impact-scope">${esc((scope.years || []).join(' + '))}</span></div><div class="correction-impact-metrics"><article><span>Recebido</span><strong>USD ${amount(received)}</strong><small>${amount(rows.length)} grupos filtrados</small></article><article><span>Saldo em aberto</span><strong>USD ${amount(open)}</strong><small>Todos os anos</small></article><article><span>Linhas alteradas</span><strong>${amount(summary.changedRows)}</strong><small>${amount(summary.changedOrders)} ordens / referências</small></article></div>${summary.missingExpectedAmounts ? `<p class="correction-impact-alert">Saldo incompleto · ${amount(summary.missingExpectedAmounts)} parcelas sem valor previsto válido.</p>` : ''}${criteria('distribution', `<p>Compare a distribuição dos recebimentos por fornecedor, ano de entrada e mercado.</p><p>${esc(scopeText)}</p><p>Este cenário vale também para o comparativo, os indicadores, os gráficos e as exportações do painel. A marca “Já ajustei” é um acompanhamento separado.</p><p class="correction-impact-note">Os dois cenários usam os mesmos pagamentos: <strong>USD ${amount(summary.received)}</strong> no período. Corrigir fornecedor, ano de entrada ou mercado muda a distribuição, sem alterar o valor pago nem a data de compensação. Ano e mês do recebido vêm de R; o Ano Entrada é apenas o agrupamento. Vínculos incompletos ou conflitantes preservam os campos originais e ficam “A conferir”.${summary.missingExpectedAmounts ? ` O saldo está incompleto: ${amount(summary.missingExpectedAmounts)} parcelas sem valor previsto válido.` : ''}</p><p>Os filtros e a ordenação estão nos títulos das colunas. Os indicadores desta tabela acompanham seus filtros; os indicadores gerais mantêm o recorte principal.</p>`)}${filterSummary(id)}<div class="table-wrap correction-impact-scroll" tabindex="0" aria-label="${esc(label())}"><table data-table-id="${id}"><caption class="sr-only">${esc(label())}</caption><thead><tr>${headers.map((header,index) => `<th scope="col" aria-sort="${filters().ariaSort(id,index)}">${filters().heading(id,index,header)}</th>`).join('')}</tr></thead><tbody>${page.length ? page.map(row => `<tr>${cells(row).map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-table">Nenhum grupo neste filtro.</td></tr>`}</tbody></table></div>${rows.length > size ? `<div class="pagination correction-impact-pagination"><span>Página ${state.page} de ${pages} · ${amount(rows.length)} grupos</span><button type="button" class="button secondary" data-impact-page="${state.page - 1}"${state.page === 1 ? ' disabled' : ''}>Anterior</button><button type="button" class="button secondary" data-impact-page="${state.page + 1}"${state.page === pages ? ' disabled' : ''}>Próxima</button></div>` : ''}</section>` + financialSection();
  }
  function render(model) {
    renderArchive(model);
    const host=document.getElementById('correctionImpact');if(!host||!state.model)return;
    const archive=host.innerHTML.replace(/<label class="correction-scenario-toggle">[\s\S]*?<\/label>/,'').replace('id="correctionScenarioLabel"','');
    const rows=sourceRows(),received=rows.reduce((sum,row)=>sum+row.received,0),open=rows.reduce((sum,row)=>sum+row.openBalance,0),summary=state.model.summary,review=state.reconciliation;
    host.innerHTML=`<section class="panel correction-unified-summary"><div class="panel-heading"><div><span class="section-kicker">CENÁRIO DA CONFERÊNCIA</span><h2 id="correctionScenarioLabel">${esc(label())}</h2></div><label class="correction-scenario-toggle"><input id="correctionOriginalToggle" type="checkbox"${state.original?' checked':''}><span>Ver números sem correções</span></label></div><div class="correction-impact-metrics"><article><span>Recebido · USD</span><strong>${amount(received)}</strong></article><article><span>Saldo em aberto · USD</span><strong>${amount(open)}</strong></article><article><span>${review?'Anos divergentes':'Linhas com correção'}</span><strong>${amount(review?review.yearDifferences:summary.changedRows)}</strong><small>${review?'Base completa · todos os anos':amount(summary.changedOrders)+' ordens / referências'}</small></article></div>${review?`<div class="correction-impact-status"><span class="badge warning">${amount(review.bdWithoutControl)} ressarcimentos sem vínculo no Controle</span><span class="badge warning">${amount(review.controlWithoutBd)} Controle sem BD</span><span class="badge warning">${amount(review.partialLinks)} vínculos parciais</span></div>`:''}${summary.missingExpectedAmounts?`<p class="correction-impact-alert">Saldo incompleto · ${amount(summary.missingExpectedAmounts)} parcelas sem valor previsto válido.</p>`:''}</section>`;
    const archiveHtml=`<details class="correction-audit-archive" data-correction-archive${state.archiveOpen||state.printing?' open':''}><summary>Auditoria completa · cenários e valores de origem</summary><div>${archive}</div></details>`,archiveHost=document.getElementById('correctionArchive');
    if(archiveHost)archiveHost.innerHTML=archiveHtml;else host.innerHTML+=archiveHtml;
  }
  function addWorksheets(workbook) {
    if (!state.model) return;
    const xlsx = global.XLSX;
    for (const [key,title] of [['original','Cenario original'],['corrected','Cenario corrigido']]) {
      const rows = financialRows(state.model[key],'received');
      const data = [headers, ...rows.map(row => values(row))];
      const sheet = xlsx.utils.aoa_to_sheet(data);
      sheet['!cols'] = headers.map((_,index) => ({wch:index === 0 ? 38 : 24}));
      if (rows.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:rows.length,c:headers.length-1})};
      for (let n = 2; n <= rows.length + 1; n++) for (const col of ['D','F']) if (sheet[col+n]?.t === 'n') sheet[col+n].z = '#,##0.00';
      xlsx.utils.book_append_sheet(workbook, sheet, title);
    }
    if (state.audit) {
      for (const [original,title] of [[true,'Claim original'],[false,'Claim corrigido']]) {
        const titles = [...claimHeaders(original),'Analistas na BD','Valores U encontrados','Motivos da conferência'];
        const rows = financialRows(state.audit.rows,original?'originalClaimValue':'claimed');
        const sheet = xlsx.utils.aoa_to_sheet([titles,...rows.map(row => [...claimValues(row,original),(row.analysts || []).join('; '),(row.originalClaimValues || []).join('; '),(row.reasons || []).join('; ')])]);
        sheet['!cols'] = titles.map((_,index) => ({wch:index < 2 ? 36 : index === 7 || index === titles.length-1 ? 65 : 25}));
        if (rows.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:rows.length,c:titles.length-1})};
        for (let row = 2; row <= rows.length + 1; row++) for (const col of ['C','D','E']) if (sheet[col+row]?.t === 'n') sheet[col+row].z = '#,##0.00';
        xlsx.utils.book_append_sheet(workbook, sheet, title);
      }
      const corrections = financialRows(state.audit.uCorrections,'corrected');
      const titles = ['Ordem / referência','Fornecedor','Analista na BD','Linha Controle','Célula Controle','Campo','Valor original U','Valor correto AJ','Linhas BD','Regra'];
      const sheet = xlsx.utils.aoa_to_sheet([titles,...corrections.map(row => [row.reference,row.supplier,(row.analysts || []).join('; '),row.row,row.cell,row.field,row.original,row.corrected,(row.bdRows || []).join('; '),row.reason])]);
      sheet['!cols'] = titles.map((_,index) => ({wch:index === 9 ? 65 : 26}));
      if (corrections.length) sheet['!autofilter'] = {ref:xlsx.utils.encode_range({r:0,c:0},{r:corrections.length,c:titles.length-1})};
      for (let row = 2; row <= corrections.length + 1; row++) for (const col of ['G','H']) if (sheet[col+row]?.t === 'n') sheet[col+row].z = '#,##0.00';
      xlsx.utils.book_append_sheet(workbook, sheet, 'Ajustes valor integral U');
    }
  }
  function clear() { state.model = null; state.audit = null; state.reconciliation = null; state.original = false; state.page = 1; state.claimPage = 1; state.printing = false; state.archiveOpen=false; state.criteria = {distribution:false,financial:false}; document.getElementById('correctionImpact')?.replaceChildren();document.getElementById('correctionArchive')?.replaceChildren(); }
  document.addEventListener('toggle', event => { const key = event.target.dataset?.correctionCriteria; if (key && !state.printing) state.criteria[key] = event.target.open;if(event.target.dataset?.correctionArchive!==undefined&&!state.printing)state.archiveOpen=event.target.open; }, true);
  document.addEventListener('change', async event => {
    if (event.target.id !== 'correctionOriginalToggle') return;
    const requested = event.target.checked ? 'original' : 'corrected'; event.target.disabled = true; state.page = 1; state.claimPage = 1; await global.MinervaApp?.setCorrectionScenario(requested);
    document.getElementById('correctionOriginalToggle')?.focus();
  });
  document.addEventListener('click', event => { const button = event.target.closest('[data-impact-page],[data-claim-impact-page]'); if (button && !button.disabled) { if (button.dataset.claimImpactPage) state.claimPage = Number(button.dataset.claimImpactPage); else state.page = Number(button.dataset.impactPage); render(); } });
  document.addEventListener('minerva:model-updated', () => { if (!global.MinervaApp?.state.model) clear(); });
  global.MinervaCorrectionImpact = {render,clear,label,buildQueue,issueSource,issueProblem,problemText,problemMarkup,auditComparisons,auditResultMarkup,addWorksheets,handlesTable:id => id.startsWith('correction-impact-'),handleFilter:() => {state.page=1;state.claimPage=1;render();},beforePrint:() => {state.printing=true;render();},afterPrint:() => {state.printing=false;render();}};
})(window);
