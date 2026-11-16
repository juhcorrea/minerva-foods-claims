'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const profileSource=fs.readFileSync(require.resolve('../dist/profile.js'),'utf8');
const preferencesSource=fs.readFileSync(require.resolve('../dist/preferences.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const sample=(overrides={})=>({name:'Pessoa Exemplo',employeeId:'EXAMPLE',jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',avatarDataUrl:'',keepMenuOpen:true,managerId:'',managerName:'',...overrides});
const identity=(role='viewer',id='person-a')=>({id,name:'Conta Exemplo',email:id+'@example.test',role});
const managers=[{id:'person-a',name:'Pessoa Exemplo',jobTitle:'Analista'},{id:'manager-a',name:'Gestora Exemplo',jobTitle:'Gerente',department:'Logística',unit:'Unidade Exemplo'},{id:'manager-b',name:'Outro Gestor',jobTitle:'Coordenador',department:'Operações',unit:'Unidade Dois'}];
function harness({role='viewer',hosted=true,load,save,loadManagers,profile=sample(),photoResult='data:image/jpeg;base64,/9j/AA==',deferImage=false}={}){
 const dom=createDOM(),{document,window,element}=dom,proto=Object.getPrototypeOf(document.body),events=new Map(),requests=[],storage=new Map(),images=[],revoked=[],draws=[];
 proto.prepend=function(node){this.insertBefore(node,this.children[0]||null);};
 Object.defineProperty(proto,'innerHTML',{set(markup){
  this.replaceChildren();const stack=[this],voidTags=new Set(['br','hr','img','input','link','meta']);
  for(const token of String(markup).matchAll(/<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)){
   if(!token[1]){stack.at(-1)._text+=token[3]||'';continue;}
   const tag=token[1].toLowerCase();if(token[0].startsWith('</')){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName.toLowerCase()===tag){stack.length=i;break;}continue;}
   const node=document.createElement(tag);for(const a of token[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(a[1],a[2]??a[3]??a[4]??'');
   node.hidden=node.hasAttribute('hidden');node.disabled=node.hasAttribute('disabled');node.readOnly=node.hasAttribute('readonly');node.checked=node.hasAttribute('checked');stack.at(-1).append(node);if(!voidTags.has(tag))stack.push(node);
  }
 }});
 const create=document.createElement;document.createElement=tag=>{const node=create(tag);if(tag==='canvas'){node.getContext=()=>({fillRect(){},drawImage(...args){draws.push(args);}});node.toDataURL=()=>photoResult;}return node;};
 document.head=element('head',{},document.documentElement);document.styleSheets=[];
 const shell=element('div',{class:'app-shell'}),top=element('header',{class:'topbar'},shell),actions=element('div',{class:'topbar-actions'},top);element('span',{class:'breadcrumb'},top);
 const imports=element('button',{id:'openImports'},actions),sidebar=element('aside',{class:'sidebar'}),nav=element('nav',{class:'main-nav'},sidebar);element('button',{class:'nav-item',text:'Visão Geral'},nav);const footer=element('div',{class:'sidebar-bottom sidebar-status'},sidebar);element('div',{id:'sidebarAccount'},footer);
 const main=element('main',{id:'mainContent'},shell),toolbar=element('section',{id:'teamToolbar',class:'team-toolbar'},main),rules=element('button',{id:'exportRules',text:'Regras De Cálculo (PDF)'},main);
 toolbar.innerHTML='<div class="team-account"></div><div class="team-actions"><button id="teamRefresh">Atualizar</button><button id="teamManage">Usuários E Solicitações</button><button id="teamPublish" disabled>Publicar</button></div><div id="teamPublication">Publicação De Exemplo</div><p id="teamMessage"></p>';
 let account=role?identity(role):null,record={profile:copy(profile),revision:'r1',identity:{userId:account?.id,email:account?.email,role:account?.role}},memberOpens=0;
 function updatePermissions(){document.getElementById('teamManage').hidden=account?.role!=='admin';document.getElementById('teamPublish').hidden=!['admin','editor'].includes(account?.role);imports.hidden=!['admin','editor'].includes(account?.role);imports.disabled=imports.hidden;}
 updatePermissions();
 window.MINERVA_HOSTED=hosted;window.matchMedia=()=>({matches:false,addEventListener(){}});window.localStorage={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value)};window.location={href:'https://example.invalid/',origin:'https://example.invalid'};window.scrollY=135;window.scrollTo=value=>{window.scrollY=value.top;};window.setTimeout=()=>1;window.clearTimeout=()=>{};window.addEventListener=(name,fn)=>{if(!events.has(name))events.set(name,[]);events.get(name).push(fn);};
 window.MinervaTeam={getProfile:()=>account,getSelfProfile:async()=>{requests.push({method:'GET',user:account?.id});return load?load(account):copy(record);},getProfileManagers:async()=>{requests.push({method:'DIRECTORY',user:account?.id});return loadManagers?loadManagers(account):{people:copy(managers)};},saveSelfProfile:async payload=>{requests.push({method:'PUT',payload:copy(payload),user:account?.id});if(save)return save(payload,account);record={profile:copy(payload.profile),revision:'r2',identity:{userId:account.id,email:account.email,role:account.role}};return copy(record);},openMembers(){memberOpens++;},logout(){account=null;session();}};
 class PhotoImage{constructor(){this.naturalWidth=640;this.naturalHeight=480;images.push(this);}set src(value){this.url=value;if(!deferImage)setImmediate(()=>this.onload());}}
 const photoURL={createObjectURL:()=> 'blob:photo-example',revokeObjectURL:url=>revoked.push(url)};
 vm.runInNewContext(profileSource,{window,document,URL:photoURL,Image:PhotoImage,console});
 vm.runInNewContext(preferencesSource,{window,document,URL,console});
 function session(){updatePermissions();document.dispatchEvent({type:'minerva:session-updated'});}
 const $=id=>document.getElementById(id),settle=()=>new Promise(resolve=>setImmediate(resolve));
 return {...dom,$,window,requests,storage,toolbar,rules,images,revoked,draws,get account(){return account;},get memberOpens(){return memberOpens;},settle,open(){$('profileButton').click();},close(){$('closeProfile').click();},input(key,value){const el=$('profileField_'+key);el.value=value;el.dispatchEvent({type:'input',bubbles:true});},setAccount(value){account=value;session();},session,resize(){for(const fn of events.get('resize')||[])fn();},async submit(){$('selfProfileForm').dispatchEvent({type:'submit',preventDefault(){}});await settle();},async photo(file){const el=$('profilePhotoFile');el.files=[file];el.dispatchEvent({type:'change'});await settle();await settle();}};
}
test('profile page edits only own fields, keeps the verified email read-only and saves through the team API',async()=>{
 const h=harness();await h.settle();h.open();assert.equal(h.$('profilePanel').getAttribute('role'),'region');assert.equal(h.$('profileEmail').readOnly,true);assert.equal(h.$('profileEmail').value,'person-a@example.test');assert.equal(h.$('mainContent').hasAttribute('inert'),true);
 h.input('name','Nova Pessoa');h.input('jobTitle','Coordenação');h.$('profileEmail').value='forged@example.test';h.$('profileKeepMenu').checked=false;h.$('profileKeepMenu').dispatchEvent({type:'input',bubbles:true});await h.submit();
 const write=h.requests.find(r=>r.method==='PUT');assert.equal(write.payload.revision,'r1');assert.equal(write.payload.profile.name,'Nova Pessoa');assert.equal(write.payload.profile.jobTitle,'Coordenação');assert.equal(write.payload.profile.keepMenuOpen,false);assert.equal(write.payload.profile.email,undefined);
 assert.equal(h.account.name,'Conta Exemplo');assert.equal(h.$('profileName').textContent,'Nova Pessoa');assert.equal(h.$('profileSaveStatus').textContent,'Alterações salvas.');assert.equal(h.document.documentElement.dataset.menuCollapsed,'true');assert.equal(h.storage.has('minerva.claims.demo-profile.v1'),false);
});
test('back, resize and reopening preserve unsaved fields; Cancel restores the last saved profile',async()=>{
 const h=harness();await h.settle();h.open();h.input('name','Rascunho Privado');h.resize();assert.equal(h.$('profilePanel').hidden,false);h.close();assert.equal(h.$('mainContent').hasAttribute('inert'),false);h.open();assert.equal(h.$('profileField_name').value,'Rascunho Privado');assert.equal(h.requests.filter(r=>r.method==='GET').length,1);
 h.$('profileCancel').click();h.open();assert.equal(h.$('profileField_name').value,'Pessoa Exemplo');assert.equal(h.requests.some(r=>r.method==='PUT'),false);
});
test('approved session refresh does not overwrite an unsaved profile draft',async()=>{
 const h=harness();await h.settle();h.open();h.input('department','Rascunho Setor');h.session();assert.equal(h.$('profileField_department').value,'Rascunho Setor');assert.equal(h.requests.filter(r=>r.method==='GET').length,1);
});

