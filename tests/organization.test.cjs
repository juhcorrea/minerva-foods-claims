'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {buildOrganization,selectOrganization}=require('../dist/organization.js');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(require.resolve('../dist/organization.js'),'utf8');
const person=(id,name,extra={})=>({id,name,jobTitle:'Analista',department:'Logística',unit:'Unidade Exemplo',managerId:'',managerName:'',...extra});
const sample=()=>[person('a','Gestora Exemplo',{jobTitle:'Gestora'}),person('b','Analista Exemplo',{managerId:'a'}),person('c','Assistente Exemplo',{managerId:'b'}),person('d','Pessoa Externa',{managerName:'Gestor Externo Exemplo'})];
function allPeople(model){const found=[],stack=[...model.groups];while(stack.length){const node=stack.pop();if(node.kind==='person')found.push(node);stack.push(...node.children);assert(found.length<=model.total,'tree must not repeat people or loop');}return found;}
function harness(fetchFn){const dom=createDOM();dom.window.document=dom.document;const host=dom.element('section');vm.runInNewContext(source,{window:dom.window,document:dom.document,console});return{...dom,host,controller:dom.window.MinervaOrganization.mount(host,fetchFn),settle:()=>new Promise(resolve=>setImmediate(resolve))};}

test('stable manager ids form the hierarchy and external managers are excluded from the people total',()=>{
 const model=buildOrganization(sample()),[a,b,c,d]=model.nodes;assert.equal(model.total,4);assert.equal(b.parent,a);assert.equal(c.parent,b);assert.equal(a.parent.name,'Gestor Não Informado');assert.equal(d.parent.external,true);assert.equal(d.parent.count,1);assert.equal(allPeople(model).length,4);assert.equal(model.issueCount,0);
});

test('missing managers remain visible and do not get silently assigned by a matching display name',()=>{
 const model=buildOrganization([person('a','Gestora Exemplo'),person('b','Analista Exemplo',{managerId:'revoked',managerName:'Gestora Exemplo'})]);assert.equal(model.nodes[1].parent.key,'unavailable');assert.deepEqual(model.nodes[1].issues,['Gestor Não Encontrado']);assert.equal(allPeople(model).length,2);
});

test('circular and self-reporting relationships are isolated without losing their non-circular teams',()=>{
 const model=buildOrganization([person('a','Primeira',{managerId:'b'}),person('b','Segunda',{managerId:'a'}),person('c','Terceira',{managerId:'a'}),person('d','Quarta',{managerId:'d'})]);assert.equal(model.total,4);assert.equal(allPeople(model).length,4);assert.equal(model.issueCount,3);assert.equal(model.nodes[2].parent,model.nodes[0]);for(const i of [0,1,3]){assert.equal(model.nodes[i].parent.key,'circular');assert.deepEqual(model.nodes[i].issues,['Vínculo Circular']);}
});

test('ambiguous duplicate ids and malformed entries are displayed for review without guessing a manager',()=>{
 const model=buildOrganization([person('a','Primeira'),person('a','Outra'),person('b','Pessoa Subordinada',{managerId:'a'}),null]);assert.equal(model.total,4);assert.equal(allPeople(model).length,4);assert.equal(model.nodes[2].parent.key,'unavailable');assert.match(model.nodes[2].issues.join(' '),/Duplicada/);assert.equal(model.nodes[3].name,'Nome Não Informado');assert.equal(model.issueCount,4);assert.throws(()=>buildOrganization(null),/inválida/);
});

test('long reporting chains and cycles are processed iteratively',()=>{
 const people=Array.from({length:5000},(_,i)=>person(String(i),'Pessoa '+i,{managerId:i?String(i-1):''})),model=buildOrganization(people);assert.equal(allPeople(model).length,5000);assert.equal(model.groups[0].count,5000);people[0].managerId='4999';const circular=buildOrganization(people);assert.equal(allPeople(circular).length,5000);assert.equal(circular.issueCount,5000);
});

test('search is accent-insensitive and keeps only matching people plus their hierarchy context',()=>{
 const model=buildOrganization(sample()),selection=selectOrganization(model,'assistente logistica');assert.equal(selection.matches.size,1);assert.equal(selection.visible.size,3);assert.equal(selection.matches.has(model.nodes[2]),true);assert.equal(selection.visible.has(model.nodes[3]),false);assert.equal(selectOrganization(model,'não existe').visible.size,0);assert.equal(selectOrganization(model,'').matches.size,4);
});

