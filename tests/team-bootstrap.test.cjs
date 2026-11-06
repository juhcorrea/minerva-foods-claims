'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(path.join(__dirname,'../dist/team.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../dist/index.html'),'utf8');

function harness({layout='current',approved=true,code=source}={}){
  const dom=createDOM(),{document,window}=dom,prototype=Object.getPrototypeOf(document.body);
  const originalInsert=prototype.insertBefore;
  // Match the browser's direct-child constraint instead of silently appending invalid references.
  prototype.insertBefore=function(node,reference){
    if(reference&&reference.parentElement!==this)throw new DOMException('The reference is not a child of this node.','NotFoundError');
    return originalInsert.call(this,node,reference);
  };
  Object.defineProperty(prototype,'firstChild',{get(){return this.children[0]||null;}});
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
  const firstChild=main.firstChild,requests=[],loaded=[];
  window.MINERVA_HOSTED=true;window.setInterval=()=>1;window.clearInterval=()=>{};window.setTimeout=()=>1;window.clearTimeout=()=>{};
  window.MinervaApp={state:{},getOptions:()=>({years:[2026],asOf:'2026-11-06'}),setServerLoader(fn){this.loader=fn;},setPublishedReport(payload){loaded.push(payload);return true;},view(){}};
  class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
  const fetch=async url=>{requests.push(url);return {ok:true,status:200,json:async()=>url==='/api/session'?{authenticated:true,approved,role:'admin',status:approved?'approved':'pending',name:'Pessoa exemplo',userId:'test-person'}:{revision:'test-revision',model:{summary:{}}}};};
  const context={window,document,fetch,CustomEvent,URLSearchParams,AbortController,setTimeout,console};
  vm.runInNewContext(code,context,{filename:'team.js'});
  return {...dom,main,filters,firstChild,requests,loaded,async settled(){await new Promise(resolve=>setImmediate(resolve));}};
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
