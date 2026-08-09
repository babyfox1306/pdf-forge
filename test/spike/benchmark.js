/**
 * Phase 0.5 benchmarks for inspectPdf (small + large).
 */
const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');
const { inspectPdf, __resetPdfInspectCacheForTests } = require('../../out/pdfInspect');

async function bench(label, fixture) {
    __resetPdfInspectCacheForTests();
    const buf = fs.readFileSync(fixture);
    const counts = { getTextContent: 0, render: 0, getOperatorList: 0, destroyDocument: 0, destroyLoadingTask: 0 };
    const rssBefore = process.memoryUsage().rss;
    const t0 = performance.now();
    const result = await inspectPdf(buf, {
        onGetTextContent: () => counts.getTextContent++,
        onRender: () => counts.render++,
        onGetOperatorList: () => counts.getOperatorList++,
        onDestroyDocument: () => counts.destroyDocument++,
        onDestroyLoadingTask: () => counts.destroyLoadingTask++,
    });
    const wallMs = performance.now() - t0;
    const rssAfter = process.memoryUsage().rss;
    return {
        label,
        fixture,
        bytes: buf.byteLength,
        result,
        instrumentation: counts,
        wallMs: Math.round(wallMs * 100) / 100,
        rssBefore,
        rssAfter,
        rssDelta: rssAfter - rssBefore,
    };
}

(async () => {
    const fixtures = path.join(__dirname, '..', 'fixtures');
    const small = await bench('small-normal', path.join(fixtures, 'normal.pdf'));
    const large = await bench('large-40', path.join(fixtures, 'large-40.pdf'));
    console.log(JSON.stringify({ small, large }, null, 2));
})();
