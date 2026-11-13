'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../dist/materials.js'),'utf8'),data=require('../dist/materials-data.js');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const model={meta:{asOf:'2026-11-13',years:[2026]},executiveReport:{controlClaims:[]}};
const documentValue=(value,revision='r1')=>({revision,periods:{2026:{containerTotal:value,containerFrozen:null,containerChilled:null,containerDry:null,freightUsd:null,note:'',agreements:{}}}});
function fixture(){
 let profile={id:'user-a',email:'a@example.test',role:'admin'},printCalls=0;const listeners=new Map(),reads=[],writes=[],elements=new Map();
 const element=()=>({innerHTML:'',isConnected:true,classList:{add(){},remove(){}},querySelectorAll:()=>[],remove(){this.isConnected=false;if(this.id)elements.delete(this.id);}});
 for(const id of ['materialsDirectors','materialsCarriers'])elements.set(id,element());
 const document={getElementById:id=>elements.get(id)||null,addEventListener:(name,handler)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(handler);},fonts:{ready:Promise.resolve()},createElement:()=>element(),body:{classList:{add(){},remove(){}},append(node){elements.set(node.id,node);}}};
 const context={document,MINERVA_HOSTED:true,MinervaMaterialsData:data,MinervaEngine:{today:()=> '2026-11-13'},MinervaMultiSelect:{refresh(){},close(){}},MinervaTeam:{getProfile:()=>profile,getMaterialInputs:()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),saveMaterialInputs:payload=>new Promise((resolve,reject)=>writes.push({payload,resolve,reject}))},structuredClone,Intl,Set,Map,Date,Number,String,Object,Array,Math,JSON,console,print:()=>printCalls++,addEventListener(){}};
 context.window=context;vm.createContext(context);vm.runInContext(source,context);
 const dispatch=(name,event={})=>{for(const handler of listeners.get(name)||[])handler(event);};
 const saveForm=()=>{const button={disabled:false},values={containerTotal:{value:'900001'},containerFrozen:{value:''},containerChilled:{value:''},containerDry:{value:''},freightUsd:{value:''},note:{value:'A note'}};const form={elements:{namedItem:name=>values[name]},querySelector:()=>button,querySelectorAll:()=>[],closest:selector=>selector==='[data-material-inputs]'?form:null};dispatch('submit',{target:form,preventDefault(){}});};
 return {api:context.MinervaMaterials,context,reads,writes,dispatch,saveForm,render:()=>context.MinervaMaterials.render(model,'directors'),html:()=>elements.get('materialsDirectors').innerHTML,setProfile(value){profile=value;dispatch('minerva:session-updated',{detail:value});},printed:()=>printCalls};
}

test('late reads cannot restore manual information after logout or replace the new user response',async()=>{
 const f=fixture();f.render();assert.equal(f.reads.length,1);f.setProfile(null);assert.equal(f.html(),'');
 f.setProfile({id:'user-b',email:'b@example.test',role:'admin'});f.render();assert.equal(f.reads.length,2);
 f.reads[1].resolve(documentValue(7777,'new'));await turn();assert.match(f.html(),/7\.777/);
 f.reads[0].resolve(documentValue(882244,'old'));await turn();assert.doesNotMatch(f.html(),/882\.244/);assert.match(f.html(),/7\.777/);
});

test('session checks for the same identity preserve loaded information and do not reload the editor',async()=>{
 const f=fixture();f.render();f.reads[0].resolve(documentValue(4321));await turn();const html=f.html();
 assert.match(html,/data-placeholder="Todos Os Meses"/);for(const [index,name]of ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'].entries())assert(html.includes('<option value="'+(index+1)+'">'+name+'</option>'));assert.doesNotMatch(html,/>Jan<|>Fev<|>Nov</);
 f.setProfile({id:'user-a',email:'a@example.test',role:'admin'});await turn();assert.equal(f.reads.length,1);assert.equal(f.html(),html);
});

test('viewer cannot submit manual inputs and an admin save resolving after a role change is discarded',async()=>{
 const f=fixture();f.render();f.reads[0].resolve(documentValue(100));await turn();f.saveForm();assert.equal(f.writes.length,1);
 f.setProfile({id:'user-a',email:'a@example.test',role:'viewer'});assert.equal(f.reads.length,2);assert.doesNotMatch(f.html(),/data-material-inputs/);
 f.reads[1].resolve(documentValue(200,'viewer'));await turn();f.writes[0].resolve(documentValue(900001,'late-admin'));await turn();assert.doesNotMatch(f.html(),/900\.001/);assert.doesNotMatch(f.html(),/data-material-inputs/);
 f.saveForm();assert.equal(f.writes.length,1);
});

test('logout clears pending print content and prevents printing after fonts finish loading',async()=>{
 const f=fixture();f.render();f.reads[0].resolve(documentValue(100));await turn();let resolveFont;f.context.document.fonts.ready=new Promise(resolve=>resolveFont=resolve);
 const pending=f.api.exportPdf('directors');assert(f.context.document.getElementById('materialsPrintRoot'));f.setProfile(null);assert.equal(f.context.document.getElementById('materialsPrintRoot'),null);resolveFont();await pending;assert.equal(f.printed(),0);
});

test('PDF and Excel cannot export before shared inputs load or after a load failure, and retry succeeds',async()=>{
 const f=fixture();let excelCalls=0;f.context.XLSX={...require('../dist/vendor/xlsx.full.min.js'),writeFile:()=>excelCalls++};f.render();
 await f.api.exportPdf();f.api.exportExcel();assert.equal(f.printed(),0);assert.equal(excelCalls,0);assert.equal(f.context.document.getElementById('materialsPrintRoot'),null);assert.match(f.html(),/Aguarde o carregamento/);
 f.reads[0].reject(Error('Falha de conexão'));await turn();await f.api.exportPdf();f.api.exportExcel();assert.equal(f.printed(),0);assert.equal(excelCalls,0);assert.match(f.html(),/Falha de conexão/);assert.equal(f.reads.length,2);
 f.reads[1].resolve(documentValue(150));await turn();await f.api.exportPdf();f.api.exportExcel();assert.equal(f.printed(),1);assert.equal(excelCalls,1);
});
