'use strict';

/**
 * Conflict candidate logic via batchOrchestrator + temp dirs (§16.4).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, writePdf, copyFixture, FIXTURES } = require('./helpers/tempWorkspace');
const { hashFileContent } = require('../out/hash');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

describe('conflict', () => {
    let root;
    let mock;
    let runBatchConversion;
    let __resetBatchLockForTests;
    let context;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-conflict-');
        mock = createMockVscode({
            workspaceFolders: [root],
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
        ({ runBatchConversion, __resetBatchLockForTests } = loadBatchOrchestrator(mock));

        // Warm pdf-parse after pdfjs inspect load — cold first convert can throw
        // spurious "bad XRef entry" under pdf-parse's bundled pdf.js.
        const { convertPdf } = require('../out/convertPdf');
        const { inspectPdf } = require('../out/pdfInspect');
        const warm = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        await inspectPdf(warm);
        await convertPdf(warm, 'warmup.pdf');
    });

    beforeEach(() => {
        __resetBatchLockForTests();
        context = mock.__createContext();
    });

    after(async () => {
        await rimraf(root);
    });

    async function runOn(folderFs, ctx = context) {
        return runBatchConversion(mock.Uri.file(folderFs), ctx, {
            openExternal: async () => false,
        });
    }

    it('user edits canonical; same source not overwritten or charged again', async () => {
        const sub = await makeTempDir('pdf-forge-c1-');
        try {
            mock.__setWorkspaceFolders([sub]);
            context = mock.__createContext();
            await copyFixture('normal.pdf', path.join(sub, 'same.pdf'));
            const r1 = await runOn(sub);
            if (r1.converted < 1) {
                const manPath = path.join(sub, 'pdf-forge-exports', '.pdf-forge-manifest.json');
                const man = fs.existsSync(manPath)
                    ? JSON.parse(fs.readFileSync(manPath, 'utf8'))
                    : null;
                assert.fail(
                    `expected converted, got ${JSON.stringify(r1)} manifest=${JSON.stringify(man)}`
                );
            }

            const out = path.join(sub, 'pdf-forge-exports', 'same', 'document.md');
            assert.ok(fs.existsSync(out));
            const original = fs.readFileSync(out, 'utf8');
            fs.writeFileSync(out, original + '\n\nUSER EDIT\n', 'utf8');
            const editedHash = hashFileContent(fs.readFileSync(out));

            const pagesBefore = context.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            __resetBatchLockForTests();
            const r2 = await runOn(sub);
            assert.ok(r2.conflict >= 1, `expected conflict, got ${JSON.stringify(r2)}`);
            assert.strictEqual(hashFileContent(fs.readFileSync(out)), editedHash);
            assert.ok(
                !fs.existsSync(
                    path.join(sub, 'pdf-forge-exports', 'same', 'document.pdf-forge-new.md')
                )
            );
            const pagesAfter = context.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            assert.strictEqual(pagesAfter, pagesBefore);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('user edits canonical; source changes → one candidate; re-run does not re-charge', async () => {
        const sub = await makeTempDir('pdf-forge-c2-');
        try {
            mock.__setWorkspaceFolders([sub]);
            context = mock.__createContext();
            __resetBatchLockForTests();

            await copyFixture('normal.pdf', path.join(sub, 'doc.pdf'));
            await runOn(sub);

            const out = path.join(sub, 'pdf-forge-exports', 'doc', 'document.md');
            assert.ok(fs.existsSync(out));
            fs.writeFileSync(out, fs.readFileSync(out, 'utf8') + '\nUSER\n', 'utf8');

            // Different convertible source (new hash)
            await copyFixture('large-40.pdf', path.join(sub, 'doc.pdf'));

            __resetBatchLockForTests();
            const pagesBefore = context.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            const r = await runOn(sub);
            const cand = path.join(
                sub,
                'pdf-forge-exports',
                'doc',
                'document.pdf-forge-new.md'
            );
            assert.ok(fs.existsSync(cand), 'candidate must appear');
            assert.ok(fs.readFileSync(out, 'utf8').includes('USER'));
            assert.ok(r.conflict >= 1);

            const candHash = hashFileContent(fs.readFileSync(cand));
            const pagesMid = context.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            __resetBatchLockForTests();
            await runOn(sub);
            assert.strictEqual(hashFileContent(fs.readFileSync(cand)), candHash);
            const pagesEnd = context.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            assert.strictEqual(pagesEnd, pagesMid);
            assert.ok(pagesMid >= pagesBefore);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('unowned document.md is never overwritten', async () => {
        const sub = await makeTempDir('pdf-forge-unowned-');
        try {
            mock.__setWorkspaceFolders([sub]);
            context = mock.__createContext();
            __resetBatchLockForTests();

            const outDir = path.join(sub, 'pdf-forge-exports', 'fresh');
            await fs.promises.mkdir(outDir, { recursive: true });
            const out = path.join(outDir, 'document.md');
            fs.writeFileSync(out, '# User owned file\n', 'utf8');

            await copyFixture('normal.pdf', path.join(sub, 'fresh.pdf'));

            const r = await runOn(sub);
            assert.ok(r.conflict >= 1);
            assert.strictEqual(fs.readFileSync(out, 'utf8'), '# User owned file\n');
            assert.ok(!fs.existsSync(path.join(outDir, 'document.pdf-forge-new.md')));
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('user edits both canonical and candidate: neither overwritten, no third file', async () => {
        const sub = await makeTempDir('pdf-forge-both-');
        try {
            mock.__setWorkspaceFolders([sub]);
            context = mock.__createContext();
            __resetBatchLockForTests();

            await copyFixture('normal.pdf', path.join(sub, 'both.pdf'));
            await runOn(sub);

            const out = path.join(sub, 'pdf-forge-exports', 'both', 'document.md');
            fs.writeFileSync(out, fs.readFileSync(out, 'utf8') + '\nCANON\n', 'utf8');

            await copyFixture('large-40.pdf', path.join(sub, 'both.pdf'));
            __resetBatchLockForTests();
            await runOn(sub);

            const cand = path.join(
                sub,
                'pdf-forge-exports',
                'both',
                'document.pdf-forge-new.md'
            );
            assert.ok(fs.existsSync(cand));
            fs.writeFileSync(cand, fs.readFileSync(cand, 'utf8') + '\nCAND\n', 'utf8');
            const outH = hashFileContent(fs.readFileSync(out));
            const candH = hashFileContent(fs.readFileSync(cand));

            // Third source revision while both user-modified
            await copyFixture('normal.pdf', path.join(sub, 'both.pdf'));
            // Append a byte to force yet another hash while remaining a valid PDF is hard;
            // use yaml-title / converted-min if they convert, else re-copy large after
            // mutating by concatenating a comment trailer (changes hash, may break parse).
            // Prefer swapping to a third distinct real fixture: write normal then large again
            // is same as first candidate hash. Instead append PDF comment before %%EOF.
            let pdf = fs.readFileSync(path.join(FIXTURES, 'large-40.pdf'));
            const marker = Buffer.from('\n%pdf-forge-rev3\n');
            pdf = Buffer.concat([pdf, marker]);
            fs.writeFileSync(path.join(sub, 'both.pdf'), pdf);

            __resetBatchLockForTests();
            await runOn(sub);

            assert.strictEqual(hashFileContent(fs.readFileSync(out)), outH);
            assert.strictEqual(hashFileContent(fs.readFileSync(cand)), candH);
            const extras = fs
                .readdirSync(path.join(sub, 'pdf-forge-exports', 'both'))
                .filter((n) => n.endsWith('.md'));
            assert.deepStrictEqual(extras.sort(), [
                'document.md',
                'document.pdf-forge-new.md',
            ]);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });
});
