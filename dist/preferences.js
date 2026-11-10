(function (global) {
  'use strict';
  const STORAGE_KEY = 'minerva.claims.preferences.v1';
  const SIZES = [100, 115, 130];
  function normalizePreferences(value) {
    const v = value && typeof value === 'object' ? value : {};
    return {theme:['light','dark','system'].includes(v.theme) ? v.theme : 'system', textSize:SIZES.includes(Number(v.textSize)) ? Number(v.textSize) : 100, menuCollapsed:v.menuCollapsed === true};
  }
  function initials(name) {return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toLocaleUpperCase('pt-BR');}
  if (typeof module !== 'undefined' && module.exports) {module.exports = {normalizePreferences, initials}; return;}
  if (typeof document === 'undefined') return;

  let saved;
  try {saved = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}');} catch {saved = {};}
  const preferences = normalizePreferences(saved);
  const root = document.documentElement;
  const $ = id => document.getElementById(id);
  const darkMedia = global.matchMedia('(prefers-color-scheme: dark)');
  let mounted = false, messageTimer = null, scaleFrame = null, fullscreenBusy = false;
  let currentProfile = null, observedToolbar = null, toolbarObserver = null, toolbarFinder = null;
  const activeTheme = () => preferences.theme === 'system' ? darkMedia.matches ? 'dark' : 'light' : preferences.theme;
  function save() {try {global.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));} catch {announce('Preferência aplicada. Este navegador não permite salvar a configuração.');}}
  function announce(message) {const el = $('preferencesStatus');if (!el) return;global.clearTimeout(messageTimer);el.textContent=message;el.hidden=false;messageTimer=global.setTimeout(() => {el.hidden=true;el.textContent='';}, 7000);}
  function applyPreferences() {
    const dark = activeTheme() === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    root.dataset.textSize = String(preferences.textSize);
    root.dataset.menuCollapsed = String(preferences.menuCollapsed);
    if (!mounted) return;
    $('themeToggle').setAttribute('aria-pressed', String(dark));
    $('themeToggle').title = dark ? 'Desativar modo noturno' : 'Ativar modo noturno';
    $('textSizeSelect').value = String(preferences.textSize);
    $('textSizeSelect').title = 'Tamanho do texto: '+preferences.textSize+'%';
    const collapsed = preferences.menuCollapsed;
    $('menuToggle').setAttribute('aria-expanded', String(!collapsed));
    $('menuToggle').setAttribute('aria-label', collapsed ? 'Expandir menu lateral' : 'Recolher menu para ícones');
    $('menuToggle').title = collapsed ? 'Expandir menu lateral' : 'Recolher menu para ícones';
    $('menuToggleLabel').textContent = collapsed ? 'Expandir menu' : 'Recolher menu';
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {sidebar.inert = false;sidebar.removeAttribute('aria-hidden');}
  }
  applyPreferences();

  function setTheme(value) {if (!['light','dark','system'].includes(value)) return;preferences.theme=value;applyPreferences();save();announce(activeTheme()==='dark'?'Modo noturno ativado.':'Modo claro ativado.');}
  function setTextSize(value) {if (!SIZES.includes(Number(value))) return;preferences.textSize=Number(value);applyPreferences();save();announce('Tamanho do texto: '+preferences.textSize+'%.');}
  function setMenuCollapsed(value) {preferences.menuCollapsed=Boolean(value);applyPreferences();save();}

  // Reuse only font-size declarations from the app's trusted local stylesheets.
  // Their responsive conditions and specificity remain intact; no document data is read.
  function fontRules(rules) {
    let css = '';
    for (const rule of rules) {
      if (rule.type === 1 && rule.style) {
        const size = rule.style.getPropertyValue('font-size');
        if (size) {
          // Preserve later inheritance/variable rules too, so an earlier fixed
          // heading size cannot override the table's responsive font size.
          const scalable = !/inherit|initial|unset|revert|var\(|--minerva-text-scale/.test(size) && /px|rem|em|vw|vh|%/.test(size);
          const value = scalable ? 'calc(('+size+') * var(--minerva-text-scale))' : size;
          css += rule.selectorText+'{font-size:'+value+(rule.style.getPropertyPriority('font-size')?'!important':'')+'}\n';
        }
      } else if (rule.cssRules && (rule.type === 4 || rule.type === 12)) {
        const child = fontRules(rule.cssRules);
        if (child) css += rule.cssText.slice(0, rule.cssText.indexOf('{'))+'{'+child+'}\n';
      }
    }
    return css;
  }
  function buildTextScale() {
    scaleFrame=null;
    let css='';
    for (const sheet of document.styleSheets) {
      if (!sheet.href) continue;
      let url;try {url=new URL(sheet.href,global.location.href);} catch {continue;}
      if (url.origin !== global.location.origin || !/(?:^|\/)(styles|integration|team|preferences)\.css$/.test(url.pathname)) continue;
      try {css += fontRules(sheet.cssRules);} catch {/* Cross-origin or unavailable stylesheet: preserve its own sizes. */}
    }
    let style=$('preferencesTextScale');
    if (!style) {style=document.createElement('style');style.id='preferencesTextScale';document.head.append(style);}
    style.textContent='@media screen{'+css+'}';
  }
  function scheduleTextScale() {if (scaleFrame===null) scaleFrame=global.requestAnimationFrame(buildTextScale);}

  function fullscreenElement() {return document.fullscreenElement || document.webkitFullscreenElement || null;}
  function updateFullscreen(announceChange) {
    const active=Boolean(fullscreenElement());
    $('fullscreenToggle').setAttribute('aria-pressed',String(active));
    $('fullscreenToggle').title=active?'Sair da tela cheia · Esc':'Abrir painel em tela cheia';
    $('fullscreenToggle').setAttribute('aria-label',active?'Sair da tela cheia':'Abrir painel em tela cheia');
    $('fullscreenLabel').textContent=active?'Sair da tela cheia':'Tela cheia';
    if (announceChange) announce(active?'Tela cheia ativada. Pressione Esc para sair.':'Tela cheia desativada.');
  }
  async function toggleFullscreen() {
    if (fullscreenBusy) return;
    const active=Boolean(fullscreenElement()),fn=active?(document.exitFullscreen||document.webkitExitFullscreen):(root.requestFullscreen||root.webkitRequestFullscreen);
    if (!fn) {announce('A tela cheia não está disponível aqui. Use a opção de tela cheia do navegador.');return;}
    fullscreenBusy=true;
    try {await fn.call(active?document:root,active?undefined:{navigationUI:'hide'});updateFullscreen(false);}
    catch {announce('O navegador não permitiu a tela cheia. Use a opção de tela cheia do próprio navegador.');}
    finally {fullscreenBusy=false;}
  }

  function syncOperationalNotice() {
    const notice=$('profileActivityStatus'),label=$('profileActivityMessage'),message=$('teamMessage');
    if (!notice||!label) return;
    const text=message?.textContent?.trim()||'',error=Boolean(message?.classList.contains('is-error'));
    const relevant=error||/^Publicando\b/i.test(text);
    const visible=Boolean(currentProfile)&&relevant&&Boolean($('profilePanel')?.hidden);
    if(label.textContent!==text)label.textContent=text;
    if(notice.classList.contains('is-error')!==error)notice.classList.toggle('is-error',error);
    if(notice.hidden===visible)notice.hidden=!visible;
  }
  function syncProfileControls() {
    const host=$('profileControls'),toolbar=$('teamToolbar');
    if(!host)return;
    const allowed=global.MINERVA_HOSTED===true&&Boolean(currentProfile);
    host.hidden=!allowed||!toolbar;
    if(allowed&&toolbar){
      if(toolbar.parentElement!==host)host.append(toolbar);
      const imports=$('openImports'),actions=toolbar.querySelector('.team-actions');
      if(imports&&actions&&imports.parentElement!==actions)actions.prepend(imports);
    }
    if(toolbar&&observedToolbar!==toolbar&&global.MutationObserver){
      toolbarObserver?.disconnect();observedToolbar=toolbar;
      toolbarObserver=new global.MutationObserver(syncOperationalNotice);
      toolbarObserver.observe(toolbar,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','disabled','hidden']});
      toolbarFinder?.disconnect();
    }
    syncOperationalNotice();
  }
  function closeProfile(restoreFocus) {const panel=$('profilePanel');if (!panel) return;panel.hidden=true;$('profileButton').setAttribute('aria-expanded','false');syncOperationalNotice();if (restoreFocus && !$('profileButton').hidden) $('profileButton').focus();}
  function updateProfile() {
    if (!mounted) return;
    currentProfile=global.MinervaTeam?.getProfile?.() || null;
    const hosted=global.MINERVA_HOSTED===true,allowed=!hosted||Boolean(currentProfile);
    syncProfileControls();
    $('profileButton').hidden=!allowed;
    if ($('sidebarSignout')) $('sidebarSignout').hidden=!hosted||!allowed;
    if ($('sidebarRefresh')) $('sidebarRefresh').hidden=!hosted||!allowed;
    if (!allowed) {
      closeProfile(false);
      $('profileButton').setAttribute('aria-label','Perfil indisponível');
      $('profileButton').removeAttribute('title');
      $('profilePanelNote').textContent='';
      for (const id of ['profileName','profileRole','profileAvatar','profilePanelName','profilePanelContact','profilePanelRole']) $(id).textContent='';
      $('profileSignout').hidden=true;
      return;
    }
    const name=hosted?currentProfile.name:'Prévia local',role=hosted?currentProfile.role==='admin'?(name==='Desenvolvimento'?'Acesso administrativo':'Administradora'):currentProfile.role==='editor'?'Atualizar bases':currentProfile.role==='reviewer'?'Conferente':'Consulta':'Sem perfil conectado';
    $('profileName').textContent=name;
    $('profileRole').textContent=role;
    $('profileAvatar').textContent=hosted?initials(name)||'P':'PL';
    $('profileButton').setAttribute('aria-label','Perfil: '+name+' · '+role);
    $('profileButton').title='Perfil em uso: '+name+' · '+role;
    $('profilePanelName').textContent=name;
    $('profilePanelRole').textContent=role;
    $('profilePanelContact').textContent=hosted?currentProfile.email||'':'';
    $('profilePanelContact').hidden=!hosted||!currentProfile.email;
    $('profilePanelNote').textContent=hosted?(currentProfile.role==='admin'?'Este acesso pode publicar atualizações e gerenciar usuários e seus perfis.':currentProfile.role==='editor'?'Este acesso pode importar e publicar as bases e marcar correções. A gestão de acessos continua com a administração.':currentProfile.role==='reviewer'?'Este acesso permite consultar o relatório e marcar ou desmarcar os ajustes na Correção de base.':'Este acesso permite consultar o relatório publicado.'):'Esta é uma prévia local. Nenhum acesso de administradora foi ativado.';
    $('profileSignout').hidden=!hosted;
    $('profileSignout').disabled=false;
  }
  function openProfile() {
    updateProfile();if ($('profileButton').hidden) return;
    const panel=$('profilePanel');if (!panel.hidden) {closeProfile(true);return;}
    const rect=$('profileButton').getBoundingClientRect();
    panel.hidden=false;
    syncOperationalNotice();
    panel.style.right='auto';
    panel.style.left=Math.max(12,Math.min(rect.left,global.innerWidth-panel.offsetWidth-12))+'px';
    panel.style.top=Math.max(12,Math.min(rect.top-panel.offsetHeight-10,global.innerHeight-panel.offsetHeight-12))+'px';
    $('profileButton').setAttribute('aria-expanded','true');$('closeProfile').focus();
  }
  function mount() {
    if (mounted) return;
    const topbar=document.querySelector('.topbar');if (!topbar) return;
    const toolbar=document.createElement('div');toolbar.id='preferencesToolbar';toolbar.className='preferences-toolbar';toolbar.setAttribute('role','group');toolbar.setAttribute('aria-label','Preferências de visualização');
    toolbar.innerHTML='<span class="preferences-caption">VISUALIZAÇÃO</span><button id="themeToggle" class="preferences-button" type="button" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.5 14A8.5 8.5 0 0 1 10 3.5 8.5 8.5 0 1 0 20.5 14Z"/></svg><span>Modo noturno</span></button><label class="preferences-text-control" for="textSizeSelect"><span aria-hidden="true">Aa</span><span class="sr-only">Tamanho do texto</span><select id="textSizeSelect" title="Aumentar o tamanho do texto"><option value="100">Texto 100%</option><option value="115">Texto 115%</option><option value="130">Texto 130%</option></select></label>';
    topbar.append(toolbar);
    const controls=document.createElement('div');controls.className='window-controls';controls.setAttribute('role','group');controls.setAttribute('aria-label','Menu e tela cheia');
    controls.innerHTML='<button id="menuToggle" class="window-control" type="button" aria-expanded="true" aria-controls="appSidebar" aria-label="Recolher menu lateral" title="Recolher menu lateral"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 12h14M5 18h14"/></svg><span id="menuToggleLabel" class="sr-only">Recolher menu</span></button><button id="fullscreenToggle" class="window-control" type="button" aria-pressed="false" aria-label="Abrir painel em tela cheia" title="Abrir painel em tela cheia"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/></svg><span id="fullscreenLabel" class="sr-only">Tela cheia</span></button>';
    const leading=document.createElement('div');leading.className='topbar-leading';leading.append(controls);const breadcrumb=topbar.querySelector('.breadcrumb');if(breadcrumb)leading.append(breadcrumb);topbar.prepend(leading);
    const sidebar=document.querySelector('.sidebar');if (sidebar) sidebar.id='appSidebar';
    if(sidebar){
      for(const item of sidebar.querySelectorAll('.nav-item')){const label=item.querySelector('span')?.textContent?.trim();if(label){item.setAttribute('aria-label',label);item.title=label;}}
    }
    const profile=document.createElement('button');profile.id='profileButton';profile.type='button';profile.className='profile-button';profile.hidden=global.MINERVA_HOSTED===true;profile.setAttribute('aria-haspopup','dialog');profile.setAttribute('aria-expanded','false');profile.setAttribute('aria-controls','profilePanel');
    profile.innerHTML='<span id="profileAvatar" class="profile-avatar" aria-hidden="true"></span><span class="profile-label"><small>PERFIL EM USO</small><strong id="profileName"></strong><span id="profileRole"></span></span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 10 5 5 5-5"/></svg>';
    const account=$('sidebarAccount');
    if(account){account.append(profile);const signout=document.createElement('button');signout.id='sidebarSignout';signout.type='button';signout.className='sidebar-icon-button';signout.hidden=true;signout.title='Sair deste perfil';signout.setAttribute('aria-label','Sair deste perfil');signout.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v16h5m5-13 5 5-5 5M9 12h10"/></svg>';signout.addEventListener('click',event=>global.MinervaTeam?.logout(event));account.append(signout);}
    else topbar.querySelector('.topbar-actions')?.prepend(profile);
    const placeProfile=()=>{const target=global.innerWidth<=760?topbar.querySelector('.topbar-actions'):account;if(target&&profile.parentElement!==target)target.prepend(profile);};
    placeProfile();global.addEventListener('resize',placeProfile);
    $('sidebarRefresh')?.addEventListener('click',()=>$('teamRefresh')?.click());
    const panel=document.createElement('section');panel.id='profilePanel';panel.className='profile-panel';panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-labelledby','profilePanelTitle');
    panel.innerHTML='<div class="profile-panel-heading"><h2 id="profilePanelTitle">Perfil em uso</h2><button id="closeProfile" class="icon-button" type="button" aria-label="Fechar perfil">×</button></div><strong id="profilePanelName" class="profile-panel-name"></strong><span id="profilePanelContact" class="profile-panel-contact"></span><span id="profilePanelRole" class="profile-panel-role"></span><p id="profilePanelNote"></p><section id="profileControls" class="profile-controls" aria-label="Ações do painel" hidden></section><section id="profileResources" class="profile-resources" aria-label="Critérios do painel" hidden></section><button id="profileSignout" class="button button-outline" type="button">Sair deste perfil</button>';
    document.body.append(panel);
    const rules=$('exportRules'),resources=$('profileResources');
    if(rules&&resources){resources.append(rules);rules.textContent='Critérios e regras de cálculo (PDF)';resources.hidden=false;}
    const activity=document.createElement('div');activity.id='profileActivityStatus';activity.className='profile-activity-status';activity.hidden=true;activity.setAttribute('role','status');activity.setAttribute('aria-live','polite');
    activity.innerHTML='<span id="profileActivityMessage"></span><button id="profileActivityOpen" type="button">Ver no perfil</button>';document.body.append(activity);
    const status=document.createElement('div');status.id='preferencesStatus';status.className='preferences-status';status.hidden=true;status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.setAttribute('aria-atomic','true');document.body.append(status);
    mounted=true;
    $('themeToggle').addEventListener('click',()=>setTheme(activeTheme()==='dark'?'light':'dark'));
    $('textSizeSelect').addEventListener('change',event=>setTextSize(event.target.value));
    $('menuToggle').addEventListener('click',()=>setMenuCollapsed(!preferences.menuCollapsed));
    $('fullscreenToggle').addEventListener('click',toggleFullscreen);
    $('profileButton').addEventListener('click',openProfile);
    $('closeProfile').addEventListener('click',()=>closeProfile(true));
    $('profileSignout').addEventListener('click',event=>global.MinervaTeam?.logout(event));
    $('profileActivityOpen').addEventListener('click',openProfile);
    panel.addEventListener('click',event=>{const button=event.target?.closest?.('button');if(button&&!button.disabled&&['openImports','emptyImport','teamManage'].includes(button.id))closeProfile(false);},true);
    document.addEventListener('minerva:session-updated',updateProfile);
    document.addEventListener('minerva:model-updated',syncProfileControls);
    if(global.MINERVA_HOSTED===true&&global.MutationObserver){toolbarFinder=new global.MutationObserver(()=>{if($('teamToolbar'))syncProfileControls();});toolbarFinder.observe(document.querySelector('main')||document.body,{childList:true,subtree:true});}
    document.addEventListener('pointerdown',event=>{if (!panel.hidden&&!panel.contains(event.target)&&!profile.contains(event.target)) closeProfile(false);});
    document.addEventListener('keydown',event=>{if (event.key==='Escape'&&!panel.hidden) {event.preventDefault();closeProfile(true);}});
    panel.addEventListener('focusout',event=>{if (event.relatedTarget&&!panel.contains(event.relatedTarget)&&event.relatedTarget!==profile) closeProfile(false);});
    document.addEventListener('fullscreenchange',()=>{closeProfile(false);updateFullscreen(true);});
    document.addEventListener('webkitfullscreenchange',()=>updateFullscreen(true));
    global.addEventListener('resize',()=>closeProfile(false));
    global.addEventListener('beforeprint',()=>closeProfile(false));
    const onMedia=(media,fn)=>media.addEventListener?media.addEventListener('change',fn):media.addListener(fn);
    onMedia(darkMedia,()=>{if (preferences.theme==='system') applyPreferences();});
    document.addEventListener('load',event=>{if (event.target?.tagName==='LINK') scheduleTextScale();},true);
    applyPreferences();updateProfile();updateFullscreen(false);buildTextScale();
    global.MinervaPreferences={get:()=>({...preferences,effectiveTheme:activeTheme()}),setTheme,setTextSize,setMenuCollapsed,toggleFullscreen};
  }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})(typeof window!=='undefined'?window:globalThis);
