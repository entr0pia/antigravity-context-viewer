'use strict';
/**
 * Zero-dependency renderer builder for Antigravity Context Meter.
 * Assembles modular frontend components from src/renderer/ into a single
 * high-performance runtime file (dist/meter-renderer.js).
 */
const fs = require('fs');
const path = require('path');

function cleanCss(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

function cleanHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .join('\n');
}

function cleanJs(code) {
  return code
    .replace(/^\s*\/\/\s*={10,}.*$/gm, '')
    .split(/\r?\n/)
    .filter((line, idx, arr) => !(line.trim() === '' && arr[idx - 1]?.trim() === ''))
    .join('\n');
}

function build() {
  const rootDir = path.resolve(__dirname, '..');
  const srcDir = path.join(rootDir, 'src');
  const distDir = path.join(rootDir, 'dist');
  const rendererDir = path.join(srcDir, 'renderer');

  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  const css = cleanCss(fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8'));
  const html = cleanHtml(fs.readFileSync(path.join(rendererDir, 'template.html'), 'utf8'));
  const init = cleanJs(fs.readFileSync(path.join(rendererDir, 'init.js'), 'utf8'));
  const colors = cleanJs(fs.readFileSync(path.join(rendererDir, 'colors.js'), 'utf8'));
  const layout = cleanJs(fs.readFileSync(path.join(rendererDir, 'layout.js'), 'utf8'));
  const panels = cleanJs(fs.readFileSync(path.join(rendererDir, 'panels.js'), 'utf8'));
  const heatmap = cleanJs(fs.readFileSync(path.join(rendererDir, 'heatmap.js'), 'utf8'));
  const main = cleanJs(fs.readFileSync(path.join(rendererDir, 'main.js'), 'utf8'));

  const templateSnippet = `  shadow.innerHTML = \`<style>\n${css}\n  </style>\n\n${html}\`;`;
  const initInjected = init.replace('/* __RENDERER_TEMPLATE_INJECTION__ */', templateSnippet);

  const bundle = [
    initInjected,
    colors,
    layout,
    panels,
    heatmap,
    main
  ].join('\n\n');

  const targetFile = path.join(distDir, 'meter-renderer.js');
  fs.writeFileSync(targetFile, bundle, 'utf8');
  return { targetFile, bytes: Buffer.byteLength(bundle, 'utf8') };
}

if (require.main === module) {
  const result = build();
  console.log(`[Build] Assembled dist/meter-renderer.js (${(result.bytes / 1024).toFixed(1)} KB)`);
}

module.exports = { build };
