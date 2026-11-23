'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {cropGeometry,zoomGeometry,rasterDataUrl,validateSource,MAX_FILE,MAX_AVATAR}=require('../dist/photo-cropper.js');
const {createDOM}=require('./dom-fixture.cjs');
const source=fs.readFileSync(require.resolve('../dist/photo-cropper.js'),'utf8');
const jpegBytes=Uint8Array.from([255,216,255,224,0,0,0,0,255,217]);
const jpeg='data:image/jpeg;base64,'+Buffer.from(jpegBytes).toString('base64');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const webp='data:image/webp;base64,'+Buffer.from('RIFF0000WEBPVP8 0000').toString('base64');
const file=(extra={})=>({type:'image/png',size:1000,...extra});
const closeEnough=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,actual+' != '+expected);
function harness({autoLoad=true,deferExport=false,deferBuffer=false,dimensions=[800,400],blobSize=jpegBytes.length,blobType='image/jpeg',output=jpegBytes}={}){
 const dom=createDOM(),{document,window}=dom,proto=Object.getPrototypeOf(document.body),create=document.createElement,images=[],canvases=[],draws=[],fills=[],revoked=[],exports=[],buffers=[],urls=[];
 window.document=document;window.atob=atob;window.btoa=btoa;window.URL={createObjectURL(source){const url='blob:synthetic-'+urls.length;urls.push({url,source});return url;},revokeObjectURL:url=>revoked.push(url)};
 proto.showModal=function(){this.open=true;};proto.close=function(){if(!this.open)return;this.open=false;setImmediate(()=>this.dispatchEvent({type:'close'}));};proto.setPointerCapture=function(id){this.captured=id;};proto.releasePointerCapture=function(id){this.captured=null;this.dispatchEvent({type:'lostpointercapture',pointerId:id});};
 document.createElement=tag=>{
  const element=create(tag);
  if(tag==='img'){images.push(element);element.naturalWidth=dimensions[0];element.naturalHeight=dimensions[1];Object.defineProperty(element,'src',{set(value){this.imageSource=value;if(autoLoad)setImmediate(()=>this.onload?.());},get(){return this.imageSource;}});}
  if(tag==='canvas'){
   canvases.push(element);element.getContext=()=>({set fillStyle(value){element.fill=value;},fillRect(...args){fills.push(args);},drawImage(...args){draws.push(args);}});
   element.toBlob=(callback,type,quality)=>{element.outputType=type;element.quality=quality;const blob={type:blobType,size:blobSize,arrayBuffer:()=>deferBuffer?new Promise(resolve=>buffers.push(resolve)):Promise.resolve(Uint8Array.from(output).buffer)};exports.push({callback,blob});if(!deferExport)setImmediate(()=>callback(blob));};
  }
  return element;
 };
 vm.runInNewContext(source,{window,document,console,Uint8Array});const controller=window.MinervaPhotoCropper.create(),dialog=document.querySelector('.photo-cropper-dialog'),find=selector=>dialog.querySelector(selector),stage=find('.photo-cropper-stage');stage.getBoundingClientRect=()=>({width:280,height:280});
 const settle=()=>new Promise(resolve=>setImmediate(resolve)),event=(node,type,values={})=>node.dispatchEvent({type,preventDefault(){this.prevented=true;},stopPropagation(){},...values});
 return{...dom,controller,dialog,find,stage,images,canvases,draws,fills,revoked,exports,buffers,urls,settle,event,zoom(value){find('.photo-cropper-zoom').value=String(value);event(find('.photo-cropper-zoom'),'input');},key(key,extra={}){event(stage,'keydown',{key,...extra});},use(){find('.photo-cropper-use').click();}};
}

test('portrait and landscape cover geometry starts centered without blank edges',()=>{
 const landscape=cropGeometry(800,400);assert.equal(landscape.displayWidth,560);assert.equal(landscape.displayHeight,280);closeEnough(landscape.sourceX,200);closeEnough(landscape.sourceY,0);closeEnough(landscape.sourceSize,400);
 const portrait=cropGeometry(400,800);assert.equal(portrait.displayWidth,280);assert.equal(portrait.displayHeight,560);closeEnough(portrait.sourceX,0);closeEnough(portrait.sourceY,200);closeEnough(portrait.sourceSize,400);
});

test('zoom and extreme pan offsets always clamp the crop inside source bounds',()=>{
 for(const [width,height] of [[800,400],[400,800],[100,100],[1,40000],[3500,700]])for(const zoom of [-5,1,1.1,2,4,10])for(const x of [-10000,-25,0,25,10000])for(const y of [-10000,0,10000]){
  const g=cropGeometry(width,height,zoom,x,y);assert(g.zoom>=1&&g.zoom<=4);assert(g.sourceX>=0&&g.sourceY>=0);assert(g.sourceX+g.sourceSize<=width+1e-7);assert(g.sourceY+g.sourceSize<=height+1e-7);assert(g.displayWidth/2-g.x>=140-1e-7);assert(g.displayWidth/2+g.x>=140-1e-7);assert(g.displayHeight/2-g.y>=140-1e-7);assert(g.displayHeight/2+g.y>=140-1e-7);
 }
});

