/** Prove: require pdf-parse before inspect prevents XRef flake. */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-order-probe.json');
    const evidence = { verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        const pdfPath = path.join(rootA, 'docs', 'same.pdf');
        const createRequire = require('module').createRequire;
        const req = createRequire(path.join(ext.extensionPath, 'package.json'));

        // Warm pdf-parse BEFORE any inspect
        req('pdf-parse');
        evidence.warmed = true;

        const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
        const { convertPdf } = req('./out/convertPdf.js');
        const { hashBuffer } = req('./out/hash.js');
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');

        __resetPdfInspectCacheForTests();
        const buffer = await fs.promises.readFile(pdfPath);
        hashBuffer(buffer);
        await inspectPdf(Buffer.from(buffer));
        try {
            const r = await convertPdf(Buffer.from(await fs.promises.readFile(pdfPath)), 'docs/same.pdf');
            evidence.immediateAfterInspect = { ok: true, quality: r.quality };
        } catch (e) {
            evidence.immediateAfterInspect = { ok: false, error: e.message };
        }

        fs.rmSync(path.join(rootA, 'pdf-forge-exports'), { recursive: true, force: true });
        const mem = new Map();
        const batchCtx = {
            globalState: {
                get(k, d) {
                    return mem.has(k) ? mem.get(k) : d;
                },
                async update(k, v) {
                    mem.set(k, v);
                },
            },
            workspaceState: { get() {}, async update() {} },
            extensionPath: ext.extensionPath,
            globalStorageUri: vscode.Uri.file(path.join(rootA, '.g')),
            subscriptions: [],
        };
        __resetBatchLockForTests();
        const b = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'docs')), batchCtx, {
            openExternal: async () => true,
        });
        evidence.batch = { converted: b.converted, message: b.message };
        evidence.verdict =
            evidence.immediateAfterInspect.ok && b.converted === 1 ? 'PASS' : 'FAIL';
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    if (evidence.verdict !== 'PASS') throw new Error(JSON.stringify(evidence));
}

module.exports = { run };
