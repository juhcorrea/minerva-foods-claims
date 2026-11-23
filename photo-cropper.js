(function(global){
  'use strict';

  const STAGE_SIZE=280,OUTPUT_SIZE=384,MAX_FILE=5*1024*1024,MAX_AVATAR=512*1024,MAX_PIXELS=40000000;
  const TYPES=['image/jpeg','image/png','image/webp'];
  const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
  const finite=value=>typeof value==='number'&&Number.isFinite(value);

  function cropGeometry(width,height,zoom=1,x=0,y=0,size=STAGE_SIZE){
    if(!finite(width)||!finite(height)||width<=0||height<=0||!finite(size)||size<=0)throw new Error('A imagem não tem dimensões válidas.');
    zoom=clamp(finite(zoom)?zoom:1,1,4);
    const scale=Math.max(size/width,size/height)*zoom,displayWidth=width*scale,displayHeight=height*scale,maxX=Math.max(0,(displayWidth-size)/2),maxY=Math.max(0,(displayHeight-size)/2);
    x=clamp(finite(x)?x:0,-maxX,maxX);y=clamp(finite(y)?y:0,-maxY,maxY);
    const sourceSize=size/scale,sourceX=clamp((displayWidth-size)/2/scale-x/scale,0,Math.max(0,width-sourceSize)),sourceY=clamp((displayHeight-size)/2/scale-y/scale,0,Math.max(0,height-sourceSize));
    return{zoom,x,y,scale,displayWidth,displayHeight,maxX,maxY,sourceX,sourceY,sourceSize};
  }
  function zoomGeometry(width,height,geometry,zoom){
    const next=clamp(finite(zoom)?zoom:1,1,4),ratio=next/geometry.zoom;
    return cropGeometry(width,height,next,geometry.x*ratio,geometry.y*ratio);
  }
  function rasterDataUrl(value){
    if(typeof value!=='string'||!value||value.length>Math.ceil(MAX_AVATAR/3)*4+32)return false;
    const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if(!match||match[2].length%4)return false;
    let bytes;try{bytes=(global?.atob||atob)(match[2]);if((global?.btoa||btoa)(bytes)!==match[2])return false;}catch{return false;}
    if(!bytes.length||bytes.length>MAX_AVATAR)return false;
    const code=index=>bytes.charCodeAt(index),type=match[1];
    if(type==='jpeg')return bytes.length>=4&&code(0)===255&&code(1)===216&&code(2)===255&&code(bytes.length-2)===255&&code(bytes.length-1)===217;
    if(type==='png')return bytes.length>=33&&bytes.slice(0,8)==='\x89PNG\r\n\x1a\n'&&bytes.slice(12,16)==='IHDR'&&bytes.slice(-8,-4)==='IEND';
    return bytes.length>=20&&bytes.slice(0,4)==='RIFF'&&bytes.slice(8,12)==='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.slice(12,16));
  }
  function validateSource(source){
    if(typeof source==='string'){
      if(!rasterDataUrl(source))throw new Error('Use uma foto JPG, PNG ou WebP válida de até 512 KB após o ajuste.');
      return 'data';
    }
    if(!source||!TYPES.includes(source.type)||!finite(source.size)||source.size<=0||source.size>MAX_FILE)throw new Error('Escolha uma foto JPG, PNG ou WebP de até 5 MB.');
    return 'file';
  }

  let serial=0;
  function create(){
    const doc=global.document,id='photo-cropper-'+(++serial);
    const make=(tag,className,text)=>{const element=doc.createElement(tag);if(className)element.className=className;if(text!==undefined)element.textContent=text;return element;};
    const button=(className,text)=>{const element=make('button',className,text);element.type='button';return element;};
    const dialog=make('dialog','photo-cropper-dialog');dialog.setAttribute('aria-labelledby',id+'-title');
    const heading=make('header','photo-cropper-heading'),title=make('h2','','Ajustar Foto'),closeButton=button('photo-cropper-close','×');title.id=id+'-title';closeButton.setAttribute('aria-label','Fechar Ajuste Da Foto');heading.append(title,closeButton);
    const intro=make('p','photo-cropper-intro','Arraste a foto e ajuste o zoom para escolher o enquadramento.'),stageWrap=make('div','photo-cropper-stage-wrap'),stage=make('div','photo-cropper-stage');stage.tabIndex=0;stage.setAttribute('role','group');stage.setAttribute('aria-label','Enquadramento Da Foto');stage.setAttribute('aria-describedby',id+'-help');stageWrap.append(stage);
    const help=make('p','photo-cropper-help','No teclado: use as setas para mover e + ou − para ajustar o zoom.');help.id=id+'-help';
    const controls=make('div','photo-cropper-controls'),zoomHeading=make('div','photo-cropper-zoom-heading'),zoomLabel=make('label','','Zoom'),zoomOutput=make('output','photo-cropper-zoom-value','100%'),zoom=make('input','photo-cropper-zoom');zoom.id=id+'-zoom';zoom.type='range';zoom.min='1';zoom.max='4';zoom.step='0.01';zoom.value='1';zoomLabel.setAttribute('for',zoom.id);zoomOutput.setAttribute('for',zoom.id);zoom.setAttribute('aria-label','Zoom Da Foto');zoomHeading.append(zoomLabel,zoomOutput);
    const centerButton=button('button button-outline photo-cropper-center','Centralizar');centerButton.setAttribute('aria-label','Centralizar Foto E Redefinir Zoom');controls.append(zoomHeading,zoom,centerButton);
    const status=make('p','photo-cropper-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const footer=make('footer','photo-cropper-footer'),cancelButton=button('button button-outline photo-cropper-cancel','Cancelar'),useButton=button('button button-primary photo-cropper-use','Usar Foto');footer.append(cancelButton,useButton);
    dialog.append(heading,intro,stageWrap,help,controls,status,footer);doc.body.append(dialog);
    let active=null,generation=0;
    const current=state=>active===state&&state.token===generation;
    function message(text,error=false){status.textContent=text;status.hidden=!text;status.classList.toggle('is-error',error);}
    function updateControls(){const ready=Boolean(active?.loaded&&!active?.exporting);zoom.disabled=centerButton.disabled=useButton.disabled=!ready;stage.setAttribute('aria-disabled',String(!ready));dialog.setAttribute('aria-busy',String(Boolean(active&&(!active.loaded||active.exporting))));}
    function releaseUrl(state){if(state.url){global.URL.revokeObjectURL(state.url);state.url=null;}}
    function releasePointer(state){if(state?.pointer){const pointer=state.pointer;state.pointer=null;stage.classList.remove('is-dragging');try{stage.releasePointerCapture?.(pointer.id);}catch{}}}
    function finish(value,error){
      const state=active;if(!state)return;
      active=null;generation++;releasePointer(state);releaseUrl(state);stage.replaceChildren();zoom.value='1';zoomOutput.textContent='100%';message('');updateControls();if(dialog.open)dialog.close();
      if(error)state.reject(error);else state.resolve(value);
    }
    function cancel(){finish(null);}
    function paint(state){
      if(!current(state)||!state.loaded)return;
      const geometry=cropGeometry(state.width,state.height,state.zoom,state.x,state.y);state.zoom=geometry.zoom;state.x=geometry.x;state.y=geometry.y;
      const rect=stage.getBoundingClientRect(),factor=(rect.width||STAGE_SIZE)/STAGE_SIZE;
      state.image.style.width=geometry.displayWidth*factor+'px';state.image.style.height=geometry.displayHeight*factor+'px';state.image.style.transform='translate('+(-geometry.displayWidth/2+geometry.x)*factor+'px,'+(-geometry.displayHeight/2+geometry.y)*factor+'px)';
      zoom.value=String(geometry.zoom);zoomOutput.textContent=Math.round(geometry.zoom*100)+'%';zoom.setAttribute('aria-valuetext',zoomOutput.textContent);
    }
    function setZoom(value){
      const state=active;if(!state?.loaded||state.exporting)return;
      const geometry=zoomGeometry(state.width,state.height,cropGeometry(state.width,state.height,state.zoom,state.x,state.y),Number(value));state.zoom=geometry.zoom;state.x=geometry.x;state.y=geometry.y;paint(state);
    }
    function center(){const state=active;if(!state?.loaded||state.exporting)return;state.zoom=1;state.x=state.y=0;paint(state);}
    function open(source){
      cancel();let sourceKind;try{sourceKind=validateSource(source);}catch(error){return Promise.reject(error);}
      return new Promise((resolve,reject)=>{
        const state={token:++generation,resolve,reject,url:null,image:null,width:0,height:0,zoom:1,x:0,y:0,loaded:false,exporting:false,pointer:null};active=state;message('Carregando Foto…');updateControls();
        try{
          dialog.showModal();closeButton.focus();
          const image=make('img','photo-cropper-image');image.alt='';image.setAttribute('aria-hidden','true');image.draggable=false;image.hidden=true;state.image=image;stage.append(image);
          image.onload=()=>{
            if(!current(state))return;releaseUrl(state);
            const width=image.naturalWidth,height=image.naturalHeight;
            if(!finite(width)||!finite(height)||width<=0||height<=0||width*height>MAX_PIXELS){finish(null,new Error('A resolução da foto é muito grande ou inválida. Escolha outra imagem.'));return;}
            state.width=width;state.height=height;state.loaded=true;image.hidden=false;paint(state);message('');updateControls();stage.focus();
          };
          image.onerror=()=>{if(current(state))finish(null,new Error('Não foi possível ler esta foto. Escolha outra imagem.'));};
          if(sourceKind==='file'){state.url=global.URL.createObjectURL(source);image.src=state.url;}else image.src=source;
        }catch(error){if(current(state))finish(null,error);}
      });
    }
    async function usePhoto(){
      const state=active;if(!state?.loaded||state.exporting)return;
      releasePointer(state);state.exporting=true;updateControls();message('Preparando Foto…');
      try{
        const geometry=cropGeometry(state.width,state.height,state.zoom,state.x,state.y),canvas=doc.createElement('canvas');canvas.width=canvas.height=OUTPUT_SIZE;
        const context=canvas.getContext('2d');if(!context)throw new Error('Seu navegador não conseguiu preparar a foto.');
        context.fillStyle='#ffffff';context.fillRect(0,0,OUTPUT_SIZE,OUTPUT_SIZE);context.drawImage(state.image,geometry.sourceX,geometry.sourceY,geometry.sourceSize,geometry.sourceSize,0,0,OUTPUT_SIZE,OUTPUT_SIZE);
        const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Não foi possível preparar a foto. Tente novamente.')),'image/jpeg',0.9));
        if(!current(state))return;
        if(blob.type!=='image/jpeg'||!blob.size||blob.size>MAX_AVATAR)throw new Error('A foto ficou muito grande. Reduza o zoom ou escolha outra imagem.');
        const bytes=new Uint8Array(await blob.arrayBuffer());if(!current(state))return;
        if(!bytes.length||bytes.length>MAX_AVATAR)throw new Error('A foto ficou muito grande. Escolha outra imagem.');
        let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
        const result='data:image/jpeg;base64,'+global.btoa(binary);if(!rasterDataUrl(result))throw new Error('Não foi possível preparar uma foto JPG válida. Tente novamente.');
        if(current(state))finish(result);
      }catch(error){if(current(state)){state.exporting=false;message(error.message||'Não foi possível preparar a foto. Tente novamente.',true);updateControls();}}
    }
    stage.addEventListener('pointerdown',event=>{
      const state=active;if(!state?.loaded||state.exporting||state.pointer||event.button!==undefined&&event.button!==0)return;
      event.preventDefault();stage.focus();state.pointer={id:event.pointerId,x:event.clientX,y:event.clientY};stage.classList.add('is-dragging');try{stage.setPointerCapture?.(event.pointerId);}catch{}
    });
    stage.addEventListener('pointermove',event=>{
      const state=active,pointer=state?.pointer;if(!pointer||pointer.id!==event.pointerId||!state.loaded||state.exporting)return;
      event.preventDefault();const factor=STAGE_SIZE/(stage.getBoundingClientRect().width||STAGE_SIZE);state.x+=(event.clientX-pointer.x)*factor;state.y+=(event.clientY-pointer.y)*factor;pointer.x=event.clientX;pointer.y=event.clientY;paint(state);
    });
    for(const eventName of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(eventName,event=>{if(active?.pointer?.id===event.pointerId)releasePointer(active);});
    stage.addEventListener('keydown',event=>{
      const state=active;if(!state?.loaded||state.exporting)return;const step=event.shiftKey?25:10;
      if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();event.stopPropagation();if(event.key==='ArrowLeft')state.x-=step;if(event.key==='ArrowRight')state.x+=step;if(event.key==='ArrowUp')state.y-=step;if(event.key==='ArrowDown')state.y+=step;paint(state);}
      else if(['+','=','-','_'].includes(event.key)){event.preventDefault();event.stopPropagation();setZoom(state.zoom+(['+','='].includes(event.key)?0.1:-0.1));}
      else if(event.key==='Home'){event.preventDefault();event.stopPropagation();center();}
    });
    zoom.addEventListener('input',()=>setZoom(zoom.value));centerButton.addEventListener('click',center);useButton.addEventListener('click',usePhoto);cancelButton.addEventListener('click',cancel);closeButton.addEventListener('click',cancel);
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel();}});
    dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});dialog.addEventListener('close',()=>{if(active&&!dialog.open)cancel();});
    global.addEventListener?.('resize',()=>{if(active?.loaded)paint(active);});
    updateControls();return{open,cancel};
  }

  if(global)global.MinervaPhotoCropper={create};
  if(typeof module==='object'&&module.exports)module.exports={cropGeometry,zoomGeometry,rasterDataUrl,validateSource,STAGE_SIZE,OUTPUT_SIZE,MAX_FILE,MAX_AVATAR,MAX_PIXELS};
})(typeof window==='undefined'?null:window);
