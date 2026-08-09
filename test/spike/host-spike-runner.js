/**
 * Launch real VS Code / Cursor extension host against the packaged install,
 * invoke inspectPdf once, write evidence JSON, exit.
 *
 * Activated via: pdf-forge.inspectHostSpike (spike-only command).
 */
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

async function runSpike(context) {
    const outPath =
        process.env.PDF_FORGE_SPIKE_OUT ||
        path.join(context.globalStorageUri.fsPath, 'inspect-host-spike.json');

    const { inspectPdf, __resetPdfInspectCacheForTests } = require('./pdfInspect');
    __resetPdfInspectCacheForTests();

    const fixture =
        process.env.PDF_FORGE_SPIKE_FIXTURE ||
        path.join(context.extensionPath, '..', '..', '..', 'test', 'fixtures', 'normal.pdf');

    // Prefer fixture bundled beside extension if present
    const bundledCandidates = [
        process.env.PDF_FORGE_SPIKE_FIXTURE,
        path.join(context.extensionPath, 'test-fixtures', 'normal.pdf'),
        path.join(context.extensionPath, '..', 'test', 'fixtures', 'normal.pdf'),
    ].filter(Boolean);

    let fixturePath = bundledCandidates.find((p) => p && fs.existsSync(p));
    if (!fixturePath) {
        // last resort: generate minimal 1-page via reading workspace
        const folders = vscode.workspace.workspaceFolders;
        if (folders && folders[0]) {
            const p = path.join(folders[0].uri.fsPath, 'test', 'fixtures', 'normal.pdf');
            if (fs.existsSync(p)) fixturePath = p;
        }
    }

    const evidence = {
        host: 'vscode-extension-host',
        extensionPath: context.extensionPath,
        fixturePath: fixturePath || null,
        importMechanism:
            'dynamic import(file URL of packaged node_modules/pdfjs-dist/legacy/build/pdf.mjs)',
        packageSubpath: 'pdfjs-dist/legacy/build/pdf.mjs',
        result: null,
        instrumentation: null,
        error: null,
        wallMs: null,
    };

    try {
        if (!fixturePath) {
            throw new Error('No fixture PDF found for host spike');
        }
        const counts = {
            getTextContent: 0,
            render: 0,
            getOperatorList: 0,
            destroyDocument: 0,
            destroyLoadingTask: 0,
        };
        const buf = fs.readFileSync(fixturePath);
        const t0 = Date.now();
        const result = await inspectPdf(buf, {
            onGetTextContent: () => counts.getTextContent++,
            onRender: () => counts.render++,
            onGetOperatorList: () => counts.getOperatorList++,
            onDestroyDocument: () => counts.destroyDocument++,
            onDestroyLoadingTask: () => counts.destroyLoadingTask++,
        });
        evidence.result = result;
        evidence.instrumentation = counts;
        evidence.wallMs = Date.now() - t0;
        evidence.verdict =
            result.pageCount &&
            result.pageCount > 0 &&
            counts.getTextContent === 0 &&
            counts.render === 0 &&
            counts.destroyDocument >= 1
                ? 'PASS'
                : 'FAIL';
    } catch (e) {
        evidence.error = e && e.stack ? String(e.stack) : String(e);
        evidence.verdict = 'FAIL';
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf8');
    return evidence;
}

module.exports = { runSpike };