test('mount waits for refresh and renders total, metadata, safe text and external manager labels',async()=>{
 let calls=0;const people=sample();people[1].name='<img src=x onerror=alert(1)>';people[1].email='not-for-display@example.test';people[1].employeeId='NOT-FOR-DISPLAY';const h=harness(async()=>{calls++;return{people};});assert.equal(calls,0);assert.equal(h.host.querySelector('.org-count').textContent,'—');assert.equal(await h.controller.refresh(),true);assert.equal(calls,1);assert.equal(h.host.querySelector('.org-count').textContent,'4');assert.equal(h.host.querySelectorAll('.org-person').length,4);assert.equal(h.host.querySelector('img'),null);assert(h.host.textContent.includes('<img src=x onerror=alert(1)>'));assert(!h.host.textContent.includes('not-for-display'));assert(!h.host.textContent.includes('NOT-FOR-DISPLAY'));assert(h.host.textContent.includes('Gestor Externo'));assert.equal(h.host.getAttribute('aria-busy'),'false');
});

test('search shows matching count and ancestor context while the grand total stays explicit',async()=>{
 const h=harness(async()=>({people:sample()}));await h.controller.refresh();const input=h.host.querySelector('.org-search');input.value='assistente';input.dispatchEvent({type:'input'});assert.equal(h.host.querySelectorAll('.org-person').length,3);assert.equal(h.host.querySelectorAll('.is-context').length,2);assert.equal(h.host.querySelector('.org-results').textContent,'1 Pessoa Encontrada · 4 Pessoas No Total');assert.equal(h.host.querySelector('.org-count').textContent,'4');input.value='inexistente';input.dispatchEvent({type:'input'});assert(h.host.textContent.includes('Nenhuma Pessoa Encontrada'));assert.equal(h.host.querySelectorAll('.org-person').length,0);
});

test('group and team controls expose expanded state and preserve every person in the DOM',async()=>{
 const h=harness(async()=>({people:sample()}));await h.controller.refresh();const group=h.host.querySelector('.org-group-heading');assert.equal(group.getAttribute('aria-expanded'),'true');group.click();assert.equal(group.getAttribute('aria-expanded'),'false');group.click();assert.equal(group.getAttribute('aria-expanded'),'true');const toggle=h.host.querySelector('.org-toggle');toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'false');toggle.click();assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.equal(h.host.querySelectorAll('.org-person').length,4);
});

test('reset clears personal text and ignores a late request after closing or switching account',async()=>{
 let finish;const h=harness(()=>new Promise(resolve=>{finish=resolve;}));const pending=h.controller.refresh();h.controller.reset();finish({people:sample()});assert.equal(await pending,false);assert.equal(h.host.querySelectorAll('.org-person').length,0);assert.equal(h.host.querySelector('.org-count').textContent,'—');assert(!h.host.textContent.includes('Gestora Exemplo'));assert.equal(h.host.querySelector('.org-search').value,'');assert.equal(h.host.getAttribute('aria-busy'),'false');
});

test('refresh only accepts the latest response and failure never leaves stale personal data',async()=>{
 const finishes=[];const h=harness(()=>new Promise((resolve,reject)=>finishes.push({resolve,reject})));const first=h.controller.refresh(),second=h.controller.refresh();finishes[1].resolve({people:[person('new','Nova Pessoa')]});assert.equal(await second,true);finishes[0].resolve({people:sample()});assert.equal(await first,false);assert(h.host.textContent.includes('Nova Pessoa'));assert(!h.host.textContent.includes('Gestora Exemplo'));const failure=h.controller.refresh();finishes[2].reject(Error('network'));assert.equal(await failure,false);assert.equal(h.host.querySelectorAll('.org-person').length,0);assert(!h.host.textContent.includes('Nova Pessoa'));assert.equal(h.host.querySelector('.org-status').classList.contains('is-error'),true);assert.equal(h.host.querySelector('.org-refresh').disabled,false);
});

test('global reset clears a loaded directory and aborted access does not display an old error',async()=>{
 let revoked=false;const h=harness(async()=>{if(revoked)throw Object.assign(Error('old account'),{name:'AbortError'});return{people:sample()};});await h.controller.refresh();h.window.MinervaOrganization.reset();assert.equal(h.host.querySelectorAll('.org-person').length,0);revoked=true;assert.equal(await h.controller.refresh(),false);assert.equal(h.host.querySelector('.org-status').textContent,'');
});
