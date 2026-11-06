'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../dist/preferences.js'),'utf8');
function harness({role='admin',hosted=true,late=false}={}){
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
    imports.hidden=profile?.role==='viewer';imports.disabled=imports.hidden;
    document.getElementById('teamPublish').addEventListener('click',()=>callbacks++);
    [imports,document.getElementById('teamManage')].forEach(button=>button.addEventListener('click',()=>{dialogOpened=true;}));
    return toolbar;
  };
  if(!late)addToolbar();
  window.MINERVA_HOSTED=hosted;window.MinervaTeam={getProfile:()=>profile,logout(){profile=null;session();}};
  window.matchMedia=()=>({matches:false,addEventListener(){}});window.localStorage={getItem:()=>null,setItem(){}};window.location={href:'https://example.invalid/',origin:'https://example.invalid'};
  window.setTimeout=()=>1;window.clearTimeout=()=>{};
  function session(){document.dispatchEvent({type:'minerva:session-updated'});}
  retry.addEventListener('click',()=>{profile={id:'example-profile',name:'Pessoa exemplo',role:'admin'};session();});
  vm.runInNewContext(source,{window,document,URL,console},{filename:'preferences.js'});
  return {...dom,imports,main,actions,retry,addToolbar,get toolbar(){return toolbar;},get callbacks(){return callbacks;},get dialogOpened(){return dialogOpened;},session,setProfile(value){profile=value;session();},notify(){for(const observer of dom.observers.filter(o=>o.active))observer.callback([]);},get:id=>document.getElementById(id)};
}
for(const role of ['admin','editor','viewer'])test('profile contains original controls and preserves '+role+' permissions',()=>{
  const h=harness({role}),toolbar=h.toolbar,publish=h.get('teamPublish'),manage=h.get('teamManage');
  assert.equal(toolbar.parentElement,h.get('profileControls'));assert(!h.main.contains(toolbar));assert.equal(h.imports.parentElement,toolbar.querySelector('.team-actions'));
  assert.equal(publish.hidden,role==='viewer');assert.equal(manage.hidden,role!=='admin');assert.equal(publish.disabled,true);
  assert.equal(h.imports.hidden,role==='viewer');assert.equal(h.imports.disabled,role==='viewer');publish.click();assert.equal(h.callbacks,0);
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
