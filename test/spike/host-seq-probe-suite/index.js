/** Reproduce orchestrator inspect→convert sequence exactly. */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-seq-probe.json');
    const evidence = { verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        const pdfPath = path.join(rootA, 'docs', 'same.pdf');

        const createRequire = require('module').createRequire;
        const req = createRequire(path.join(ext.extensionPath, 'package.json'));
        const { inspectPdf } = req('./out/pdfInspect.js');
        const { convertPdf } = req('./out/convertPdf.js');
        const { hashBuffer } = req('./out/hash.js');

        // Exact batch preflight+convert sequence
        let buffer = await fs.promises.readFile(pdfPath);
        const sourceHash = hashBuffer(buffer);
        const inspection = await inspectPdf(Buffer.from(buffer));
        void buffer;
        evidence.inspection = inspection;
        evidence.sourceHash = sourceHash;

        const pdfBuffer = await fs.promises.readFile(pdfPath);
        try {
            const c1 = await convertPdf(pdfBuffer, 'docs/same.pdf');
            evidence.c1 = { ok: true, quality: c1.quality };
        } catch (e) {
            evidence.c1 = { ok: false, error: e.message };
            try {
                const c2 = await convertPdf(Buffer.from(pdfBuffer), 'docs/same.pdf');
                evidence.c2 = { ok: true, quality: c2.quality };
            } catch (e2) {
                evidence.c2 = { ok: false, error: e2.message };
            }
        }

        // Control: immediate without hash
        const b2 = await fs.promises.readFile(pdfPath);
        const insp2 = await inspectPdf(Buffer.from(b2));
        try {
            const c3 = await convertPdf(await fs.promises.readFile(pdfPath), 'docs/same.pdf');
            evidence.control = { ok: true, insp2, quality: c3.quality };
        } catch (e) {
            evidence.control = { ok: false, insp2, error: e.message };
        }

        evidence.verdict = evidence.c1?.ok || evidence.c2?.ok ? 'PASS' : 'FAIL';
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    if (evidence.verdict !== 'PASS') throw new Error(JSON.stringify(evidence, null, 2));
}

module.exports = { run };
