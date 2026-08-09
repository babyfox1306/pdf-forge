/** Host batch-only probe against multi-root workspace. */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-batch-probe.json');
    const evidence = { folders: [], verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const folders = vscode.workspace.workspaceFolders || [];
        evidence.folders = folders.map((f) => ({ name: f.name, fsPath: f.uri.fsPath }));
        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        if (!rootA) throw new Error('no root A');

        const createRequire = require('module').createRequire;
        const req = createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');
        const { convertPdf } = req('./out/convertPdf.js');
        const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');

        const pdfPath = path.join(rootA, 'docs', 'same.pdf');
        evidence.pdfExists = fs.existsSync(pdfPath);
        evidence.pdfHash = require('crypto')
            .createHash('sha256')
            .update(fs.readFileSync(pdfPath))
            .digest('hex');

        // Direct path (control)
        __resetPdfInspectCacheForTests();
        evidence.directInspect = await inspectPdf(Buffer.from(fs.readFileSync(pdfPath)));
        try {
            evidence.directConvert = {
                ok: true,
                quality: (await convertPdf(fs.readFileSync(pdfPath), 'docs/same.pdf')).quality,
            };
        } catch (e) {
            evidence.directConvert = { ok: false, error: e.message };
        }

        // Batch path
        const mem = new Map();
        const batchCtx = {
            globalState: {
                get(key, def) {
                    return mem.has(key) ? mem.get(key) : def;
                },
                async update(key, value) {
                    mem.set(key, value);
                },
            },
            workspaceState: { get() {}, async update() {} },
            extensionPath: ext.extensionPath,
            globalStorageUri: vscode.Uri.file(path.join(rootA, '.g')),
            subscriptions: [],
        };
        __resetBatchLockForTests();
        const r = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'docs')), batchCtx, {
            openExternal: async () => true,
        });
        const man = path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json');
        evidence.batch = {
            message: r.message,
            converted: r.converted,
            failed: r.failed,
            manifest: fs.existsSync(man) ? JSON.parse(fs.readFileSync(man, 'utf8')) : null,
            md: fs.existsSync(
                path.join(rootA, 'pdf-forge-exports', 'docs', 'same', 'document.md')
            ),
        };
        evidence.verdict =
            evidence.batch.converted === 1 && evidence.directConvert.ok ? 'PASS' : 'FAIL';
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
        evidence.verdict = 'FAIL';
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    if (evidence.verdict !== 'PASS') throw new Error(JSON.stringify(evidence, null, 2));
}

module.exports = { run };