test('zoom preserves the chosen source center and invalid geometry is rejected',()=>{
 const before=cropGeometry(800,400,2,70,35),after=zoomGeometry(800,400,before,3);closeEnough(before.sourceX+before.sourceSize/2,after.sourceX+after.sourceSize/2);closeEnough(before.sourceY+before.sourceSize/2,after.sourceY+after.sourceSize/2);
 for(const pair of [[0,10],[-1,10],[NaN,10],[Infinity,10],[10,0]])assert.throws(()=>cropGeometry(...pair),/dimensões/);
});

test('source validation accepts bounded raster files and canonical existing photos only',()=>{
 for(const type of ['image/jpeg','image/png','image/webp'])assert.equal(validateSource(file({type,size:MAX_FILE})),'file');
 for(const input of [file({type:'image/svg+xml'}),file({size:MAX_FILE+1}),file({size:0}),file({size:-1}),null])assert.throws(()=>validateSource(input),/JPG, PNG ou WebP/);
 for(const url of [png,jpeg,webp]){assert.equal(rasterDataUrl(url),true);assert.equal(validateSource(url),'data');}
 for(const url of ['https://example.test/photo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/jpeg;base64,AAAA',png.replace('image/png','image/jpeg'),png+'\n','data:image/png;base64,'+'A'.repeat(700000)]){assert.equal(rasterDataUrl(url),false);assert.throws(()=>validateSource(url),/válida/);}
});

test('opening a photo never exports until Use Photo and exports the selected crop as a 384px JPEG',async()=>{
 const h=harness(),pending=h.controller.open(file());assert.equal(h.dialog.open,true);assert.equal(h.find('.photo-cropper-use').disabled,true);await h.settle();assert.equal(h.find('.photo-cropper-use').disabled,false);assert.equal(h.exports.length,0);assert.equal(h.document.activeElement,h.stage);h.zoom(2);h.event(h.stage,'pointerdown',{pointerId:1,clientX:100,clientY:100,button:0});h.event(h.stage,'pointermove',{pointerId:1,clientX:170,clientY:135});h.event(h.stage,'pointerup',{pointerId:1});assert.equal(h.stage.captured,null);h.use();assert.equal(await pending,jpeg);assert.equal(h.dialog.open,false);assert.equal(h.canvases[0].width,384);assert.equal(h.canvases[0].height,384);assert.equal(h.canvases[0].outputType,'image/jpeg');assert.equal(h.canvases[0].quality,0.9);assert.equal(h.canvases[0].fill,'#ffffff');assert.deepEqual(h.fills[0],[0,0,384,384]);
 const expected=cropGeometry(800,400,2,70,35),draw=h.draws[0];closeEnough(draw[1],expected.sourceX);closeEnough(draw[2],expected.sourceY);closeEnough(draw[3],expected.sourceSize);assert.deepEqual(draw.slice(5),[0,0,384,384]);assert.deepEqual(h.revoked,['blob:synthetic-0']);assert.equal(h.find('img'),null);
});

test('keyboard zoom and pan work and Center resets both framing and zoom',async()=>{
 const h=harness(),pending=h.controller.open(png);await h.settle();h.key('+');assert.equal(h.find('.photo-cropper-zoom-value').textContent,'110%');h.key('ArrowRight');assert.notEqual(h.find('img').style.transform,'translate(-308px,-154px)');h.zoom(4);h.key('ArrowUp',{shiftKey:true});h.find('.photo-cropper-center').click();assert.equal(h.find('.photo-cropper-zoom').value,'1');assert.equal(h.find('.photo-cropper-zoom-value').textContent,'100%');h.key('-');assert.equal(h.find('.photo-cropper-zoom').value,'1');h.use();assert.equal(await pending,jpeg);closeEnough(h.draws[0][1],200);closeEnough(h.draws[0][2],0);closeEnough(h.draws[0][3],400);assert.equal(h.urls.length,0);
});

test('Cancel resolves null immediately during loading and late decoding cannot restore the old image',async()=>{
 const h=harness({autoLoad:false}),pending=h.controller.open(file());h.controller.cancel();assert.equal(await pending,null);assert.equal(h.dialog.open,false);assert.equal(h.find('img'),null);assert.deepEqual(h.revoked,['blob:synthetic-0']);h.images[0].onload();assert.equal(h.find('img'),null);assert.equal(h.find('.photo-cropper-use').disabled,true);assert.equal(h.find('.photo-cropper-status').textContent,'');
});

