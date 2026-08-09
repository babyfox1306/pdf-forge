'use strict';

/**
 * Preflight inspect tests (extends spike coverage for §16.3).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');
const {
    inspectPdf,
    __resetPdfInspectCacheForTests,
} = require('../out/pdfInspect');
const { hashBuffer } = require('../out/hash');
const { ensureGeneratedFixtures, FIXTURES, buildEncryptedPdfStub } = require('./helpers/makePdf');

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

describe('preflight.inspect', () => {
    before(() => {
        ensureGeneratedFixtures();
    });

    it('page count without getTextContent / render / getOperatorList', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        const { c, instrumentation } = counters();
        const result = await inspectPdf(buf, instrumentation);
        assert.strictEqual(result.pageCount, 2);
        assert.strictEqual(c.getTextContent, 0);
        assert.strictEqual(c.render, 0);
        assert.strictEqual(c.getOperatorList, 0);
    });

    it('resources released after each inspected document', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(FIXTURES, 'large-40.pdf'));
        const { c, instrumentation } = counters();
        await inspectPdf(buf, instrumentation);
        assert.ok(c.destroyDocument >= 1, 'document destroyed');
    });

    it('unknown / corrupt remains pageCount null', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(FIXTURES, 'corrupt.pdf'));
        const result = await inspectPdf(buf);
        assert.strictEqual(result.pageCount, null);
        assert.ok(result.errorReason);
    });

    it('shared-buffer: hash + inspect from same buffer without detachment', async () => {
        __resetPdfInspectCacheForTests();
        const buf = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        const beforeLen = buf.byteLength;
        const sourceHash = hashBuffer(buf);
        assert.strictEqual(buf.byteLength, beforeLen, 'hash must not detach');
        const result = await inspectPdf(buf);
        assert.strictEqual(buf.byteLength, beforeLen, 'inspect must not detach caller buffer');
        assert.strictEqual(typeof sourceHash, 'string');
        assert.strictEqual(sourceHash.length, 64);
        assert.strictEqual(result.pageCount, 2);
        // Second hash of same buffer matches — no third independent read required for hash
        assert.strictEqual(hashBuffer(buf), sourceHash);
    });

    it('encrypted fixture classifies as encrypted or unknown (not invented page count)', async () => {
        __resetPdfInspectCacheForTests();
        const buf = buildEncryptedPdfStub();
        const result = await inspectPdf(buf);
        assert.strictEqual(result.pageCount, null);
        assert.ok(
            result.encryption === 'encrypted' || result.encryption === 'unknown',
            `got encryption=${result.encryption}`
        );
    });

    it('sequential inspects do not retain prior document proxies (cleanup each time)', async () => {
        __resetPdfInspectCacheForTests();
        let destroys = 0;
        for (const name of ['normal.pdf', 'large-40.pdf', 'no-text.pdf']) {
            const buf = fs.readFileSync(path.join(FIXTURES, name));
            const { c, instrumentation } = counters();
            await inspectPdf(buf, instrumentation);
            destroys += c.destroyDocument;
            assert.strictEqual(c.getTextContent, 0);
        }
        assert.ok(destroys >= 3);
    });
});
