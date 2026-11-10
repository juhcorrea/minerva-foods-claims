(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fragment = new URLSearchParams(location.hash.slice(1));
  let activationToken = fragment.get('ativar') || fragment.get('access') || '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  let pending = false, accessProvider = false, verifiedEmail = '', checking = false;
  const panels = ['Loading', 'Request', 'Activate', 'Pending', 'Revoked', 'Identity'];
  function show(name) { for (const item of panels) $('access' + item).hidden = item !== name; }
  function message(text = '', error = false) { $('accessMessage').textContent = text; $('accessMessage').classList.toggle('error', error); }
  async function api(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Minerva-Request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'Não foi possível concluir. Tente novamente.');
    return data;
  }
  function applySession(session) {
    accessProvider = session.authProvider === 'cloudflare-access' || session.provider === 'cloudflare-access';
    verifiedEmail = accessProvider && session.authenticated === true && typeof session.verifiedEmail === 'string' ? session.verifiedEmail : '';
    $('legacyAdminHelp').hidden = accessProvider;
    $('accessAccount').hidden = !verifiedEmail;
    $('accountEmail').textContent = verifiedEmail;
    $('requestEmail').readOnly = accessProvider;
    $('requestEmail').required = accessProvider;
    $('verifiedEmailNote').hidden = !accessProvider;
    $('requestIntro').textContent = accessProvider ? 'Informe seu nome para as administradoras reconhecerem sua solicitação.' : 'As administradoras liberam a visualização do relatório. Você não precisa criar uma conta.';
    $('requestEmailLabel').textContent = accessProvider ? 'E-mail corporativo verificado' : 'E-mail de contato (opcional)';
    $('requestScope').textContent = accessProvider ? 'Após a aprovação, use esta mesma conta em qualquer aparelho.' : 'O relatório ficará disponível neste navegador após a aprovação.';
    $('pendingCodeLabel').textContent = accessProvider ? 'E-MAIL VERIFICADO' : 'SEU CÓDIGO';
    $('pendingCodeBlock').classList.toggle('verified-email', accessProvider);
    $('pendingInstructions').textContent = accessProvider ? 'As administradoras receberam sua solicitação vinculada a este e-mail.' : 'Informe seu nome e este código às administradoras. Assim que aprovarem, você poderá consultar o painel aqui.';
    $('pendingScope').textContent = accessProvider ? 'A aprovação vale em qualquer aparelho ao entrar com a mesma conta.' : 'Em outro aparelho ou navegador, será necessário solicitar um novo acesso.';
    if (accessProvider) { activationToken = ''; $('requestEmail').value = verifiedEmail; }
    if (accessProvider && !verifiedEmail) { pending = false; show('Identity'); return; }
    // The server determines the authentication provider before a URL fragment
    // can activate the legacy Sites flow. Access never exchanges that token.
    if (!accessProvider && activationToken) { pending = false; show('Activate'); return; }
    if (session.approved && ['admin', 'editor', 'reviewer', 'viewer'].includes(session.role)) { location.replace('/'); return; }
    pending = session.status === 'pending' || session.role === 'pending';
    if (pending) {
      $('pendingName').textContent = session.name || 'Sua solicitação';
      $('pendingCode').textContent = accessProvider ? verifiedEmail : session.requestCode || session.code || '—';
      show('Pending');
    } else if (['revoked', 'rejected'].includes(session.status)) show('Revoked');
    else show('Request');
  }
  async function check(manual = false) {
    if (checking) return;
    checking = true; $('retrySession').hidden = true;
    try { const session = await api('/api/session'); message(); applySession(session); if (manual && pending) message('Seu pedido continua aguardando aprovação.'); }
    catch (error) { pending = false; show('Loading'); $('retrySession').hidden = false; message(error.message, true); }
    finally { checking = false; }
  }
  $('requestForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('requestSubmit'); button.disabled = true; message();
    try {
      if (accessProvider && !verifiedEmail) { show('Identity'); return; }
      const body = {name:$('requestName').value.trim()};
      if (!accessProvider) body.email = $('requestEmail').value.trim();
      const data = await api('/api/auth/request', body); applySession(data.session || data);
    }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('activateButton').addEventListener('click', async () => {
    if (accessProvider || !activationToken) return;
    const button = $('activateButton'); button.disabled = true; message();
    try { await api('/api/auth/exchange', { token: activationToken }); activationToken = ''; location.replace('/'); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('checkAccess').addEventListener('click', () => check(true));
  $('checkRevoked').addEventListener('click', () => check(true));
  $('retrySession').addEventListener('click', () => check());
  $('retryIdentity').addEventListener('click', () => location.assign('/'));
  $('changeAccessAccount').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; message();
    try { const data = await api('/api/auth/logout', {}); location.assign(data.logoutUrl === '/cdn-cgi/access/logout' ? data.logoutUrl : '/'); }
    catch (error) { message(error.message, true); button.disabled = false; }
  });
  check();
  setInterval(() => { if (pending && !document.hidden) check(); }, 15000);
})();
