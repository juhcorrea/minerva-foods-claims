(function(global){
  'use strict';
  const editableFields=['name','employeeId','jobTitle','department','unit','managerId','managerName','avatarDataUrl'];
  const MAX_AVATAR=512*1024;
  const profileValues=value=>({...Object.fromEntries(editableFields.map(key=>[key,typeof value?.[key]==='string'&&(key!=='avatarDataUrl'||/^data:image\/(jpeg|png|webp);base64,/.test(value[key]))?value[key]:''])),showInOrganization:value?.showInOrganization!==false});
  function initials(name){const words=String(name||'').trim().split(/\s+/).filter(Boolean);return [words[0],words.length>1?words.at(-1):''].filter(Boolean).map(word=>Array.from(word)[0]).join('').toLocaleUpperCase('pt-BR')||'P';}
  const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  const instances=new Set();let serial=0;

  function mount(options){
    if(typeof options?.getProfile!=='function'||typeof options?.saveProfile!=='function'||typeof options?.getManagers!=='function')throw new TypeError('Informe as consultas e o salvamento do perfil.');
    const doc=global.document,id='member-profile-'+(++serial);
    const make=(tag,className,value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
    const button=(className,label)=>{const node=make('button',className,label);node.type='button';return node;};
    const dialog=make('dialog','member-profile-dialog');dialog.setAttribute('aria-labelledby',id+'-title');
    const header=make('header','member-profile-heading'),heading=make('div'),eyebrow=make('span','member-profile-eyebrow','Administração De Pessoas'),title=make('h2','','Editar Perfil');title.id=id+'-title';
    const subtitle=make('p','member-profile-subtitle','Dados Da Pessoa'),closeButton=button('member-profile-close','×');closeButton.setAttribute('aria-label','Fechar Edição Do Perfil');heading.append(eyebrow,title,subtitle);header.append(heading,closeButton);
    const form=make('form','member-profile-form'),fields=make('div','member-profile-fields'),inputs={};
    const photoSection=make('section','member-profile-photo-section'),photoPreview=make('div','member-profile-photo'),photoActions=make('div','member-profile-photo-actions'),photoLabel=make('strong','','Foto Do Perfil'),photoButtons=make('div','member-profile-photo-buttons'),changePhoto=button('button button-outline member-profile-change-photo','Alterar Foto'),framePhoto=button('button button-outline member-profile-frame-photo','Enquadrar Foto'),removePhoto=button('member-profile-remove-photo','Remover Foto'),photoHelp=make('small','','JPG, PNG ou WebP · até 5 MB. Ajuste o zoom e arraste a foto para centralizar o rosto.'),photoFile=make('input','member-profile-photo-file');photoFile.type='file';photoFile.accept='image/jpeg,image/png,image/webp';photoFile.hidden=true;photoFile.setAttribute('aria-label','Selecionar Foto Do Perfil');photoButtons.append(changePhoto,framePhoto,removePhoto);photoActions.append(photoLabel,photoButtons,photoHelp,photoFile);photoSection.append(photoPreview,photoActions);
    function field(key,label,max,wide=false){const wrap=make('div','member-profile-field'+(wide?' member-profile-wide':'')),caption=make('label','',label),input=make('input');input.id=id+'-'+key;input.name=key;input.maxLength=max;input.autocomplete='off';caption.setAttribute('for',input.id);wrap.append(caption,input);inputs[key]=input;fields.append(wrap);return wrap;}
    field('name','Nome Completo',160,true);inputs.name.required=true;inputs.name.minLength=2;
    const emailWrap=field('email','E-mail Corporativo',254,true);inputs.email.type='email';inputs.email.readOnly=true;emailWrap.append(make('small','','Vinculado à conta de acesso.'));
    field('employeeId','Matrícula',80);field('jobTitle','Cargo',120);field('department','Setor',120);field('unit','Unidade',120);
    const managerField=make('div','member-profile-field member-profile-wide member-profile-manager'),managerLabel=make('label','','Gestor'),managerInputWrap=make('div','member-profile-manager-input'),managerInput=make('input'),clearManager=button('member-profile-manager-clear','×'),managerOptions=make('div','member-profile-manager-options'),managerHint=make('small','member-profile-manager-hint');
    managerInput.id=id+'-manager';managerInput.maxLength=160;managerInput.autocomplete='off';managerInput.placeholder='Buscar Pessoa Ou Informar O Nome Do Gestor';managerOptions.id=id+'-managers';managerOptions.hidden=true;managerInput.setAttribute('aria-controls',managerOptions.id);managerInput.setAttribute('aria-expanded','false');managerLabel.setAttribute('for',managerInput.id);clearManager.setAttribute('aria-label','Limpar Gestor');clearManager.title='Limpar Gestor';managerInputWrap.append(managerInput,clearManager);managerField.append(managerLabel,managerInputWrap,managerOptions,managerHint);fields.append(managerField);
    const visibilityLabel=make('label','member-profile-visibility member-profile-wide'),visibilityInput=make('input'),visibilityText=make('span'),visibilityTitle=make('strong','','Exibir No Organograma'),visibilityHint=make('small','','Desmarque para ocultar esta pessoa do organograma. O acesso ao painel permanece igual.');visibilityInput.type='checkbox';visibilityInput.checked=true;visibilityText.append(visibilityTitle,visibilityHint);visibilityLabel.append(visibilityInput,visibilityText);fields.append(visibilityLabel);
    const status=make('p','member-profile-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.hidden=true;
    const actions=make('footer','member-profile-actions'),reloadButton=button('button button-outline member-profile-reload','Recarregar Perfil'),cancelButton=button('button button-outline member-profile-cancel','Cancelar'),saveButton=button('button button-primary member-profile-save','Salvar Alterações');saveButton.type='submit';reloadButton.hidden=true;actions.append(reloadButton,cancelButton,saveButton);form.append(photoSection,fields,status,actions);dialog.append(header,form);doc.body.append(dialog);
    let version=0,target=null,record=null,draft=profileValues(),loading=false,saving=false,requiresReload=false,directory=[],directoryLoaded=false,directoryLoading=false,photoVersion=0,photoLoading=false,photoSource=null,cropper=null;
    const defaultHint='Selecione uma pessoa cadastrada ou informe o nome de um gestor externo ao painel.';
    const current=(token,userId)=>version===token&&target?.id===userId&&dialog.open;
    function setStatus(message,error=false){status.textContent=message;status.hidden=!message;status.classList.toggle('is-error',error);}
    function controls(){const blocked=loading||saving||!record,photoBlocked=blocked||requiresReload;for(const input of [...Object.values(inputs),managerInput,visibilityInput])input.disabled=blocked;clearManager.disabled=blocked;changePhoto.disabled=photoBlocked;framePhoto.disabled=photoBlocked||!draft.avatarDataUrl;photoFile.disabled=photoBlocked;removePhoto.disabled=photoBlocked||(!draft.avatarDataUrl&&!photoLoading);saveButton.disabled=blocked||requiresReload||photoLoading;reloadButton.disabled=loading||saving;form.setAttribute('aria-busy',String(loading||saving||photoLoading));for(const choice of managerOptions.querySelectorAll('button'))choice.disabled=blocked;}
    function cancelCrop(clearSource=false){photoVersion++;photoLoading=false;cropper?.cancel();if(clearSource)photoSource=null;}
    function paintPhoto(){photoPreview.replaceChildren();if(draft.avatarDataUrl){const img=make('img');img.src=draft.avatarDataUrl;img.alt='Foto Do Perfil';photoPreview.append(img);}else photoPreview.textContent=initials(inputs.name.value||draft.name||target?.name);}
    function closeManagers(){managerOptions.hidden=true;managerInput.setAttribute('aria-expanded','false');}
    function managerName(){return draft.managerId?(directory.find(person=>person.id===draft.managerId)?.name||'Gestor Cadastrado'):draft.managerName;}
    function populate(){for(const key of editableFields.slice(0,5))inputs[key].value=draft[key];inputs.email.value=record?.identity?.email||'';managerInput.value=managerName();visibilityInput.checked=draft.showInOrganization;closeManagers();paintPhoto();}
    function readDraft(){for(const key of editableFields.slice(0,5))draft[key]=inputs[key].value;draft.showInOrganization=visibilityInput.checked;return profileValues(draft);}
    function chooseManager(person){if(!record||loading||saving)return;draft.managerId=person?.id||'';draft.managerName='';managerInput.value=person?.name||'';managerInput.focus();closeManagers();setStatus('Alterações não salvas.');}
    function renderManagers(){
      if(!record||loading||saving)return;managerOptions.replaceChildren();const query=fold(managerInput.value.trim()),choices=directory.filter(person=>person.id!==target.id&&(!query||fold([person.name,person.jobTitle,person.department,person.unit].join(' ')).includes(query))).slice(0,40);
      for(const person of choices){const choice=button('member-profile-manager-option','');choice.append(make('strong','',person.name),make('small','',[person.jobTitle,person.department,person.unit].filter(Boolean).join(' · ')));choice.addEventListener('click',()=>chooseManager(person));managerOptions.append(choice);}
      const message=directoryLoading?'Carregando pessoas…':choices.length?'Selecione a pessoa para vincular o gestor.':'Nenhuma pessoa cadastrada encontrada. O nome digitado será salvo como gestor externo.';managerOptions.append(make('small','member-profile-manager-note',message));managerOptions.hidden=false;managerInput.setAttribute('aria-expanded','true');
    }
    async function loadManagers(){
      if(!target||directoryLoaded||directoryLoading)return;const token=version,userId=target.id;directoryLoading=true;
      try{const result=await options.getManagers();if(!current(token,userId))return;directory=Array.isArray(result?.people)?result.people.filter(person=>typeof person?.id==='string'&&typeof person?.name==='string'):[];directoryLoaded=true;managerHint.textContent=defaultHint;if(draft.managerId)managerInput.value=managerName();}
      catch(error){if(current(token,userId)&&error?.name!=='AbortError')managerHint.textContent='Não foi possível carregar os cadastros. Tente novamente ou informe o nome do gestor.';}
      finally{if(current(token,userId)){directoryLoading=false;if(!managerOptions.hidden)renderManagers();}}
    }
    async function load(){
      if(!target)return false;const token=version,userId=target.id;cancelCrop(true);loading=true;record=null;requiresReload=false;reloadButton.hidden=true;closeManagers();controls();setStatus('Carregando perfil…');
      try{const result=await options.getProfile(userId);if(!current(token,userId))return false;if(!result?.profile||typeof result.profile!=='object'||(result.identity?.userId&&result.identity.userId!==userId))throw new Error('Não foi possível confirmar o perfil solicitado. Recarregue para tentar novamente.');record=result;draft=profileValues(result.profile);populate();subtitle.textContent=draft.name||target.name||'Dados Da Pessoa';setStatus('');return true;}
      catch(error){if(current(token,userId)){if(error?.name==='AbortError'){reset();return false;}setStatus(error?.message||'Não foi possível carregar o perfil. Tente novamente.',true);reloadButton.hidden=false;}return false;}
      finally{if(current(token,userId)){loading=false;controls();}}
    }
    async function save(event){
      event.preventDefault();if(!target||!record||loading||saving||requiresReload||photoLoading)return;
      const profile=readDraft();profile.name=profile.name.trim();profile.managerName=profile.managerName.trim();if(profile.name.length<2){setStatus('Informe o nome completo.',true);inputs.name.focus();return;}
      const token=version,userId=target.id;cancelCrop();saving=true;closeManagers();controls();setStatus('Salvando alterações…');
      try{
        const result=await options.saveProfile(userId,{revision:record.revision??null,profile});if(!current(token,userId))return;
        if(!result?.profile||typeof result.profile!=='object'||(result.identity?.userId&&result.identity.userId!==userId))throw new Error('O salvamento não retornou o perfil esperado. Recarregue para conferir.');
        record=result;draft=profileValues(result.profile);populate();subtitle.textContent=draft.name||target.name;setStatus('Alterações salvas.');
        if(typeof options.onSaved==='function')try{await options.onSaved(result);}catch(error){if(current(token,userId))setStatus('Alterações salvas. Atualize a lista de pessoas para conferir o resultado.');}
      }catch(error){if(current(token,userId)){if(error?.name==='AbortError'){reset();return;}requiresReload=error?.status===409;reloadButton.hidden=!requiresReload;setStatus(requiresReload?'Este perfil foi alterado em outra sessão. Recarregue o perfil antes de salvar novamente.':error?.message||'Não foi possível salvar. Tente novamente.',true);}}
      finally{if(current(token,userId)){saving=false;controls();}}
    }
    async function openCrop(source){
      if(!source||!record||loading||saving||requiresReload||!target)return;
      const previousStatus=status.textContent,previousError=status.classList.contains('is-error');cancelCrop();
      const token=version,userId=target.id,photoToken=photoVersion;photoLoading=true;controls();setStatus('Ajuste o enquadramento e clique em Usar Foto.');
      const photoCurrent=()=>photoToken===photoVersion&&current(token,userId)&&!loading&&!saving;
      try{if(!cropper){if(typeof global.MinervaPhotoCropper?.create!=='function')throw new Error('Não foi possível abrir o enquadramento. Atualize a página e tente novamente.');cropper=global.MinervaPhotoCropper.create();}
        const data=await cropper.open(source);if(!photoCurrent())return;if(data===null){setStatus(previousStatus,previousError);return;}
        if(typeof data!=='string'||!data.startsWith('data:image/jpeg;base64,')||data.length*0.75>MAX_AVATAR)throw new Error('Não foi possível preparar esta foto. Escolha outra imagem.');
        draft.avatarDataUrl=data;photoSource=source;paintPhoto();setStatus('Foto pronta. Clique em Salvar Alterações para confirmar.');}
      catch(error){if(photoCurrent())setStatus(error.message||'Não foi possível preparar esta foto.',true);}
      finally{if(photoCurrent()){photoLoading=false;controls();}}
    }
    function choosePhoto(event){const file=event.target.files?.[0];event.target.value='';if(file)void openCrop(file);}
    function reset(){version++;cancelCrop(true);target=null;record=null;draft=profileValues();directory=[];directoryLoaded=false;directoryLoading=false;loading=false;saving=false;requiresReload=false;for(const input of Object.values(inputs))input.value='';visibilityInput.checked=true;photoFile.value='';photoPreview.replaceChildren();managerInput.value='';managerOptions.replaceChildren();closeManagers();managerHint.textContent=defaultHint;subtitle.textContent='Dados Da Pessoa';reloadButton.hidden=true;setStatus('');controls();if(dialog.open)dialog.close();}
    function open(person){reset();if(!person||typeof person.id!=='string'||!person.id.trim())return Promise.resolve(false);target={id:person.id,name:typeof person.name==='string'?person.name:''};subtitle.textContent=target.name||'Dados Da Pessoa';dialog.showModal();void loadManagers();return load();}
    closeButton.addEventListener('click',reset);cancelButton.addEventListener('click',reset);dialog.addEventListener('cancel',event=>{event.preventDefault();reset();});dialog.addEventListener('close',()=>{if(target&&!dialog.open)reset();});form.addEventListener('submit',save);
    form.addEventListener('input',event=>{if(event.target===photoFile)return;if(record&&!loading&&!saving){paintPhoto();if(!requiresReload&&!photoLoading)setStatus('Alterações não salvas.');}});reloadButton.addEventListener('click',()=>{if(!loading&&!saving)void load();});
    changePhoto.addEventListener('click',()=>photoFile.click());framePhoto.addEventListener('click',()=>{void openCrop(photoSource||draft.avatarDataUrl);});photoFile.addEventListener('change',choosePhoto);removePhoto.addEventListener('click',()=>{if(!record||loading||saving||requiresReload)return;cancelCrop(true);draft.avatarDataUrl='';photoFile.value='';paintPhoto();controls();setStatus('Foto removida. Clique em Salvar Alterações para confirmar.');});
    managerInput.addEventListener('focus',()=>{void loadManagers();renderManagers();});managerInput.addEventListener('input',()=>{if(!record||loading||saving)return;draft.managerId='';draft.managerName=managerInput.value;renderManagers();});clearManager.addEventListener('click',()=>chooseManager(null));
    managerInput.addEventListener('keydown',event=>{if(event.key==='ArrowDown'){event.preventDefault();renderManagers();managerOptions.querySelector('button')?.focus();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeManagers();}});
    managerOptions.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();managerInput.focus();closeManagers();}});
    managerField.addEventListener('focusout',event=>{if(!event.relatedTarget||!managerField.contains(event.relatedTarget))closeManagers();});
    reset();const controller={open,reset};instances.add(controller);return controller;
  }
  global.MinervaMemberProfile={mount,reset:()=>{for(const instance of instances)instance.reset();}};
})(typeof window!=='undefined'?window:globalThis);
