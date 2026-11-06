(function (global) {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const clock = seconds => `${String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, seconds)) % 60).padStart(2, '0')}`;
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#icon-${name}"/></svg>`;
  const externalArrow = '<svg class="portfolio-external-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18 18 6M6 6h12v12"/></svg>';
  const badge = text => `<span class="portfolio-eyebrow">${esc(text)}</span>`;
  const jump = (view, label) => `<button type="button" class="portfolio-link" data-portfolio-demo="${view}">${esc(label)} ${externalArrow}</button>`;
  const masthead = active => `<div class="report-masthead"><img src="/assets/minerva-logo.png" alt="Minerva Foods"><div aria-label="Etapas da apresentação">${['Painel','Rotina','Bases','Critérios','Conferência','Demonstração','Acesso'].map((label,i)=>`<span${i===active?' class="is-current"':''}>${label}</span>`).join('')}</div></div>`;
  const sectionTitle = (kicker, title, text) => `${badge(kicker)}<h2>${title}</h2>${text ? `<p class="portfolio-lead">${text}</p>` : ''}`;
  const cover = () => `<div class="portfolio-cover-copy"><img class="portfolio-cover-logo" src="/assets/minerva-logo.png" alt="Minerva Foods"><h2>Minerva Foods<br>Claims</h2><p class="portfolio-cover-period">Gestão de ressarcimentos</p><p class="portfolio-cover-area">Supply Chain · Administração</p><p class="portfolio-cover-description">Duas planilhas conectadas para acompanhar claims, recebimentos e ações da base.</p><p class="portfolio-cover-footer">Apresentação do painel · 10 minutos</p></div><img class="portfolio-cover-art" src="/assets/minerva-cover.png" alt="">`;
  function workflow() {
    return `<div class="portfolio-flow" aria-label="Duas planilhas são conciliadas e transformadas em um relatório compartilhado"><div class="portfolio-source-pair"><div><span>01</span><strong>Base de claims</strong><small>BD.xlsx · aba BD</small></div><div><span>02</span><strong>Recebimentos</strong><small>Aba Controle Recebimento</small></div></div><span class="portfolio-flow-arrow" aria-hidden="true">→</span><div class="portfolio-flow-center"><span class="portfolio-flow-symbol" aria-hidden="true">⇄</span><strong>Conciliação</strong><small>Ordem ou nota fiscal</small></div><span class="portfolio-flow-arrow" aria-hidden="true">→</span><div class="portfolio-flow-out"><strong>Uma visão compartilhada</strong><span>Resultados · parcelas · conferência</span><span class="portfolio-flow-line"></span><span>Do indicador ao registro de origem</span></div></div>`;
  }
  function beforeAfter() {
    return `<div class="portfolio-comparison"><article class="portfolio-before"><span class="portfolio-column-tag">NA ROTINA DO EXCEL</span><h3>Cruzamentos e conferências manuais</h3><ol><li><strong>Buscar a mesma referência</strong><span>Cruzar ordem e NF entre duas bases com PROCV e conferências.</span></li><li><strong>Conferir diferenças</strong><span>Reconhecer nomes abreviados e verificar ano e mercado.</span></li><li><strong>Reconstruir o recebimento</strong><span>Separar parcelas pagas, vencidas e futuras sem duplicar o claim.</span></li><li><strong>Montar a apresentação</strong><span>Reunir totais, filtros e gráficos para explicar o resultado.</span></li></ol></article><article class="portfolio-after"><span class="portfolio-column-tag">COM O PAINEL</span><h3>Análise e acompanhamento compartilhados</h3><ol><li><strong>Anexar e analisar</strong><span>As duas abas são lidas com os critérios definidos para a operação.</span></li><li><strong>Conferir com rastreabilidade</strong><span>As divergências ficam por ordem, com original, ajuste e linha de origem.</span></li><li><strong>Acompanhar o andamento</strong><span>Recebido, parcelas em aberto e histórico do acordo ficam acessíveis.</span></li><li><strong>Apresentar a mesma base</strong><span>Gráficos, filtros e exportações usam a versão publicada do relatório.</span></li></ol></article></div>`;
  }
  function orderExample() {
    return `<div class="portfolio-order-example"><div class="portfolio-example-claim"><span>EXEMPLO ILUSTRATIVO</span><strong>1 ordem</strong><p>Um claim, mesmo quando o pagamento é parcelado.</p></div><div class="portfolio-example-installments"><div><span class="portfolio-dot paid"></span><strong>Parcela 1</strong><span>Pago</span></div><div><span class="portfolio-dot paid"></span><strong>Parcela 2</strong><span>Pago</span></div><div><span class="portfolio-dot pending"></span><strong>Parcela 3</strong><span>Em aberto</span></div></div><div class="portfolio-example-answer"><span>LEITURA DO ACORDO</span><strong>Quitação parcial</strong><p>O histórico reúne as parcelas. O claim não é multiplicado pelas linhas do Controle.</p></div></div>`;
  }
  function receiptScopes() {
    return `<div class="portfolio-scope-grid"><article><span class="portfolio-column-tag">VISÃO GERAL · FORNECEDORES</span><h3>Como ler o comparativo?</h3><p>O padrão reúne todas as operações, inclusive as não identificadas. M/R/T confirmam o recebido; a falta de vínculo à BD não exclui o pagamento.</p><span class="portfolio-scope-caption">Mesmo ano · outros anos · ano não identificado</span></article><article><span class="portfolio-column-tag">CONTROLE · ANALISTAS · REUNIÃO</span><h3>Quanto entrou no Controle de recebimento?</h3><p>Soma o realizado com status Pago e data de compensação R válida. A visão integral inclui pagamentos sem vínculo com a BD.</p><span class="portfolio-scope-caption">Recebido total no Controle</span></article></div><p class="portfolio-inline-note">Os totais podem ter escopos diferentes. O painel identifica cada critério para que o resultado seja apresentado com contexto.</p>`;
  }
  function governance() {
    return `<div class="portfolio-governance"><article><span class="portfolio-governance-number">01</span><div><h3>Responsável pelo painel</h3><p>Administração é a responsável pelo painel e pela versão compartilhada. Cada publicação registra data, hora e perfil responsável pela atualização.</p></div></article><article><span class="portfolio-governance-number">02</span><div><h3>Consulta após aprovação</h3><p>Quem recebe o link solicita acesso. A administração aprova a visualização; não é necessário criar uma conta no ChatGPT.</p></div></article><article><span class="portfolio-governance-number">03</span><div><h3>O próximo mês já tem um lugar</h3><p>A aba Reunião de resultados organiza o período e os visuais. O time pode apresentar a base publicada e levar o material em PowerPoint, PDF ou Excel.</p></div></article></div>`;
  }
  const SLIDES = [
    {
      label: 'O ponto de partida', duration:45,
      html: `<div class="portfolio-slide portfolio-slide-cover">${cover()}</div>`,
      notes: 'Abra com a dificuldade do dia a dia: as informações já existiam, mas estavam distribuídas entre a BD e o Controle de Recebimento. Explique que o painel foi criado para conectar essas bases e facilitar a leitura do resultado. O objetivo desta apresentação é mostrar a rotina, os critérios e onde consultar cada informação.'
    },
    {
      label: 'O trabalho que vinha antes do gráfico', duration:75,
      html: `<div class="portfolio-slide">${masthead(1)}${sectionTitle('01 · O DESAFIO', 'Preparação da análise', '')}${beforeAfter()}</div>`,
      notes: 'Conte como era necessário procurar referências com PROCV, conferir ordens e notas fiscais, reconhecer fornecedores com nomes diferentes e revisar ano e mercado. Mostre que as parcelas exigiam cuidado para não contar o mesmo claim várias vezes. Não atribua uma economia de horas ou percentual sem medição; o ganho demonstrado aqui é a organização do fluxo e a visibilidade das informações.'
    },
    {
      label: 'Como as bases se encontram', duration:90,
      html: `<div class="portfolio-slide">${masthead(2)}${sectionTitle('02 · A CONEXÃO', 'Conciliação das duas bases', 'O painel cruza a ordem ou a nota fiscal e mantém os registros disponíveis para conferência.')}${workflow()}${orderExample()}</div>`,
      notes: 'Explique que usamos apenas a aba BD e a aba Controle Recebimento. O vínculo procura a referência do Controle na ordem ou na NF da BD. Quando houver mais de uma interpretação, a ocorrência fica sinalizada para revisão, sem excluir um pagamento confirmado por M/R/T. Uma linha agrupada, como “3 ordens de demonstração”, soma T uma única vez e fica sem detalhamento por ordem até a referência ser completada. Use o exemplo ilustrativo: três parcelas não são três claims; o acordo permanece em acompanhamento até que todas sejam pagas.'
    },
    {
      label: 'Ler cada número no seu contexto', duration:105,
      html: `<div class="portfolio-slide">${masthead(3)}${sectionTitle('03 · O RESULTADO', 'Critérios dos recebimentos', '')}${receiptScopes()}<div class="portfolio-formula"><span>No comparativo</span><strong>Perda = Reclamado − (Recebido + Em negociação)</strong><small>As parcelas em aberto são acompanhadas separadamente no Controle.</small></div></div>`,
      notes: 'Mostre a diferença entre o comparativo e o Controle integral. O comparativo padrão inclui CTNR/carreta e pagamentos cuja operação ainda não foi identificada; outras operações conhecidas ficam fora. M/R/T confirmam o recebido, independentemente de validação na BD, ano de entrada, situação ou motivo do claim. Ao escolher uma operação específica, os pagamentos sem operação identificada ficam fora desse filtro, com o valor indicado para conferência. Separe mesmo ano do claim, ano diferente e ano não identificado: as três partes somam o total. No Controle, o realizado exige M como Pago, usa o ano da data R e o valor de T; o analista do recebimento vem de AF. A data R também define o mês; sem data válida, o pagamento é apontado e não é somado. AE serve apenas para conferência. Não trate diferença de escopo como erro de cálculo.'
    },
    {
      label: 'Da divergência à ação', duration:105,
      html: `<div class="portfolio-slide">${masthead(4)}${sectionTitle('04 · A CONFERÊNCIA', 'Conferência e atualização da base', '')}<div class="portfolio-action-grid"><article><span class="portfolio-action-icon">≠</span><h3>Correções por ordem</h3><p>Compare fornecedor, ano e mercado originais com as correções seguras da BD. O detalhe preserva células e linhas de origem.</p></article><article><span class="portfolio-action-icon">✓</span><h3>Acompanhamento compartilhado</h3><p>Depois do ajuste na planilha, a administradora marca “Já ajustei”. A linha fica verde e a marcação pode ser desfeita.</p></article><article><span class="portfolio-action-icon">${externalArrow}</span><h3>Detalhe sem perder a referência</h3><p>Copie a ordem para localizar o registro no Excel e exporte a conferência para apoiar a atualização da base.</p></article></div><p class="portfolio-inline-note">O painel não altera o Excel original. O analista da BD é uma referência para a conferência e não comprova quem preencheu um dado incorreto.</p></div>`,
      notes: 'Explique o ciclo: identificar a divergência, alternar Original e Corrigido, abrir o detalhe, copiar a ordem, corrigir o Excel e marcar como ajustado no painel. A seleção Original ou Corrigido muda a atribuição de fornecedor, ano de entrada e mercado no painel; o reclamado permanece conforme a BD e o valor recebido T não é reescrito. A marcação registra quem marcou e quando; ela não muda os valores financeiros. Destaque que é preciso publicar novamente as planilhas atualizadas para compartilhar os novos dados. O nome de BE é o analista relacionado na BD, não a identificação automática de quem errou.'
    },
    {
      label: 'Demonstração guiada', duration:120,
      html: `<div class="portfolio-slide">${masthead(5)}${sectionTitle('05 · NA PRÁTICA', 'Demonstração do painel', 'Abra uma visão, mostre uma interação e volte ao roteiro pelo botão “Retomar apresentação”.')}<div class="portfolio-demo-grid"><article><span>01</span><h3>Entender o período</h3><p>Indicadores do reclamado, recebido, perda e negociação.</p>${jump('overview','Abrir visão geral')}</article><article><span>02</span><h3>Investigar o detalhe</h3><p>Fornecedor, ordem e parcelas do acordo.</p>${jump('suppliers','Abrir fornecedores')}</article><article><span>03</span><h3>Acompanhar as ações</h3><p>Pagamentos, vencimentos e correções por ordem.</p>${jump('corrections','Abrir correções')}</article><article><span>04</span><h3>Levar para a reunião</h3><p>Escolher o mês, os gráficos e apresentar os resultados.</p>${jump('meeting','Abrir resultados')}</article></div></div>`,
      notes: 'Reserve dois minutos para demonstrar. Na visão geral, mostre o critério e o período. Em Fornecedores, abra o detalhe de um fornecedor. Em Correções, mostre o original e o ajuste sugerido, sem marcar nada apenas para demonstrar. Em Reunião de resultados, selecione o mês e os visuais. Os botões suspendem os slides e abrem o painel; o botão Retomar apresentação continua deste ponto e mantém o cronômetro.'
    },
    {
      label: 'Uma rotina compartilhada', duration:60,
      html: `<div class="portfolio-slide">${masthead(6)}${sectionTitle('06 · CONTINUIDADE', 'Atualização e acesso do time', '')}${governance()}<div class="portfolio-closing"><strong>Mais clareza para acompanhar.<br>Mais contexto para decidir.</strong><span>Minerva Foods · Claims</span></div></div>`,
      notes: 'Feche reforçando três pontos: Administração é a responsável pela atualização do painel, o acesso depende de aprovação e a equipe consulta a versão publicada. O painel apoia a análise e a conferência; a qualidade depende das bases e da validação do time. Convide a equipe a usar a próxima reunião para acompanhar os recebimentos, os pontos em aberto e as ações da base.'
    }
  ];
  const totalDuration = slides => slides.reduce((sum, slide) => sum + Math.max(0, Number(slide.duration) || 0), 0);
  if (typeof module !== 'undefined' && module.exports) { module.exports = {slides:SLIDES, totalDuration, clock}; return; }
  if (!global.document) return;
  let model = null, exportingPowerPoint = false;
  const $ = id => document.getElementById(id);
  let deck = null, index = 0, elapsedMs = 0, startedAt = null, timer = null, notesVisible = false, returnFocus = null, pausedForDemo = false;
  let printing = false, printCleanupTimer = null;
  const logo = '<img src="/assets/minerva-logo.png" alt="Minerva Foods" width="136" height="60" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><span class="portfolio-logo-fallback" hidden>minerva<em>foods</em></span>';
  function publishedLabel() {
    const current = global.MinervaApp?.state;
    const meta = current?.bd ? null : current?.publishedMeta;
    if (meta?.updatedAt && Number.isFinite(new Date(meta.updatedAt).getTime())) return `Responsável: Administração · Base publicada em ${new Intl.DateTimeFormat('pt-BR', {timeZone:'America/Sao_Paulo', dateStyle:'short', timeStyle:'short'}).format(new Date(meta.updatedAt))} · Brasília${meta.updatedBy ? ' · ' + meta.updatedBy : ''}`;
    return 'Responsável: Administração · ' + (current?.demo ? 'Demonstração fictícia · valores não representam a operação' : current?.bd ? 'Prévia local · planilhas ainda não publicadas' : 'Apresentação do painel · acesso autorizado');
  }
  function portfolioDeck() { return {title:'Minerva Foods Claims · do Excel à decisão', slides:SLIDES, metadata:publishedLabel()}; }
  function normalizeDeck(value) {
    if (!value || !Array.isArray(value.slides)) return null;
    const slides = value.slides.filter(slide => slide && typeof slide.html === 'string').map(slide => ({label:String(slide.label || ''), html:slide.html, notes:String(slide.notes || ''), duration:Math.max(0, Number(slide.duration) || 0)}));
    return slides.length ? {title:String(value.title || 'Apresentação de resultados'), slides, metadata:String(value.metadata || '')} : null;
  }
  function ensureDialog() {
    if ($('minervaPresentation')) return $('minervaPresentation');
    const dialog = document.createElement('dialog');
    dialog.id = 'minervaPresentation';
    dialog.className = 'presentation-dialog';
    dialog.setAttribute('aria-labelledby','presentationTitle');
    dialog.innerHTML = `<header class="presentation-toolbar"><div class="presentation-brand">${logo}<div><span>MINERVA FOODS · CLAIMS</span><strong id="presentationTitle"></strong></div></div><div class="presentation-tools"><button type="button" data-presentation-action="notes" aria-pressed="false">Notas da apresentação</button><button type="button" data-presentation-action="fullscreen">Tela cheia</button><button type="button" data-presentation-action="close" aria-label="Encerrar apresentação" class="presentation-close">×</button></div></header><div class="presentation-stage" tabindex="0" aria-label="Conteúdo do slide"><div id="presentationSlide" class="presentation-slide-content"></div><aside id="presentationNotes" class="presentation-notes" hidden><span>APOIO PARA A FALA · VISÍVEL A QUEM ESTÁ VENDO ESTA TELA</span><p></p></aside></div><footer class="presentation-footer"><div class="presentation-position"><span id="presentationCounter" aria-live="polite"></span><small id="presentationMetadata"></small></div><div class="presentation-time"><span id="presentationTimer" aria-label="Tempo da apresentação">00:00</span><small id="presentationTimeTarget"></small><button type="button" data-presentation-action="pause">Pausar tempo</button><button type="button" data-presentation-action="restart">Reiniciar</button></div><div class="presentation-navigation"><button type="button" data-presentation-action="previous" aria-label="Slide anterior">←</button><button type="button" data-presentation-action="next" aria-label="Próximo slide">→</button></div></footer><p id="presentationStatus" class="presentation-status" role="status"></p>`;
    document.body.append(dialog);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closePresentation(); });
    dialog.addEventListener('close', stopTick);
    return dialog;
  }
  const elapsed = () => elapsedMs + (startedAt == null ? 0 : performance.now() - startedAt);
  function tick() {
    const timerElement = $('presentationTimer');
    if (!timerElement || !deck) return;
    const total = totalDuration(deck.slides), seconds = Math.floor(elapsed() / 1000);
    timerElement.textContent = clock(seconds);
    timerElement.classList.toggle('is-over-time', total > 0 && seconds >= total);
    timerElement.setAttribute('aria-label', `Tempo decorrido ${clock(seconds)}${total > 0 ? ', roteiro de ' + clock(total) : ''}`);
    $('presentationTimeTarget').textContent = total > 0 ? `/ ${clock(total)}` : 'tempo decorrido';
  }
  function stopTick() { if (timer) clearInterval(timer); timer = null; }
  function startTick() { stopTick(); timer = setInterval(tick,500); tick(); }
  function pause() { if (startedAt == null) startedAt = performance.now(); else { elapsedMs = elapsed(); startedAt = null; } updatePause(); tick(); }
  function updatePause() { const button=$('minervaPresentation')?.querySelector('[data-presentation-action="pause"]'); if(button) button.textContent=startedAt == null ? 'Continuar tempo' : 'Pausar tempo'; }
  function showSlide() {
    if (!deck) return;
    index = Math.min(Math.max(0,index),deck.slides.length-1);
    const slide = deck.slides[index], dialog = ensureDialog();
    $('presentationTitle').textContent=deck.title;
    $('presentationSlide').innerHTML=slide.html;
    $('presentationCounter').textContent=`${index+1} / ${deck.slides.length} · ${slide.label}`;
    $('presentationMetadata').textContent=deck.metadata;
    $('presentationNotes').hidden=!notesVisible;
    $('presentationNotes').querySelector('p').textContent=slide.notes || 'Sem notas para este slide.';
    dialog.querySelector('[data-presentation-action="notes"]').setAttribute('aria-pressed',String(notesVisible));
    dialog.querySelector('[data-presentation-action="previous"]').disabled=index===0;
    dialog.querySelector('[data-presentation-action="next"]').disabled=index===deck.slides.length-1;
    dialog.querySelector('.presentation-stage').scrollTop=0;
    $('presentationStatus').textContent='';
    updatePause(); tick();
  }
  function openPresentation(value) {
    const next=normalizeDeck(value);
    if (!next) return false;
    if ($('minervaPresentation')?.open) closePresentation();
    deck=next;index=0;elapsedMs=0;startedAt=performance.now();notesVisible=false;pausedForDemo=false;returnFocus=document.activeElement;
    removeResume();
    const dialog=ensureDialog(); showSlide();dialog.showModal();document.body.classList.add('presentation-open');startTick();
    dialog.querySelector(deck.slides.length>1?'[data-presentation-action="next"]':'[data-presentation-action="close"]').focus();
    return true;
  }
  async function leaveFullscreen() { if(document.fullscreenElement===$('minervaPresentation')) { try { await document.exitFullscreen(); } catch {} } }
  function closePresentation(options={}) {
    stopTick();
    const dialog=$('minervaPresentation');
    if(startedAt!=null){elapsedMs=elapsed();startedAt=null;}
    leaveFullscreen();
    if(dialog?.open)dialog.close();
    document.body.classList.remove('presentation-open');
    if(!options.keep){deck=null;pausedForDemo=false;removeResume();if($('presentationSlide'))$('presentationSlide').replaceChildren();if($('presentationNotes'))$('presentationNotes').querySelector('p').textContent='';if($('presentationMetadata'))$('presentationMetadata').textContent='';}
    if(!options.noFocus){
      if(returnFocus?.isConnected&&returnFocus.getClientRects().length)returnFocus.focus();
      else document.querySelector('.main-nav [aria-current="page"]')?.focus();
    }
  }
  function removeResume(){ $('presentationResume')?.remove(); }
  function demo(view) {
    if(!['overview','suppliers','installments','corrections','analysts','meeting'].includes(view))return;
    if($('minervaPresentation')?.open){
      // The demonstration is part of the timed talk. Its time continues while
      // slides are suspended, unless the presenter had explicitly paused it.
      const running=startedAt!=null;
      closePresentation({keep:true,noFocus:true});
      if(running)startedAt=performance.now();
      pausedForDemo=true;
      const resume=document.createElement('div');resume.id='presentationResume';resume.className='presentation-resume';
      resume.innerHTML='<span>Roteiro em andamento</span><button type="button" data-presentation-action="resume">Retomar apresentação</button><button type="button" data-presentation-action="close" aria-label="Encerrar roteiro">×</button>';
      document.body.append(resume);
    }
    global.MinervaApp?.view(view);
    global.scrollTo({top:0,behavior:'smooth'});
  }
  function resumePresentation(){if(!deck||!pausedForDemo)return;pausedForDemo=false;removeResume();const dialog=ensureDialog();showSlide();dialog.showModal();document.body.classList.add('presentation-open');startTick();dialog.querySelector(index<deck.slides.length-1?'[data-presentation-action="next"]':'[data-presentation-action="close"]').focus();}
  async function fullscreen(){const dialog=ensureDialog();try{if(document.fullscreenElement===dialog)await document.exitFullscreen();else if(dialog.requestFullscreen)await dialog.requestFullscreen();else throw new Error('unsupported');}catch{$('presentationStatus').textContent='A apresentação já ocupa a janela. Use o comando de tela cheia do navegador se quiser ocultar suas barras.';}}
  function cleanPrint(){printing=false;clearTimeout(printCleanupTimer);printCleanupTimer=null;$('presentationPrintRoot')?.remove();document.body.classList.remove('presentation-printing');}
  async function printPresentation(value){
    const printDeck=normalizeDeck(value||deck);if(!printDeck||printing)return false;
    cleanPrint();printing=true;
    const root=document.createElement('div');root.id='presentationPrintRoot';root.className='presentation-print-root';
    root.innerHTML=printDeck.slides.map((slide,i)=>`<section class="presentation-print-page"><header>${logo}<span>${esc(printDeck.title)}</span></header><div class="presentation-print-content">${slide.html}</div><footer><span>${esc(printDeck.metadata)}</span><span>${i+1} / ${printDeck.slides.length} · ${esc(slide.label)}</span></footer></section>`).join('');
    document.body.append(root);document.body.classList.add('presentation-printing');
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try {global.print();} catch {cleanPrint();return false;}
    // Browsers dispatch afterprint after the print preview closes. Keep the DOM
    // available until then; this timeout is only a fallback for missing events.
    printCleanupTimer=setTimeout(cleanPrint,120000);
    return true;
  }
  function render(value){
    if(value!==undefined)model=value;
    const container=$('view-portfolio');if(!container)return;
    container.classList.add('portfolio-view');
    let minutes=0;
    const agenda=SLIDES.map((slide,i)=>{const start=clock(minutes);minutes+=slide.duration;return `<details class="portfolio-agenda-item"><summary><span class="portfolio-agenda-time">${start}–${clock(minutes)}</span><span><small>PARTE ${String(i+1).padStart(2,'0')}</small><strong>${esc(slide.label)}</strong></span><span class="portfolio-agenda-expand" aria-hidden="true">+</span></summary><div class="portfolio-speaker-notes"><span>APOIO PARA A FALA</span><p>${esc(slide.notes)}</p><button type="button" class="portfolio-link" data-portfolio-slide="${i}">Ensaiar a partir daqui <span aria-hidden="true">→</span></button></div></details>`;}).join('');
    container.innerHTML=`<div class="portfolio-page-heading"><div>${badge('APRESENTAÇÃO DO PAINEL')}<h2>Portfólio · Minerva Foods Claims</h2></div><div class="portfolio-actions"><button type="button" class="button button-outline" data-portfolio-action="pptx"${exportingPowerPoint?' disabled':''}>${exportingPowerPoint?'Gerando PowerPoint…':'Exportar PowerPoint'}</button><button type="button" class="button button-outline" data-portfolio-action="pdf">Exportar PDF</button><button type="button" class="button button-primary" data-portfolio-action="present">${icon('arrow')}Apresentar em 10 minutos</button></div></div><section class="portfolio-hero portfolio-reference-cover">${cover()}</section><section class="portfolio-section"><div class="portfolio-section-heading">${badge('01 · O ANTES E O DEPOIS')}<h2>Da conferência manual<br>à leitura do resultado.</h2><p>A complexidade da análise passa a ficar organizada em um fluxo que pode ser consultado e apresentado.</p></div>${beforeAfter()}</section><section class="portfolio-section portfolio-example-section"><div class="portfolio-section-heading">${badge('02 · UMA REGRA QUE FAZ DIFERENÇA')}<h2>Várias parcelas.<br>O mesmo claim.</h2></div>${orderExample()}</section><section class="portfolio-section"><div class="portfolio-section-heading">${badge('03 · NÚMEROS COM CONTEXTO')}<h2>Cada visão responde<br>a uma pergunta.</h2></div>${receiptScopes()}<div class="portfolio-shortcuts">${jump('suppliers','Comparativo por fornecedor')}${jump('installments','Controle de recebimento')}${jump('analysts','Resultado por analista')}</div></section><section class="portfolio-agenda panel"><div class="portfolio-agenda-heading"><div>${badge('ROTEIRO PARA A APRESENTAÇÃO')}<h2>Dez minutos.<br>Uma história completa.</h2><p>Sete partes, com tempo sugerido e apoio para a fala. O modo apresentação tem cronômetro, navegação por setas e notas opcionais.</p></div><span class="portfolio-ten"><strong>10</strong><span>MINUTOS</span></span></div>${agenda}<div class="portfolio-agenda-footer"><p>As notas ficam visíveis na mesma tela quando abertas. Na reunião, mantenha-as fechadas se não quiser projetá-las.</p><button type="button" class="button button-primary" data-portfolio-action="present">Começar apresentação ${icon('arrow')}</button></div></section><section class="portfolio-section"><div class="portfolio-section-heading">${badge('04 · PARA CONTINUAR TODO MÊS')}<h2>Uma versão publicada.<br>Um acesso controlado.</h2></div>${governance()}<div class="portfolio-bottom-link"><p>Pronto para escolher o período e montar os gráficos da próxima reunião?</p>${jump('meeting','Abrir Reunião de resultados')}</div></section><p class="portfolio-publication">${esc(publishedLabel())}</p><p id="portfolioExportStatus" role="status" class="portfolio-export-status"></p>`;
  }
  function powerPointPayload(){return {kind:'portfolio',title:'Minerva Foods Claims',metadata:publishedLabel(),slides:SLIDES.map(slide=>({label:slide.label,notes:slide.notes,duration:slide.duration}))};}
  function updatePowerPointButton(){document.querySelectorAll('[data-portfolio-action="pptx"]').forEach(button=>{button.disabled=exportingPowerPoint;button.textContent=exportingPowerPoint?'Gerando PowerPoint…':'Exportar PowerPoint';button.setAttribute('aria-busy',String(exportingPowerPoint));});}
  async function exportPowerPoint(){
    if(exportingPowerPoint)return;exportingPowerPoint=true;updatePowerPointButton();
    const status=text=>{if($('portfolioExportStatus'))$('portfolioExportStatus').textContent=text;};
    status('Preparando o PowerPoint com o roteiro de 10 minutos…');
    try{
      if(!global.MinervaPowerPoint)throw new Error('Atualize a página para carregar a exportação em PowerPoint.');
      const result=await global.MinervaPowerPoint.exportPortfolio(powerPointPayload());
      if(result&&!result.cancelled)status(!result.logoIncluded?'PowerPoint gerado. O logo não carregou nesta tentativa; atualize a página e exporte novamente para incluí-lo.':result.coverIncluded===false?'PowerPoint gerado. A arte da capa não carregou; atualize a página e exporte novamente para incluí-la.':'PowerPoint gerado com roteiro e notas de apoio.');
    }catch(error){status(error.message||'Não foi possível gerar o PowerPoint. Tente novamente.');}
    finally{exportingPowerPoint=false;updatePowerPointButton();}
  }
  function present(){return openPresentation(portfolioDeck());}
  function exportPdf(){return printPresentation(portfolioDeck());}
  function clear(){model=null;closePresentation();cleanPrint();const container=$('view-portfolio');if(container)container.replaceChildren();}
  document.addEventListener('click',event=>{
    const presentationAction=event.target.closest('[data-presentation-action]');
    if(presentationAction){event.preventDefault();switch(presentationAction.dataset.presentationAction){case'close':closePresentation();break;case'next':if(deck&&index<deck.slides.length-1){index++;showSlide();}break;case'previous':if(index>0){index--;showSlide();}break;case'notes':notesVisible=!notesVisible;showSlide();break;case'pause':pause();break;case'restart':elapsedMs=0;startedAt=performance.now();updatePause();tick();break;case'fullscreen':fullscreen();break;case'resume':resumePresentation();break;}return;}
    const demoButton=event.target.closest('[data-portfolio-demo]');if(demoButton){event.preventDefault();demo(demoButton.dataset.portfolioDemo);return;}
    const portfolioAction=event.target.closest('[data-portfolio-action]');if(portfolioAction){event.preventDefault();portfolioAction.dataset.portfolioAction==='pdf'?exportPdf():portfolioAction.dataset.portfolioAction==='pptx'?exportPowerPoint():present();return;}
    const slide=event.target.closest('[data-portfolio-slide]');if(slide){event.preventDefault();present();index=Number(slide.dataset.portfolioSlide)||0;showSlide();}
  });
  document.addEventListener('keydown',event=>{
    if(!$('minervaPresentation')?.open||!deck||event.altKey||event.ctrlKey||event.metaKey||event.target.matches('input,textarea,select,[contenteditable="true"]'))return;
    if(['ArrowRight','PageDown','ArrowLeft','PageUp','Home','End'].includes(event.key)){event.preventDefault();if(['ArrowRight','PageDown'].includes(event.key))index=Math.min(index+1,deck.slides.length-1);else if(['ArrowLeft','PageUp'].includes(event.key))index=Math.max(index-1,0);else index=event.key==='Home'?0:deck.slides.length-1;showSlide();}
  });
  document.addEventListener('fullscreenchange',()=>{const button=$('minervaPresentation')?.querySelector('[data-presentation-action="fullscreen"]');if(button)button.textContent=document.fullscreenElement===$('minervaPresentation')?'Sair da tela cheia':'Tela cheia';});
  document.addEventListener('minerva:session-updated',event=>{if(global.MINERVA_HOSTED&&!event.detail)clear();});
  global.addEventListener('afterprint',cleanPrint);
  global.MinervaPresentation={open:openPresentation,print:printPresentation,close:closePresentation};
  global.MinervaPortfolio={render,clear,present,exportPdf,exportPowerPoint,powerPointPayload,slides:()=>SLIDES.map(slide=>({...slide})),duration:()=>totalDuration(SLIDES)};
})(typeof window==='undefined'?globalThis:window);
