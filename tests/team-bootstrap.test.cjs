'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../dist/team.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');

function harness({layout='current',approved=true,role='admin',responses={},code=source}={}){
  const dom=createDOM(),{document,window}=dom,prototype=Object.getPrototypeOf(document.body);
  const originalInsert=prototype.insertBefore;
  // Match the browser's direct-child constraint instead of silently appending invalid references.
  prototype.insertBefore=function(node,reference){
    if(reference&&reference.parentElement!==this)throw new DOMException('The reference is not a child of this node.','NotFoundError');
    return originalInsert.call(this,node,reference);
  };
  Object.defineProperty(prototype,'firstChild',{get(){return this.children[0]||null;}});
  prototype.showModal=function(){this.open=true;};prototype.close=function(){this.open=false;};
  Object.defineProperty(prototype,'innerHTML',{set(markup){
    this.replaceChildren();const stack=[this],voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
    for(const token of String(markup).matchAll(/<!--[\s\S]*?-->|<\/?([a-z][\w:-]*)\b([^>]*)>|([^<]+)/gi)){
      if(token[0].startsWith('<!--'))continue;
      if(!token[1]){stack.at(-1)._text+=token[3]||'';continue;}
      const tag=token[1].toLowerCase();
      if(token[0].startsWith('</')){for(let i=stack.length-1;i>0;i--)if(stack[i].tagName.toLowerCase()===tag){stack.length=i;break;}continue;}
      const node=document.createElement(tag);
      for(const attr of token[2].matchAll(/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(attr[1],attr[2]??attr[3]??attr[4]??'');
      node.hidden=node.hasAttribute('hidden');stack.at(-1).append(node);
      if(!voidTags.has(tag)&&!token[2].trimEnd().endsWith('/'))stack.push(node);
    }
  }});
  document.body.innerHTML=html.slice(html.indexOf('<body')+html.slice(html.indexOf('<body')).indexOf('>')+1,html.lastIndexOf('</body>'));
  const main=document.querySelector('main'),filters=document.querySelector('.filters-panel');
  if(layout==='direct')main.insertBefore(filters,document.getElementById('globalFilterBlock'));
  if(layout==='outside')document.body.append(filters);
  if(layout==='missing')filters.remove();
  if(layout==='deep'){
    const wrapper=document.createElement('div');filters.parentElement.insertBefore(wrapper,filters);wrapper.append(filters);
  }
  const firstChild=main.firstChild,requests=[],calls=[],loaded=[],downloads=[];
  window.MINERVA_HOSTED=true;window.setInterval=()=>1;window.clearInterval=()=>{};window.setTimeout=()=>1;window.clearTimeout=()=>{};
  window.location={assign(){}};window.confirm=()=>true;
  window.MinervaApp={state:{},getOptions:()=>({years:[2026],asOf:'2026-11-06'}),setServerLoader(fn){this.loader=fn;},setPublishedReport(payload){loaded.push(payload);return true;},view(){}};
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const fetch=async(url,options={})=>{requests.push(url);calls.push({url,options,body:options.body?JSON.parse(options.body):null});const configured=responses[url],result=configured===undefined?url==='/api/session'?{authenticated:true,approved,role,status:approved?'approved':'pending',name:'Pessoa exemplo',userId:'test-person'}:{revision:'test-revision',model:{summary:{}}}:typeof configured==='function'?await configured(options):configured;return typeof result?.json==='function'?result:{ok:true,status:200,json:async()=>result};};
  const context={window,document,fetch,CustomEvent,URLSearchParams,AbortController,setTimeout,console,URL:{createObjectURL(blob){downloads.push(blob);return 'blob:demo';},revokeObjectURL(){}}};
  vm.runInNewContext(code,context,{filename:'team.js'});
  return {...dom,main,filters,firstChild,requests,calls,loaded,downloads,async settled(){await new Promise(resolve=>setImmediate(resolve));}};
}

test('hosted bootstrap initializes with the actual collapsible filters markup and loads the approved report',async()=>{
  const h=harness();await h.settled();const toolbar=h.document.getElementById('teamToolbar'),block=h.document.getElementById('globalFilterBlock');
  assert.equal(h.filters.parentElement,block);assert.equal(toolbar.parentElement,h.main);
  assert.equal(h.main.children.indexOf(toolbar)+1,h.main.children.indexOf(block));
  assert.equal(h.requests[0],'/api/session');assert.equal(h.loaded.length,1);
  assert.equal(h.document.getElementById('teamGate').hidden,true);assert(h.document.body.classList.contains('team-authenticated'));
});

test('regression fixture rejects the previous non-child insertion before the session check',()=>{
  const legacy=source.replace(/    if \(main\) \{\s*\/\/ Filters may be nested[\s\S]*?main\.insertBefore\(toolbar, anchor \|\| main\.firstChild\);\s*\}/,"    if (main) main.insertBefore(toolbar, filters || main.firstChild);");
  assert.notEqual(legacy,source);assert.throws(()=>harness({code:legacy}),{name:'NotFoundError'});
});

for(const layout of ['direct','deep','missing','outside'])test('toolbar insertion supports '+layout+' filters without blocking authentication',async()=>{
  const h=harness({layout});await h.settled();const toolbar=h.document.getElementById('teamToolbar');
  assert.equal(toolbar.parentElement,h.main);assert.equal(h.loaded.length,1);assert.equal(h.document.getElementById('teamGate').hidden,true);
  if(['missing','outside'].includes(layout))assert.equal(h.main.children[1],h.firstChild);
});

test('initialization fix preserves the pending-access gate and never requests the report',async()=>{
  const h=harness({approved:false});await h.settled();
  assert.deepEqual(h.requests,['/api/session']);assert.equal(h.loaded.length,0);assert.equal(h.document.getElementById('teamGate').hidden,false);
  assert.equal(h.document.getElementById('teamGateTitle').textContent,'Seu pedido está aguardando aprovação.');
  assert(h.document.body.classList.contains('team-denied'));
});

for(const role of ['reviewer','viewer','editor','admin'])test('hosted '+role+' has the correct publication, access and correction permissions',async()=>{
 const h=harness({role});await h.settled();const writeBases=['admin','editor'].includes(role),mark=['admin','editor','reviewer'].includes(role);assert.equal(h.loaded.length,1);assert.equal(h.document.getElementById('teamPublish').hidden,!writeBases);assert.equal(h.document.getElementById('teamManage').hidden,role!=='admin');assert.equal(h.document.getElementById('teamDownloadMigration').hidden,role!=='admin');assert.equal(h.document.getElementById('openImports').hidden,!writeBases);assert.equal(h.window.MinervaTeam.getProfile().role,role);
 const call=()=>h.window.MinervaTeam.setCorrectionProgress({key:'synthetic-key',done:true,reportRevision:'test-revision'});if(mark){await call();assert.equal(h.calls.find(call=>call.url==='/api/correction-progress').body.done,true);await h.window.MinervaTeam.setCorrectionProgress({key:'synthetic-key',done:false,reportRevision:'test-revision'});assert.equal(h.calls.at(-1).body.done,false);}else{await assert.rejects(call,/Conferente/);assert(!h.requests.includes('/api/correction-progress'));}
 h.window.MinervaApp.state.bd=[['draft']];await assert.rejects(call,/versão publicada/);if(role==='reviewer')assert(h.document.getElementById('teamRole').textContent.includes('Conferente'));
 const app=fs.readFileSync(require.resolve('../dist/app.js'),'utf8'),guard=app.match(/const canMarkCorrections = ([^;]+);/)[1],context={state:{bd:null,control:null,publishedMeta:{revision:'test-revision'}},window:{MinervaTeam:{getProfile:()=>({role})}}};assert.equal(vm.runInNewContext('('+guard+')()',context),mark);context.state.bd=[];assert.equal(vm.runInNewContext('('+guard+')()',context),false);
});

test('reviewer without a published report receives the waiting view instead of import controls',async()=>{
 const h=harness({role:'reviewer',responses:{'/api/report?years=2026&asOf=2026-11-06&correctionScenario=corrected':{ok:false,status:404,json:async()=>({error:'No report'})}}});await h.settled();assert(h.document.getElementById('teamEmptyRefresh'));assert(h.document.getElementById('emptyState').textContent.includes('Aguarde a publicação'));assert(h.document.getElementById('openImports').hidden);
});

test('administrator can explicitly assign all four profiles while fixed admins and pending approval remain separate',async()=>{
 const roster={admins:[{id:'fixed-admin',name:'Protected admin'}],members:[{id:'pending-person',name:'Pending person',status:'pending'},{id:'member-person',name:'Member person',status:'approved',role:'viewer'},{id:'delegated-admin',name:'Delegated admin',status:'approved',role:'admin'}]},h=harness({responses:{'/api/members':roster}});await h.settled();await h.window.MinervaTeam.openMembers();const find=(id,action)=>h.document.querySelector('[data-member-id="'+id+'"][data-member-action="'+action+'"]');
 assert(!h.document.querySelector('#teamAdminsList [data-member-action]'));assert(find('delegated-admin','role'));assert(find('delegated-admin','revoke'));assert(find('pending-person','approve'));assert(!find('pending-person','role'));
 for(const role of ['reviewer','editor','admin','viewer']){const button=find('member-person','role'),select=button.closest('.team-member-actions').querySelector('select');assert.deepEqual(select.options.map(option=>option.getAttribute('value')),['viewer','reviewer','editor','admin']);select.value=role;button.click();await h.settled();const mutation=h.calls.filter(call=>call.url==='/api/members/member-person/role').at(-1);assert.deepEqual(mutation.body,{role});assert.equal(mutation.options.method,'POST');assert.equal(mutation.options.headers['X-Minerva-Request'],'1');}
 find('pending-person','approve').click();await h.settled();assert.deepEqual(h.calls.find(call=>call.url==='/api/members/pending-person/approve').body,{});assert(!h.calls.some(call=>call.url==='/api/members/pending-person/role'));
});

test('self demotion closes administrative UI and clears the session immediately after the confirmed mutation',async()=>{
 const h=harness({responses:{'/api/members':{admins:[],members:[{id:'test-person',name:'Self admin',status:'approved',role:'admin'}]}}});await h.settled();await h.window.MinervaTeam.openMembers();const button=h.document.querySelector('[data-member-action="role"]');button.closest('.team-member-actions').querySelector('select').value='reviewer';button.click();await h.settled();assert.equal(h.window.MinervaTeam.getProfile(),null);assert(h.document.body.classList.contains('team-denied'));assert.equal(h.document.getElementById('teamMembersDialog').open,false);assert.equal(h.document.getElementById('teamMembersList').textContent,'');await assert.rejects(()=>h.window.MinervaTeam.setCorrectionProgress({}),/Conferente/);
});

test('late backup and publication responses cannot recreate private state after logout',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve),h=harness({responses:{'/api/migration/export':()=>pending}});await h.settled();await h.window.MinervaTeam.openMembers();h.document.getElementById('teamDownloadMigration').click();await h.settled();await h.window.MinervaTeam.logout();release({ok:true,headers:{get:()=> 'application/zip'},blob:async()=>({size:10}),json:async()=>({})});await h.settled();assert.equal(h.downloads.length,0);assert.equal(h.window.MinervaTeam.getProfile(),null);
 let finish;const wait=new Promise(resolve=>finish=resolve),p=harness({responses:{'/api/report':()=>wait}});await p.settled();Object.assign(p.window.MinervaApp.state,{bd:[['draft']],control:[['draft']],model:{},demo:false});const button=p.document.getElementById('teamPublish');button.disabled=false;button.click();await p.settled();await p.window.MinervaTeam.logout();finish({revision:'late-revision'});await p.settled();assert.equal(p.window.MinervaTeam.getProfile(),null);assert.equal(p.window.MinervaApp.state.model,null);assert.equal(p.loaded.length,1);
});

