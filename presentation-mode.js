(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const state = {active: false, collapsed: false, snapshot: null, nativeSeen: false, session: 0};
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;

  function setFiltersCollapsed(collapsed) {
    state.collapsed = Boolean(collapsed);
    document.body.classList.toggle('dashboard-filters-collapsed', state.collapsed);
    $('dashboardFiltersToggle')?.setAttribute('aria-expanded', String(!state.collapsed));
    if ($('dashboardFiltersToggle')) $('dashboardFiltersToggle').title = state.collapsed ? 'Mostrar filtros e status' : 'Recolher filtros e status';
    if ($('globalFilterBlock')) $('globalFilterBlock').hidden = state.collapsed;
  }

  function updateTitle() {
    if ($('dashboardPresentationTitle')) $('dashboardPresentationTitle').textContent = $('viewLabel')?.textContent || 'Indicadores Claim';
  }

  async function exitNativeFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { await exit.call(document); } catch { /* The CSS workspace has already been restored. */ } }
  }

  async function leave(exitNative = true) {
    if (!state.active) return;
    const snapshot = state.snapshot;
    state.active = false;
    state.session++;
    document.body.classList.remove('dashboard-presentation');
    if ($('dashboardPresentationBar')) $('dashboardPresentationBar').hidden = true;
    $('dashboardPresentationToggle')?.setAttribute('aria-pressed', 'false');
    setFiltersCollapsed(snapshot?.collapsed || false);
    state.snapshot = null;
    if (exitNative && !snapshot?.hadFullscreen && fullscreenElement() === root) await exitNativeFullscreen();
    if (snapshot?.focus?.isConnected) snapshot.focus.focus({preventScroll: true});
    if (snapshot) global.scrollTo(snapshot.scrollX, snapshot.scrollY);
  }

  async function enter() {
    if (state.active) return;
    const session = ++state.session;
    state.snapshot = {collapsed: state.collapsed, focus: document.activeElement, scrollX: global.scrollX, scrollY: global.scrollY, hadFullscreen: Boolean(fullscreenElement())};
    state.active = true;
    state.nativeSeen = Boolean(fullscreenElement());
    // Hide the navigation with CSS only, preserving the user's menu preference.
    document.body.classList.add('dashboard-presentation');
    setFiltersCollapsed(true);
    updateTitle();
    if ($('dashboardPresentationBar')) $('dashboardPresentationBar').hidden = false;
    $('dashboardPresentationToggle')?.setAttribute('aria-pressed', 'true');
    $('dashboardPresentationExit')?.focus({preventScroll: true});
    global.scrollTo(0, 0);
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    if (!request || fullscreenElement()) return;
    try {
      await request.call(root, {navigationUI: 'hide'});
      if (session !== state.session || !state.active) {
        if (fullscreenElement() === root && !state.active) await exitNativeFullscreen();
        return;
      }
      state.nativeSeen = Boolean(fullscreenElement());
    } catch { /* Keep the expanded workspace when native fullscreen is unavailable. */ }
  }

  $('dashboardFiltersToggle')?.addEventListener('click', () => setFiltersCollapsed(!state.collapsed));
  $('dashboardPresentationToggle')?.addEventListener('click', enter);
  $('dashboardPresentationExit')?.addEventListener('click', () => leave());
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !state.active || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    leave();
  });
  const onFullscreenChange = () => {
    if (!state.active) return;
    if (fullscreenElement()) state.nativeSeen = true;
    else if (state.nativeSeen) leave(false);
  };
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  document.addEventListener('minerva:session-updated', event => { if (global.MINERVA_HOSTED && !event.detail) leave(); });
  if (global.MutationObserver && $('viewLabel')) new MutationObserver(updateTitle).observe($('viewLabel'), {childList: true, characterData: true, subtree: true});
  setFiltersCollapsed(false);
  updateTitle();
  global.MinervaDashboardPresentation = {enter, leave, setFiltersCollapsed, isActive: () => state.active};
})(window);
