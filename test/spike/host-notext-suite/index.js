'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { stubGuideUi } = require('../stubGuideUi');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-notext-probe.json');
    const ev = { verdict: 'FAIL' };
    try {
        stubGuideUi(vscode);
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');
        const { inspectPdf, __resetPdfInspectCacheForTests } = req('./out/pdfInspect.js');
        const { convertPdf, warmPdfParseEngine, __resetPdfParseWarmForTests } = req(
            './out/convertPdf.js'
        );
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
        const pdf = path.join(rootA, 'notext', 'empty.pdf');

        __resetPdfParseWarmForTests();
        await warmPdfParseEngine(ext.extensionPath, { force: true });
        __resetPdfInspectCacheForTests();
        ev.inspect = await inspectPdf(Buffer.from(fs.readFileSync(pdf)));
        await new Promise((r) => setTimeout(r, 800));
        await warmPdfParseEngine(ext.extensionPath, { force: true });
        ev.convert = await convertPdf(Buffer.from(fs.readFileSync(pdf)), 'notext/empty.pdf');

        const mem = new Map();
        const ctx = {
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
        const r = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'notext')), ctx, {
            openExternal: async () => true,
            showInformationMessage: async () => 'Not now',
            showWarningMessage: async () => undefined,
        });
        const man = JSON.parse(
            fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
        );
        ev.batch = {
            message: r.message,
            entry: man.entries.find((e) => e.source === 'notext/empty.pdf'),
            md: fs.existsSync(
                path.join(rootA, 'pdf-forge-exports', 'notext', 'empty', 'document.md')
            ),
            pagesUsed: mem.get('pdf-forge.batchUsage')?.pagesUsed,
        };
        assert.ok(ev.inspect.pageCount >= 1);
        assert.strictEqual(ev.inspect.encryption, 'none');
        assert.strictEqual(ev.convert.quality, 'no_text');
        assert.ok(ev.convert.normalizedTextChars < 10);
        assert.strictEqual((ev.convert.markdown || '').length, 0);
        assert.strictEqual(ev.batch.entry.status, 'no_text');
        assert.strictEqual(ev.batch.md, false);
        assert.strictEqual((ev.batch.entry.chargedSourceHashes || []).length, 0);
        assert.strictEqual(ev.batch.pagesUsed, 0);
        ev.diagClass = 'A_valid_pdf_extract_ok';
        ev.verdict = 'PASS';
    } catch (e) {
        ev.error = String(e && e.stack ? e.stack : e);
        ev.verdict = 'FAIL';
    }
    fs.writeFileSync(out, JSON.stringify(ev, null, 2));
    if (ev.verdict !== 'PASS') throw new Error(ev.error || 'fail');
}

module.exports = { run };