test('keyboard activation of a sidebar item closes the profile without losing its draft',async()=>{
 const h=harness();await h.settle();h.open();h.input('name','Rascunho Da Navegação');h.document.querySelector('.main-nav .nav-item').click();assert.equal(h.$('profilePanel').hidden,true);assert.equal(h.$('mainContent').hasAttribute('inert'),false);assert.equal(h.$('profileButton').getAttribute('aria-haspopup'),null);assert.equal(h.$('closeProfile').getAttribute('aria-label'),'Voltar Ao Painel');h.open();assert.equal(h.$('profileField_name').value,'Rascunho Da Navegação');
});
for(const role of ['admin','editor','reviewer','viewer'])test('users and requests shortcut obeys '+role+' access while original toolbar and rules keep their nodes',async()=>{
 const h=harness({role});await h.settle();assert.equal(h.$('profileUsersNav').hidden,role!=='admin');assert.equal(h.$('profileUsersLink').hidden,role!=='admin');assert.equal(h.toolbar.parentElement,h.$('profileControls'));assert.equal(h.rules.parentElement,h.$('profileResources'));
 const nav=h.$('profileUsersNav'),footer=h.document.querySelector('.sidebar-status');assert.equal(nav.parentElement,footer);assert.equal(footer.children[footer.children.indexOf(nav)+1],h.$('sidebarAccount'));assert.equal(nav.closest('.main-nav'),null);
 assert.equal(h.$('profilePublishing').hidden,false);assert.equal(h.$('profileControls').parentElement,h.$('profilePublishing'));assert.equal(h.$('teamPublish').closest('details'),null);assert(h.rules.closest('details'));assert.equal(h.$('teamPublish').hidden,!['admin','editor'].includes(role));
 h.open();h.$('profileUsersLink').click();assert.equal(h.memberOpens,role==='admin'?1:0);if(role==='admin')assert.equal(h.$('profilePanel').hidden,true);
});
test('account change clears unsaved data and suppresses a late save from the old identity',async()=>{
 let finishSave;const h=harness({save:()=>new Promise(resolve=>{finishSave=resolve;}),load:account=>({profile:sample({name:account.id==='person-a'?'Primeira Pessoa':'Segunda Pessoa'}),revision:'r1',identity:{email:account.email,role:account.role}})});await h.settle();h.open();h.input('name','Privado Da Primeira');const pending=h.submit();h.setAccount(identity('viewer','person-b'));await h.settle();finishSave({profile:sample({name:'Privado Da Primeira'}),revision:'r2'});await pending;assert.equal(h.$('profileField_name').value,'Segunda Pessoa');assert.equal(h.$('profileEmail').value,'person-b@example.test');assert.equal(h.$('profileName').textContent,'Segunda Pessoa');
 h.setAccount(null);assert.equal(h.$('profilePanel').hidden,true);assert.equal(h.$('profileEmail').value,'');assert.equal(h.$('profileUsersNav').hidden,true);assert.equal(h.$('profilePhoto').querySelector('img'),null);
});
test('saving failure keeps the draft and permits retry without claiming success',async()=>{
 let failed=true;const h=harness({save:async payload=>{if(failed)throw Error('Sem conexão. Tente novamente.');return{profile:payload.profile,revision:'r2'};}});await h.settle();h.open();h.input('name','Nome A Salvar');await h.submit();assert.equal(h.$('profileField_name').value,'Nome A Salvar');assert.match(h.$('profileSaveStatus').textContent,/Sem conexão/);assert.equal(h.$('profileSaveStatus').classList.contains('is-error'),true);assert.equal(h.$('profileSave').disabled,false);
 failed=false;await h.submit();assert.equal(h.$('profileSaveStatus').textContent,'Alterações salvas.');
});
test('first-load failure exposes an explicit reload and blocks saving until a profile is fetched',async()=>{
 let failed=true;const h=harness({load:async account=>{if(failed)throw Error('Não foi possível carregar.');return{profile:sample(),revision:'r1',identity:{email:account.email}};}});await h.settle();h.open();await h.settle();assert.equal(h.$('profileReload').hidden,false);assert.equal(h.$('profileSave').disabled,true);failed=false;h.$('profileReload').click();await h.settle();assert.equal(h.$('profileSave').disabled,false);assert.equal(h.$('profileField_name').value,'Pessoa Exemplo');
});

