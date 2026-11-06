
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
  document.querySelector('.sidebar-status-heading > span').textContent = 'Ambiente demonstrativo';
  for (const id of ['sidebarUpdatedAt', 'sidebarControlUpdatedAt']) document.getElementById(id).textContent = 'Dados fictícios';
  document.getElementById('sidebarLoadLabel').textContent = 'Demonstração';
  document.getElementById('sidebarUpdatedBy').textContent = 'Exemplos ilustrativos';
  originalButton.click();
})();
