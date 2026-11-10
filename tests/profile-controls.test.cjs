'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../dist/preferences.js'),'utf8');
function harness({role='admin',hosted=true,late=false,saved={}}={}){
  const dom=createDOM(),{document,window,element}=dom,proto=Object.getPrototypeOf(document.body);
  proto.prepend=function(node){this.insertBefore(node,this.children[0]||null);};
  Object.defineProperty(proto,'innerHTML',{set(markup){
    this.replaceChildren();const stack=[this],voidTags=new Set(['br','hr','img','input','link','meta']);
    for(const token of String(markup).matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)){
      if(!token[1]){stack.at(-1)._text+=token[3]||'';continue;}
      const tag=token[1].toLowerCase();
      if(token[0].startsWith('</')){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName.toLowerCase()===tag){stack.length=i;break;}continue;}
      const node=document.createElement(tag);
      for(const a of token[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(a[1],a[2]??a[3]??a[4]??'');
      node.hidden=node.hasAttribute('hidden');node.disabled=node.hasAttribute('disabled');stack.at(-1).append(node);
      if(!voidTags.has(tag))stack.push(node);
    }
  }});
  document.head=element('head',{},document.documentElement);document.styleSheets=[];
  const top=element('header',{class:'topbar'}),actions=element('div',{class:'topbar-actions'},top);
  element('span',{class:'breadcrumb'},top);const imports=element('button',{id:'openImports'},actions);
  const sidebar=element('aside',{class:'sidebar'});element('div',{id:'sidebarAccount'},sidebar);
  const main=element('main');const retry=element('button',{id:'teamRetrySession'});
  let profile=role?{id:'example-profile',name:'Pessoa exemplo',role}:null,toolbar=null,callbacks=0,dialogOpened=false;
  const addToolbar=()=>{
    toolbar=element('section',{id:'teamToolbar',class:'team-toolbar'},main);
    toolbar.innerHTML='<div class="team-account"></div><div class="team-actions"><button id="teamRefresh">Atualizar</button><button id="teamManage">Acessos</button><button id="teamPublish" disabled>Publicar</button></div><div id="teamPublication">Publicação de exemplo</div><p id="teamMessage"></p>';
    document.getElementById('teamManage').hidden=profile?.role!=='admin';document.getElementById('teamPublish').hidden=!['admin','editor'].includes(profile?.role);
    imports.hidden=!['admin','editor'].includes(profile?.role);imports.disabled=imports.hidden;
    document.getElementById('teamPublish').addEventListener('click',()=>callbacks++);
    [imports,document.getElementById('teamManage')].forEach(button=>button.addEventListener('click',()=>{dialogOpened=true;}));
    return toolbar;
  };
  if(!late)addToolbar();
  window.MINERVA_HOSTED=hosted;window.MinervaTeam={getProfile:()=>profile,logout(){profile=null;session();}};
  const storage=new Map([['minerva.claims.preferences.v1',JSON.stringify(saved)]]);
  window.matchMedia=()=>({matches:false,addEventListener(){}});window.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};window.location={href:'https://example.invalid/',origin:'https://example.invalid'};
  window.setTimeout=()=>1;window.clearTimeout=()=>{};
  function session(){document.dispatchEvent({type:'minerva:session-updated'});}
  retry.addEventListener('click',()=>{profile={id:'example-profile',name:'Pessoa exemplo',role:'admin'};session();});
  vm.runInNewContext(source,{window,document,URL,console},{filename:'preferences.js'});
  return {...dom,imports,main,actions,retry,addToolbar,storage,get toolbar(){return toolbar;},get callbacks(){return callbacks;},get dialogOpened(){return dialogOpened;},session,setProfile(value){profile=value;session();},notify(){for(const observer of dom.observers.filter(o=>o.active))observer.callback([]);},get:id=>document.getElementById(id)};
}
for(const role of ['admin','editor','reviewer','viewer'])test('profile contains original controls and preserves '+role+' permissions',()=>{
  const h=harness({role}),toolbar=h.toolbar,publish=h.get('teamPublish'),manage=h.get('teamManage');
  assert.equal(toolbar.parentElement,h.get('profileControls'));assert(!h.main.contains(toolbar));assert.equal(h.imports.parentElement,toolbar.querySelector('.team-actions'));if(role==='reviewer')assert.equal(h.get('profileRole').textContent,'Conferente');
  assert.equal(publish.hidden,!['admin','editor'].includes(role));assert.equal(manage.hidden,role!=='admin');assert.equal(publish.disabled,true);
  assert.equal(h.imports.hidden,!['admin','editor'].includes(role));assert.equal(h.imports.disabled,!['admin','editor'].includes(role));publish.click();assert.equal(h.callbacks,0);
  publish.disabled=false;publish.click();assert.equal(h.callbacks,1);h.session();assert.equal(h.get('teamPublish'),publish);
  assert.equal(h.document.querySelectorAll('#teamMessage').length,1);assert.equal(h.get('teamPublication').textContent,'Publicação de exemplo');
});
test('pending access stays hidden, retry authorizes relocation, and denial closes profile and status',()=>{
  const h=harness({role:null});assert.equal(h.get('profileButton').hidden,true);assert.equal(h.toolbar.parentElement,h.main);
  h.retry.click();assert.equal(h.toolbar.parentElement,h.get('profileControls'));h.get('profileButton').click();assert.equal(h.get('profilePanel').hidden,false);
  const message=h.get('teamMessage');message.textContent='Falha de exemplo';message.classList.add('is-error');h.notify();
  h.setProfile(null);assert.equal(h.get('profilePanel').hidden,true);assert.equal(h.get('profileButton').hidden,true);assert.equal(h.get('profileControls').hidden,true);assert.equal(h.get('profileActivityStatus').hidden,true);
});
test('late toolbar is moved after creation and local preview keeps its existing import controls',()=>{
  const h=harness({late:true});assert.equal(h.get('profileControls').hidden,true);h.addToolbar();h.notify();assert.equal(h.toolbar.parentElement,h.get('profileControls'));
  const local=harness({hosted:false});assert.equal(local.imports.parentElement,local.actions);assert.equal(local.toolbar.parentElement,local.main);assert.equal(local.get('profileControls').hidden,true);
});
test('import and access dialogs keep their handlers and close the profile',()=>{
  for(const id of ['openImports','teamManage']){const h=harness();h.get('profileButton').click();assert.equal(h.get('profilePanel').hidden,false);h.get(id).click();assert.equal(h.dialogOpened,true);assert.equal(h.get('profilePanel').hidden,true);}
});
test('only errors or publishing status surface outside the closed profile',()=>{
  const h=harness(),message=h.get('teamMessage'),notice=h.get('profileActivityStatus');
  message.textContent='Você está consultando a última versão publicada.';h.notify();assert.equal(notice.hidden,true);
  message.textContent='Publicando a análise…';h.notify();assert.equal(notice.hidden,false);assert.equal(h.get('profileActivityMessage').textContent,message.textContent);
  h.get('profileActivityOpen').click();assert.equal(notice.hidden,true);assert.equal(h.get('profilePanel').hidden,false);
  message.textContent='Falha de exemplo';message.classList.add('is-error');h.notify();h.get('closeProfile').click();assert.equal(notice.hidden,false);assert.equal(h.get('teamMessage'),message);
  message.classList.remove('is-error');message.textContent='Atualização publicada.';h.notify();assert.equal(notice.hidden,true);
});
test('presentation and unauthenticated modes conceal profile and operational notice',()=>{
  const css=fs.readFileSync(path.join(__dirname,'../dist/preferences.css'),'utf8');
  for(const state of ['dashboard-presentation','team-session-pending','team-denied']){assert(css.includes('body.'+state+' #profilePanel'));assert(css.includes('body.'+state+' .profile-activity-status'));}
  assert(css.includes('.profile-controls [hidden]'));assert(css.includes('overscroll-behavior:contain'));
});