test('a new open cancels the prior promise and ignores its delayed image and native close events',async()=>{
 const h=harness({autoLoad:false}),first=h.controller.open(file()),second=h.controller.open(png);assert.equal(await first,null);await h.settle();assert.equal(h.dialog.open,true);h.images[0].onload();assert.equal(h.find('.photo-cropper-use').disabled,true);h.images[1].onload();assert.equal(h.find('.photo-cropper-use').disabled,false);h.find('.photo-cropper-cancel').click();assert.equal(await second,null);assert.equal(h.exports.length,0);
});

test('native Escape and external close settle the operation without publishing a crop',async()=>{
 for(const action of [h=>h.event(h.dialog,'cancel'),h=>h.dialog.close(),h=>h.find('.photo-cropper-close').click()]){const h=harness(),pending=h.controller.open(file());await h.settle();action(h);assert.equal(await pending,null);assert.equal(h.exports.length,0);assert.equal(h.find('img'),null);}
});

test('Escape from crop controls cancels only the cropper and never reaches the profile page shortcut',async()=>{
 for(const selector of ['.photo-cropper-stage','.photo-cropper-zoom','.photo-cropper-use']){
  const h=harness(),pending=h.controller.open(file());await h.settle();let parentClosed=false;
  h.document.addEventListener('keydown',event=>{if(event.key==='Escape')parentClosed=true;});
  const event={type:'keydown',key:'Escape',bubbles:true,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.propagationStopped=true;this.bubbles=false;}};
  h.find(selector).dispatchEvent(event);assert.equal(parentClosed,false);assert.equal(event.defaultPrevented,true);assert.equal(event.propagationStopped,true);assert.equal(await pending,null);assert.equal(h.dialog.open,false);assert.equal(h.exports.length,0);
 }
});

test('bad sources and image decode errors reject without leaving a modal or object URL behind',async()=>{
 const invalid=harness();await assert.rejects(invalid.controller.open(file({type:'text/html'})),/JPG/);assert.equal(invalid.dialog.open,undefined);assert.equal(invalid.images.length,0);
 for(const failure of ['decode','dimensions']){const h=harness({autoLoad:false,dimensions:failure==='dimensions'?[10000,10000]:[800,400]}),pending=h.controller.open(file()),rejected=assert.rejects(pending,failure==='decode'?/ler esta foto/:/resolução/);if(failure==='decode')h.images[0].onerror();else h.images[0].onload();await rejected;assert.equal(h.dialog.open,false);assert.equal(h.find('img'),null);assert.deepEqual(h.revoked,['blob:synthetic-0']);}
});

test('cancellation during JPEG export ignores the callback and leaves a newer operation intact',async()=>{
 const h=harness({deferExport:true}),first=h.controller.open(file());await h.settle();h.use();assert.equal(h.find('.photo-cropper-use').disabled,true);h.controller.cancel();assert.equal(await first,null);const second=h.controller.open(png);await h.settle();h.exports[0].callback(h.exports[0].blob);await h.settle();assert.equal(h.dialog.open,true);assert.equal(h.find('.photo-cropper-use').disabled,false);assert.equal(h.exports.length,1);h.controller.cancel();assert.equal(await second,null);
});

test('cancellation during blob conversion cannot resolve an old operation with a photo',async()=>{
 const h=harness({deferBuffer:true}),pending=h.controller.open(png);await h.settle();h.use();await h.settle();assert.equal(h.buffers.length,1);h.controller.cancel();assert.equal(await pending,null);h.buffers[0](jpegBytes.buffer);await h.settle();assert.equal(h.dialog.open,false);assert.equal(h.find('img'),null);assert.equal(h.find('.photo-cropper-status').textContent,'');
});

test('oversized or invalid JPEG output reports an error and permits cancelling without a result',async()=>{
 for(const options of [{blobSize:MAX_AVATAR+1},{blobType:'image/png'},{output:Uint8Array.from([0,0,0,0])}]){const h=harness(options),pending=h.controller.open(file());await h.settle();h.use();await h.settle();await h.settle();assert.equal(h.dialog.open,true);assert.equal(h.find('.photo-cropper-status').classList.contains('is-error'),true);assert.equal(h.find('.photo-cropper-use').disabled,false);h.controller.cancel();assert.equal(await pending,null);}
});

test('dragging with touch uses viewport scale and does not allow blank edges',async()=>{
 const h=harness(),pending=h.controller.open(png);await h.settle();h.stage.getBoundingClientRect=()=>({width:140,height:140});h.event(h.stage,'pointerdown',{pointerId:8,pointerType:'touch',clientX:10,clientY:10});h.event(h.stage,'pointermove',{pointerId:8,pointerType:'touch',clientX:1000,clientY:1000});h.event(h.stage,'pointercancel',{pointerId:8});assert.equal(h.stage.classList.contains('is-dragging'),false);h.use();await pending;closeEnough(h.draws[0][1],0);closeEnough(h.draws[0][2],0);closeEnough(h.draws[0][3],400);
});
