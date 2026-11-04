(function (global) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const copyIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
  const checkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"/></svg>';
  let statusTimer, manualDialog, previousFocus;
  function button(value) {
    const reference = String(value ?? '');
    return '<button type="button" class="copy-reference-button" data-copy-reference="'+escape(reference)+'" aria-label="'+escape('Copiar ordem/NF: '+reference)+'" title="Copiar ordem/NF"'+(reference.trim()?'':' disabled')+'>'+copyIcon+'</button>';
  }
  function announce(message) {
    let status = document.getElementById('copyReferenceStatus');
    if (!status) { status = document.createElement('div'); status.id = 'copyReferenceStatus'; status.className = 'copy-reference-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); document.body.append(status); }
    clearTimeout(statusTimer); status.hidden = false; status.textContent = message;
    statusTimer = setTimeout(() => {status.hidden = true; status.textContent = '';}, 3000);
  }
  function legacyCopy(value) {
    const input = document.createElement('textarea'), focused = document.activeElement;
    input.value = value; input.readOnly = true; input.className = 'copy-reference-transfer'; input.setAttribute('aria-label','Referência para copiar');
    (document.querySelector('dialog[open]') || document.body).append(input);
    let copied = false;
    try { input.focus({preventScroll:true}); input.select(); copied = typeof document.execCommand === 'function' && document.execCommand('copy'); } catch (_) {} finally { input.remove(); focused?.focus?.({preventScroll:true}); }
    return copied;
  }
  function manualCopy(value, origin) {
    previousFocus = origin;
    if (!manualDialog) {
      manualDialog = document.createElement('dialog'); manualDialog.className = 'copy-reference-dialog'; manualDialog.setAttribute('aria-labelledby','copyReferenceTitle');
      manualDialog.innerHTML = '<h2 id="copyReferenceTitle">Copiar ordem / NF</h2><p>Selecione a referência abaixo e use Ctrl+C ou a opção Copiar do celular.</p><textarea id="copyReferenceManual" readonly aria-label="Ordem ou NF para copiar"></textarea><div class="copy-reference-dialog-actions"><button type="button" data-copy-reference-select>Selecionar referência</button><button type="button" data-copy-reference-close>Fechar</button></div>';
      document.body.append(manualDialog);
      manualDialog.querySelector('[data-copy-reference-select]').addEventListener('click', () => { const input = manualDialog.querySelector('textarea'); input.focus(); input.select(); });
      manualDialog.querySelector('[data-copy-reference-close]').addEventListener('click', () => manualDialog.close());
      manualDialog.addEventListener('close', () => {manualDialog.querySelector('textarea').value = ''; previousFocus?.focus?.({preventScroll:true});});
    }
    const input = manualDialog.querySelector('textarea'); input.value = value;
    if (!manualDialog.open) manualDialog.showModal(); input.focus(); input.select();
  }
  async function copy(origin) {
    if (origin.disabled) return;
    const value = origin.dataset.copyReference; if (!value?.trim()) return;
    origin.disabled = true;
    let copied = false;
    try { if (global.navigator.clipboard?.writeText) { await global.navigator.clipboard.writeText(value); copied = true; } } catch (_) {}
    if (!copied) copied = legacyCopy(value);
    origin.disabled = false;
    if (!copied) { manualCopy(value,origin); return; }
    origin.innerHTML = checkIcon; origin.classList.add('is-copied'); origin.title = 'Copiado'; origin.setAttribute('aria-label','Ordem/NF copiada: '+value); announce('Copiado');
    setTimeout(() => {if (!origin.isConnected) return; origin.innerHTML = copyIcon; origin.classList.remove('is-copied'); origin.title = 'Copiar ordem/NF'; origin.setAttribute('aria-label','Copiar ordem/NF: '+value);}, 2200);
  }
  document.addEventListener('click', event => { const origin = event.target.closest?.('[data-copy-reference]'); if (!origin) return; event.preventDefault(); event.stopPropagation(); copy(origin); }, true);
  global.MinervaCopy = {button};
})(window);