for(const outcome of ['success','denied'])test('a late session poll '+outcome+' cannot replace or deny a newer identity',async()=>{
 const code=source.slice(source.indexOf('  async function checkSessionAccess()'),source.indexOf('  async function api('));
 let resolve,reject;const oldSession={authenticated:true,approved:true,status:'approved',userId:'old-person',role:'admin'},currentSession={...oldSession,userId:'new-person',role:'reviewer'},pending=new Promise((ok,no)=>{resolve=ok;reject=no;}),events=[];
 const context={session:oldSession,sessionVersion:1,sessionCheckInFlight:false,lastSessionCheckAt:0,document:{visibilityState:'visible'},Date,api:()=>pending,isApprovedSession:()=>true,accessStatus:()=> 'approved',lockGate:()=>events.push('gate'),updateProfile:()=>events.push('profile')};
 vm.createContext(context);vm.runInContext(code,context);const poll=context.checkSessionAccess();context.session=currentSession;context.sessionVersion=3;context.sessionCheckInFlight=true;
 if(outcome==='success')resolve(oldSession);else reject(Object.assign(new Error('Old session denied'),{status:403}));
 await poll;assert.equal(context.session,currentSession);assert.equal(context.sessionCheckInFlight,true);assert.deepEqual(events,[]);
});

for(const outcome of ['success','denied'])test('late correction acknowledgement '+outcome+' cannot affect a newly authenticated session',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);let current={authenticated:true,approved:true,status:'approved',userId:'old-reviewer',name:'Old synthetic person',role:'reviewer'};
 const h=harness({responses:{'/api/session':()=>current,'/api/correction-progress':()=>pending}});await h.settled();
 const marking=h.window.MinervaTeam.setCorrectionProgress({key:'synthetic-key',done:true,reportRevision:'same-revision'}).then(result=>({result}),error=>({error}));
 await h.window.MinervaTeam.logout();current={...current,userId:'new-reviewer',name:'New synthetic person'};h.document.getElementById('teamRetrySession').click();await h.settled();assert.equal(h.window.MinervaTeam.getProfile().id,'new-reviewer');
 release(outcome==='success'?{progress:{key:'synthetic-key',done:true}}:{ok:false,status:403,json:async()=>({error:'Old request denied'})});
 const settled=await marking;assert.equal(settled.error?.name,'AbortError');assert.equal(h.window.MinervaTeam.getProfile().id,'new-reviewer');assert.equal(h.document.getElementById('teamGate').hidden,true);assert(h.document.body.classList.contains('team-authenticated'));
});
