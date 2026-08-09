const path = require('path');
const fs = require('fs');
const vscode = require('vscode');

async function activate() {
  const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
  if (!ext.isActive) await ext.activate();
  return require(path.join(ext.extensionPath, 'out', 'convertPdf.js'));
}

async function run() {
  const out = path.join(__dirname, '..', 'host-large-convert-only.json');
  const pdf = path.join(__dirname, '..', '..', 'fixtures', 'large-101.pdf');
  const convertPdf = await activate();
  const t0 = Date.now();
  try {
    const r = await Promise.race([
      convertPdf.convertPdf(pdf),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout 45s')), 45000)),
    ]);
    fs.writeFileSync(out, JSON.stringify({ ok: true, ms: Date.now() - t0, quality: r.quality, pages: r.pageCount, chars: r.normalizedCharCount }, null, 2));
  } catch (e) {
    fs.writeFileSync(out, JSON.stringify({ ok: false, ms: Date.now() - t0, error: String(e && e.message || e) }, null, 2));
  }
}

module.exports = { run };
