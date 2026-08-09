'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before } = require('node:test');
const { classifyTextQuality, normalizeTextChars } = require('../out/textQuality');
const {
    ensureGeneratedFixtures,
    FIXTURES,
    buildEncryptedPdfStub,
} = require('./helpers/makePdf');

/**
 * Run convertPdf while pdf-parse resolves to `impl` (kept installed for the async call).
 */
async function withPdfParseMock(impl, fn) {
    const pdfParsePath = require.resolve('pdf-parse');
    const prev = require.cache[pdfParsePath];
    require.cache[pdfParsePath] = {
        id: pdfParsePath,
        filename: pdfParsePath,
        loaded: true,
        exports: impl,
    };
    const convertPath = require.resolve('../out/convertPdf.js');
    delete require.cache[convertPath];
    try {
        const { convertPdf } = require('../out/convertPdf.js');
        return await fn(convertPdf);
    } finally {
        if (prev) {
            require.cache[pdfParsePath] = prev;
        } else {
            delete require.cache[pdfParsePath];
        }
        delete require.cache[convertPath];
    }
}

describe('convertPdf', () => {
    before(() => {
        ensureGeneratedFixtures();
    });

    it('normal PDF converts with pageCount and YAML front matter', async () => {
        const { convertPdf } = require('../out/convertPdf');
        const buf = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        const result = await convertPdf(buf, 'docs/normal.pdf');
        assert.ok(result.pageCount >= 1);
        assert.strictEqual(result.quality, 'converted');
        assert.ok(result.markdown.startsWith('---\n'));
        assert.ok(result.markdown.includes('source: "docs/normal.pdf"'));
        assert.match(result.markdown, /pages: \d+/);
        assert.strictEqual(
            result.quality,
            classifyTextQuality(result.normalizedTextChars, result.pageCount)
        );
    });

    it('no_text when normalized chars < 10', async () => {
        await withPdfParseMock(async () => ({
            text: '123456789',
            numpages: 1,
            info: {},
        }), async (convertPdf) => {
            const result = await convertPdf(Buffer.from('%PDF'), 'scan/empty.pdf');
            assert.strictEqual(result.quality, 'no_text');
            assert.strictEqual(result.markdown, '');
            assert.strictEqual(result.pageCount, 1);
            assert.strictEqual(result.normalizedTextChars, 9);
        });
    });

    it('low_text lower boundary at 10 and includes warning', async () => {
        await withPdfParseMock(async () => ({
            text: '0123456789',
            numpages: 1,
            info: {},
        }), async (convertPdf) => {
            const result = await convertPdf(Buffer.from('%PDF'), 'docs/low.pdf');
            assert.strictEqual(result.quality, 'low_text');
            assert.ok(result.markdown.includes('Warning'));
            assert.ok(result.markdown.includes('status: "low_text"'));
        });
    });

    it('converted at max(50, pageCount*40) boundary', async () => {
        await withPdfParseMock(async () => ({
            text: 'x'.repeat(50),
            numpages: 1,
            info: {},
        }), async (convertPdf) => {
            const result = await convertPdf(Buffer.from('%PDF'), 'docs/ok.pdf');
            assert.strictEqual(result.quality, 'converted');
            assert.ok(result.markdown.includes('status: "converted"'));
            assert.ok(!result.markdown.includes('Warning'));
        });
    });

    it('pageCount invariant: finite positive integer; rejects missing pages', async () => {
        const { convertPdf: realConvert } = require('../out/convertPdf');
        const buf = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        const result = await realConvert(buf, 'docs/pages.pdf');
        assert.ok(Number.isFinite(result.pageCount));
        assert.ok(result.pageCount >= 1);
        assert.strictEqual(result.pageCount, Math.floor(result.pageCount));

        await withPdfParseMock(async () => ({
            text: 'hello',
            numpages: 0,
            info: {},
        }), async (convertPdf) => {
            await assert.rejects(
                () => convertPdf(Buffer.from('%PDF'), 'x.pdf'),
                /page_count_unavailable/
            );
        });
    });

    it('YAML quoting for title and source with special characters', async () => {
        await withPdfParseMock(async () => ({
            text: 'x'.repeat(60),
            numpages: 1,
            info: { Title: 'Title: "Quotes" \\ Slash' },
        }), async (convertPdf) => {
            const source = 'yaml path (test)/doc#1.pdf';
            const result = await convertPdf(Buffer.from('%PDF'), source);
            assert.ok(result.markdown.includes(`source: "${source}"`));
            assert.ok(result.markdown.includes('title: "Title: \\"Quotes\\" \\\\ Slash"'));
            assert.match(result.markdown, /status: "/);
        });
    });

    it('encrypted stub fails closed (encrypted or extract error)', async () => {
        const { convertPdf } = require('../out/convertPdf');
        const buf = buildEncryptedPdfStub();
        try {
            await convertPdf(buf, 'secret.pdf');
            assert.fail('expected throw');
        } catch (error) {
            const msg = error?.message || String(error);
            assert.ok(
                msg === 'encrypted' ||
                    error?.code === 'encrypted' ||
                    /password|encrypt|Failed to extract|bad XRef|page_count/i.test(msg)
            );
        }
    });

    it('normalizeTextChars boundaries used by converter', () => {
        assert.strictEqual(normalizeTextChars('123456789'), 9);
        assert.strictEqual(classifyTextQuality(9, 1), 'no_text');
        assert.strictEqual(classifyTextQuality(10, 1), 'low_text');
    });
});