test('navigation modes persist independently and preserve the existing fullscreen control',async()=>{
 const h=harness(),root=h.document.documentElement,sidebar=h.get('appSidebar'),toggle=h.get('menuToggle'),menu=h.get('navigationMenu'),fullscreen=h.get('fullscreenToggle'),parent=fullscreen.parentElement;
 const choose=mode=>{toggle.click();assert.equal(menu.hidden,false);h.document.querySelector('[data-menu-mode="'+mode+'"]').click();assert.equal(menu.hidden,true);assert.equal(toggle.getAttribute('aria-expanded'),'false');assert.equal(h.document.activeElement,toggle);};
 assert.equal(root.dataset.menuHidden,'false');assert.equal(root.dataset.menuCollapsed,'false');assert.equal(sidebar.inert,false);
 choose('compact');assert.equal(root.dataset.menuCollapsed,'true');assert.equal(sidebar.inert,false);assert.equal(sidebar.getAttribute('aria-hidden'),null);
 h.get('profileButton').click();assert.equal(h.get('profilePanel').hidden,false);h.window.MinervaPreferences.setMenuMode('hidden');assert.equal(h.get('profilePanel').hidden,true);assert.equal(sidebar.inert,true);assert.equal(sidebar.getAttribute('aria-hidden'),'true');assert.equal(root.dataset.menuHidden,'true');
 const persisted=JSON.parse(h.storage.get('minerva.claims.preferences.v1'));assert.equal(persisted.menuHidden,true);assert.equal(harness({saved:persisted}).get('appSidebar').inert,true);
 choose('expanded');assert.equal(root.dataset.menuHidden,'false');assert.equal(root.dataset.menuCollapsed,'false');assert.equal(sidebar.inert,false);assert.equal(sidebar.getAttribute('aria-hidden'),null);assert.equal(fullscreen.parentElement,parent);assert.equal(h.document.querySelectorAll('#fullscreenToggle').length,1);
 let entered=0,left=0;root.requestFullscreen=async()=>{entered++;h.document.fullscreenElement=root;};h.document.exitFullscreen=async()=>{left++;h.document.fullscreenElement=null;};fullscreen.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(entered,1);assert.equal(fullscreen.getAttribute('aria-pressed'),'true');fullscreen.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(left,1);assert.equal(fullscreen.getAttribute('aria-pressed'),'false');
 const legacy=harness({saved:{menuCollapsed:true}});assert.equal(legacy.document.documentElement.dataset.menuCollapsed,'true');assert.equal(legacy.document.documentElement.dataset.menuHidden,'false');assert.equal(legacy.get('appSidebar').inert,false);
});

