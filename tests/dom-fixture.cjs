'use strict';
// Small DOM fixture for progressive enhancements; no browser or operational data.
function createDOM(){
 const listeners=new Map(),frames=[];let activeElement=null;
 const dataName=name=>name.replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this.style={};this.className='';this.id='';this._text='';this.value='';this.selected=false;this.disabled=false;this.hidden=false;this.handlers=new Map();const self=this;this.classList={add(...names){self.className=[...new Set([...self.className.split(/\s+/).filter(Boolean),...names])].join(' ')},remove(...names){self.className=self.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ')},contains(name){return self.className.split(/\s+/).includes(name)},toggle(name,force){const next=force===undefined?!this.contains(name):force;next?this.add(name):this.remove(name);return next;}};}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(value){this.children.forEach(c=>c.parentElement=null);this.children=[];this._text=String(value)}
  get isConnected(){return this===document.body||this===document.documentElement||Boolean(this.parentElement?.isConnected)}
  get options(){return this.tagName==='SELECT'?this.querySelectorAll('option'):undefined}get selectedOptions(){return this.options?.filter(o=>o.selected)}
  append(...nodes){for(const node of nodes){if(node.tagName==='#FRAGMENT'){this.append(...node.children.slice());continue}node.remove();node.parentElement=this;this.children.push(node)}}
  replaceChildren(...nodes){this.children.forEach(c=>c.parentElement=null);this.children=[];this._text='';this.append(...nodes)}
  getBoundingClientRect(){return {left:40,right:300,top:100,bottom:135,width:260,height:35}}
  insertBefore(node,reference){node.remove();node.parentElement=this;const i=this.children.indexOf(reference);this.children.splice(i<0?this.children.length:i,0,node)}
  remove(){if(this.parentElement){this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null}}
  setAttribute(name,value){value=String(value);if(name==='id')this.id=value;else if(name==='class')this.className=value;else if(name.startsWith('data-'))this.dataset[dataName(name.slice(5))]=value;else this.attributes[name]=value}
  getAttribute(name){if(name==='id')return this.id||null;if(name==='class')return this.className||null;if(name.startsWith('data-'))return this.dataset[dataName(name.slice(5))]??null;return this.attributes[name]??null}
  removeAttribute(name){if(name.startsWith('data-'))delete this.dataset[dataName(name.slice(5))];else delete this.attributes[name]}
  hasAttribute(name){return this.getAttribute(name)!==null}
  contains(node){return this===node||this.children.some(c=>c.contains(node))}
  matches(selector){return selector.split(',').some(part=>{part=part.trim();const tag=part.match(/^[a-z][\w-]*/i);if(tag&&this.tagName!==tag[0].toUpperCase())return false;for(const m of part.matchAll(/#([\w-]+)/g))if(this.id!==m[1])return false;for(const m of part.matchAll(/\.([\w-]+)/g))if(!this.classList.contains(m[1]))return false;for(const m of part.matchAll(/\[([\w-]+)(?:(\^?=)["']?([^\]"']*)["']?)?\]/g)){const value=this.getAttribute(m[1]);if(value===null)return false;if(m[2]==='='&&value!==m[3])return false;if(m[2]==='^='&&!value.startsWith(m[3]))return false}return true;})}
  closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null}
  querySelectorAll(selector){const result=[];for(const raw of selector.split(',')){const part=raw.trim();if(part.startsWith(':scope > ')){result.push(...this.children.filter(n=>n.matches(part.slice(9))));continue}const tokens=part.split(/\s+/);const match=n=>{if(!n.matches(tokens.at(-1)))return false;let p=n.parentElement;for(let i=tokens.length-2;i>=0;i--){if(tokens[i]==='>'){i--;if(!p?.matches(tokens[i]))return false;p=p.parentElement}else{while(p&&!p.matches(tokens[i]))p=p.parentElement;if(!p)return false;p=p.parentElement}}return true};const visit=n=>{for(const c of n.children){if(match(c))result.push(c);visit(c)}};visit(this)}return [...new Set(result)]}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null}
  addEventListener(type,fn){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(fn)}
  dispatchEvent(event){event.target??=this;for(const fn of this.handlers.get(event.type)||[])fn(event);if(event.bubbles){if(this.parentElement)this.parentElement.dispatchEvent(event);else document.dispatchEvent(event)}return true}
  focus(){activeElement=this}
  click(){if(!this.disabled)this.dispatchEvent({type:'click',bubbles:true,preventDefault(){}})}
 }
 const document={createElement:tag=>new Element(tag),createDocumentFragment:()=>new Element('#fragment'),get activeElement(){return activeElement},querySelector:s=>document.body.matches(s)?document.body:document.body.querySelector(s),querySelectorAll:s=>document.body.querySelectorAll(s),getElementById:id=>document.querySelector('#'+id),addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},dispatchEvent(event){for(const fn of listeners.get(event.type)||[])fn(event)},body:null,documentElement:null};document.documentElement=new Element('html');document.body=new Element('body');document.documentElement.append(document.body);
 const observers=[];class MutationObserver{constructor(callback){this.callback=callback;observers.push(this)}observe(){this.active=true}disconnect(){this.active=false}}
 const window={MutationObserver,innerWidth:1440,innerHeight:900,addEventListener(){},requestAnimationFrame:fn=>frames.push(fn),setTimeout:fn=>frames.push(fn)};
 const element=(tag,attrs={},parent=document.body)=>{const el=document.createElement(tag);for(const [k,v]of Object.entries(attrs)){if(k==='text')el.textContent=v;else el.setAttribute(k,v)}parent?.append(el);return el};
 return {document,window,element,observers,flush(){let limit=20;while(frames.length&&limit--)frames.shift()();if(frames.length)throw Error('Frame loop')},click(target){document.dispatchEvent({type:'click',target,preventDefault(){}})}};
}
module.exports={createDOM};
