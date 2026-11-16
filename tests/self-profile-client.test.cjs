'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/team.js'),'utf8');
const {isApprovedSession}=require('../dist/team.js');
const code=source.slice(source.indexOf('  async function selfProfileRequest(options)'),source.indexOf('  createUI();',source.indexOf('  async function selfProfileRequest(options)')));
const approved=role=>({authenticated:true,approved:true,status:'approved',role,userId:'example-person',name:'Pessoa Exemplo',email:'person@example.test'});
const fields={name:'Nome Do Perfil',employeeId:'EXAMPLE',jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',avatarDataUrl:'',keepMenuOpen:false};
const copy=value=>JSON.parse(JSON.stringify(value));
function harness({role='viewer',respond=async()=>({profile:fields,revision:'r1'})}={}){
 const requests=[],context={session:approved(role),sessionVersion:1,isApprovedSession,api:async(path,options)=>{requests.push({path,options:copy(options||{})});return respond(path,options);}};
 vm.runInNewContext(code,context);
 return{context,requests,get:()=>context.getSelfProfile(),save:payload=>context.saveSelfProfile(payload)};
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
 assert.match(source,/id="teamManage"[^>]*>Usuários e solicitações<\/button>/);
 assert.match(source,/<h2 id="teamMembersTitle">Usuários e solicitações<\/h2>/);
 assert.match(source,/\$\('teamManage'\)\.addEventListener\('click', openMembers\)/);
 assert.match(source,/async function openMembers\(\)\s*\{\s*if \(session\?\.role !== 'admin'\) return;/);
 assert.match(source,/getMaterialInputs, saveMaterialInputs, getSelfProfile, saveSelfProfile, openMembers/);
});
