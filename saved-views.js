(function(global){
  'use strict';
  const PREFIX='minerva.saved-views.v1.',LIMIT=30;
  const cleanName=value=>String(value||'').trim().replace(/\s+/g,' ').slice(0,60);
  const normalized=value=>String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR');
  async function identityKey(profile,cryptoApi){
    const identity=String(profile?.id||profile?.email||profile?.name||'').trim().toLocaleLowerCase('pt-BR');if(!identity)return null;
    const bytes=await cryptoApi.subtle.digest('SHA-256',new TextEncoder().encode('minerva-saved-views:'+identity));
    return PREFIX+'profile.'+Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
  }
  function repository({storage,key,capture,restore,sanitize,uuid,now=()=>new Date().toISOString()}){
    async function load(){
      const scope=await key();if(!scope)throw new Error('Entre no painel para acessar suas visões.');
      let data;try{data=JSON.parse(storage.getItem(scope)||'null');}catch{data=null;}
      const records=(data?.version===1&&Array.isArray(data.views)?data.views:[]).slice(0,LIMIT).filter(item=>item&&typeof item.id==='string'&&item.id.length<=100&&cleanName(item.name)).map(item=>({id:item.id,name:cleanName(item.name),updatedAt:/^\d{4}-\d{2}-\d{2}T/.test(item.updatedAt)?item.updatedAt:'',config:sanitize(item.config)}));
      return{scope,records};
    }
    function write(scope,records){try{storage.setItem(scope,JSON.stringify({version:1,views:records}));}catch{throw new Error('Não foi possível salvar neste navegador. Verifique o armazenamento disponível.');}}
    async function same(scope){if(await key()!==scope)throw new Error('A conta mudou. Abra suas visões novamente.');}
    return{
      async list(){const{records}=await load();return records.map(({id,name,updatedAt,config})=>({id,name,updatedAt,view:config.view})).sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));},
      async save(name){name=cleanName(name);if(!name)throw new Error('Dê um nome à visão.');const{scope,records}=await load(),config=sanitize(capture()),existing=records.find(item=>normalized(item.name)===normalized(name));if(!existing&&records.length>=LIMIT)throw new Error('Limite de 30 visões. Exclua uma antes de salvar outra.');const record={id:existing?.id||uuid(),name,updatedAt:now(),config};if(existing)records[records.indexOf(existing)]=record;else records.push(record);await same(scope);write(scope,records);return{updated:Boolean(existing),id:record.id};},
      async remove(id){const{scope,records}=await load();await same(scope);write(scope,records.filter(record=>record.id!==id));},
      async apply(id){const{scope,records}=await load(),record=records.find(item=>item.id===id);if(!record)throw new Error('Esta visão não está mais disponível.');await same(scope);await restore(record.config);await same(scope);return record.name;}
    };
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={identityKey,repository};return;}
  const app=global.MinervaApp;if(!app)return;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const titles={overview:'Visão geral',suppliers:'Fornecedores',corrections:'Correção de base',installments:'Controle de recebimento',claims:'Controle de claim',procurement:'FUP suprimentos',analysts:'Recebimento por analista',meeting:'Reunião de resultados',portfolio:'Conheça o painel',method:'Critérios'};
  const getKey=()=>{const profile=global.MinervaTeam?.getProfile?.();if(profile)return identityKey(profile,global.crypto);return global.MINERVA_HOSTED?null:PREFIX+(app.state.demo?'demo':'local');};
  const store=repository({storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value)},key:getKey,capture:()=>app.captureView(),restore:config=>app.restoreView(config),sanitize:value=>app.sanitizeView(value),uuid:()=>global.crypto.randomUUID()});
  const button=document.createElement('button');button.id='savedViewsButton';button.type='button';button.className='button button-outline';button.textContent='Visões salvas';document.querySelector('.topbar-actions')?.prepend(button);
  const dialog=document.createElement('dialog');dialog.id='savedViewsDialog';dialog.className='sv-dialog';dialog.setAttribute('aria-labelledby','savedViewsTitle');
  dialog.innerHTML='<header class="sv-heading"><div><h2 id="savedViewsTitle">Visões salvas</h2><p>Neste navegador</p></div><button type="button" class="sv-close" aria-label="Fechar visões salvas">×</button></header><form class="sv-save"><label>Nome da visão<input id="savedViewName" maxlength="60" required placeholder="Ex.: Negociações por país" autocomplete="off"></label><button type="submit" class="button button-primary">Salvar atual</button></form><label class="sv-search"><span class="sr-only">Buscar visão salva</span><input id="savedViewSearch" type="search" placeholder="Buscar visão…" autocomplete="off"></label><div id="savedViewList" class="sv-list"></div><p id="savedViewStatus" class="sv-status" role="status" aria-live="polite"></p>';
  document.body.append(dialog);const find=selector=>dialog.querySelector(selector);let busy=false,revision=0,scopeVersion=0,activeScope=null;
  const status=(message,error=false)=>{find('#savedViewStatus').textContent=message;find('#savedViewStatus').classList.toggle('is-error',error);};
  async function render(){const run=++revision;try{const rows=await store.list();if(run!==revision)return;const query=normalized(find('#savedViewSearch').value),filtered=rows.filter(row=>normalized(row.name+' '+(titles[row.view]||'')).includes(query));find('#savedViewList').innerHTML=filtered.length?filtered.map(row=>'<article class="sv-item"><div><strong>'+escape(row.name)+'</strong><small>'+escape(titles[row.view]||'Painel')+'</small></div><div class="sv-actions"><button type="button" class="button secondary" data-sv-apply="'+escape(row.id)+'">Aplicar</button><button type="button" class="button button-text" data-sv-delete="'+escape(row.id)+'" aria-label="Excluir '+escape(row.name)+'">Excluir</button></div></article>').join(''):'<p class="sv-empty">'+(rows.length?'Nenhuma visão encontrada.':'Salve os filtros atuais para reutilizar depois.')+'</p>';}catch(error){if(run===revision){find('#savedViewList').replaceChildren();status(error.message,true);}}}
  async function action(fn){if(busy)return;busy=true;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=true);try{await fn();}catch(error){status(error.message||'Não foi possível concluir.',true);}finally{busy=false;dialog.querySelectorAll('button,input').forEach(el=>el.disabled=false);refresh();}}
  function refresh(){button.disabled=!app.state.model||Boolean(app.state.analysisBusy)||Boolean(global.MINERVA_HOSTED&&!global.MinervaTeam?.getProfile?.());}
  button.addEventListener('click',()=>{status('');find('#savedViewSearch').value='';dialog.showModal();render();find('#savedViewName').focus();});
  find('.sv-close').addEventListener('click',()=>dialog.close());find('#savedViewSearch').addEventListener('input',render);
  find('.sv-save').addEventListener('submit',event=>{event.preventDefault();action(async()=>{const result=await store.save(find('#savedViewName').value);status(result.updated?'Visão atualizada.':'Visão salva.');find('#savedViewName').value='';await render();});});
  dialog.addEventListener('click',event=>{const apply=event.target.closest('[data-sv-apply]'),remove=event.target.closest('[data-sv-delete]');if(apply)action(async()=>{const name=await store.apply(apply.dataset.svApply);status('Aplicada: '+name+'. Dados atuais recalculados.');dialog.close();button.focus();});else if(remove)action(async()=>{await store.remove(remove.dataset.svDelete);await render();status('Visão excluída.');});});
  async function refreshScope(){const version=++scopeVersion;try{const scope=await getKey();if(version!==scopeVersion)return;if(scope!==activeScope){activeScope=scope;revision++;dialog.close();find('#savedViewList').replaceChildren();find('#savedViewName').value='';status('');}}catch{revision++;dialog.close();find('#savedViewList').replaceChildren();}refresh();}
  document.addEventListener('minerva:analysis-state',refresh);document.addEventListener('minerva:model-updated',refreshScope);document.addEventListener('minerva:session-updated',refreshScope);refresh();refreshScope();
  global.MinervaSavedViews={open:()=>button.click(),refresh};
})(typeof window!=='undefined'?window:globalThis);