test('navigation dropdown supports checked state, keyboard movement and dismissal without changing selection',()=>{
 const h=harness({saved:{menuCollapsed:true}}),menu=h.get('navigationMenu'),toggle=h.get('menuToggle'),items=menu.querySelectorAll('[data-menu-mode]');
 const key=(target,value)=>target.dispatchEvent({type:'keydown',key:value,bubbles:true,preventDefault(){}});
 toggle.click();assert.equal(toggle.getAttribute('aria-haspopup'),'menu');assert.equal(menu.getAttribute('role'),'menu');assert.equal(h.document.activeElement,items[1]);assert.equal(items[1].getAttribute('aria-checked'),'true');assert(items.every(item=>item.getAttribute('role')==='menuitemradio'));
 key(items[1],'ArrowDown');assert.equal(h.document.activeElement,items[2]);key(items[2],'ArrowDown');assert.equal(h.document.activeElement,items[0]);key(items[0],'End');assert.equal(h.document.activeElement,items[2]);key(items[2],'Home');assert.equal(h.document.activeElement,items[0]);key(items[0],'ArrowUp');assert.equal(h.document.activeElement,items[2]);
 key(items[2],'Escape');assert.equal(menu.hidden,true);assert.equal(h.document.activeElement,toggle);assert.equal(h.window.MinervaPreferences.get().menuCollapsed,true);
 key(toggle,'ArrowDown');assert.equal(h.document.activeElement,items[0]);h.document.dispatchEvent({type:'pointerdown',target:h.main});assert.equal(menu.hidden,true);
 key(toggle,'ArrowUp');assert.equal(h.document.activeElement,items[2]);key(items[2],'Tab');assert.equal(menu.hidden,true);assert.equal(h.window.MinervaPreferences.get().menuHidden,false);
 toggle.click();items[2].click();assert.equal(items[2].getAttribute('aria-checked'),'true');assert.equal(items[1].getAttribute('aria-checked'),'false');assert(toggle.title.includes('Escondido'));
 const css=fs.readFileSync(path.join(__dirname,'../dist/preferences.css'),'utf8');assert.match(css,/html\[data-menu-hidden="true"\] \.sidebar\{display:none!important\}/);assert.match(css,/html\[data-menu-hidden="true"\] body:not\(\.dashboard-presentation\) \.app-shell\{margin-left:0!important\}/);
});
