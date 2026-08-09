/**
 * Packaged-host probe: load inspectPdf from an unpacked VSIX tree
 * using the same CommonJS out/ layout the extension host uses.
 *
 * Usage:
 *   node test/spike/run-packaged-host-probe.js <unpacked-extension-dir> <fixture.pdf>
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

async function main() {
    const extensionRoot = process.argv[2];
    const fixturePath = process.argv[3];
    if (!extensionRoot || !fixturePath) {
        console.error('Usage: node run-packaged-host-probe.js <unpacked-extension-dir> <fixture.pdf>');
        process.exit(2);
    }

    const inspectPath = path.join(extensionRoot, 'out', 'pdfInspect.js');
    if (!fs.existsSync(inspectPath)) {
        console.error('MISSING', inspectPath);
        process.exit(1);
    }

    const legacyPdf = path.join(
        extensionRoot,
        'node_modules',
        'pdfjs-dist',
        'legacy',
        'build',
        'pdf.mjs'
    );
    const legacyWorker = path.join(
        extensionRoot,
        'node_modules',
        'pdfjs-dist',
        'legacy',
        'build',
        'pdf.worker.mjs'
    );

    const evidence = {
        extensionRoot,
        inspectPath,
        legacyPdfPresent: fs.existsSync(legacyPdf),
        legacyWorkerPresent: fs.existsSync(legacyWorker),
        importMechanism: 'dynamic import(pathToFileURL(.../pdfjs-dist/legacy/build/pdf.mjs)) from CommonJS out/pdfInspect.js',
        packageSubpath: 'pdfjs-dist/legacy/build/pdf.mjs (+ pdf.worker.mjs via GlobalWorkerOptions.workerSrc file:// URL)',
        fixturePath,
        error: null,
        result: null,
        instrumentation: null,
        wallMs: null,
        rssBefore: process.memoryUsage().rss,
        rssAfter: null,
    };

    if (!evidence.legacyPdfPresent || !evidence.legacyWorkerPresent) {
        evidence.error = 'pdfjs-dist legacy build missing from packaged extension';
        console.log(JSON.stringify(evidence, null, 2));
        process.exit(1);
    }

    // Ensure relative resolution from out/ finds packaged node_modules
    process.chdir(extensionRoot);

    const { inspectPdf, __resetPdfInspectCacheForTests } = require(inspectPath);
    __resetPdfInspectCacheForTests();

    const counts = {
        getTextContent: 0,
        render: 0,
        getOperatorList: 0,
        destroyDocument: 0,
        destroyLoadingTask: 0,
    };

    const buf = fs.readFileSync(fixturePath);
    const t0 = performance.now();
    try {
        const result = await inspectPdf(buf, {
            onGetTextContent: () => counts.getTextContent++,
            onRender: () => counts.render++,
            onGetOperatorList: () => counts.getOperatorList++,
            onDestroyDocument: () => counts.destroyDocument++,
            onDestroyLoadingTask: () => counts.destroyLoadingTask++,
        });
        evidence.result = result;
        evidence.instrumentation = counts;
        evidence.wallMs = Math.round(performance.now() - t0);
        evidence.rssAfter = process.memoryUsage().rss;
    } catch (e) {
        evidence.error = e && e.stack ? e.stack : String(e);
        evidence.wallMs = Math.round(performance.now() - t0);
        evidence.rssAfter = process.memoryUsage().rss;
        console.log(JSON.stringify(evidence, null, 2));
        process.exit(1);
    }

    const pass =
        evidence.result &&
        typeof evidence.result.pageCount === 'number' &&
        evidence.result.pageCount > 0 &&
        counts.getTextContent === 0 &&
        counts.render === 0 &&
        counts.destroyDocument >= 1;

    evidence.verdict = pass ? 'PASS' : 'FAIL';
    console.log(JSON.stringify(evidence, null, 2));
    process.exit(pass ? 0 : 1);
}

main();