test('conflict preserves the draft until the user explicitly reloads the saved profile',async()=>{
 const h=harness({save:async()=>{throw Object.assign(Error('Perfil alterado em outra sessão.'),{status:409});}});await h.settle();h.open();h.input('name','Rascunho Em Conflito');await h.submit();assert.equal(h.$('profileField_name').value,'Rascunho Em Conflito');assert.equal(h.$('profileReload').hidden,false);assert.match(h.$('profileSaveStatus').textContent,/outra sessão|recarreg/i);
 h.$('profileReload').click();await h.settle();assert.equal(h.$('profileField_name').value,'Pessoa Exemplo');assert.equal(h.$('profileReload').hidden,true);assert.equal(h.$('profileSave').disabled,false);
});
test('valid photo is cropped to a small JPEG draft, saved only on confirmation, and can be removed or cancelled',async()=>{
 const h=harness();await h.settle();h.open();await h.photo({type:'image/png',size:1000});assert.equal(h.requests.some(r=>r.method==='PUT'),false);assert.equal(h.$('profilePhoto').querySelector('img').src,'data:image/jpeg;base64,/9j/AA==');assert.equal(h.draws.length,1);assert.deepEqual(h.revoked,['blob:photo-example']);assert.equal(h.draws[0][1],80);assert.equal(h.draws[0][2],0);assert.equal(h.draws[0][3],480);assert.equal(h.draws[0][7],384);
 await h.submit();assert.match(h.requests.at(-1).payload.profile.avatarDataUrl,/^data:image\/jpeg;base64,/);h.$('profileRemovePhoto').click();assert.equal(h.$('profilePhoto').querySelector('img'),null);h.$('profileCancel').click();h.open();assert(h.$('profilePhoto').querySelector('img'));h.$('profileRemovePhoto').click();await h.submit();assert.equal(h.requests.at(-1).payload.profile.avatarDataUrl,'');
});
test('invalid, excessive, or unreadable photos keep the current photo and never save',async()=>{
 for(const file of [{type:'image/svg+xml',size:100},{type:'text/html',size:100},{type:'image/png',size:5*1024*1024+1},{type:'image/jpeg',size:0}]){const h=harness();await h.settle();h.open();await h.photo(file);assert.match(h.$('profileSaveStatus').textContent,/JPG, PNG ou WebP/);assert.equal(h.images.length,0);assert.equal(h.requests.some(r=>r.method==='PUT'),false);}
 const broken=harness({deferImage:true});await broken.settle();broken.open();const pending=broken.photo({type:'image/jpeg',size:100});broken.images[0].onerror();await pending;assert.match(broken.$('profileSaveStatus').textContent,/Não foi possível ler/);assert.deepEqual(broken.revoked,['blob:photo-example']);
});
test('late photo processing cannot reintroduce an image after Cancel or account switch',async()=>{
 for(const change of [h=>h.$('profileCancel').click(),h=>h.setAccount(identity('viewer','person-b'))]){const h=harness({deferImage:true});await h.settle();h.open();const pending=h.photo({type:'image/jpeg',size:100});change(h);h.images[0].onload();await pending;assert.equal(h.$('profilePhoto').querySelector('img'),null);}
});

