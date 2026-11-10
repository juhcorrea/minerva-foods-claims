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
  function createClient({makeWorker,setTimer=setTimeout,clearTimer=clearTimeout}){
    let worker=null,workerRevision=null,serial=0,pending=null,epoch=0,loadSerial=0,upgradeController=null,maintenanceTask=null,maintenanceController=null,maintenanceCalls=0;
    function discardWorker(){
      if(worker)worker.terminate();worker=null;workerRevision=null;
      if(pending){const job=pending;pending=null;job.cleanup();job.reject(aborted());}
    }
    function clear(){epoch++;discardWorker();upgradeController?.abort();upgradeController=null;maintenanceController?.abort();maintenanceController=null;}
    function run(manifest,options,signal,onProgress){
      const sourceKey=JSON.stringify([manifest.revision,manifest.projectionVersion??1]);
      check(signal);if(workerRevision!==sourceKey)discardWorker();
      if(pending)discardWorker();
      if(!worker){worker=makeWorker();workerRevision=sourceKey;}
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
          const failure=event.data.error?Object.assign(new Error(event.data.error.message),{status:event.data.error.status,code:event.data.error.code}):null;finish(failure,event.data.model);if(failure)discardWorker();
        };
        const error=()=>{finish(new Error('Não foi possível concluir o cálculo no navegador. Atualize a visão e tente novamente.'));if(current===worker){current.terminate();worker=null;workerRevision=null;}};
        pending={id,reject,cleanup};signal?.addEventListener('abort',stop,{once:true});current.addEventListener('message',message);current.addEventListener('error',error);
        try{current.postMessage({id,manifest,options});}catch(failure){finish(failure);discardWorker();}
      });
    }
    async function upgradeProjection({api,signal,onProgress,guard,canUpgrade}){
      const active=()=>{guard();if(!canUpgrade())throw aborted();};
      const validate=(value,previous)=>{
        if(!value||typeof value.revision!=='string'||!value.revision||value.projectionVersion!==3||!Number.isInteger(value.totalParts)||value.totalParts<2||value.totalParts>768||!Number.isInteger(value.completed)||value.completed<0||value.completed>value.totalParts||value.nextPart!==value.completed||typeof value.ready!=='boolean'||value.ready&&value.completed!==value.totalParts||previous&&(value.revision!==previous.revision||value.totalParts!==previous.totalParts||value.completed<previous.completed))throw new Error('A preparação da leitura não foi confirmada. Use Atualizar visão para retomar; as bases publicadas foram preservadas.');
        return value;
      };
      const post=async(path,body)=>{
        active();const controller=new AbortController(),stop=()=>controller.abort();let timedOut=false;
        upgradeController=controller;signal?.addEventListener('abort',stop,{once:true});
        const timeout=setTimer(()=>{timedOut=true;controller.abort();},30000);
        try{const result=await api('/api/client-report/upgrade/'+path,{method:'POST',signal:controller.signal,body:JSON.stringify(body)});active();if(controller.signal.aborted)throw aborted();return result;}
        catch(error){active();if(timedOut)throw Object.assign(new Error('Uma etapa da preparação demorou mais de 30 segundos. Use Atualizar visão para retomar; as bases foram preservadas.'),{code:'UPGRADE_TIMEOUT'});throw error;}
        finally{clearTimer(timeout);signal?.removeEventListener('abort',stop);if(upgradeController===controller)upgradeController=null;}
      };
      discardWorker();active();onProgress({phase:'projection',loaded:0,total:0});
      let state=validate(await post('start',{}));
      onProgress({phase:'projection',loaded:state.completed,total:state.totalParts});
      while(!state.ready&&state.completed<state.totalParts){
        const previous=state;state=validate(await post('part',{revision:state.revision,part:state.nextPart}),previous);
        if(state.completed===previous.completed&&!state.ready)throw new Error('A preparação da leitura não avançou. Use Atualizar visão para retomar.');
        onProgress({phase:'projection',loaded:state.completed,total:state.totalParts});
      }
      if(!state.ready)state=validate(await post('commit',{revision:state.revision}),state);
      if(!state.ready)throw new Error('A preparação ainda não foi concluída. Use Atualizar visão para retomar.');
      discardWorker();active();
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
      async load(options,{api,signal,onProgress=()=>{},canUpgrade=()=>false}={}){
        upgradeController?.abort();
        const started=epoch,loadId=++loadSerial,guard=()=>{check(signal);if(started!==epoch||loadId!==loadSerial)throw aborted();};
        for(let attempt=0;attempt<2;attempt++){
          try{
            guard();onProgress({phase:'manifest'});const manifest=await api('/api/client-report',{signal});guard();
            if(!manifest?.revision){discardWorker();return {model:null,revision:null,files:null,updatedAt:null,updatedBy:null};}
            const model=await run(manifest,options,signal,onProgress);guard();
            return {model,revision:manifest.revision,projectionVersion:manifest.projectionVersion??1,files:manifest.files,updatedAt:manifest.updatedAt,updatedBy:manifest.updatedBy,asOf:manifest.asOf};
          }catch(error){
            guard();
            if(attempt||error.status!==409||error.code!=='REPORT_PROJECTION_OUTDATED'||!canUpgrade())throw error;
            await upgradeProjection({api,signal,onProgress,guard,canUpgrade});
          }
        }
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
