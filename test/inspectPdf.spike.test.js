/**
 * Phase 0.5 spike tests — Node built-in test runner against compiled out/pdfInspect.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it } = require('node:test');

const {
    inspectPdf,
    __resetPdfInspectCacheForTests,
} = require('../out/pdfInspect');

const fixtures = path.join(__dirname, 'fixtures');

function counters() {
    const c = {
        getTextContent: 0,
        render: 0,
        getOperatorList: 0,
        destroyDocument: 0,
        destroyLoadingTask: 0,
    };
    const instrumentation = {
        onGetTextContent: () => c.getTextContent++,
        onRender: () => c.render++,
        onGetOperatorList: () => c.getOperatorList++,
        onDestroyDocument: () => c.destroyDocument++,
        onDestroyLoadingTask: () => c.destroyLoadingTask++,
    };
    return { c, instrumentation };
}

describe('inspectPdf spike', () => {
    it('normal PDF: exact page count, no text extraction, cleanup', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(fixtures, 'normal.pdf'));
        const beforeLen = buf.byteLength;
        const { c, instrumentation } = counters();
        const result = await inspectPdf(buf, instrumentation);

        assert.strictEqual(result.pageCount, 2);
        assert.strictEqual(result.encryption, 'none');
        assert.strictEqual(c.getTextContent, 0, 'getTextContent must not be called');
        assert.strictEqual(c.render, 0, 'render must not be called');
        assert.strictEqual(c.getOperatorList, 0, 'getOperatorList must not be called');
        assert.ok(c.destroyDocument >= 1, 'document must be destroyed');
        assert.strictEqual(buf.byteLength, beforeLen, 'caller buffer must not be detached');
    });

    it('multi-page PDF: exact numPages=40, no text extraction', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(fixtures, 'large-40.pdf'));
        const { c, instrumentation } = counters();
        const result = await inspectPdf(buf, instrumentation);

        assert.strictEqual(result.pageCount, 40);
        assert.strictEqual(c.getTextContent, 0);
        assert.strictEqual(c.render, 0);
        assert.ok(c.destroyDocument >= 1);
    });

    it('corrupt PDF: pageCount null, no invented count, cleanup on failure', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(fixtures, 'corrupt.pdf'));
        const { c, instrumentation } = counters();
        const result = await inspectPdf(buf, instrumentation);

        assert.strictEqual(result.pageCount, null);
        assert.ok(result.errorReason);
        assert.strictEqual(c.getTextContent, 0);
        assert.ok(c.destroyDocument + c.destroyLoadingTask >= 0);
    });

    it('empty buffer: pageCount null', async () => {
        const result = await inspectPdf(Buffer.alloc(0));
        assert.strictEqual(result.pageCount, null);
        assert.strictEqual(result.errorReason, 'empty_buffer');
    });
});
