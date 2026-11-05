import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Publish only the browser demonstration. No server, private configuration,
// administrative entry screen or operational dataset enters this directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'dist');
const output = path.join(root, 'build/demo');
const files = [
  'index.html', 'site.webmanifest', 'styles.css', 'integration.css',
  'preferences.css', 'preferences.js', 'table-filters.css', 'table-filters.js',
  'column-layout.css', 'column-layout.js', 'charts.css', 'analysts.css',
  'analysts.js', 'team.css', 'copy-reference.css', 'copy-reference.js',
  'correction-progress.css', 'correction-impact.css', 'correction-impact.js',
  'powerpoint.js', 'portfolio.css', 'portfolio.js', 'meetings.css',
  'meetings.js', 'engine.js', 'app.js', 'vendor/xlsx.full.min.js',
  'vendor/pptxgen.bundle.js', 'vendor/pptxgen.LICENSE.txt',
  'assets/minerva-logo.png', 'assets/minerva-monogram.svg', 'assets/minerva-cover.png',
  'assets/montserrat-latin.woff2'
];

fs.rmSync(output, {recursive: true, force: true});
fs.mkdirSync(output, {recursive: true});
for (const file of files) {
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), {recursive: true});
  let bytes = fs.readFileSync(path.join(source, file));
  if (/\.(html|js|css)$/.test(file) && !file.startsWith('vendor/')) {
    let text = bytes.toString('utf8')
      .replaceAll('/assets/minerva-logo.webp', 'assets/minerva-logo.png')
      .replaceAll('/assets/minerva-favicon.png', 'assets/minerva-logo.png')
      .replaceAll('/assets/minerva-apple-touch-icon.jpg', 'assets/minerva-logo.png')
      .replaceAll('/assets/', 'assets/')
      .replaceAll('/site.webmanifest', 'site.webmanifest');
    if (file === 'index.html') {
      text = text.replace('sizes="180x180" ', '')
        .replace('Carregue suas planilhas para analisar os valores reais.', 'Explore os filtros, gráficos e exportações com os exemplos ilustrativos.')
        .replace('</head>', '  <link rel="stylesheet" href="demo-only.css">\n</head>')
        .replace('</body>', '  <script src="demo-start.js"></script>\n</body>');
    }
    if (file === 'app.js') {
      // Disable input at its entry points as well as hiding the controls.
      // The regular local source remains unchanged and supports its own imports.
      for (const signature of ['function openImports(){', 'async function fileChanged(event,kind){']) {
        if (!text.includes(signature)) throw new Error('Review demo import isolation: missing ' + signature);
      }
      text = text.replace('function openImports(){', "function openImports(){say('Esta demonstração utiliza somente dados fictícios.');return;")
        .replace('async function fileChanged(event,kind){', 'async function fileChanged(event,kind){return;');
    }
    bytes = Buffer.from(text);
  }
  fs.writeFileSync(target, bytes);
}

const manifest = JSON.parse(fs.readFileSync(path.join(output, 'site.webmanifest'), 'utf8'));
Object.assign(manifest, {
  id: './', start_url: './', scope: './',
  name: 'Minerva Foods Claims · Demonstração',
  short_name: 'Claims · Demo',
  description: 'Demonstração com dados fictícios. Não representa resultados reais da empresa.',
  icons: [{src: 'assets/minerva-logo.png', type: 'image/png', sizes: 'any', purpose: 'any'}]
});
fs.writeFileSync(path.join(output, 'site.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');
fs.writeFileSync(path.join(output, '.nojekyll'), '');
fs.writeFileSync(path.join(output, 'demo-only.css'), `
#openImports, #emptyImport, #importDialog { display: none !important; }
.public-demo-notice { display: block !important; }
`);
fs.writeFileSync(path.join(output, 'demo-start.js'), `
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
`);

// Verify the project-subpath contract without requiring a local browser server.
// Every linked HTML/CSS asset and every dynamic image must resolve in the bundle.
const index = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
for (const id of ['demoButton', 'sidebarUpdatedAt', 'sidebarUpdatedBy']) {
  if (!index.includes(`id="${id}"`)) throw new Error('Missing demo startup element: ' + id);
}
for (const className of ['topbar-actions', 'sidebar-publication']) {
  if (!new RegExp(`class="[^"]*\\b${className}\\b`).test(index)) throw new Error('Missing demo startup container: ' + className);
}
for (const match of index.matchAll(/(?:src|href)="([^"#]+)"/g)) {
  const ref = match[1];
  if (/^(?:https?:|data:)/.test(ref)) throw new Error('External HTML asset in demo: ' + ref);
  if (ref.startsWith('/')) throw new Error('Root-relative HTML asset in demo: ' + ref);
  if (!fs.existsSync(path.join(output, ref))) throw new Error('Missing demo asset: ' + ref);
}
for (const file of files.filter(file => /\.(css|js)$/.test(file) && !file.startsWith('vendor/'))) {
  const text = fs.readFileSync(path.join(output, file), 'utf8');
  if (/["'(]\/assets\//.test(text)) throw new Error('Root-relative image in ' + file);
  for (const match of text.matchAll(/(?:["']|url\(["']?)(assets\/[A-Za-z0-9_.-]+)(?:["']|\))/g)) {
    if (!fs.existsSync(path.join(output, match[1]))) throw new Error('Missing dynamic asset in ' + file + ': ' + match[1]);
  }
}
if (/team\.js|access\.js|MINERVA_HOSTED\s*=\s*true/.test(index)) throw new Error('Hosted access code must not load in the public demo');
console.log(JSON.stringify({directory: 'build/demo', files: files.length + 3, datasets: 'synthetic only', backend: false}));
