
(() => {
  'use strict';
  for (const input of document.querySelectorAll('input[type="file"]')) input.disabled = true;
  const originalButton = document.getElementById('demoButton');
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'button button-primary';
  reset.textContent = 'Reiniciar demonstração';
  reset.addEventListener('click', () => originalButton.click());
  document.querySelector('.topbar-actions').append(reset);
  document.querySelector('.sidebar-publication > span').textContent = 'Ambiente demonstrativo';
  document.getElementById('sidebarUpdatedAt').textContent = 'Dados fictícios';
  document.getElementById('sidebarUpdatedBy').textContent = 'Exemplos ilustrativos';
  originalButton.click();
})();
