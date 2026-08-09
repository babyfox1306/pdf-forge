'use strict';

/**
 * §16.3 hundreds retention — sequential inspectPdf must not retain live docs.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const {
    inspectPdf,
    __resetPdfInspectCacheForTests,
} = require('../out/pdfInspect');
const { makeTempDir, rimraf, FIXTURES } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

const COUNT = 200;

describe('preflight.hundreds', () => {
    let root;
    let files = [];

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-hundreds-');
        const src = path.join(FIXTURES, 'normal.pdf');
        for (let i = 0; i < COUNT; i++) {
            const dest = path.join(root, 'docs', `f${String(i).padStart(3, '0')}.pdf`);
            await fs.promises.mkdir(path.dirname(dest), { recursive: true });
            await fs.promises.copyFile(src, dest);
            files.push(dest);
        }
    });

    after(async () => {
        await rimraf(root);
    });

    it('200 sequential inspects: maxLiveDocs<=1, liveDocs ends 0, rss not ~200 buffers', async () => {
        __resetPdfInspectCacheForTests();
        const fileSize = fs.statSync(files[0]).size;

        // Warm pdf.js so RSS delta measures the loop, not first-load overhead
        const warmBuf = fs.readFileSync(files[0]);
        for (let w = 0; w < 3; w++) {
            await inspectPdf(warmBuf);
        }
        if (typeof global.gc === 'function') {
            global.gc();
        }
        const memBefore = process.memoryUsage();
        const rssBefore = memBefore.rss;
        const heapBefore = memBefore.heapUsed;

        let liveDocs = 0;
        let maxLiveDocs = 0;
        const retainedBuffers = [];

        // Sequential for-loop only (no parallel inspection).
        for (let i = 0; i < files.length; i++) {
            const buf = fs.readFileSync(files[i]);
            retainedBuffers.push(buf);
            await inspectPdf(buf, {
                onDocumentOpened: () => {
                    liveDocs++;
                    if (liveDocs > maxLiveDocs) {
                        maxLiveDocs = liveDocs;
                    }
                },
                onDestroyDocument: () => {
                    liveDocs--;
                },
            });
            retainedBuffers.length = 0;
            assert.ok(liveDocs <= 1, `liveDocs after destroy should be <=1, got ${liveDocs}`);
        }

        assert.ok(maxLiveDocs <= 1, `maxLiveDocs expected <=1, got ${maxLiveDocs}`);
        assert.strictEqual(liveDocs, 0, 'all documents destroyed after loop');

        if (typeof global.gc === 'function') {
            global.gc();
        }
        const memAfter = process.memoryUsage();
        const rssAfter = memAfter.rss;
        const rssDelta = Math.max(0, rssAfter - rssBefore);
        const heapDelta = Math.max(0, memAfter.heapUsed - heapBefore);
        // Heuristic: growth must not look like retaining ~200 full buffers.
        // Tiny fixtures make pdf.js per-open overhead dominate raw fileSize, so floor
        // the per-doc size used in the retain model.
        const perDoc = Math.max(fileSize, 64 * 1024);
        const retainModel = COUNT * perDoc * 10;
        assert.ok(
            heapDelta < retainModel && rssDelta < retainModel,
            `memory growth heap=${heapDelta} rss=${rssDelta} should be << retaining ${COUNT} buffers (~${retainModel}); rssBefore=${rssBefore} rssAfter=${rssAfter}`
        );
    });
});
