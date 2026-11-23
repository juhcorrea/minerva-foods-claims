(function(global){
  'use strict';

  const text=value=>typeof value==='string'?value.trim():'';
  const fold=value=>text(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR').replace(/\s+/g,' ');
  const compare=(a,b)=>a.name.localeCompare(b.name,'pt-BR',{sensitivity:'base'})||a.key.localeCompare(b.key);
  function initials(name){
    const words=text(name).split(/\s+/).filter(Boolean);
    if(!words.length)return '—';
    return (Array.from(words[0])[0]+(words.length>1?Array.from(words.at(-1))[0]:'')).toLocaleUpperCase('pt-BR');
  }
  function rasterAvatar(value){
    const url=text(value);if(!url||url.length>700000)return '';
    const match=/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);if(!match)return '';
    const encoded=match[2],bytes=encoded.length*3/4-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
    if(encoded.length%4||bytes>512*1024)return '';
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',prefix=[];let bits=0,buffer=0;
    for(const character of encoded.slice(0,16)){if(character==='=')break;buffer=(buffer<<6)|alphabet.indexOf(character);bits+=6;if(bits>=8){bits-=8;prefix.push((buffer>>>bits)&255);}}
    const starts=signature=>signature.every((byte,index)=>prefix[index]===byte);
    const valid=match[1]==='jpeg'?starts([255,216,255]):match[1]==='png'?starts([137,80,78,71,13,10,26,10]):starts([82,73,70,70])&&prefix[8]===87&&prefix[9]===69&&prefix[10]===66&&prefix[11]===80;
    return valid?url:'';
  }

  function visiblePeople(people){
    const byId=new Map();
    for(const person of people){const id=text(person?.id);if(id){if(!byId.has(id))byId.set(id,[]);byId.get(id).push(person);}}
    return people.filter(person=>person?.showInOrganization!==false).map(person=>{
      const managerId=text(person?.managerId),targets=byId.get(managerId)||[];
      if(!targets.some(manager=>manager.showInOrganization===false))return person;
      const seen=new Set([text(person?.id)]);let nextId=managerId;
      while(nextId&&!seen.has(nextId)){
        seen.add(nextId);const candidates=byId.get(nextId)||[];
        if(candidates.length!==1)break;
        const manager=candidates[0];
        if(manager.showInOrganization!==false)return{...person,managerId:text(manager.id),managerName:''};
        nextId=text(manager.managerId);
      }
      return{...person,managerId:'',managerName:''};
    });
  }

  // Build a forest without inventing a reporting relationship for missing data.
  function buildOrganization(people){
    if(!Array.isArray(people))throw new Error('Resposta do organograma inválida.');
    const ids=new Map(),nodes=visiblePeople(people).map((person,index)=>{
      const source=person&&typeof person==='object'?person:{};
      const node={kind:'person',key:'person:'+index,id:text(source.id),name:text(source.name)||'Nome Não Informado',initials:initials(source.name),avatarDataUrl:rasterAvatar(source.avatarDataUrl),jobTitle:text(source.jobTitle),department:text(source.department),unit:text(source.unit),managerId:text(source.managerId),managerName:text(source.managerName),children:[],issues:[],parent:null,linkedManager:null,groupKey:''};
      if(node.id){if(!ids.has(node.id))ids.set(node.id,[]);ids.get(node.id).push(node);}
      else node.issues.push('Identificação Não Informada');
      return node;
    });
    for(const list of ids.values())if(list.length>1)for(const node of list)node.issues.push('Identificação Duplicada');
    for(const node of nodes){
      if(node.managerId){
        const targets=ids.get(node.managerId)||[];
        if(targets.length===1)node.linkedManager=targets[0];
        else{node.groupKey='unavailable';node.issues.push(targets.length?'Gestor Com Identificação Duplicada':'Gestor Não Encontrado');}
      }else node.groupKey=node.managerName?'external:'+fold(node.managerName):'unknown';
    }
    // Each person has at most one manager. Break every cycle edge, preserving
    // its people and their non-circular teams for explicit review.
    const complete=new Set();
    for(const start of nodes){
      const path=[],positions=new Map();let current=start;
      while(current&&!complete.has(current)&&!positions.has(current)){positions.set(current,path.length);path.push(current);current=current.linkedManager;}
      if(current&&positions.has(current))for(const member of path.slice(positions.get(current))){member.linkedManager=null;member.groupKey='circular';member.issues.push('Vínculo Circular');}
      for(const member of path)complete.add(member);
    }
    const groupsByKey=new Map();
    function groupFor(node){
      const key=node.groupKey||'unknown';
      if(!groupsByKey.has(key)){
        const external=key.startsWith('external:');
        groupsByKey.set(key,{kind:'group',key,name:external?node.managerName:key==='circular'?'Vínculos A Conferir':key==='unavailable'?'Gestor Não Encontrado':'Gestor Não Informado',external,children:[],count:0,issues:[],parent:null});
      }
      return groupsByKey.get(key);
    }
    for(const node of nodes){node.parent=node.linkedManager||groupFor(node);node.parent.children.push(node);delete node.linkedManager;}
    for(const node of nodes)node.children.sort(compare);
    const groups=[...groupsByKey.values()].sort((a,b)=>Number(a.key==='circular'||a.key==='unavailable')-Number(b.key==='circular'||b.key==='unavailable')||compare(a,b));
    for(const group of groups){group.children.sort(compare);const stack=[...group.children];while(stack.length){const node=stack.pop();group.count++;stack.push(...node.children);}}
    return{nodes,groups,total:nodes.length,issueCount:nodes.filter(node=>node.issues.length).length};
  }

  function selectOrganization(model,query){
    const terms=fold(query).split(' ').filter(Boolean),matches=new Set(),visible=new Set();
    for(const node of model.nodes){
      const values=fold([node.name,node.jobTitle,node.department,node.unit,node.managerName].join(' '));
      if(!terms.every(term=>values.includes(term)))continue;
      matches.add(node);
      for(let current=node;current&&current.kind==='person'&&!visible.has(current);current=current.parent)visible.add(current);
    }
    return{matches,visible,searching:terms.length>0};
  }

  const mounted=new WeakMap(),instances=new Set();
  function mount(host,fetchFn){
    if(!host||typeof fetchFn!=='function')throw new TypeError('Informe o local e a consulta do organograma.');
    if(mounted.has(host))return mounted.get(host);
    const doc=host.ownerDocument||global.document;
    const make=(tag,className,value)=>{const node=doc.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
    const button=(className,value)=>{const node=make('button',className,value);node.type='button';return node;};
    let model=null,version=0,loading=false;const collapsed=new Set();
    host.classList.add('organization');
    const toolbar=make('div','org-toolbar'),heading=make('div','org-heading'),title=make('h3','','Organograma'),summary=make('div','org-total'),count=make('strong','org-count','—'),countLabel=make('span','','Pessoas');
    summary.append(count,countLabel);heading.append(title,summary);
    const actions=make('div','org-actions'),searchLabel=make('label','org-search-label'),searchCaption=make('span','','Buscar Na Equipe'),search=make('input','org-search');
    search.type='search';search.placeholder='Nome, cargo, setor ou unidade';search.setAttribute('aria-label','Buscar No Organograma');search.autocomplete='off';searchLabel.append(searchCaption,search);
    const refreshButton=button('button button-outline org-refresh','Atualizar');actions.append(searchLabel,refreshButton);toolbar.append(heading,actions);
    const note=make('p','org-note','A hierarquia usa o gestor informado no perfil. Gestores externos não entram no total de pessoas.'),status=make('p','org-status'),results=make('p','org-results'),content=make('div','org-content');
    status.setAttribute('role','status');status.setAttribute('aria-live','polite');results.setAttribute('aria-live','polite');
    host.replaceChildren(toolbar,note,status,results,content);

    function setStatus(message,error=false){status.textContent=message;status.classList.toggle('is-error',error);}
    function empty(message){content.replaceChildren(make('p','org-empty',message));}
    function avatar(name,avatarDataUrl,letters){
      const circle=make('span','org-avatar'),fallback=make('span','org-avatar-initials',letters===undefined?initials(name):letters);circle.setAttribute('aria-hidden','true');circle.append(fallback);
      if(avatarDataUrl){
        const image=make('img','org-avatar-image');image.alt='';image.decoding='async';image.loading='lazy';
        image.addEventListener('error',()=>{image.remove();circle.classList.remove('has-photo');});
        image.src=avatarDataUrl;circle.classList.add('has-photo');circle.append(image);
      }
      return circle;
    }
    function renderPerson(node,selection){
      const item=make('li','org-node'),card=make('article','org-person');item.dataset.personId=node.id;
      if(node.issues.length)card.classList.add('has-issue');
      if(selection.searching&&!selection.matches.has(node))card.classList.add('is-context');
      const childNodes=node.children.filter(child=>selection.visible.has(child));let toggle;
      if(childNodes.length){toggle=button('org-toggle','−');toggle.setAttribute('aria-label','Recolher Equipe De '+node.name);card.append(toggle);}
      else card.append(make('span','org-node-dot'));
      card.append(avatar(node.name,node.avatarDataUrl,node.initials));
      const info=make('div','org-person-info'),name=make('strong','org-person-name',node.name),job=make('span','org-person-job',node.jobTitle||'Cargo Não Informado');info.append(name,job);
      const meta=[node.department,node.unit].filter(Boolean);if(meta.length)info.append(make('span','org-person-meta',meta.join(' · ')));
      if(node.issues.length){const warnings=make('div','org-person-warnings');for(const issue of node.issues)warnings.append(make('span','org-warning',issue));info.append(warnings);if(node.managerName)info.append(make('span','org-person-meta','Gestor Informado: '+node.managerName));}
      if(selection.searching&&!selection.matches.has(node))info.append(make('small','org-context-note','Contexto Da Hierarquia'));
      card.append(info);
      if(node.children.length)card.append(make('span','org-direct-count',node.children.length+' '+(node.children.length===1?'Pessoa Direta':'Pessoas Diretas')));
      item.append(card);
      let children;
      if(childNodes.length){
        children=make('ul','org-children');children.setAttribute('aria-label','Equipe De '+node.name);item.append(children);
        const update=()=>{children.hidden=!selection.searching&&collapsed.has(node.key);toggle.textContent=children.hidden?'+':'−';toggle.setAttribute('aria-expanded',String(!children.hidden));toggle.setAttribute('aria-label',(children.hidden?'Expandir':'Recolher')+' Equipe De '+node.name);};
        toggle.addEventListener('click',()=>{if(children.hidden)collapsed.delete(node.key);else collapsed.add(node.key);children.hidden=!children.hidden;toggle.textContent=children.hidden?'+':'−';toggle.setAttribute('aria-expanded',String(!children.hidden));toggle.setAttribute('aria-label',(children.hidden?'Expandir':'Recolher')+' Equipe De '+node.name);});update();
      }
      return{item,children,childNodes};
    }
    function render(){
      if(!model)return;
      const selection=selectOrganization(model,search.value);count.textContent=model.total.toLocaleString('pt-BR');
      results.textContent=selection.searching?selection.matches.size.toLocaleString('pt-BR')+' '+(selection.matches.size===1?'Pessoa Encontrada':'Pessoas Encontradas')+' · '+model.total.toLocaleString('pt-BR')+' '+(model.total===1?'Pessoa No Total':'Pessoas No Total'):model.issueCount?model.issueCount.toLocaleString('pt-BR')+' '+(model.issueCount===1?'Pessoa Com Vínculo A Conferir':'Pessoas Com Vínculo A Conferir'):'';
      if(!model.total){empty('Nenhuma Pessoa Disponível No Organograma.');return;}
      if(!selection.matches.size){empty('Nenhuma Pessoa Encontrada. Altere A Busca.');return;}
      content.replaceChildren();
      for(const group of model.groups){
        const roots=group.children.filter(node=>selection.visible.has(node));if(!roots.length)continue;
        const section=make('section','org-group'),groupToggle=button('org-group-heading',''),symbol=make('span','org-group-symbol','−'),label=make('strong','',group.name);symbol.setAttribute('aria-hidden','true');groupToggle.append(symbol);if(group.external)groupToggle.append(avatar(group.name));groupToggle.append(label);
        if(group.external)groupToggle.append(make('span','org-external','Gestor Externo'));
        groupToggle.append(make('span','org-group-count',group.count.toLocaleString('pt-BR')+' '+(group.count===1?'Pessoa':'Pessoas')));
        const list=make('ul','org-tree');list.setAttribute('aria-label',group.name);list.hidden=!selection.searching&&collapsed.has(group.key);groupToggle.setAttribute('aria-expanded',String(!list.hidden));symbol.textContent=list.hidden?'+':'−';
        groupToggle.addEventListener('click',()=>{list.hidden=!list.hidden;if(list.hidden)collapsed.add(group.key);else collapsed.delete(group.key);symbol.textContent=list.hidden?'+':'−';groupToggle.setAttribute('aria-expanded',String(!list.hidden));});section.append(groupToggle,list);content.append(section);
        const stack=roots.slice().reverse().map(node=>({node,parent:list}));
        while(stack.length){const entry=stack.pop(),rendered=renderPerson(entry.node,selection);entry.parent.append(rendered.item);for(let i=rendered.childNodes.length-1;i>=0;i--)stack.push({node:rendered.childNodes[i],parent:rendered.children});}
      }
    }
    async function refresh(){
      const request=++version;loading=true;model=null;content.replaceChildren();count.textContent='—';results.textContent='';host.setAttribute('aria-busy','true');refreshButton.disabled=true;setStatus('Carregando Organograma…');
      try{
        const response=await fetchFn();if(request!==version)return false;
        model=buildOrganization(response?.people);collapsed.clear();setStatus('');render();return true;
      }catch(error){
        if(request!==version)return false;
        model=null;count.textContent='—';content.replaceChildren();results.textContent='';
        if(error?.name==='AbortError')setStatus('');else setStatus('Não Foi Possível Carregar O Organograma. Clique Em Atualizar Para Tentar Novamente.',true);
        return false;
      }finally{if(request===version){loading=false;refreshButton.disabled=false;host.setAttribute('aria-busy','false');}}
    }
    function reset(){version++;loading=false;model=null;collapsed.clear();search.value='';content.replaceChildren();count.textContent='—';results.textContent='';setStatus('');refreshButton.disabled=false;host.setAttribute('aria-busy','false');}
    search.addEventListener('input',render);refreshButton.addEventListener('click',refresh);
    const controller={refresh,reset};mounted.set(host,controller);instances.add(controller);return controller;
  }
  function reset(){for(const controller of instances)controller.reset();}
  const api={mount,reset};
  if(global)global.MinervaOrganization=api;
  if(typeof module==='object'&&module.exports)module.exports={buildOrganization,selectOrganization,initials,rasterAvatar,...api};
})(typeof window==='undefined'?null:window);
