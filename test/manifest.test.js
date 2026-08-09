'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { describe, it, before, after } = require('node:test');
const {
    validateManifest,
    createEmptyManifest,
    loadManifest,
    saveManifest,
    upsertEntry,
    removeMissingInSubtree,
    getEntry,
    MANIFEST_FILENAME,
} = require('../out/manifest');
const { FailClosedError, MANIFEST_SCHEMA_VERSION, CONVERTER_VERSION } = require('../out/types');
const { buildIndexMarkdown } = require('../out/indexBuilder');
const { hashFileContent } = require('../out/hash');

function entry(source, overrides = {}) {
    return {
        source,
        observedSourceHash: 'abc',
        pageCount: 2,
        status: 'converted',
        converterVersion: CONVERTER_VERSION,
        chargedSourceHashes: ['abc'],
        canonicalSourceHash: 'abc',
        canonicalOutputPath: source.replace(/\.pdf$/i, '') + '/document.md',
        canonicalOutputHash: 'out',
        ...overrides,
    };
}

describe('manifest', () => {
    let tmp;

    before(async () => {
        tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-forge-manifest-'));
    });

    after(async () => {
        await fs.promises.rm(tmp, { recursive: true, force: true });
    });

    it('schema validation accepts empty and rejects bad schema', () => {
        const empty = createEmptyManifest();
        assert.strictEqual(empty.schemaVersion, MANIFEST_SCHEMA_VERSION);
        assert.deepStrictEqual(validateManifest(empty), empty);

        assert.throws(
            () => validateManifest({ schemaVersion: 999, entries: [] }),
            (e) => e instanceof FailClosedError
        );
        assert.throws(
            () => validateManifest({ schemaVersion: 1, entries: [{ source: 'x' }] }),
            (e) => e instanceof FailClosedError
        );
        assert.throws(() => validateManifest(null), (e) => e instanceof FailClosedError);
    });

    it('atomic rewrite via saveManifest', async () => {
        const m = createEmptyManifest();
        upsertEntry(m, entry('docs/a.pdf'));
        await saveManifest(tmp, m);
        const filePath = path.join(tmp, MANIFEST_FILENAME);
        assert.ok(fs.existsSync(filePath));
        const loaded = await loadManifest(tmp);
        assert.strictEqual(loaded.entries.length, 1);
        assert.strictEqual(getEntry(loaded, 'docs/a.pdf').source, 'docs/a.pdf');
        // No leftover temps that look like complete manifest
        const leftovers = fs.readdirSync(tmp).filter((n) => n.endsWith('.tmp'));
        assert.deepStrictEqual(leftovers, []);
    });

    it('subtree merge: removeMissingInSubtree preserves other subtree', () => {
        const m = createEmptyManifest();
        upsertEntry(m, entry('docs/a.pdf'));
        upsertEntry(m, entry('docs/b.pdf'));
        upsertEntry(m, entry('manuals/x.pdf'));
        removeMissingInSubtree(m, 'docs', ['docs/a.pdf']);
        assert.ok(getEntry(m, 'docs/a.pdf'));
        assert.ok(!getEntry(m, 'docs/b.pdf'));
        assert.ok(getEntry(m, 'manuals/x.pdf'), 'manuals entry must remain');
    });

    it('corrupt manifest fail-closed', async () => {
        const badDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-forge-bad-m-'));
        try {
            await fs.promises.writeFile(
                path.join(badDir, MANIFEST_FILENAME),
                '{ not json',
                'utf8'
            );
            await assert.rejects(() => loadManifest(badDir), (e) => e instanceof FailClosedError);

            await fs.promises.writeFile(
                path.join(badDir, MANIFEST_FILENAME),
                JSON.stringify({ schemaVersion: 1, entries: 'nope' }),
                'utf8'
            );
            await assert.rejects(() => loadManifest(badDir), (e) => e instanceof FailClosedError);
        } finally {
            await fs.promises.rm(badDir, { recursive: true, force: true });
        }
    });

    it('INDEX rebuild preserves entries from separately converted subtree', () => {
        const m = createEmptyManifest();
        upsertEntry(m, entry('docs/a.pdf'));
        upsertEntry(m, entry('manuals/x.pdf'));
        // Simulate docs rescan removing only docs missing
        removeMissingInSubtree(m, 'docs', ['docs/a.pdf']);
        const index = buildIndexMarkdown(m.entries);
        assert.ok(index.includes('docs/a.pdf'));
        assert.ok(index.includes('manuals/x.pdf'));
        assert.ok(!index.includes('docs/b.pdf'));
    });

    it('missing manifest loads as empty', async () => {
        const emptyDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-forge-empty-m-'));
        try {
            const m = await loadManifest(emptyDir);
            assert.strictEqual(m.entries.length, 0);
        } finally {
            await fs.promises.rm(emptyDir, { recursive: true, force: true });
        }
    });

    it('save sorts entries deterministically', async () => {
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'pdf-forge-sort-m-'));
        try {
            const m = createEmptyManifest();
            upsertEntry(m, entry('z.pdf'));
            upsertEntry(m, entry('a.pdf'));
            await saveManifest(dir, m);
            const raw = JSON.parse(
                await fs.promises.readFile(path.join(dir, MANIFEST_FILENAME), 'utf8')
            );
            assert.deepStrictEqual(
                raw.entries.map((e) => e.source),
                ['a.pdf', 'z.pdf']
            );
            // Content hash stable on rewrite
            const h1 = hashFileContent(JSON.stringify(raw));
            await saveManifest(dir, await loadManifest(dir));
            const raw2 = JSON.parse(
                await fs.promises.readFile(path.join(dir, MANIFEST_FILENAME), 'utf8')
            );
            assert.strictEqual(hashFileContent(JSON.stringify(raw2)), h1);
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true });
        }
    });
});
