(function(global,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports){module.exports=api;return;}
  const script=document.currentScript?.src||new URL('client-analysis.js',document.baseURI).href;
  global.MinervaClientAnalysis=api.createClient({makeWorker:()=>new Worker(new URL('analysis-worker.js',script),{name:'minerva-private-analysis'})});
})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  const aborted=()=>Object.assign(new Error('Operação cancelada.'),{name:'AbortError'});
  const check=signal=>{if(signal?.aborted)throw aborted();};
  function* uploadParts(sheet,rows,maxBytes=65536){
    if(!['bd','control'].includes(sheet)||!Array.isArray(rows)||rows.length<2||rows.length>25000)throw new Error('As duas planilhas precisam conter cabeçalho e linhas válidas.');
    let firstRow=0,index=0;
    const encoder=new TextEncoder();
    while(firstRow<rows.length){
      const selected=[],prefix=JSON.stringify({sheet,index,firstRow}).slice(0,-1)+',"rows":[';let size=encoder.encode(prefix).byteLength+2;
      while(firstRow+selected.length<rows.length&&selected.length<64){
        const row=rows[firstRow+selected.length];if(!Array.isArray(row))throw new Error('A planilha contém uma linha inválida.');
        const serialized=JSON.stringify(row),extra=encoder.encode(serialized).byteLength+(selected.length?1:0);
        if(size+extra>maxBytes){if(!selected.length)throw new Error('Uma linha excede o tamanho permitido para publicação. Confira as células de texto.');break;}
        selected.push(serialized);size+=extra;
      }
      const body=prefix+selected.join(',')+']}';
      yield {sheet,index,firstRow,rowCount:selected.length,body};firstRow+=selected.length;index++;
    }
  }
  function createClient({makeWorker}){
    let worker=null,workerRevision=null,serial=0,pending=null,epoch=0,maintenanceTask=null,maintenanceController=null,maintenanceCalls=0;
    function clear(){
      epoch++;if(worker)worker.terminate();worker=null;workerRevision=null;
      maintenanceController?.abort();maintenanceController=null;
      if(pending){const job=pending;pending=null;job.cleanup();job.reject(aborted());}
    }
    function run(manifest,options,signal,onProgress){
      check(signal);if(workerRevision!==manifest.revision)clear();
      if(pending)clear();
      if(!worker){worker=makeWorker();workerRevision=manifest.revision;}
      const current=worker,id=++serial;
      return new Promise((resolve,reject)=>{
        const stop=()=>clear();
        const cleanup=()=>{signal?.removeEventListener('abort',stop);current.removeEventListener('message',message);current.removeEventListener('error',error);};
        const finish=(failure,value)=>{if(pending?.id!==id)return;pending=null;cleanup();failure?reject(failure):resolve(value);};
        const message=event=>{
          if(event.data?.id!==id||current!==worker)return;
          if(event.data.type==='progress'){
            const progress=event.data.progress;
            if(progress?.phase==='analysis'||progress?.phase==='download'&&Number.isInteger(progress.loaded)&&Number.isInteger(progress.total)&&progress.total>0&&progress.total<=768&&progress.loaded>=0&&progress.loaded<=progress.total)onProgress(progress);
            return;
          }
          const failure=event.data.error?Object.assign(new Error(event.data.error.message),{status:event.data.error.status,code:event.data.error.code}):null;finish(failure,event.data.model);if(failure)clear();
        };
        const error=()=>{finish(new Error('Não foi possível concluir o cálculo no navegador. Atualize a visão e tente novamente.'));if(current===worker){current.terminate();worker=null;workerRevision=null;}};
        pending={id,reject,cleanup};signal?.addEventListener('abort',stop,{once:true});current.addEventListener('message',message);current.addEventListener('error',error);
        try{current.postMessage({id,manifest,options});}catch(failure){finish(failure);clear();}
      });
    }
    return {
      clear,
      maintain({api,allowed=()=>false}={}){
        if(maintenanceTask)return maintenanceTask;
        if(!allowed()||maintenanceCalls>=100)return Promise.resolve();
        const started=epoch,controller=new AbortController();maintenanceController=controller;
        maintenanceTask=(async()=>{
          let cursor=null;
          try{
            while(maintenanceCalls<100&&started===epoch&&allowed()&&!controller.signal.aborted){
              maintenanceCalls++;
              const result=await api('/api/client-report/cleanup',{method:'POST',signal:controller.signal,body:JSON.stringify({cursor})});
              if(started!==epoch||!allowed()||controller.signal.aborted||result?.hasMore!==true)break;
              if(typeof result.cursor!=='string'||!result.cursor||result.cursor.length>8192)break;
              cursor=result.cursor;
            }
          }catch{/* Optional maintenance never blocks access, analysis or publication. */}
        })().finally(()=>{if(maintenanceController===controller)maintenanceController=null;maintenanceTask=null;});
        return maintenanceTask;
      },
      async load(options,{api,signal,onProgress=()=>{}}={}){
        check(signal);onProgress({phase:'manifest'});const started=epoch,manifest=await api('/api/client-report',{signal});check(signal);if(started!==epoch)throw aborted();
        if(!manifest?.revision){clear();return {model:null,revision:null,files:null,updatedAt:null,updatedBy:null};}
        const model=await run(manifest,options,signal,onProgress);check(signal);
        return {model,revision:manifest.revision,files:manifest.files,updatedAt:manifest.updatedAt,updatedBy:manifest.updatedBy,asOf:manifest.asOf};
      },
      async publish(payload,{api,expectedRevision,signal,onProgress=()=>{}}={}){
        const started=epoch,guard=()=>{check(signal);if(started!==epoch)throw aborted();};guard();
        // Validate the chunk boundaries before creating a server-side draft.
        let total=0;for(const sheet of ['bd','control'])for(const _part of uploadParts(sheet,payload[sheet]))total++;
        if(total>768)throw new Error('As planilhas excedem o limite de partes desta publicação.');
        const start=await api('/api/client-report/start',{method:'POST',signal,body:JSON.stringify({expectedRevision,expectedRows:{bd:payload.bd.length,control:payload.control.length},files:payload.files,asOf:payload.asOf,demo:false})});
        guard();
        if(typeof start?.uploadId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(start.uploadId))throw new Error('A publicação não retornou uma identificação válida.');
        let sent=0;
        for(const sheet of ['bd','control'])for(const part of uploadParts(sheet,payload[sheet])){
          guard();const saved=await api('/api/client-report/'+encodeURIComponent(start.uploadId)+'/parts',{method:'POST',signal,body:part.body});guard();
          if(saved?.sheet!==part.sheet||saved.index!==part.index||saved.firstRow!==part.firstRow||saved.rowCount!==part.rowCount)throw new Error('Uma parte da publicação não foi confirmada. Os dados anteriores permanecem publicados.');
          onProgress({sent:++sent,total});
        }
        guard();const saved=await api('/api/client-report/'+encodeURIComponent(start.uploadId)+'/commit',{method:'POST',signal,body:'{}'});guard();
        if(typeof saved?.revision!=='string'||!saved.revision)throw new Error('Não foi possível confirmar a nova versão publicada.');clear();return saved;
      },
    };
  }
  return {createClient,uploadParts};
});
