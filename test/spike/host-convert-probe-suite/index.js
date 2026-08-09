/** Minimal host probe: inspect then convert inside real extension host. */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-convert-probe.json');
    const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
    await ext.activate();
    const createRequire = require('module').createRequire;
    const req = createRequire(path.join(ext.extensionPath, 'package.json'));
    const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
    const { convertPdf } = req('./out/convertPdf.js');
    const fixture = path.join(ext.extensionPath, 'test-fixtures', 'normal.pdf');
    const evidence = { fixture, exists: fs.existsSync(fixture), trials: [] };
    try {
        for (let t = 0; t < 5; t++) {
            __resetPdfInspectCacheForTests();
            const trial = { t };
            const buf = fs.readFileSync(fixture);
            trial.inspect = await inspectPdf(Buffer.from(buf));
            // mimic batch gap (manifest load / ensureOutputRoot)
            await new Promise((r) => setTimeout(r, 50));
            try {
                trial.convert = await convertPdf(fs.readFileSync(fixture), 'docs/same.pdf');
                trial.ok = true;
            } catch (e) {
                trial.convertError = e.message;
                trial.ok = false;
                try {
                    trial.convertRetry = await convertPdf(
                        Buffer.from(fs.readFileSync(fixture)),
                        'docs/same.pdf'
                    );
                    trial.retryOk = true;
                } catch (e2) {
                    trial.retryError = e2.message;
                    trial.retryOk = false;
                }
            }
            evidence.trials.push(trial);
        }
        evidence.verdict = evidence.trials.every((x) => x.ok || x.retryOk) ? 'PASS' : 'FAIL';
        evidence.passCount = evidence.trials.filter((x) => x.ok || x.retryOk).length;
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
        evidence.verdict = 'FAIL';
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    if (evidence.verdict !== 'PASS') throw new Error(JSON.stringify(evidence));
}

module.exports = { run };
