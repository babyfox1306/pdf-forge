/** Timing / order isolation for inspect→convert XRef flake. */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-timing-probe.json');
    const evidence = { cases: {}, verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        const pdfPath = path.join(rootA, 'docs', 'same.pdf');
        const createRequire = require('module').createRequire;
        const req = createRequire(path.join(ext.extensionPath, 'package.json'));
        const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
        const { convertPdf } = req('./out/convertPdf.js');
        const { hashBuffer } = req('./out/hash.js');

        async function tryConvert(label, delayMs) {
            __resetPdfInspectCacheForTests();
            const buffer = await fs.promises.readFile(pdfPath);
            hashBuffer(buffer);
            await inspectPdf(Buffer.from(buffer));
            if (delayMs) await sleep(delayMs);
            const pdfBuffer = await fs.promises.readFile(pdfPath);
            try {
                const r = await convertPdf(Buffer.from(pdfBuffer), 'docs/same.pdf');
                evidence.cases[label] = { ok: true, quality: r.quality, delayMs };
            } catch (e) {
                evidence.cases[label] = { ok: false, error: e.message, delayMs };
            }
        }

        await tryConvert('delay0', 0);
        await tryConvert('delay100', 100);
        await tryConvert('delay500', 500);
        await tryConvert('delay2000', 2000);

        // convert-first warm then inspect+convert
        __resetPdfInspectCacheForTests();
        try {
            await convertPdf(fs.readFileSync(pdfPath), 'docs/same.pdf');
            evidence.cases.warmConvertAlone = { ok: true };
        } catch (e) {
            evidence.cases.warmConvertAlone = { ok: false, error: e.message };
        }
        await tryConvert('afterWarm', 0);

        evidence.verdict = Object.values(evidence.cases).some((c) => c.ok && c.delayMs !== undefined)
            ? 'PARTIAL'
            : 'FAIL';
        if (evidence.cases.afterWarm?.ok) evidence.verdict = 'WARM_HELPS';
        if (['delay0', 'delay100', 'delay500', 'delay2000'].every((k) => evidence.cases[k]?.ok)) {
            evidence.verdict = 'PASS';
        }
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(JSON.stringify(evidence, null, 2));
    // always exit 0 so evidence is easy to read via runTests success path — still write file in finally of runner
    if (evidence.verdict === 'FAIL') throw new Error(JSON.stringify(evidence));
}

module.exports = { run };
