'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-large-inspect.json');
    const ev = { verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
        const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
        const { convertPdf, warmPdfParseEngine, __resetPdfParseWarmForTests } = req(
            './out/convertPdf.js'
        );
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
        const pdf = path.join(rootA, 'largefirst', 'a-large.pdf');
        const buf = fs.readFileSync(pdf);
        ev.size = buf.length;

        __resetPdfParseWarmForTests();
        await warmPdfParseEngine(ext.extensionPath, { force: true });
        let t = Date.now();
        __resetPdfInspectCacheForTests();
        ev.inspect = await inspectPdf(Buffer.from(buf));
        ev.inspectMs = Date.now() - t;

        t = Date.now();
        await warmPdfParseEngine(ext.extensionPath, { force: true });
        ev.convert = await convertPdf(Buffer.from(buf), 'largefirst/a-large.pdf');
        ev.convertMs = Date.now() - t;
        ev.verdict = 'PASS';
    } catch (e) {
        ev.error = String(e && e.stack ? e.stack : e);
    }
    fs.writeFileSync(out, JSON.stringify(ev, null, 2));
    if (ev.verdict !== 'PASS') throw new Error(ev.error || 'fail');
}

module.exports = { run };