test('reloading the saved profile invalidates an older photo still being processed',async()=>{
 const h=harness({deferImage:true});await h.settle();h.open();const pending=h.photo({type:'image/jpeg',size:100});h.$('profileReload').click();await h.settle();h.images[0].onload();await pending;assert.equal(h.$('profilePhoto').querySelector('img'),null);assert.equal(h.$('profileSaveStatus').textContent,'');assert.deepEqual(h.revoked,['blob:photo-example']);
});
test('local preview stores only the preview profile locally and cannot open user administration',async()=>{
 const h=harness({hosted:false});await h.settle();h.open();h.input('name','Nome Fictício');await h.submit();assert.equal(h.requests.length,0);assert.equal(h.$('profileUsersNav').hidden,true);assert.equal(h.$('profileUsersLink').hidden,true);assert.equal(JSON.parse(h.storage.get('minerva.claims.demo-profile.v1')).profile.name,'Nome Fictício');assert.equal(h.toolbar.parentElement,h.$('mainContent'));
});
function typeManager(h,value){h.$('profileManagerSearch').value=value;h.$('profileManagerSearch').dispatchEvent({type:'input',bubbles:true});}
test('manager search filters registered people without self-selection and saves the selected identity',async()=>{
 const h=harness();await h.settle();h.open();await h.settle();h.$('profileManagerSearch').dispatchEvent({type:'focus'});
 assert.equal(h.$('profileManagerOptions').querySelectorAll('button').length,2);assert.equal(h.$('profileManagerSearch').getAttribute('aria-expanded'),'true');
 typeManager(h,'logistica');const options=h.$('profileManagerOptions').querySelectorAll('button');assert.equal(options.length,1);assert.equal(options[0].querySelector('strong').textContent,'Gestora Exemplo');options[0].click();
 assert.equal(h.$('profileManagerSearch').value,'Gestora Exemplo');assert.equal(h.$('profileManagerOptions').hidden,true);assert.equal(h.$('profileManagerSearch').getAttribute('aria-expanded'),'false');assert.equal(h.requests.some(r=>r.method==='PUT'),false);
 await h.submit();const saved=h.requests.findLast(r=>r.method==='PUT').payload.profile;assert.equal(saved.managerId,'manager-a');assert.equal(saved.managerName,'');assert.equal(saved.name,'Pessoa Exemplo');
});
test('typing an external manager replaces a registered link and retains the name after reopening',async()=>{
 const h=harness({profile:sample({managerId:'manager-a'})});await h.settle();h.open();await h.settle();assert.equal(h.$('profileManagerSearch').value,'Gestora Exemplo');
 typeManager(h,'Gestor Externo Exemplo');assert.match(h.$('profileManagerOptions').textContent,/Nenhuma pessoa cadastrada/);await h.submit();const saved=h.requests.findLast(r=>r.method==='PUT').payload.profile;assert.equal(saved.managerId,'');assert.equal(saved.managerName,'Gestor Externo Exemplo');
 h.close();h.open();assert.equal(h.$('profileManagerSearch').value,'Gestor Externo Exemplo');
});
test('clear manager removes both references; Cancel restores the saved manager without publishing a change',async()=>{
 const h=harness({profile:sample({managerId:'manager-a'})});await h.settle();h.open();await h.settle();h.$('profileManagerClear').click();assert.equal(h.$('profileManagerSearch').value,'');assert.equal(h.$('profileManagerOptions').hidden,true);
 h.$('profileCancel').click();h.open();assert.equal(h.$('profileManagerSearch').value,'Gestora Exemplo');assert.equal(h.requests.some(r=>r.method==='PUT'),false);
 h.$('profileManagerClear').click();await h.submit();const saved=h.requests.findLast(r=>r.method==='PUT').payload.profile;assert.equal(saved.managerId,'');assert.equal(saved.managerName,'');
});
test('a late manager directory response cannot replace choices after the signed-in account changes',async()=>{
 let finishOld;const current=[{id:'manager-new',name:'Gestor Da Nova Conta',department:'Operações'}];
 const h=harness({load:account=>({profile:sample({name:account.id==='person-a'?'Pessoa Inicial':'Nova Pessoa'}),revision:'r1',identity:{email:account.email,role:account.role}}),loadManagers:account=>account.id==='person-a'?new Promise(resolve=>{finishOld=resolve;}):{people:current}});
 await h.settle();h.open();h.close();h.setAccount(identity('viewer','person-b'));await h.settle();h.open();await h.settle();h.$('profileManagerSearch').dispatchEvent({type:'focus'});assert.match(h.$('profileManagerOptions').textContent,/Gestor Da Nova Conta/);
 finishOld({people:[{id:'manager-old',name:'Gestor Da Conta Anterior'}]});await h.settle();assert.doesNotMatch(h.$('profileManagerOptions').textContent,/Conta Anterior/);assert.equal(h.$('profileManagerOptions').querySelectorAll('button').length,1);
 h.$('profileManagerOptions').querySelector('button').click();await h.submit();const saved=h.requests.findLast(r=>r.method==='PUT');assert.equal(saved.user,'person-b');assert.equal(saved.payload.profile.managerId,'manager-new');assert.equal(saved.payload.profile.name,'Nova Pessoa');
});
test('a failed directory lookup can retry and does not prevent saving an external manager',async()=>{
 let failures=1;const h=harness({loadManagers:async()=>{if(failures--)throw Error('Sem conexão');return{people:copy(managers)};}});await h.settle();h.open();await h.settle();assert.match(h.$('profileManagerHint').textContent,/Não foi possível carregar/);
 typeManager(h,'Gestor Externo');await h.submit();assert.equal(h.requests.findLast(r=>r.method==='PUT').payload.profile.managerName,'Gestor Externo');
 h.$('profileManagerSearch').dispatchEvent({type:'focus'});await h.settle();typeManager(h,'');assert.equal(h.$('profileManagerOptions').querySelectorAll('button').length,2);assert.equal(h.requests.filter(r=>r.method==='DIRECTORY').length,2);
});
