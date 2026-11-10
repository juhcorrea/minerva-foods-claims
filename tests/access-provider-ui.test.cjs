'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{createDOM}=require('./dom-fixture.cjs');
const html=fs.readFileSync(require.resolve('../dist/access.html'),'utf8'),source=fs.readFileSync(require.resolve('../dist/access.js'),'utf8');
const accessSession=(changes={})=>({authProvider:'cloudflare-access',provider:'cloudflare-access',authenticated:true,approved:false,status:'unregistered',role:'requester',verifiedEmail:'viewer@example.test',...changes});
function harness({session=accessSession(),hash='',responses={}}={}){
  const {document,element}=createDOM(),requests=[],redirects=[],timers=[],replacements=[];
  for(const match of html.matchAll(/<([a-z][\w-]*)\b[^>]*\bid="([^"]+)"[^>]*>/gi)){
    const node=element(match[1],{id:match[2]});node.hidden=/\bhidden\b/.test(match[0]);
  }
  const location={hash,pathname:'/acesso',search:'',replace:path=>redirects.push({method:'replace',path}),assign:path=>redirects.push({method:'assign',path})};
  const history={replaceState(_state,_title,url){replacements.push(url);location.hash='';}};
  const fetch=async(path,options)=>{requests.push({path,options,body:options.body?JSON.parse(options.body):null});const value=responses[path]??(path==='/api/session'?session:{});const answer=typeof value==='function'?await value():value;if(answer instanceof Error)throw answer;return {ok:answer.httpStatus==null||answer.httpStatus<400,status:answer.httpStatus||200,json:async()=>answer};};
  vm.runInNewContext(source,{document,location,history,fetch,URLSearchParams,setInterval:fn=>{timers.push(fn);return timers.length;}});
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {document,requests,redirects,timers,replacements,location,settle,$:id=>document.getElementById(id),async submit(){document.getElementById('requestForm').dispatchEvent({type:'submit',preventDefault(){}});await settle();},async click(id){const node=document.getElementById(id);node.dispatchEvent({type:'click',currentTarget:node,preventDefault(){}});await settle();}};
}
test('Access verifies the provider before discarding legacy activation and accepts only a requested name',async()=>{
  const h=harness({hash:'#ativar=legacy-demo-token',responses:{'/api/auth/request':accessSession({status:'pending',name:'Viewer QA'})}});await h.settle();
  assert.equal(h.requests[0].path,'/api/session');assert.equal(h.location.hash,'');assert.deepEqual(h.replacements,['/acesso']);
  assert.equal(h.$('accessActivate').hidden,true);assert.equal(h.$('accessRequest').hidden,false);assert.equal(h.$('legacyAdminHelp').hidden,true);
  assert.equal(h.$('requestEmail').value,'viewer@example.test');assert.equal(h.$('requestEmail').readOnly,true);assert.equal(h.$('requestEmail').required,true);
  h.$('requestName').value=' Viewer QA ';h.$('requestEmail').value='forged@example.test';await h.submit();
  assert.deepEqual(h.requests.find(request=>request.path==='/api/auth/request').body,{name:'Viewer QA'});assert.equal(h.$('accessPending').hidden,false);assert.equal(h.$('pendingCode').textContent,'viewer@example.test');
  assert.match(h.$('pendingScope').textContent,/qualquer aparelho/);assert.match(h.$('pendingCodeLabel').textContent,/E-MAIL/);
  await h.click('activateButton');assert(!h.requests.some(request=>request.path==='/api/auth/exchange'));
});
test('Access anonymous and revoked states never expose a legacy admin flow or infer authorization from email',async()=>{
  const anonymous=harness({session:accessSession({authenticated:false,verifiedEmail:null,status:'anonymous'}),hash:'#ativar=legacy-demo-token'});await anonymous.settle();
  assert.equal(anonymous.$('accessIdentity').hidden,false);assert.equal(anonymous.$('accessRequest').hidden,true);assert.equal(anonymous.$('legacyAdminHelp').hidden,true);assert.equal(anonymous.redirects.length,0);
  const revoked=harness({session:accessSession({status:'revoked',email:'admin@example.test'})});await revoked.settle();assert.equal(revoked.$('accessRevoked').hidden,false);assert.equal(revoked.redirects.length,0);
  const pending=harness({session:accessSession({status:'pending',email:'admin@example.test',name:'Admin-looking label'})});await pending.settle();assert.equal(pending.$('accessPending').hidden,false);assert.equal(pending.redirects.length,0);
  const admin=harness({session:accessSession({status:'approved',approved:true,role:'admin',verifiedEmail:'unlisted@example.test'})});await admin.settle();assert.deepEqual(admin.redirects,[{method:'replace',path:'/'}]);
});
test('Access pending approval is refreshed by the server and works without a browser code',async()=>{
  let approved=false;const h=harness({responses:{'/api/session':()=>accessSession({status:approved?'approved':'pending',approved,role:approved?'viewer':'requester',requestCode:'LEGACY-CODE',name:'Viewer QA'})}});await h.settle();
  assert.equal(h.$('pendingCode').textContent,'viewer@example.test');assert(!h.$('pendingInstructions').textContent.includes('código'));
  approved=true;h.timers[0]();await h.settle();assert.deepEqual(h.redirects,[{method:'replace',path:'/'}]);
});
test('legacy Sites activation and per-browser contact requests remain available after provider detection',async()=>{
  const legacy={authenticated:false,approved:false,status:'anonymous'},activated=harness({session:legacy,hash:'#ativar=legacy-demo-token'});await activated.settle();
  assert.equal(activated.$('accessActivate').hidden,false);assert.equal(activated.$('legacyAdminHelp').hidden,false);await activated.click('activateButton');
  assert.deepEqual(activated.requests.find(request=>request.path==='/api/auth/exchange').body,{token:'legacy-demo-token'});assert.deepEqual(activated.redirects,[{method:'replace',path:'/'}]);
  const h=harness({session:legacy,responses:{'/api/auth/request':{authenticated:true,approved:false,status:'pending',role:'requester',name:'Viewer QA',requestCode:'QA-CODE'}}});await h.settle();
  assert.equal(h.$('requestEmail').readOnly,false);h.$('requestName').value='Viewer QA';h.$('requestEmail').value='contact@example.test';await h.submit();
  assert.deepEqual(h.requests.at(-1).body,{name:'Viewer QA',email:'contact@example.test'});assert.equal(h.$('pendingCode').textContent,'QA-CODE');assert.match(h.$('pendingScope').textContent,/novo acesso/);
});
test('network failure cannot enable an unverified activation and offers an explicit retry',async()=>{
  let failed=true;const h=harness({hash:'#ativar=legacy-demo-token',responses:{'/api/session':()=>{if(failed)throw Error('Connection unavailable');return {authenticated:false,status:'anonymous'};}}});await h.settle();
  assert.equal(h.$('accessLoading').hidden,false);assert.equal(h.$('retrySession').hidden,false);assert.equal(h.$('accessActivate').hidden,true);
  failed=false;await h.click('retrySession');assert.equal(h.$('accessActivate').hidden,false);
});
test('account switching accepts only the exact same-origin Access logout endpoint',async()=>{
  for(const [logoutUrl,expected] of [['/cdn-cgi/access/logout','/cdn-cgi/access/logout'],['https://external.example/logout','/'],['//external.example','/'],['/cdn-cgi/access/logout?redirect=//external.example','/']]){
    const h=harness({responses:{'/api/auth/logout':{logoutUrl}}});await h.settle();await h.click('changeAccessAccount');assert.deepEqual(h.redirects,[{method:'assign',path:expected}]);
    assert.equal(h.requests.at(-1).options.method,'POST');assert.equal(h.requests.at(-1).options.credentials,'same-origin');
  }
});
test('Access markup retains the official logo and no named administrator or client-side admin allowlist',()=>{
  assert.match(html,/class="logo" src="\/assets\/minerva-logo\.png"/);assert(!/Owner|Developer|@minervafoods/i.test(html+source));assert.match(html,/Acesso gerenciado pelas administradoras/);
});

const teamSource=fs.readFileSync(require.resolve('../dist/team.js'),'utf8'),{logoutDestination}=require('../dist/team.js');
test('team logout clears the report before safe Access or legacy navigation',async()=>{
  const code=teamSource.slice(teamSource.indexOf('  async function logout(event)'),teamSource.indexOf('  async function copyLink()'));
  for(const [result,expected] of [[{},'/'],[{logoutUrl:'/cdn-cgi/access/logout'},'/cdn-cgi/access/logout'],[{logoutUrl:'https://external.example'},'/']]){
    const calls=[],button={disabled:false},context={logoutDestination,api:async(path,options)=>{calls.push({path,options});return result;},lockGate:()=>calls.push('locked'),global:{location:{assign:path=>calls.push(path)}},setMessage(){},$:()=>null};vm.runInNewContext(code,context);await context.logout({currentTarget:button});
    assert.equal(calls[0].path,'/api/auth/logout');assert.equal(calls[0].options.method,'POST');assert.deepEqual(calls.slice(1),['locked',expected]);
  }
});
