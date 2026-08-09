'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
  const out =
    process.env.PDF_FORGE_ACCEPTANCE_OUT ||
    path.join(__dirname, '..', 'host-large-preflight-sim.json');
  const ev = { verdict: 'FAIL', steps: [] };
  const t0 = Date.now();
  const step = async (name, fn, ms = 45000) => {
    const t = Date.now();
    const result = await Promise.race([
      fn(),
      new Promise((_, rej) => setTimeout(() => rej(new Error(name + ' timeout ' + ms + 'ms')), ms)),
    ]);
    ev.steps.push({ step: name, ms: Date.now() - t, result: result && typeof result === 'object' ? result : undefined });
    return result;
  };
  try {
    const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
    await ext.activate();
    const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
    const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
    const { convertPdf, warmPdfParseEngine, __resetPdfParseWarmForTests } = req('./out/convertPdf.js');
    const folders = vscode.workspace.workspaceFolders || [];
    const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
    const large = path.join(rootA, 'largefirst', 'a-large.pdf');
    const small = path.join(rootA, 'largefirst', 'b-small.pdf');
    const buf = (p) => Buffer.from(fs.readFileSync(p));

    __resetPdfParseWarmForTests();
    await step('warm', () => warmPdfParseEngine(ext.extensionPath, { force: true }), 15000);
    __resetPdfInspectCacheForTests();
    await step('inspect-large', () => inspectPdf(buf(large)), 30000);
    await step('inspect-small', () => inspectPdf(buf(small)), 30000);
    await new Promise((r) => setTimeout(r, 800));
    await step('rewarm', () => warmPdfParseEngine(ext.extensionPath, { force: true }), 15000);
    const conv = await step('convert-large', () => convertPdf(buf(large), 'largefirst/a-large.pdf'), 45000);
    ev.convert = {
      quality: conv.quality,
      pageCount: conv.pageCount,
      chars: conv.normalizedTextChars,
    };
    await step('convert-small', () => convertPdf(buf(small), 'largefirst/b-small.pdf'), 30000);
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
