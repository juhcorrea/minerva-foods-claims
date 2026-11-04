(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const fragment = new URLSearchParams(location.hash.slice(1));
  let activationToken = fragment.get('ativar') || fragment.get('access') || '';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  let pending = false;
  const panels = ['Loading', 'Request', 'Activate', 'Pending', 'Revoked'];
  function show(name) { for (const item of panels) $('access' + item).hidden = item !== name; }
  function message(text = '', error = false) { $('accessMessage').textContent = text; $('accessMessage').classList.toggle('error', error); }
  async function api(path, body) {
    const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Minerva-Request': '1' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || data.message || 'Não foi possível concluir. Tente novamente.');
    return data;
  }
  function applySession(session) {
    if (session.approved && ['admin', 'editor', 'viewer'].includes(session.role)) { location.replace('/'); return; }
    pending = session.status === 'pending' || session.role === 'pending';
    if (pending) {
      $('pendingName').textContent = session.name || 'Sua solicitação';
      $('pendingCode').textContent = session.requestCode || session.code || '—';
      show('Pending');
    } else if (['revoked', 'rejected'].includes(session.status)) show('Revoked');
    else show('Request');
  }
  async function check(manual = false) {
    try { const session = await api('/api/session'); applySession(session); if (manual && pending) message('Seu pedido continua aguardando aprovação.'); }
    catch (error) { show('Request'); message(error.message, true); }
  }
  $('requestForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('requestSubmit'); button.disabled = true; message();
    try { const data = await api('/api/auth/request', { name: $('requestName').value.trim(), email: $('requestEmail').value.trim() }); applySession(data.session || data); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('activateButton').addEventListener('click', async () => {
    const button = $('activateButton'); button.disabled = true; message();
    try { await api('/api/auth/exchange', { token: activationToken }); activationToken = ''; location.replace('/'); }
    catch (error) { message(error.message, true); }
    finally { button.disabled = false; }
  });
  $('checkAccess').addEventListener('click', () => check(true));
  $('checkRevoked').addEventListener('click', () => check(true));
  if (activationToken) show('Activate'); else check();
  setInterval(() => { if (pending && !document.hidden) check(); }, 15000);
})();
