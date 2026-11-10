(function(global){
 'use strict';
 let active=null,cancelActive=null;
 const scriptUrl=document.currentScript?.src;
 function download({onProgress=()=>{}}={}){
  if(active)return active;
  active=new Promise((resolve,reject)=>{
   let worker,timer,finished=false;
   const finish=(error,value)=>{if(finished)return;finished=true;global.clearTimeout(timer);worker?.terminate();error?reject(error):resolve(value);};
   cancelActive=()=>finish(new Error('O backup foi cancelado. Entre novamente para continuar.'));
   try{
    if(typeof global.Worker!=='function')throw new Error('Este navegador não oferece o recurso necessário para gerar o backup.');
    const url=new URL('client-backup-worker.js',scriptUrl||global.location.href);worker=new Worker(url);
    timer=global.setTimeout(()=>finish(new Error('O backup demorou além do esperado. Confira a conexão e tente novamente.')),300000);
    worker.addEventListener('error',()=>finish(new Error('Não foi possível iniciar o backup. Atualize a página e tente novamente.')));
    worker.addEventListener('message',event=>{
     if(finished)return;
     const data=event.data;if(data?.type==='progress'){onProgress(String(data.message||''));return;}
     if(data?.type==='error'){finish(new Error(data.message||'Não foi possível preparar o backup privado.'));return;}
     if(data?.type!=='complete')return;
     try{
      if(!(data.blob instanceof Blob)||!data.blob.size||data.blob.type!=='application/zip')throw new Error('O backup retornou um arquivo inválido.');
      const href=URL.createObjectURL(data.blob),link=document.createElement('a');link.href=href;link.download='Minerva-Claims-Migracao-Privada.zip';link.hidden=true;document.body.append(link);link.click();link.remove();global.setTimeout(()=>URL.revokeObjectURL(href),60000);finish(null,{downloaded:true,bytes:data.blob.size});
     }catch(error){finish(error);}
    });
    worker.postMessage({type:'download'});
   }catch(error){finish(error);}
  });
  active=active.finally(()=>{active=null;cancelActive=null;});return active;
 }
 global.MinervaClientBackup={download,clear:()=>cancelActive?.()};
})(window);
