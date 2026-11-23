'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const {isApprovedSession}=require('../dist/team.js');
const requestStart=source.indexOf('  async function selfProfileRequest(');
assert(requestStart>=0,'Profile request helpers must be present in the client');
const code=source.slice(requestStart,source.indexOf('  createUI();',requestStart));
const approved=role=>({authenticated:true,approved:true,status:'approved',role,userId:'example-person',name:'Pessoa Exemplo',email:'person@example.test'});
const fields={name:'Nome Do Perfil',employeeId:'EXAMPLE',jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',avatarDataUrl:'',keepMenuOpen:false,managerId:'example-manager',managerName:''};
const copy=value=>JSON.parse(JSON.stringify(value));
function harness({role='viewer',respond=async()=>({profile:fields,revision:'r1'})}={}){
 const requests=[],context={session:approved(role),sessionVersion:1,isApprovedSession,api:async(path,options)=>{requests.push({path,options:copy(options||{})});return respond(path,options);}};
 vm.runInNewContext(code,context);
 return{context,requests,get:()=>context.getSelfProfile(),save:payload=>context.saveSelfProfile(payload),managers:()=>context.getProfileManagers(),organization:()=>context.getOrganization(),member:id=>context.getMemberProfile(id),saveMember:(id,payload)=>context.saveMemberProfile(id,payload)};
}
for(const role of ['admin','editor','reviewer','viewer'])test('self profile '+role+' loads and saves without changing access identity',async()=>{
 const h=harness({role}),identity=copy(h.context.session);
 const loaded=await h.get();assert.equal(loaded.revision,'r1');
 await h.save({revision:'r1',profile:{...fields,email:'forged@example.test',role:'admin',userId:'another-person'},identity:{role:'admin'}});
 assert.equal(h.requests[0].path,'/api/profile/self');assert.deepEqual(h.requests[0].options,{});
 assert.equal(h.requests[1].options.method,'PUT');assert.deepEqual(JSON.parse(h.requests[1].options.body),{revision:'r1',profile:fields});
 assert.deepEqual(copy(h.context.session),identity);
});
test('new self profile keeps a null revision and does not invent optional data',async()=>{
 const h=harness();await h.save({profile:{name:'Pessoa'}});
 assert.deepEqual(JSON.parse(h.requests[0].options.body),{revision:null,profile:{name:'Pessoa'}});
});
for(const state of [null,{authenticated:false,approved:false},{...approved('viewer'),status:'pending',approved:false},{...approved('admin'),status:'revoked'},{...approved('viewer'),role:'requester'}])test('unapproved self profile never makes a request: '+String(state?.status||state?.authenticated),async()=>{
 const h=harness();h.context.session=state;
 await assert.rejects(h.get(),/Entre para/);await assert.rejects(h.save({profile:fields}),/Entre para/);assert.equal(h.requests.length,0);
});
for(const [name,change] of [
 ['logout',ctx=>{ctx.session=null;ctx.sessionVersion++;}],
 ['another account',ctx=>{ctx.session={...ctx.session,userId:'other-person'};}],
 ['role change',ctx=>{ctx.session={...ctx.session,role:'admin'};}],
 ['revocation',ctx=>{ctx.session={...ctx.session,approved:false,status:'revoked'};}],
 ['new session',ctx=>{ctx.sessionVersion++;}]
])for(const operation of ['get','save'])test('ignores '+operation+' response after '+name,async()=>{
 let finish;const h=harness({respond:()=>new Promise(resolve=>{finish=resolve;})});
 const pending=operation==='get'?h.get():h.save({revision:'r1',profile:fields});change(h.context);finish({profile:fields,revision:'r2'});
 await assert.rejects(pending,error=>error.name==='AbortError');
});
test('conflict and connection errors stay actionable for the current account',async()=>{
 for(const problem of [Object.assign(new Error('Atualize o perfil antes de salvar.'),{status:409,code:'PROFILE_CONFLICT'}),Object.assign(new Error('Confira sua conexão.'),{network:true})]){
  const h=harness({respond:async()=>{throw problem;}});await assert.rejects(h.save({profile:fields}),error=>error===problem);
 }
});
test('an error belonging to a previous session never leaks into the new account',async()=>{
 let fail;const h=harness({respond:()=>new Promise((_,reject)=>{fail=reject;})});const pending=h.get();h.context.sessionVersion++;fail(new Error('Old profile failed'));
 await assert.rejects(pending,error=>error.name==='AbortError'&&!error.message.includes('Old profile'));
});
test('users and requests retain existing management identity and handlers',()=>{
 assert.match(source,/id="teamManage"[^>]*>Usuários E Solicitações<\/button>/);
 assert.match(source,/<h2 id="teamMembersTitle">Usuários E Solicitações<\/h2>/);
 assert.match(source,/\$\('teamManage'\)\.addEventListener\('click', openMembers\)/);
 assert.match(source,/async function openMembers\(\)\s*\{\s*if \(session\?\.role !== 'admin'\) return;/);
 assert.match(source,/getMaterialInputs, saveMaterialInputs, getSelfProfile, saveSelfProfile, getProfileManagers, getOrganization, openMembers/);
});
for(const role of ['admin','editor','reviewer','viewer'])test('approved '+role+' can retrieve the manager directory without requesting the organization chart',async()=>{
 const people=[{id:'example-manager',name:'Gestor Exemplo'}],h=harness({role,respond:async()=>({people})});assert.deepEqual(await h.managers(),{people});assert.deepEqual(h.requests,[{path:'/api/profile/managers',options:{}}]);
});
test('organization chart uses its separate admin endpoint and never mutates session identity',async()=>{
 const nodes=[{id:'example-person',managerId:'example-manager'}],h=harness({role:'admin',respond:async()=>({nodes})}),identity=copy(h.context.session);
 assert.deepEqual(await h.organization(),{nodes});assert.deepEqual(h.requests,[{path:'/api/organization',options:{}}]);assert.deepEqual(copy(h.context.session),identity);
});
for(const role of ['editor','reviewer','viewer'])test('organization chart is blocked before any request for '+role,async()=>{
 const h=harness({role});await assert.rejects(h.organization(),/Apenas administradores/);assert.equal(h.requests.length,0);
});
for(const session of [null,{authenticated:false}, {...approved('admin'),status:'pending',approved:false}, {...approved('admin'),status:'revoked'}])test('unapproved directory and chart requests never leave the client: '+String(session?.status||session?.authenticated),async()=>{
 const h=harness();h.context.session=session;await assert.rejects(h.managers());await assert.rejects(h.organization());assert.equal(h.requests.length,0);
});
for(const operation of ['managers','organization'])for(const [name,change] of [
 ['account switch',ctx=>{ctx.session={...ctx.session,userId:'other-person'};}],
 ['role change',ctx=>{ctx.session={...ctx.session,role:'viewer'};}],
 ['logout',ctx=>{ctx.session=null;ctx.sessionVersion++;}]
])test('late '+operation+' result is discarded after '+name,async()=>{
 let finish;const h=harness({role:'admin',respond:()=>new Promise(resolve=>{finish=resolve;})}),pending=h[operation]();change(h.context);finish({people:[{id:'example-manager'}]});await assert.rejects(pending,error=>error.name==='AbortError');
});
test('manager save permits an external name and an explicit cleared link without accepting access fields',async()=>{
 const h=harness();await h.save({revision:'r1',profile:{managerId:'',managerName:'Gestor Externo',role:'admin',email:'forged@example.test'}});await h.save({revision:'r2',profile:{managerId:'',managerName:''}});
 assert.deepEqual(JSON.parse(h.requests[0].options.body),{revision:'r1',profile:{managerId:'',managerName:'Gestor Externo'}});assert.deepEqual(JSON.parse(h.requests[1].options.body),{revision:'r2',profile:{managerId:'',managerName:''}});
});

for(const role of ['editor','reviewer','viewer'])test('member profile blocked before request for '+role,async()=>{
 const h=harness({role});await assert.rejects(h.member('other'),/Apenas administradores/);await assert.rejects(h.saveMember('other',{profile:fields}));assert.equal(h.requests.length,0);
});
test('admin member edit transmits only editable data and preserves target encoding',async()=>{
 const h=harness({role:'admin'}),identity=copy(h.context.session);await h.member('other/person');await h.saveMember('other/person',{revision:'r1',profile:{...fields,role:'admin',email:'forged@example.test'}});
 assert.equal(h.requests[0].path,'/api/profile/member?userId=other%2Fperson');const expected=copy(fields);delete expected.keepMenuOpen;
 assert.deepEqual(JSON.parse(h.requests[1].options.body),{revision:'r1',profile:expected});assert.deepEqual(copy(h.context.session),identity);
});
for(const operation of ['member','saveMember'])test('late admin '+operation+' response is discarded on access change',async()=>{
 let finish;const h=harness({role:'admin',respond:()=>new Promise(resolve=>{finish=resolve;})}),pending=operation==='member'?h.member('other'):h.saveMember('other',{profile:fields});h.context.session={...h.context.session,role:'viewer'};finish({profile:fields,revision:'r2'});await assert.rejects(pending,error=>error.name==='AbortError');
});
test('member editor rejects empty target and remains separate from permissions',async()=>{
 const h=harness({role:'admin'});await assert.rejects(h.member(''),/Selecione/);assert.equal(h.requests.length,0);
 assert.match(source,/data-edit-member-profile/);assert.match(source,/memberProfileView\?\.reset\(\)/);assert.match(source,/getProfile:getMemberProfile,saveProfile:saveMemberProfile/);
});

test('admin photo payload supports replace and remove without transmitting navigation preference',async()=>{
 const h=harness({role:'admin'});for(const avatarDataUrl of ['data:image/jpeg;base64,/9j/2Q==',''])await h.saveMember('other',{revision:'r-photo',profile:{...fields,avatarDataUrl,keepMenuOpen:false}});
 assert.equal(JSON.parse(h.requests[0].options.body).profile.avatarDataUrl,'data:image/jpeg;base64,/9j/2Q==');assert.equal(JSON.parse(h.requests[1].options.body).profile.avatarDataUrl,'');assert(!Object.hasOwn(JSON.parse(h.requests[0].options.body).profile,'keepMenuOpen'));
});
test('old admin payload does not introduce an empty photo when omitted',async()=>{
 const h=harness({role:'admin'}),profile={...fields};delete profile.avatarDataUrl;await h.saveMember('other',{revision:'r-photo',profile});assert(!Object.hasOwn(JSON.parse(h.requests[0].options.body).profile,'avatarDataUrl'));
});

test('organization visibility is transmitted only by the admin editor and retains explicit false',async()=>{
 const h=harness({role:'admin'});
 for(const showInOrganization of [false,true])await h.saveMember('other',{profile:{...fields,showInOrganization}});
 assert.equal(JSON.parse(h.requests[0].options.body).profile.showInOrganization,false);assert.equal(JSON.parse(h.requests[1].options.body).profile.showInOrganization,true);
 await h.saveMember('other',{profile:fields});assert(!Object.hasOwn(JSON.parse(h.requests[2].options.body).profile,'showInOrganization'));
 await h.save({profile:{...fields,showInOrganization:false}});assert(!Object.hasOwn(JSON.parse(h.requests[3].options.body).profile,'showInOrganization'));
});
