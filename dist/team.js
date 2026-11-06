(function (global) {
  'use strict';

  const displayName = identity => String(identity?.name || identity?.label || identity?.email || 'Pessoa autorizada');
  const accessStatus = identity => identity?.status || (identity?.approved === true ? 'approved' : 'pending');
  const isApprovedSession = identity => Boolean(identity?.authenticated && identity?.approved === true && ['admin','editor','viewer'].includes(identity?.role) && !['pending','revoked','rejected','denied'].includes(identity?.status));
  const publicProfile = identity => isApprovedSession(identity) ? {name:displayName(identity), email:String(identity.email || ''), role:identity.role} : null;
  const escapeHTML = value => String(value == null ? '' : value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  function reportQuery(options) {
    const params = new URLSearchParams();
    const opts = options || {};
    if (Array.isArray(opts.years) && opts.years.length) params.set('years', opts.years.map(Number).filter(Number.isInteger).join(','));
    if (opts.allYears === true) params.set('allYears', '1');
    if (opts.asOf) params.set('asOf', String(opts.asOf));
    if (opts.supplier) params.set('supplier', String(opts.supplier));
    if (opts.operation) params.set('operation', String(opts.operation));
    if (opts.controlOperation) params.set('controlOperation', String(opts.controlOperation));
    params.set('correctionScenario', String(opts.correctionScenario ?? 'corrected'));
    return params.toString();
  }
  // Pure helpers are available to local Node checks; hosted behavior never starts there.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {displayName, accessStatus, isApprovedSession, publicProfile, escapeHTML, reportQuery};
    return;
  }
  if (global.MINERVA_HOSTED !== true) return;

  const app = global.MinervaApp;
  const $ = id => document.getElementById(id);
  let session = null;
  let publishing = false;
  let loadingReport = false;
  let reportController = null;
  let loadVersion = 0;
  let publishedMeta = null;
  let sessionWatchTimer = null;
  let sessionCheckInFlight = false;
  let lastSessionCheckAt = 0;
  const body = document.body;
  body.classList.add('team-hosted', 'team-session-pending');

  function updateProfile() {
    const profile = publicProfile(session);
    if ($('teamEmail')) $('teamEmail').textContent = profile ? profile.name : '';
    if ($('teamRole')) $('teamRole').textContent = profile ? profile.role === 'admin' ? profile.name === 'Desenvolvimento' ? 'Acesso administrativo' : 'Administradora · publica as atualizações' : profile.role === 'editor' ? 'Atualizar bases · publica as atualizações' : 'Consulta · relatório compartilhado' : '';
    document.dispatchEvent(new CustomEvent('minerva:session-updated', {detail:profile}));
  }
  function timestamp(value) {
    if (!value) return '';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('pt-BR', {dateStyle:'short', timeStyle:'short', timeZone:'America/Sao_Paulo'}).format(date);
  }
  function setMessage(message, error) {
    const el = $('teamMessage');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', Boolean(error));
  }
  function memberMessage(message, error) {
    const el = $('teamMemberMessage');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('is-error', Boolean(error));
  }
  function createUI() {
    const shell = document.querySelector('.app-shell') || body;
    const gate = document.createElement('section');
    gate.id = 'teamGate';
    gate.className = 'team-gate';
    gate.setAttribute('aria-live', 'polite');
    gate.innerHTML = '<span class="section-kicker">MINERVA FOODS · CLAIMS</span><h1 id="teamGateTitle">Confirmando seu acesso…</h1><p id="teamGateText">Aguarde enquanto verificamos seu acesso.</p><div class="team-gate-actions"><a id="teamLoginLink" class="button button-primary" href="/" hidden>Voltar à entrada</a><button id="teamChangeAccount" class="button button-outline" type="button" hidden>Sair deste acesso</button><button id="teamRetrySession" class="button button-outline" type="button" hidden>Tentar novamente</button></div>';
    shell.insertBefore(gate, shell.querySelector('main'));
    $('teamRetrySession').addEventListener('click', boot);
    $('teamChangeAccount').addEventListener('click', logout);

    const toolbar = document.createElement('section');
    toolbar.id = 'teamToolbar';
    toolbar.className = 'team-toolbar';
    toolbar.setAttribute('aria-label', 'Relatório compartilhado');
    toolbar.innerHTML = '<div class="team-account"><span class="team-account-dot" aria-hidden="true"></span><div><strong id="teamEmail"></strong><span id="teamRole"></span></div><button id="teamSignout" class="team-signout" type="button">Sair</button></div><div class="team-actions"><button id="teamRefresh" class="button button-outline" type="button">Atualizar visão</button><button id="teamCopyLink" class="button button-outline" type="button">Copiar link</button><button id="teamManage" class="button button-outline" type="button" hidden>Controlar acessos</button><button id="teamPublish" class="button button-primary" type="button" hidden disabled>Publicar atualização</button></div><div id="teamPublication" class="team-publication"></div><p id="teamMessage" class="team-message" role="status" aria-live="polite"></p><div id="teamCopyFallback" class="team-copy-fallback" hidden><label for="teamLinkInput">Copie este link e compartilhe com as pessoas autorizadas</label><input id="teamLinkInput" type="text" readonly><button id="teamCloseCopy" class="button button-text" type="button">Fechar</button></div>';
    const main = document.querySelector('main');
    const filters = document.querySelector('.filters-panel');
    if (main) main.insertBefore(toolbar, filters || main.firstChild);
    else shell.append(toolbar);

    const members = document.createElement('dialog');
    members.id = 'teamMembersDialog';
    members.className = 'team-members-dialog';
    members.setAttribute('aria-labelledby', 'teamMembersTitle');
    members.innerHTML = '<div class="dialog-heading"><div><span class="section-kicker">COMPARTILHAMENTO DO RELATÓRIO</span><h2 id="teamMembersTitle">Controlar acessos</h2></div><button id="teamCloseMembers" class="icon-button" type="button" aria-label="Fechar controle de acessos">×</button></div><p class="team-member-intro">Compartilhe o link normal do relatório. Cada pessoa informa o nome e solicita acesso; confira o nome e o código do pedido antes de aprovar. O acesso começa como Consulta. Depois da aprovação, você pode liberar Atualizar bases para quem também deve publicar as planilhas.</p><div id="teamAdminsList" class="team-admins-list"></div><div class="team-requests-tip"><span>Backup privado para migração: código, bases publicadas, correções e perfis. Sem credenciais ou sessões antigas.</span><button id="teamDownloadMigration" class="button button-outline" type="button" hidden>Baixar backup privado</button></div><div class="team-requests-tip"><span>Atualizar bases permite importar, publicar e marcar correções. Somente a administração controla os acessos. Confira o nome e o código do pedido antes de aprovar.</span><button id="teamRefreshMembers" class="button button-outline" type="button">Atualizar pedidos</button></div><p id="teamMemberMessage" class="team-message" role="status" aria-live="polite"></p><div id="teamMembersList" class="team-members-list"></div>';
    body.append(members);
    $('teamCloseMembers').addEventListener('click', () => members.close());
    $('teamMembersList').addEventListener('click', changeMemberAccess);
    $('teamRefreshMembers').addEventListener('click', refreshMemberList);
    $('teamDownloadMigration').addEventListener('click', downloadMigration);
    $('teamSignout').addEventListener('click', logout);
    $('teamManage').addEventListener('click', openMembers);
    $('teamPublish').addEventListener('click', publishReport);
    $('teamCopyLink').addEventListener('click', copyLink);
    $('teamCloseCopy').addEventListener('click', () => { $('teamCopyFallback').hidden = true; });
    $('teamRefresh').addEventListener('click', () => {
      if (hasDraft()) { setMessage('Publique a análise local ou limpe a seleção dos arquivos antes de recarregar a versão compartilhada.'); return; }
      loadReport(app.getOptions());
    });
    document.addEventListener('minerva:model-updated', refreshControls);
    global.addEventListener('focus', checkSessionAccess);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') stopSessionWatch();
      else if (session?.approved) { startSessionWatch(); checkSessionAccess(); }
    });
    // The clear-selection event is also observed for compatibility with the standalone app.
    $('clearFiles')?.addEventListener('click', () => setTimeout(refreshControls, 0));
  }

  function lockGate(title, message, options) {
    const opts = options || {};
    stopSessionWatch();
    session = null;
    updateProfile();
    publishedMeta = null;
    if ($('sidebarUpdatedAt')) { $('sidebarUpdatedAt').textContent = 'Acesso encerrado'; $('sidebarUpdatedAt').removeAttribute('datetime'); }
    if ($('sidebarUpdatedBy')) $('sidebarUpdatedBy').textContent = '';
    if (reportController) reportController.abort();
    body.classList.remove('team-session-pending', 'team-authenticated', 'team-admin', 'team-editor', 'team-viewer');
    body.classList.add('team-denied');
    $('teamGate').hidden = false;
    $('teamGateTitle').textContent = title;
    $('teamGateText').textContent = message;
    $('teamLoginLink').hidden = !opts.login;
    $('teamChangeAccount').hidden = !opts.changeAccount;
    $('teamRetrySession').hidden = !opts.retry;
    if ($('teamMembersDialog')?.open) $('teamMembersDialog').close();
    if ($('importDialog')?.open) $('importDialog').close();
    if ($('detailDialog')?.open) $('detailDialog').close();
    if (app) {
      app.state.bd = app.state.control = app.state.model = null;
      app.state.demo = false;
      app.state.supplierOptions = [];
      app.state.publishedMeta = null;
    }
  }

  function stopSessionWatch() {
    if (sessionWatchTimer !== null) global.clearInterval(sessionWatchTimer);
    sessionWatchTimer = null;
  }
  function startSessionWatch() {
    stopSessionWatch();
    if (session?.approved && document.visibilityState !== 'hidden') {
      sessionWatchTimer = global.setInterval(checkSessionAccess, 60000);
    }
  }
  async function checkSessionAccess() {
    if (!session?.approved || sessionCheckInFlight || document.visibilityState === 'hidden') return;
    // Focus and visibility events often arrive together; perform one check.
    if (Date.now() - lastSessionCheckAt < 2000) return;
    sessionCheckInFlight = true;
    lastSessionCheckAt = Date.now();
    const currentUser = session.userId;
    const currentRole = session.role;
    try {
      const result = await api('/api/session');
      if (!session?.approved) return;
      if (!isApprovedSession(result)) {
        const pending = accessStatus(result) === 'pending';
        lockGate(pending ? 'Seu pedido está aguardando aprovação.' : 'Seu acesso foi encerrado.', pending ? 'A administração precisa aprovar sua solicitação para continuar.' : 'O acesso expirou ou foi revogado. Volte à entrada para consultar sua situação.', {login:true, changeAccount:Boolean(result.authenticated), retry:pending});
      } else if (result.userId !== currentUser || result.role !== currentRole) {
        lockGate('O acesso deste navegador mudou.', 'Volte à entrada para abrir o painel com o acesso atual.', {login:true, changeAccount:true});
      } else {session = result;updateProfile();}
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        lockGate('Seu acesso foi encerrado.', error.message, {login:true, changeAccount:true});
      }
      // A temporary network failure does not trigger a retry loop or reload data.
    } finally { sessionCheckInFlight = false; }
  }

  async function api(path, options) {
    const opts = options || {};
    const headers = Object.assign({'Accept':'application/json'}, opts.headers || {});
    if (opts.method && opts.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      headers['X-Minerva-Request'] = '1';
    }
    let response;
    try { response = await fetch(path, Object.assign({credentials:'same-origin', cache:'no-store'}, opts, {headers})); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      const problem = new Error('Não foi possível conectar ao relatório. Confira sua conexão e tente novamente.');
      problem.network = true;
      throw problem;
    }
    let payload;
    try { payload = await response.json(); }
    catch { payload = null; }
    if (!response.ok) {
      const error = new Error(payload?.error || (response.status === 401 ? 'Seu acesso expirou. Volte à entrada para continuar.' : response.status === 403 ? 'Seu acesso não está liberado para este relatório.' : 'Não foi possível concluir a solicitação. Tente novamente.'));
      error.status = response.status;
      error.code = payload?.code;
      error.payload = payload;
      if (path !== '/api/session' && (response.status === 401 || response.status === 403)) {
        lockGate(response.status === 401 ? 'Entre para continuar.' : 'Acesso não liberado.', error.message, {login:true, changeAccount:true, retry:response.status === 403});
      }
      throw error;
    }
    if (response.status === 204) return {};
    if (!payload || typeof payload !== 'object') throw new Error('O relatório retornou uma resposta incompleta. Tente novamente.');
    return payload;
  }

  function hasDraft() { return Boolean(app?.state.bd || app?.state.control); }
  function canUpdateBases() { return ['admin','editor'].includes(session?.role); }
  function publishable() { return Boolean(canUpdateBases() && app?.state.bd && app?.state.control && app?.state.model && !app.state.demo); }
  function refreshControls() {
    if (!session || !app) return;
    const draft = hasDraft();
    const admin = session.role === 'admin';
    $('teamPublish').hidden = !canUpdateBases();
    $('teamManage').hidden = !admin;
    $('teamDownloadMigration').hidden = !admin;
    $('teamPublish').disabled = !publishable() || publishing || loadingReport;
    $('teamPublish').textContent = publishing ? 'Publicando…' : 'Publicar atualização';
    $('teamRefresh').disabled = publishing || loadingReport || draft;
    $('teamRefresh').textContent = loadingReport ? 'Atualizando…' : 'Atualizar visão';
    const publication = $('teamPublication');
    const sidebarDate = $('sidebarUpdatedAt');
    if (sidebarDate) {
      sidebarDate.textContent = publishedMeta?.updatedAt ? timestamp(publishedMeta.updatedAt) : 'Ainda não publicada';
      if (publishedMeta?.updatedAt) sidebarDate.setAttribute('datetime', publishedMeta.updatedAt);
      else sidebarDate.removeAttribute('datetime');
      $('sidebarUpdatedBy').textContent = 'Responsável: Administração · Brasília';
    }
    publication.replaceChildren();
    const text = document.createElement('span');
    if (publishedMeta?.updatedAt) text.textContent = 'Responsável: Administração · Publicado por ' + (publishedMeta.updatedBy || 'administração') + ' em ' + timestamp(publishedMeta.updatedAt) + ' · horário de Brasília.';
    else text.textContent = 'Responsável: Administração · Nenhum relatório publicado para a equipe.';
    publication.append(text);
    if (canUpdateBases() && draft) {
      const tag = document.createElement('strong');
      tag.className = 'team-draft-label';
      tag.textContent = app.state.model ? 'Prévia local: a equipe só verá esta atualização depois de publicar.' : 'Arquivos em preparação: analise as duas planilhas antes de publicar.';
      publication.append(tag);
    }
  }

  function showEmptyReport() {
    app.state.model = null;
    if ($('loadedContent')) $('loadedContent').hidden = true;
    if ($('emptyState')) $('emptyState').hidden = false;
    if ($('exportReport')) $('exportReport').disabled = true;
    if ($('exportCorrections')) $('exportCorrections').disabled = true;
    if (session.role === 'viewer') {
      $('emptyState').innerHTML = '<div class="team-awaiting"><span class="section-kicker">RELATÓRIO COMPARTILHADO</span><h2>Nenhum relatório publicado.</h2><p>Aguarde a publicação das planilhas pela administração. A última versão ficará disponível aqui para toda a equipe autorizada.</p><button id="teamEmptyRefresh" class="button button-outline" type="button">Verificar atualização</button></div>';
      $('teamEmptyRefresh').addEventListener('click', () => loadReport(app.getOptions()));
    }
    app.view('overview');
  }

  async function loadReport(options) {
    if (!session?.approved) return false;
    const opts = options || app.getOptions();
    if (Array.isArray(opts.years) && !opts.years.length) { setMessage('Selecione pelo menos um ano para a análise.', true); return false; }
    if (!opts.asOf) { setMessage('Informe a data da análise.', true); return false; }
    if (reportController) reportController.abort();
    const controller = new AbortController();
    reportController = controller;
    const requestVersion = ++loadVersion;
    loadingReport = true;
    refreshControls();
    try {
      const payload = await api('/api/report?' + reportQuery(opts), {signal:controller.signal});
      if (requestVersion !== loadVersion) return false;
      publishedMeta = payload.revision ? payload : null;
      if (!payload.model) {
        showEmptyReport();
        setMessage(canUpdateBases() ? 'Carregue e analise as duas planilhas. Depois clique em Publicar atualização para disponibilizar o relatório.' : 'Nenhum relatório publicado. Aguarde a administração.');
        return true;
      }
      app.setPublishedReport(payload);
      setMessage('Você está consultando a última versão publicada do relatório.');
      return true;
    } catch (error) {
      if (error.name === 'AbortError') return false;
      if (error.status === 404) {
        publishedMeta = null;
        showEmptyReport();
        setMessage('Nenhum relatório publicado. Aguarde a administração.');
        return true;
      }
      setMessage(error.message, true);
      return false;
    } finally {
      if (requestVersion === loadVersion) { loadingReport = false; reportController = null; refreshControls(); }
    }
  }

  async function publishReport() {
    if (!publishable() || publishing) return;
    const opts = app.getOptions();
    if (!opts.asOf) { setMessage('Informe a data da análise antes de publicar.', true); return; }
    const payload = {
      bd:app.state.bd, control:app.state.control,
      files:{bd:app.state.bdName || 'BD.xlsx', control:app.state.controlName || 'Controle de Recebimento.xlsx'},
      asOf:opts.asOf, demo:false
    };
    publishing = true;
    refreshControls();
    setMessage('Publicando a análise para a equipe…');
    try {
      const expectedRevision = publishedMeta?.revision || session.reportMeta?.revision || 'none';
      const saved = await api('/api/report', {method:'POST', headers:{'If-Match':'"' + expectedRevision + '"'}, body:JSON.stringify(payload)});
      publishedMeta = saved;
      session.reportMeta = saved;
      app.state.bd = app.state.control = null;
      app.state.demo = false;
      ['bdFile','controlFile'].forEach(id => { if ($(id)) $(id).value = ''; });
      if ($('bdFileInfo')) $('bdFileInfo').textContent = 'Nenhum arquivo selecionado';
      if ($('controlFileInfo')) $('controlFileInfo').textContent = 'Nenhum arquivo selecionado';
      if ($('runAnalysis')) $('runAnalysis').disabled = true;
      const loaded = await loadReport(opts);
      setMessage(loaded ? 'Atualização publicada. Toda a equipe autorizada já pode consultar esta versão.' : 'A atualização foi publicada, mas não foi possível recarregar a visão. Clique em Atualizar visão para tentar novamente.', !loaded);
    } catch (error) { setMessage(error.message, true); }
    finally { publishing = false; refreshControls(); }
  }

  function memberRow(member, status) {
    const id = String(member.id || member.memberId || member.requestId || '');
    const name = displayName(member);
    const code = member.requestCode || member.code || '';
    const detail = [];
    if (code) detail.push('Pedido ' + code);
    if (member.email) detail.push(String(member.email));
    const when = status === 'pending' ? member.requestedAt || member.createdAt : status === 'approved' ? member.approvedAt || member.grantedAt : member.revokedAt || member.rejectedAt || member.updatedAt;
    if (when) detail.push(timestamp(when));
    if (status === 'approved') detail.push(member.role === 'editor' ? 'Atualizar bases' : 'Consulta');
    const attrs = ' data-member-id="' + escapeHTML(id) + '" data-member-name="' + escapeHTML(name) + '"';
    let actions = '';
    if (id && status === 'pending') {
      actions = '<button class="button button-primary team-approve" type="button" data-member-action="approve"' + attrs + ' aria-label="Aprovar acesso de ' + escapeHTML(name) + '">Aprovar</button><button class="button team-revoke" type="button" data-member-action="reject"' + attrs + ' aria-label="Rejeitar pedido de ' + escapeHTML(name) + '">Rejeitar</button>';
    } else if (id && status === 'approved' && member.role !== 'admin') {
      actions = '<label class="team-member-role">Tipo de acesso<select data-member-role aria-label="Tipo de acesso de ' + escapeHTML(name) + '"><option value="viewer"' + (member.role !== 'editor' ? ' selected' : '') + '>Consulta</option><option value="editor"' + (member.role === 'editor' ? ' selected' : '') + '>Atualizar bases</option></select></label><button class="button button-outline" type="button" data-member-action="role"' + attrs + ' aria-label="Aplicar tipo de acesso de ' + escapeHTML(name) + '">Aplicar</button><button class="button team-revoke" type="button" data-member-action="revoke" ' + attrs + ' aria-label="Revogar acesso de ' + escapeHTML(name) + '">Revogar acesso</button>';
    } else if (id && ['revoked','rejected'].includes(status) && member.role !== 'admin') {
      actions = '<span class="badge neutral">' + escapeHTML(status === 'rejected' || !member.approvedAt ? 'Rejeitado' : 'Revogado') + '</span><button class="button button-outline team-approve" type="button" data-member-action="approve"' + attrs + ' aria-label="Liberar novamente o acesso de ' + escapeHTML(name) + '">Liberar novamente</button>';
    } else {
      actions = '<span class="badge neutral">' + escapeHTML(status === 'rejected' || !member.approvedAt ? 'Rejeitado' : 'Revogado') + '</span>';
    }
    if (id && ['pending','revoked','rejected'].includes(status) && member.role !== 'admin') {
      actions += '<button class="button team-delete-request" type="button" data-member-action="delete"' + attrs + ' aria-label="Excluir solicitação de ' + escapeHTML(name) + '">Excluir solicitação</button>';
    }
    return '<div class="team-member-row' + (['revoked','rejected'].includes(status) ? ' is-revoked' : '') + '"><div><strong>' + escapeHTML(name) + '</strong><span>' + escapeHTML(detail.join(' · ')) + '</span></div><div class="team-member-actions">' + actions + '</div></div>';
  }
  function renderMembers(payload) {
    const members = Array.isArray(payload.members) ? payload.members : [];
    const admins = Array.isArray(payload.admins) ? payload.admins : [];
    const historyOpen = $('teamMembersList').querySelector('.team-closed-accesses')?.open === true;
    $('teamAdminsList').innerHTML = admins.map(admin => '<div class="team-admin-fixed"><div><strong>' + escapeHTML(displayName(admin)) + '</strong><span>' + (admin.id === 'developer' ? 'Acesso administrativo · apoio técnico' : 'Administradora · responsável pelo setor') + '</span></div><span class="badge">Administração</span></div>').join('');
    const lists = {pending:[], approved:[], closed:[]};
    for (const member of members) {
      if (member.role === 'admin') continue;
      const status = accessStatus(member);
      if (status === 'pending') lists.pending.push(member);
      else if (status === 'approved') lists.approved.push(member);
      else lists.closed.push(member);
    }
    const section = (title, rows, status, empty) => '<section class="team-member-section"><div class="team-list-heading"><strong>' + title + '</strong><span>' + rows.length + '</span></div>' + (rows.length ? rows.map(member => memberRow(member, status || accessStatus(member))).join('') : '<p class="team-list-empty">' + empty + '</p>') + '</section>';
    $('teamMembersList').innerHTML = section('Solicitações pendentes', lists.pending, 'pending', 'Nenhuma solicitação aguardando aprovação.') + section('Acessos liberados', lists.approved, 'approved', 'Ainda não há acessos liberados.') + (lists.closed.length ? '<details class="team-closed-accesses"' + (historyOpen ? ' open' : '') + '><summary>Pedidos rejeitados e acessos revogados (' + lists.closed.length + ')</summary>' + section('Histórico de acessos', lists.closed, null, '') + '</details>' : '');
  }
  async function loadMembers() {
    const payload = await api('/api/members');
    renderMembers(payload);
    return payload;
  }
  async function refreshMemberList() {
    if (session?.role !== 'admin') return;
    const button = $('teamRefreshMembers');
    button.disabled = true;
    memberMessage('Carregando os pedidos de acesso…');
    try { await loadMembers(); memberMessage('Pedidos atualizados. Confira o nome e o código antes de aprovar.'); }
    catch (error) { memberMessage(error.message, true); }
    finally { button.disabled = false; }
  }
  async function downloadMigration() {
    if (session?.role !== 'admin') return;
    const button = $('teamDownloadMigration');
    if (button.disabled) return;
    button.disabled = true;
    memberMessage('Preparando o ZIP com os dados publicados…');
    try {
      const result = await fetch('/api/migration/export', {credentials:'same-origin', cache:'no-store', headers:{Accept:'application/zip'}});
      if (!result.ok) {
        const payload = await result.json().catch(() => null);
        throw new Error(payload?.error || 'Não foi possível preparar o backup privado. Confira seu acesso administrativo e tente novamente.');
      }
      if (!/^application\/zip(?:;|$)/i.test(result.headers.get('content-type') || '')) throw new Error('O download não retornou um ZIP válido. Atualize a página e tente novamente.');
      const blob = await result.blob();
      if (!blob.size) throw new Error('O backup retornou vazio. Tente novamente.');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Minerva-Claims-Migracao-Privada.zip';
      link.hidden = true;
      document.body.append(link);
      link.click();
      link.remove();
      global.setTimeout(() => URL.revokeObjectURL(url), 60000);
      memberMessage('Download iniciado. Guarde o ZIP em local privado: ele contém os dados reais e as instruções de restauração.');
    } catch (error) {
      memberMessage(error.message || 'Não foi possível baixar o backup privado. Tente novamente.', true);
    } finally {
      button.disabled = false;
    }
  }
  async function openMembers() {
    if (session?.role !== 'admin') return;
    const dialog = $('teamMembersDialog');
    if (!dialog.open) dialog.showModal();
    await refreshMemberList();
  }
  async function changeMemberAccess(event) {
    const button = event.target.closest('[data-member-action]');
    if (!button || button.disabled || session?.role !== 'admin') return;
    const id = button.dataset.memberId;
    const name = button.dataset.memberName || 'esta pessoa';
    const action = button.dataset.memberAction;
    if (!id || !['approve','reject','revoke','role','delete'].includes(action)) return;
    if (action === 'delete' && !global.confirm('Excluir permanentemente a solicitação de ' + name + '?\n\nEla será removida da lista e do histórico de solicitações. A pessoa poderá enviar um novo pedido de acesso.')) return;
    const actions = button.closest('.team-member-actions');
    const selectedRole = actions?.querySelector('[data-member-role]')?.value;
    if (action === 'role' && !['viewer','editor'].includes(selectedRole)) return;
    const buttons = actions?.querySelectorAll('button,select') || [button];
    buttons.forEach(item => { item.disabled = true; });
    memberMessage(action === 'delete' ? 'Excluindo solicitação…' : action === 'role' ? 'Atualizando a permissão…' : action === 'approve' ? 'Liberando acesso…' : action === 'reject' ? 'Rejeitando solicitação…' : 'Revogando acesso…');
    let deleted = false;
    try {
      if (action === 'delete') { await api('/api/members/' + encodeURIComponent(id) + '/request', {method:'DELETE', body:'{}'}); deleted = true; }
      else if (action === 'role') await api('/api/members/' + encodeURIComponent(id) + '/role', {method:'POST', body:JSON.stringify({role:selectedRole})});
      else if (action === 'approve') await api('/api/members/' + encodeURIComponent(id) + '/approve', {method:'POST', body:'{}'});
      else await api('/api/members/' + encodeURIComponent(id), {method:'DELETE'});
      await loadMembers();
      memberMessage(action === 'delete' ? 'Solicitação de ' + name + ' excluída.' : action === 'role' ? 'Permissão de ' + name + ' alterada para ' + (selectedRole === 'editor' ? 'Atualizar bases' : 'Consulta') + '.' : action === 'approve' ? 'Acesso liberado para ' + name + '.' : action === 'reject' ? 'Solicitação de ' + name + ' rejeitada.' : 'Acesso de ' + name + ' revogado.');
    } catch (error) {
      memberMessage(deleted ? 'A solicitação foi excluída, mas não foi possível recarregar a lista. Clique em Atualizar pedidos.' : error.message, true);
      if (!deleted) buttons.forEach(item => { item.disabled = false; });
    }
  }
  async function logout(event) {
    const button = event?.currentTarget;
    if (button) button.disabled = true;
    try {
      await api('/api/auth/logout', {method:'POST', body:'{}'});
      lockGate('Acesso encerrado.', 'Voltando à entrada.', {login:true});
      global.location.assign('/');
    } catch (error) {
      if (error.status === 401 || error.status === 403) { global.location.assign('/'); return; }
      setMessage('Não foi possível encerrar o acesso. Tente novamente.', true);
      if ($('teamGate') && !$('teamGate').hidden) $('teamGateText').textContent = 'Não foi possível encerrar o acesso. Confira a conexão e tente novamente.';
      if (button) button.disabled = false;
    }
  }
  async function copyLink() {
    const link = new URL('/', global.location.origin).href;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(link);
      $('teamCopyFallback').hidden = true;
      setMessage('Link copiado. Somente as pessoas autorizadas poderão consultar o relatório.');
    } catch {
      const input = $('teamLinkInput');
      $('teamCopyFallback').hidden = false;
      input.value = link;
      input.focus();
      input.select();
      setMessage('O link está selecionado abaixo. Copie e compartilhe com a equipe autorizada.');
    }
  }

  async function boot() {
    if (!app) { lockGate('Não foi possível abrir o painel.', 'Atualize a página e tente novamente.', {retry:false}); return; }
    body.classList.remove('team-denied');
    body.classList.add('team-session-pending');
    $('teamGate').hidden = false;
    $('teamGateTitle').textContent = 'Confirmando seu acesso…';
    $('teamGateText').textContent = 'Aguarde enquanto verificamos seu acesso.';
    $('teamLoginLink').hidden = $('teamChangeAccount').hidden = $('teamRetrySession').hidden = true;
    try {
      const result = await api('/api/session');
      if (!isApprovedSession(result)) {
        const pending = accessStatus(result) === 'pending';
        const code = result.requestCode || result.code || '';
        lockGate(pending ? 'Seu pedido está aguardando aprovação.' : 'Acesso não liberado.', pending ? 'A administração precisa aprovar sua solicitação.' + (code ? ' Código do pedido: ' + code + '.' : '') : 'Volte à entrada para consultar a situação do seu acesso.', {changeAccount:Boolean(result.authenticated), login:true, retry:pending});
        return;
      }
      session = result;
      lastSessionCheckAt = Date.now();
      startSessionWatch();
      publishedMeta = session.reportMeta || null;
      body.classList.remove('team-session-pending', 'team-denied');
      body.classList.add('team-authenticated', result.role === 'admin' ? 'team-admin' : result.role === 'editor' ? 'team-editor' : 'team-viewer');
      $('teamGate').hidden = true;
      updateProfile();
      if (result.role === 'viewer') {
        app.state.bd = app.state.control = null;
        ['openImports','emptyImport','demoButton','runAnalysis','clearFiles','bdFile','controlFile'].forEach(id => { const el = $(id); if (el) { el.hidden = true; el.disabled = true; } });
      }
      if ($('demoButton')) $('demoButton').hidden = true;
      if ($('demoBanner')) $('demoBanner').hidden = true;
      if (session.reportMeta?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(session.reportMeta.asOf)) $('asOf').value = session.reportMeta.asOf;
      app.setServerLoader(loadReport);
      refreshControls();
      await loadReport(app.getOptions());
    } catch (error) {
      const isAuth = error.status === 401 || error.status === 403;
      lockGate(error.status === 401 ? 'Entre para continuar.' : error.status === 403 ? 'Acesso não liberado.' : 'Não foi possível confirmar seu acesso.', error.message, {login:isAuth, changeAccount:isAuth, retry:!isAuth || error.status === 403});
    }
  }

  async function setCorrectionProgress(payload){
    if(!canUpdateBases()||hasDraft())throw new Error('As marcações exigem permissão para atualizar bases e uma versão publicada.');
    return api('/api/correction-progress',{method:'POST',body:JSON.stringify(payload)});
  }

  createUI();
  global.MinervaTeam = {refresh:() => loadReport(app.getOptions()), setCorrectionProgress, openMembers, copyLink, logout, getProfile:() => publicProfile(session)};
  boot();
})(typeof window !== 'undefined' ? window : globalThis);
