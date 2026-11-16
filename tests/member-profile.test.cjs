'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(require.resolve('../dist/member-profile.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
const profile=(extra={})=>({name:'Pessoa Exemplo',employeeId:'EXAMPLE',jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',managerId:'',managerName:'',avatarDataUrl:'data:image/jpeg;base64,/9j/AA==',keepMenuOpen:false,...extra});
const record=(userId='person-a',extra={})=>({profile:profile(),revision:'r1',identity:{userId,email:userId+'@example.test',role:'viewer'},...extra});
const people=[{id:'person-a',name:'Pessoa Exemplo'},{id:'manager-a',name:'Gestora Exemplo',department:'Logística',jobTitle:'Gerente'},{id:'manager-b',name:'Outro Gestor',department:'Operações'}];
function harness({get,save,managers,onSaved}={}){
 const dom=createDOM(),{document,window}=dom;window.document=document;const requests=[],saved=[],proto=Object.getPrototypeOf(document.body),focus=proto.focus;
 proto.focus=function(){const previous=document.activeElement;if(previous===this)return;previous?.dispatchEvent({type:'focusout',relatedTarget:this});focus.call(this);this.dispatchEvent({type:'focus'});};
 proto.showModal=function(){this.open=true;};proto.close=function(){if(!this.open)return;this.open=false;setImmediate(()=>this.dispatchEvent({type:'close'}));};
 vm.runInNewContext(source,{window,document,console});
 const controller=window.MinervaMemberProfile.mount({getProfile:async id=>{requests.push({method:'GET',id});return get?get(id):record(id);},saveProfile:async(id,payload)=>{requests.push({method:'PUT',id,payload:copy(payload)});return save?save(id,payload):record(id,{profile:profile(payload.profile),revision:'r2'});},getManagers:async()=>{requests.push({method:'DIRECTORY'});return managers?managers():{people:copy(people)};},onSaved:async result=>{saved.push(copy(result));if(onSaved)await onSaved(result);}});
 const dialog=document.querySelector('.member-profile-dialog'),find=selector=>dialog.querySelector(selector),input=key=>dialog.querySelectorAll('input').find(node=>node.name===key),settle=()=>new Promise(resolve=>setImmediate(resolve));
 return{...dom,dialog,controller,requests,saved,find,input,settle,open:(person={id:'person-a',name:'Pessoa Exemplo'})=>controller.open(person),type(key,value){const el=input(key);el.value=value;el.dispatchEvent({type:'input',bubbles:true});},manager(value){const el=find('.member-profile-manager-input input');el.value=value;el.dispatchEvent({type:'input',bubbles:true});},async submit(){find('form').dispatchEvent({type:'submit',preventDefault(){}});await settle();}};
}
test('admin editor loads the requested member, preserves verified email, and saves exactly editable fields with revision',async()=>{
 const h=harness();assert.equal(h.dialog.open,undefined);assert.equal(await h.open(),true);assert.equal(h.dialog.open,true);assert.equal(h.input('name').value,'Pessoa Exemplo');assert.equal(h.input('email').value,'person-a@example.test');assert.equal(h.input('email').readOnly,true);
 h.type('name','Nome Atualizado');h.type('jobTitle','Coordenação');h.input('email').value='forged@example.test';await h.submit();const request=h.requests.find(row=>row.method==='PUT');
 assert.equal(request.id,'person-a');assert.deepEqual(request.payload,{revision:'r1',profile:{name:'Nome Atualizado',employeeId:'EXAMPLE',jobTitle:'Coordenação',department:'Logística',unit:'Unidade Exemplo',managerId:'',managerName:''}});assert.equal(h.saved.length,1);assert.equal(h.saved[0].profile.keepMenuOpen,false);assert.equal(h.saved[0].profile.avatarDataUrl,profile().avatarDataUrl);assert.equal(h.find('.member-profile-status').textContent,'Alterações salvas.');assert.equal(h.input('email').value,'person-a@example.test');
});
test('registered manager search excludes the edited member, handles accents and keeps selection closed after focus returns',async()=>{
 const h=harness();await h.open();const input=h.find('.member-profile-manager-input input');input.focus();assert.equal(h.find('.member-profile-manager-options').querySelectorAll('button').length,2);h.manager('logistica');const choice=h.find('.member-profile-manager-option');assert.equal(choice.querySelector('strong').textContent,'Gestora Exemplo');choice.focus();choice.click();
 assert.equal(h.find('.member-profile-manager-options').hidden,true);assert.equal(input.getAttribute('aria-expanded'),'false');assert.equal(documentActive(h),input);await h.submit();const payload=h.requests.find(row=>row.method==='PUT').payload.profile;assert.equal(payload.managerId,'manager-a');assert.equal(payload.managerName,'');
});
function documentActive(h){return h.document.activeElement;}
test('external manager replaces a registered link and clearing removes both manager fields',async()=>{
 const h=harness({get:id=>record(id,{profile:profile({managerId:'manager-a'})})});await h.open();assert.equal(h.find('.member-profile-manager-input input').value,'Gestora Exemplo');h.manager('Gestor Externo');await h.submit();let payload=h.requests.findLast(row=>row.method==='PUT').payload.profile;assert.equal(payload.managerId,'');assert.equal(payload.managerName,'Gestor Externo');
 h.find('.member-profile-manager-clear').click();await h.submit();payload=h.requests.findLast(row=>row.method==='PUT').payload.profile;assert.equal(payload.managerId,'');assert.equal(payload.managerName,'');assert.equal(h.requests.findLast(row=>row.method==='PUT').payload.revision,'r2');
});
test('conflict preserves draft, blocks repeated saves, and offers explicit reload before the next write',async()=>{
 let latest=false;const h=harness({get:id=>record(id,{profile:profile({name:latest?'Atualizado Por Outra Sessão':'Pessoa Exemplo'}),revision:latest?'r3':'r1'}),save:async()=>{throw Object.assign(Error('Conflict'),{status:409});}});await h.open();h.type('name','Rascunho Local');await h.submit();assert.equal(h.input('name').value,'Rascunho Local');assert.equal(h.find('.member-profile-reload').hidden,false);assert.equal(h.find('.member-profile-save').disabled,true);assert.match(h.find('.member-profile-status').textContent,/outra sessão/);await h.submit();assert.equal(h.requests.filter(row=>row.method==='PUT').length,1);
 latest=true;h.find('.member-profile-reload').click();await h.settle();assert.equal(h.input('name').value,'Atualizado Por Outra Sessão');assert.equal(h.find('.member-profile-save').disabled,false);assert.equal(h.find('.member-profile-reload').hidden,true);
});
test('network error leaves the draft available for retry and never calls onSaved',async()=>{
 let fail=true;const h=harness({save:async(id,payload)=>{if(fail)throw Error('Não foi possível conectar.');return record(id,{profile:profile(payload.profile),revision:'r2'});}});await h.open();h.type('unit','Outra Unidade');await h.submit();assert.equal(h.saved.length,0);assert.equal(h.input('unit').value,'Outra Unidade');assert.equal(h.find('.member-profile-save').disabled,false);assert.equal(h.find('.member-profile-status').classList.contains('is-error'),true);fail=false;await h.submit();assert.equal(h.saved.length,1);assert.equal(h.find('.member-profile-status').classList.contains('is-error'),false);
});
test('closing or resetting clears personal values and suppresses a late member load',async()=>{
 for(const action of [h=>h.find('.member-profile-close').click(),h=>h.controller.reset(),h=>h.window.MinervaMemberProfile.reset()]){let finish;const h=harness({get:()=>new Promise(resolve=>{finish=resolve;})}),pending=h.open();action(h);finish(record());assert.equal(await pending,false);assert.equal(h.dialog.open,false);assert.equal(h.input('name').value,'');assert.equal(h.input('email').value,'');assert.equal(h.find('.member-profile-subtitle').textContent,'Dados Da Pessoa');assert.equal(h.find('.member-profile-status').textContent,'');}
});
test('closing during save invalidates response and notification without blocking the close action',async()=>{
 let finish;const h=harness({save:()=>new Promise(resolve=>{finish=resolve;})});await h.open();h.type('name','Rascunho');const pending=h.submit();assert.equal(h.find('.member-profile-save').disabled,true);assert.equal(h.input('name').disabled,true);assert.equal(h.find('.member-profile-close').disabled,false);h.find('.member-profile-close').click();finish(record('person-a',{profile:profile({name:'Rascunho'}),revision:'r2'}));await pending;assert.equal(h.saved.length,0);assert.equal(h.input('name').value,'');assert.equal(h.dialog.open,false);
});
test('opening another member suppresses stale profile and directory responses, including queued native close events',async()=>{
 let finishProfile,finishDirectory,directories=0;const h=harness({get:id=>id==='person-a'?new Promise(resolve=>{finishProfile=resolve;}):record(id,{profile:profile({name:'Outra Pessoa'})}),managers:()=>++directories===1?new Promise(resolve=>{finishDirectory=resolve;}):{people:[{id:'manager-new',name:'Novo Gestor'}]}});
 const first=h.open();assert.equal(await h.open({id:'person-b',name:'Outra Pessoa'}),true);await h.settle();assert.equal(h.dialog.open,true);finishProfile(record());finishDirectory({people:[{id:'manager-old',name:'Gestor Antigo'}]});assert.equal(await first,false);await h.settle();assert.equal(h.input('name').value,'Outra Pessoa');assert.equal(h.input('email').value,'person-b@example.test');h.find('.member-profile-manager-input input').focus();assert.equal(h.find('.member-profile-manager-options').querySelectorAll('button').length,1);assert.doesNotMatch(h.find('.member-profile-manager-options').textContent,/Antigo/);
});
test('failed initial profile load blocks editing and exposes reload; a mismatched identity never fills the form',async()=>{
 let failed=true;const h=harness({get:async id=>{if(failed)throw Error('Serviço indisponível.');return record(id);}});assert.equal(await h.open(),false);assert.equal(h.find('.member-profile-save').disabled,true);assert.equal(h.input('name').disabled,true);assert.equal(h.find('.member-profile-reload').hidden,false);failed=false;h.find('.member-profile-reload').click();await h.settle();assert.equal(h.input('name').disabled,false);assert.equal(h.input('name').value,'Pessoa Exemplo');
 const wrong=harness({get:async()=>record('other-person')});assert.equal(await wrong.open(),false);assert.equal(wrong.input('email').value,'');assert.match(wrong.find('.member-profile-status').textContent,/confirmar o perfil/);
});
test('manager directory failure remains optional, supports retry, and clears the outdated warning on success',async()=>{
 let fail=true;const h=harness({managers:async()=>{if(fail)throw Error('offline');return{people};}});await h.open();await h.settle();assert.match(h.find('.member-profile-manager-hint').textContent,/Não foi possível/);h.manager('Gestor Externo');await h.submit();assert.equal(h.saved.length,1);fail=false;h.find('.member-profile-manager-input input').focus();await h.settle();assert.doesNotMatch(h.find('.member-profile-manager-hint').textContent,/Não foi possível/);
});
test('abort from the access wrapper closes and clears the editor without showing a previous session error',async()=>{
 const h=harness({save:async()=>{throw Object.assign(Error('Old session data'),{name:'AbortError'});}});await h.open();await h.submit();assert.equal(h.dialog.open,false);assert.equal(h.input('name').value,'');assert.equal(h.find('.member-profile-status').textContent,'');assert.equal(h.saved.length,0);
});
test('rendering uses safe text for member names and manager choices',async()=>{
 const malicious='<img src=x onerror=alert(1)>',h=harness({get:id=>record(id,{profile:profile({name:malicious})}),managers:async()=>({people:[{id:'manager',name:malicious}]})});await h.open();h.find('.member-profile-manager-input input').focus();assert.equal(h.find('.member-profile-subtitle').textContent,malicious);assert.equal(h.find('.member-profile-manager-option strong').textContent,malicious);assert.equal(h.find('img'),null);
});
