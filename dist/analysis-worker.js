(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  importScripts(new URL('engine.js',global.location.href).href);
  const runner=api.createRunner({engine:global.ClaimsEngine,fetcher:(...args)=>fetch(...args),crypto:global.crypto,baseURL:global.location.href});
  global.addEventListener('message',async event=>{
    const {id,manifest,options}=event.data||{};
    try{const model=await runner.analyze(manifest,options,{onProgress:progress=>global.postMessage({id,type:'progress',progress})});global.postMessage({id,model});}
    catch(error){global.postMessage({id,error:{message:error.message||'Não foi possível analisar as bases.',status:error.status||0,code:error.code||''}});}
  });
})(typeof self==='object'?self:globalThis,function(){
  'use strict';
  const digest=async(crypto,value)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',value))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const progressValue=value=>value==null?'':String(value).normalize('NFKC').trim().replace(/\s+/g,' ').toUpperCase();
  async function correctionProgressKey(group,crypto){
    const refs=[...new Set((group.orders?.length?group.orders:[group.reference]).map(progressValue))].sort();
    const changes=(group.changes||[...(group.year?.changes||[]),...(group.market?.changes||[])]).map(change=>JSON.stringify([progressValue(change.field),progressValue(change.reference),progressValue(change.original),progressValue(change.corrected)])).sort();
    return digest(crypto,new TextEncoder().encode(JSON.stringify({schema:1,refs,changes})));
  }
  const failure=message=>{throw new Error(message);};
  function manifestParts(manifest,baseURL){
    if(manifest?.schemaVersion!==2||typeof manifest.revision!=='string'||!manifest.revision||!Array.isArray(manifest.parts)||manifest.parts.length<2||manifest.parts.length>768)failure('A publicação possui um manifesto inválido. Atualize a visão.');
    const origin=new URL(baseURL).origin,ordered=[];
    for(const sheet of ['bd','control']){
      const parts=manifest.parts.filter(part=>part.sheet===sheet).slice().sort((a,b)=>a.index-b.index);let row=0;
      if(!parts.length)failure('A publicação está incompleta.');
      parts.forEach((part,index)=>{
        if(part.index!==index||part.firstRow!==row||!Number.isInteger(part.rowCount)||part.rowCount<1||part.rowCount>25000||!/^[a-f0-9]{64}$/.test(part.sha256||''))failure('A sequência das partes da publicação é inválida.');
        const url=new URL(part.url,baseURL);
        if(url.origin!==origin||url.pathname!=='/api/client-report/parts'||url.username||url.password||url.hash||[...url.searchParams.keys()].length!==3||[...url.searchParams.keys()].some(key=>!['revision','sheet','index'].includes(key))||url.searchParams.get('revision')!==manifest.revision||url.searchParams.get('sheet')!==sheet||url.searchParams.get('index')!==String(index))failure('A origem de uma parte da publicação é inválida.');
        row+=part.rowCount;if(row>25000)failure('A publicação excede o limite de linhas.');ordered.push({...part,url:url.href});
      });
      if(row<2)failure('A planilha publicada está vazia.');
    }
    if(ordered.length!==manifest.parts.length)failure('O manifesto contém uma planilha desconhecida.');return ordered;
  }
  function createRunner({engine,fetcher,crypto,baseURL}){
    let revision=null,source=null;
    async function load(manifest,onProgress){
      const parts=manifestParts(manifest,baseURL);
      if(revision===manifest.revision&&source)return source;
      revision=null;source=null;
      const next={bd:[],control:[]},controller=new AbortController();let cursor=0,loaded=0;
      onProgress({phase:'download',loaded,total:parts.length});
      async function take(){
        while(!controller.signal.aborted&&cursor<parts.length){
          const part=parts[cursor++],response=await fetcher(part.url,{credentials:'same-origin',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
          if(!response.ok){const error=new Error(response.status===401||response.status===403?'Seu acesso à publicação foi encerrado.':'Não foi possível baixar uma parte da publicação.');error.status=response.status;throw error;}
          const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>192*1024||await digest(crypto,bytes)!==part.sha256)failure('Uma parte da publicação não passou na conferência de integridade. Atualize a visão.');
          let value;try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{failure('Uma parte da publicação não contém dados válidos.');}
          const width=part.sheet==='bd'?64:32;
          if(!Array.isArray(value.rows)||value.rows.length!==part.rowCount||value.rows.some(row=>!Array.isArray(row)||row.length!==width||row.some(cell=>cell!==null&&!['string','number','boolean'].includes(typeof cell)||typeof cell==='number'&&!Number.isFinite(cell))))failure('Uma parte da publicação possui linhas inválidas.');
          value.rows.forEach((row,index)=>next[part.sheet][part.firstRow+index]=row);
          if(!controller.signal.aborted)onProgress({phase:'download',loaded:++loaded,total:parts.length});
        }
      }
      await Promise.all(Array.from({length:Math.min(8,parts.length)},take)).catch(error=>{controller.abort();throw error;});
      engine.validateHeaders(next.bd,'BD');engine.validateHeaders(next.control,'Controle Recebimento');
      revision=manifest.revision;source=next;return source;
    }
    return {async analyze(manifest,options={}, {onProgress=()=>{}}={}){
      const rows=await load(manifest,onProgress);onProgress({phase:'analysis'});
      const model=engine.analyze(rows.bd,rows.control,options),progress=manifest.progress||{entries:{},revision:'none'};
      if(typeof progress.revision!=='string'||!progress.entries||typeof progress.entries!=='object'||Array.isArray(progress.entries))failure('O acompanhamento das correções está inválido.');
      await Promise.all((model.correctionGroups||[]).map(async group=>{
        const key=await correctionProgressKey(group,crypto),entry=progress.entries[key];
        group.progress={key,done:entry?.done===true,updatedAt:typeof entry?.updatedAt==='string'?entry.updatedAt:null,updatedBy:typeof entry?.updatedBy==='string'?entry.updatedBy:null};
      }));
      model.meta={...model.meta,correctionProgressRevision:progress.revision};
      const {unmatchedControls,...safe}=model;return safe;
    },clear(){revision=null;source=null;}};
  }
  return {createRunner,manifestParts,correctionProgressKey};
});
