(function (global) {
  'use strict';
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const state = {active: false, collapsed: false, snapshot: null, nativeSeen: false, session: 0, laser: false};
  const fullscreenElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const isProcurement = () => document.querySelector('.main-nav [data-view="procurement"]')?.classList.contains('active') === true;
  const laserDot=document.createElement('div');laserDot.className='dashboard-laser-pointer';laserDot.hidden=true;laserDot.setAttribute('aria-hidden','true');document.body.append(laserDot);
  const laserButtons=[];
  function setLaser(enabled) {
    state.laser=Boolean(enabled)&&isProcurement();
    document.body.classList.toggle('dashboard-laser-active',state.laser);
    for(const button of laserButtons){button.setAttribute('aria-pressed',String(state.laser));button.title=state.laser?'Desligar apontador laser · Esc':'Ligar apontador laser';}
    if(!state.laser)laserDot.hidden=true;
  }
  function laserButton(id,anchor) {
    if(!anchor)return;const button=document.createElement('button');button.id=id;button.type='button';button.className='button button-outline dashboard-laser-toggle';button.hidden=true;button.setAttribute('aria-pressed','false');button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg><span>Apontador laser</span>';button.addEventListener('click',()=>setLaser(!state.laser));anchor.after(button);laserButtons.push(button);
  }
  laserButton('dashboardLaserToggle',$('dashboardPresentationToggle'));
  laserButton('presentationLaserToggle',$('dashboardPresentationTitle')?.closest('.dashboard-presentation-brand'));
  document.addEventListener('pointermove',event=>{if(!state.laser||event.pointerType==='touch')return;const host=event.target?.closest?.('dialog[open]')||document.body;if(laserDot.parentElement!==host)host.append(laserDot);laserDot.style.transform=`translate3d(${event.clientX}px,${event.clientY}px,0)`;laserDot.hidden=false;},{passive:true});
  document.addEventListener('pointerleave',()=>{laserDot.hidden=true;});
  global.addEventListener('blur',()=>{laserDot.hidden=true;});
  global.addEventListener('beforeprint',()=>setLaser(false));

  function setFiltersCollapsed(collapsed) {
    state.collapsed = Boolean(collapsed);
    document.body.classList.toggle('dashboard-filters-collapsed', state.collapsed);
    $('dashboardFiltersToggle')?.setAttribute('aria-expanded', String(!state.collapsed));
    if ($('dashboardFiltersToggle')) $('dashboardFiltersToggle').title = state.collapsed ? 'Mostrar filtros e status' : 'Recolher filtros e status';
    if ($('globalFilterBlock')) $('globalFilterBlock').hidden = state.collapsed;
  }

  function updateTitle() {
    if ($('dashboardPresentationTitle')) $('dashboardPresentationTitle').textContent = $('viewLabel')?.textContent || 'Indicadores Claim';
    for(const button of laserButtons)button.hidden=!isProcurement();
    if(!isProcurement())setLaser(false);
  }

  async function exitNativeFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (exit) { try { await exit.call(document); } catch { /* The CSS workspace has already been restored. */ } }
  }

  async function leave(exitNative = true) {
    setLaser(false);
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
    if(event.key==='Escape'&&state.laser){setLaser(false);event.preventDefault();return;}
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
