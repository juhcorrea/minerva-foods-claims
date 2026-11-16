(function (global) {
  'use strict';
  const FIELDS = ['name','employeeId','jobTitle','department','unit'];
  const MAX_FILE = 5 * 1024 * 1024, MAX_AVATAR = 512 * 1024;
  const TYPES = ['image/jpeg','image/png','image/webp'];
  function initialLetters(name) {return String(name || '').trim().split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toLocaleUpperCase('pt-BR');}
  function profileValues(value) {const v=value||{},p={};for(const key of FIELDS)p[key]=typeof v[key]==='string'?v[key]:'';p.avatarDataUrl=typeof v.avatarDataUrl==='string'&&/^data:image\/(jpeg|png|webp);base64,/.test(v.avatarDataUrl)?v.avatarDataUrl:'';p.keepMenuOpen=v.keepMenuOpen!==false;return p;}
  function validPhoto(file) {return Boolean(file && TYPES.includes(file.type) && file.size>0 && file.size<=MAX_FILE);}
  if (typeof module!=='undefined'&&module.exports) {module.exports={profileValues,initialLetters,validPhoto,MAX_FILE,MAX_AVATAR};return;}
  const $=id=>document.getElementById(id);
  let hooks={},mounted=false,account=null,accountKey='',documentValue=null,draft=null,dirty=false,loading=false,saving=false,loadVersion=0,photoVersion=0,returnScroll=0;
  const icon=paths=>'<svg viewBox="0 0 24 24" aria-hidden="true">'+paths+'</svg>';
  const userIcon=icon('<circle cx="9" cy="7" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2m4-15v6m-3-3h6"/>');
  const officeIcon=icon('<path d="M4 21V5l8-3 8 3v16M2 21h20M9 21v-5h6v5M8 7h1m6 0h1M8 11h1m6 0h1"/>');
  const menuIcon=icon('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m-3-14v1m0 4v1m6-6h6m-6 4h6"/>');
  const cameraIcon=icon('<path d="m8 5 2-2h4l2 2h4v15H4V5Z"/><circle cx="12" cy="12" r="4"/>');
  const field=(id,label,placeholder,max,wide=false)=>'<div class="profile-field'+(wide?' profile-field-wide':'')+'"><label for="profileField_'+id+'">'+label+'</label><input id="profileField_'+id+'" name="'+id+'" maxlength="'+max+'" placeholder="'+placeholder+'" autocomplete="'+(id==='name'?'name':'off')+'"'+(id==='name'?' required minlength="2"':'')+'></div>';
  function status(text,error=false) {const el=$('profileSaveStatus');if(!el)return;el.textContent=text;el.classList.toggle('is-error',error);el.hidden=!text;}
  function disabled() {const form=$('selfProfileForm');if(!form)return;for(const el of form.querySelectorAll('input,button'))el.disabled=loading||saving;for(const id of ['profileChangePhoto','profileRemovePhoto','profilePhotoFile','profileCamera'])$(id).disabled=loading||saving||!documentValue; if($('profileRemovePhoto'))$('profileRemovePhoto').disabled=loading||saving||!documentValue||!draft?.avatarDataUrl;$('profileSave').disabled=loading||saving||!documentValue;}
  function photo(el,url,name){if(!el)return;el.replaceChildren();if(url){const img=document.createElement('img');img.src=url;img.alt='Foto do perfil';el.append(img);}else el.textContent=initialLetters(name)||'P';}
  function paintIdentity(value,identity) {
    const name=value?.name||account?.name||'Meu Perfil';
    $('profilePanelName').textContent=name;$('profilePanelContact').textContent=identity?.email||account?.email||'';$('profilePanelContact').hidden=!$('profilePanelContact').textContent;
    photo($('profilePhoto'),value?.avatarDataUrl,name);
    if(documentValue){$('profileName').textContent=documentValue.profile.name||account?.name||'Meu Perfil';photo($('profileAvatar'),documentValue.profile.avatarDataUrl,documentValue.profile.name||account?.name);}
    $('profileAccessLabel').textContent=account?.role==='admin'?'Administrador Do Painel':account?.role==='editor'?'Atualizar Bases':account?.role==='reviewer'?'Conferente':'Consulta';
    $('profileAccessDescription').textContent=account?.role==='admin'?'Acesso completo':account?.role==='editor'?'Publicação de bases e marcação de correções':account?.role==='reviewer'?'Consulta e marcação de correções':'Visualização do painel';
  }
  function populate() {
    if(!draft)return;for(const key of FIELDS)$('profileField_'+key).value=draft[key];
    $('profileEmail').value=documentValue?.identity?.email||account?.email||'';
    $('profileKeepMenu').checked=draft.keepMenuOpen;paintIdentity(draft,documentValue?.identity);disabled();
  }
  function readDraft() {for(const key of FIELDS)draft[key]=$('profileField_'+key).value;draft.keepMenuOpen=$('profileKeepMenu').checked;return draft;}
  function currentKey() {return global.MINERVA_HOSTED===true?(account?.id||''):'local-demo';}
  async function load(force=false) {
    const key=currentKey();if(!key||loading||(!force&&documentValue))return;
    const version=++loadVersion;photoVersion++;loading=true;disabled();status('Carregando seu perfil…');
    try {
      let result;
      if(global.MINERVA_HOSTED===true) result=await global.MinervaTeam.getSelfProfile();
      else {let saved;try{saved=JSON.parse(global.localStorage.getItem('minerva.claims.demo-profile.v1')||'null');}catch{}result=saved||{profile:profileValues({name:'Pessoa Exemplo',keepMenuOpen:!global.MinervaPreferences?.get().menuCollapsed}),revision:null,identity:{email:'',role:'viewer'}};}
      if(version!==loadVersion||key!==currentKey())return;
      documentValue={...result,profile:profileValues(result.profile)};draft=profileValues(result.profile);dirty=false;populate();$('profileReload').hidden=true;
      status(global.MINERVA_HOSTED===true?'':'Prévia: as alterações ficam somente neste navegador.');
      if(result.revision)global.MinervaPreferences?.setMenuMode(draft.keepMenuOpen?'expanded':'compact');
    }catch(error){if(version===loadVersion){status(error.message||'Não foi possível carregar o perfil. Tente novamente.',true);documentValue=null;$('profileReload').hidden=false;}}
    finally{if(version===loadVersion){loading=false;disabled();}}
  }
  function sync(profile) {
    if(!mounted)return;account=profile;
    const next=currentKey();
    for(const id of ['profileUsersNav','profileUsersLink'])if($(id))$(id).hidden=global.MINERVA_HOSTED!==true||profile?.role!=='admin';
    if(next!==accountKey){accountKey=next;loadVersion++;photoVersion++;documentValue=null;draft=profileValues({name:profile?.name||'Pessoa Exemplo'});dirty=false;loading=false;saving=false;populate();if(global.MINERVA_HOSTED===true&&!profile){hooks.close?.(false);status('');return;}void load();}
    else if(documentValue)paintIdentity(dirty?readDraft():documentValue.profile,documentValue.identity);
  }
  function open(){returnScroll=global.scrollY||0;document.body.classList.add('profile-page-open');$('profilePanel').style.cssText='';$('profilePanel').hidden=false;$('mainContent')?.setAttribute('inert','');if(!dirty&&documentValue){draft=profileValues(documentValue.profile);populate();}void load();global.scrollTo?.({top:0,behavior:'instant'});}
  function close(){document.body.classList.remove('profile-page-open');$('mainContent')?.removeAttribute('inert');if(returnScroll)global.scrollTo?.({top:returnScroll,behavior:'instant'});}
  function cancel(){if(saving)return;draft=profileValues(documentValue?.profile||{name:account?.name});dirty=false;photoVersion++;populate();status('');hooks.close?.(true);}
  async function save(event){
    event.preventDefault();if(loading||saving||!documentValue)return;
    readDraft();const value=profileValues(draft);value.name=value.name.trim();if(value.name.length<2){status('Informe seu nome completo.',true);$('profileField_name').focus();return;}
    const key=currentKey(),version=loadVersion;saving=true;disabled();status('Salvando alterações…');
    try{
      let result;
      if(global.MINERVA_HOSTED===true)result=await global.MinervaTeam.saveSelfProfile({revision:documentValue.revision,profile:value});
      else {result={...documentValue,profile:value,revision:String(Date.now())};global.localStorage.setItem('minerva.claims.demo-profile.v1',JSON.stringify(result));}
      if(key!==currentKey()||version!==loadVersion)return;
      documentValue={...result,profile:profileValues(result.profile)};draft=profileValues(result.profile);dirty=false;populate();
      global.MinervaPreferences?.setMenuMode(draft.keepMenuOpen?'expanded':'compact');status('Alterações salvas.');
    }catch(error){if(key===currentKey()&&version===loadVersion){status(error.status===409?'Seu perfil foi alterado em outra sessão. Clique em Recarregar Perfil antes de editar novamente.':error.message||'Não foi possível salvar. Tente novamente.',true);$('profileReload').hidden=false;}}
    finally{if(key===currentKey()&&version===loadVersion){saving=false;disabled();}}
  }
  async function compressPhoto(file){
    if(!validPhoto(file))throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
    const url=URL.createObjectURL(file);
    try{const img=await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>resolve(image);image.onerror=()=>reject(new Error('Não foi possível ler esta foto. Escolha outra imagem.'));image.src=url;});
      if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>40000000)throw new Error('A resolução da foto é muito grande. Escolha uma imagem menor.');
      const canvas=document.createElement('canvas');canvas.width=canvas.height=384;const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Seu navegador não conseguiu preparar a foto.');
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,384,384);const side=Math.min(img.naturalWidth,img.naturalHeight);ctx.drawImage(img,(img.naturalWidth-side)/2,(img.naturalHeight-side)/2,side,side,0,0,384,384);
      const data=canvas.toDataURL('image/jpeg',0.86);if(data.length*0.75>MAX_AVATAR)throw new Error('A foto ficou muito grande. Escolha outra imagem.');return data;
    }finally{URL.revokeObjectURL(url);}
  }
  async function choosePhoto(event){const file=event.target.files?.[0];event.target.value='';if(!file)return;const version=++photoVersion,key=currentKey();try{const data=await compressPhoto(file);if(version!==photoVersion||key!==currentKey())return;readDraft();draft.avatarDataUrl=data;dirty=true;paintIdentity(draft,documentValue?.identity);disabled();status('Foto pronta. Clique em Salvar Alterações para confirmar.');}catch(error){if(version===photoVersion)status(error.message,true);}}
  function openUsers(){if(global.MINERVA_HOSTED!==true||account?.role!=='admin')return;hooks.close?.(false);global.MinervaTeam?.openMembers();}
  function mount(options){
    if(mounted)return;hooks=options||{};const panel=$('profilePanel');if(!panel)return;
    const controls=$('profileControls'),resources=$('profileResources'),signout=$('profileSignout'),closeButton=$('closeProfile');
    panel.classList.add('profile-page');panel.setAttribute('role','region');panel.innerHTML='<div class="profile-page-heading"><div><span class="profile-eyebrow">Sua Conta</span><h1 id="profilePanelTitle">Meu Perfil</h1></div><div id="profileCloseHost"></div></div><div class="profile-layout"><aside class="profile-summary"><div class="profile-cover"></div><div class="profile-photo-wrap"><div id="profilePhoto" class="profile-photo"></div><button type="button" id="profileCamera" class="profile-camera" aria-label="Alterar foto">'+cameraIcon+'</button></div><strong id="profilePanelName" class="profile-panel-name"></strong><span id="profilePanelContact" class="profile-panel-contact"></span><span id="profilePanelRole" class="profile-panel-role"></span><div class="profile-photo-actions"><button type="button" class="button button-outline" id="profileChangePhoto">Alterar Foto</button><button type="button" class="profile-text-button" id="profileRemovePhoto">Remover Foto</button><small>JPG, PNG ou WebP · até 5 MB<br>A imagem será ajustada ao formato do perfil.</small><input id="profilePhotoFile" type="file" accept="image/jpeg,image/png,image/webp" hidden></div><div class="profile-access"><small>Seu Acesso</small><strong id="profileAccessLabel"></strong><span id="profileAccessDescription"></span><p id="profilePanelNote" hidden></p></div><div class="profile-side-links"><button type="button" id="profileUsersLink" hidden>'+userIcon+'<span>Usuários E Solicitações</span></button><div id="profileSignoutHost"></div></div></aside><div class="profile-content"><form id="selfProfileForm" class="profile-form"><section class="profile-card"><header class="profile-card-heading">'+userIcon+'<div><h2>Dados Pessoais</h2><p>Como você será identificado no painel.</p></div></header><div class="profile-fields">'+field('name','Nome Completo','Seu nome completo',120,true)+'<div class="profile-field profile-field-wide"><label for="profileEmail">E-mail Corporativo</label><input id="profileEmail" type="email" readonly autocomplete="email"><small>Vinculado à conta de acesso.</small></div>'+field('employeeId','Matrícula','Sua matrícula',40)+field('jobTitle','Cargo','Informe seu cargo',100)+'</div></section><section class="profile-card"><header class="profile-card-heading">'+officeIcon+'<div><h2>Local De Trabalho</h2><p>Sua área e unidade.</p></div></header><div class="profile-fields">'+field('department','Setor','Informe seu setor',100)+field('unit','Unidade','Informe sua unidade',100)+'</div></section><section class="profile-card"><header class="profile-card-heading">'+menuIcon+'<div><h2>Preferências Do Painel</h2><p>Escolha como prefere navegar.</p></div></header><label class="profile-menu-preference"><input id="profileKeepMenu" type="checkbox"><span>Manter O Menu Lateral Aberto<small>Desmarcado: o menu fica compacto, com os ícones de navegação.</small></span></label><div class="profile-locale"><span>Português (Brasil)</span><span>Horário De Brasília</span><span>Data: Dia/Mês/Ano</span></div></section><div class="profile-save-row"><small>A foto e os dados ficam vinculados à sua conta no painel.</small><button type="button" id="profileCancel" class="button button-outline">Cancelar</button><button type="submit" id="profileSave" class="button button-primary">Salvar Alterações</button></div><div id="profileSaveStatus" class="profile-save-status" role="status" aria-live="polite" hidden></div><button type="button" id="profileReload" class="profile-text-button" hidden>Recarregar Perfil</button></form><details class="profile-tools"><summary>Recursos Do Painel</summary><div id="profileToolsHost"></div></details></div></div>';
    $('profileCloseHost').append(closeButton);closeButton.textContent='Voltar Ao Painel';closeButton.className='button button-outline';closeButton.setAttribute('aria-label','Voltar Ao Painel');$('profileButton').removeAttribute('aria-haspopup');
    $('profileSignoutHost').append(signout);$('profileToolsHost').append(resources,controls);document.querySelector('.app-shell')?.append(panel);
    const nav=document.createElement('button');nav.id='profileUsersNav';nav.type='button';nav.className='sidebar-admin-link';nav.hidden=true;nav.setAttribute('aria-label','Usuários E Solicitações');nav.title='Usuários E Solicitações';nav.innerHTML=userIcon+'<span>Usuários E Solicitações</span>';
    const navHost=document.querySelector('.main-nav');if(navHost){navHost.append(nav);navHost.addEventListener('click',event=>{if(event.target?.closest?.('.nav-item'))hooks.close?.(false);});}nav.addEventListener('click',openUsers);
    $('profileUsersLink').addEventListener('click',openUsers);$('selfProfileForm').addEventListener('submit',save);
    $('selfProfileForm').addEventListener('input',()=>{if(!draft||!documentValue)return;dirty=true;readDraft();paintIdentity(draft,documentValue?.identity);status('Alterações não salvas.');});
    $('profileCancel').addEventListener('click',cancel);$('profileReload').addEventListener('click',()=>{dirty=false;void load(true);$('profileReload').hidden=true;});
    $('profileChangePhoto').addEventListener('click',()=>$('profilePhotoFile').click());$('profileCamera').addEventListener('click',()=>$('profilePhotoFile').click());$('profilePhotoFile').addEventListener('change',choosePhoto);
    $('profileRemovePhoto').addEventListener('click',()=>{photoVersion++;readDraft();draft.avatarDataUrl='';dirty=true;paintIdentity(draft,documentValue?.identity);disabled();status('Foto removida. Clique em Salvar Alterações para confirmar.');});
    mounted=true;
  }
  global.MinervaProfile={mount,sync,open,close};
})(typeof window!=='undefined'?window:globalThis);
