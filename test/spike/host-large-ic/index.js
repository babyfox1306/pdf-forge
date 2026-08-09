'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
  const out =
    process.env.PDF_FORGE_ACCEPTANCE_OUT ||
    path.join(__dirname, '..', 'host-large-ic.json');
  const ev = { verdict: 'FAIL', steps: [] };
  const t0 = Date.now();
  try {
    const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
    await ext.activate();
    const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
    const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
    const { convertPdf, warmPdfParseEngine, __resetPdfParseWarmForTests } = req('./out/convertPdf.js');
    const folders = vscode.workspace.workspaceFolders || [];
    const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
    const pdf = path.join(rootA, 'large-101.pdf');
    const buf = () => Buffer.from(fs.readFileSync(pdf));

    __resetPdfParseWarmForTests();
    const tw = Date.now();
    await warmPdfParseEngine(ext.extensionPath, { force: true });
    ev.steps.push({ step: 'warm', ms: Date.now() - tw });

    __resetPdfInspectCacheForTests();
    const ti = Date.now();
    const insp = await Promise.race([
      inspectPdf(buf()),
      new Promise((_, rej) => setTimeout(() => rej(new Error('inspect timeout 30s')), 30000)),
    ]);
    ev.inspect = insp;
    ev.steps.push({ step: 'inspect', ms: Date.now() - ti });

    await new Promise((r) => setTimeout(r, 800));
    const tw2 = Date.now();
    await warmPdfParseEngine(ext.extensionPath, { force: true });
    ev.steps.push({ step: 'rewarm', ms: Date.now() - tw2 });

    const tc = Date.now();
    const conv = await Promise.race([
      convertPdf(buf(), 'large-101.pdf'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('convert timeout 45s')), 45000)),
    ]);
    ev.convert = {
      quality: conv.quality,
      pageCount: conv.pageCount,
      chars: conv.normalizedTextChars,
      mdLen: (conv.markdown || '').length,
    };
    ev.steps.push({ step: 'convert', ms: Date.now() - tc });
    ev.verdict = 'PASS';
  } catch (e) {
    ev.error = String(e && e.stack ? e.stack : e);
    ev.verdict = 'FAIL';
  }
  ev.totalMs = Date.now() - t0;
  fs.writeFileSync(out, JSON.stringify(ev, null, 2));
  if (ev.verdict !== 'PASS') throw new Error(ev.error || 'fail');
}

module.exports = { run };
