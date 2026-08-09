'use strict';

/**
 * Batch lifecycle: subtree INDEX merge, cancel, lock (§16.5).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

describe('batchLifecycle', () => {
    let root;
    let mock;
    let runBatchConversion;
    let __resetBatchLockForTests;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-life-');
        mock = createMockVscode({
            workspaceFolders: [root],
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
        ({ runBatchConversion, __resetBatchLockForTests } = loadBatchOrchestrator(mock));
    });

    beforeEach(() => {
        __resetBatchLockForTests();
    });

    after(async () => {
        await rimraf(root);
    });

    it('convert docs/ then manuals/: root INDEX contains both', async () => {
        const ctx = mock.__createContext();
        await copyFixture('normal.pdf', path.join(root, 'docs', 'a.pdf'));
        await copyFixture('normal.pdf', path.join(root, 'manuals', 'b.pdf'));

        await runBatchConversion(mock.Uri.file(path.join(root, 'docs')), ctx, {
            openExternal: async () => false,
        });
        __resetBatchLockForTests();
        await runBatchConversion(mock.Uri.file(path.join(root, 'manuals')), ctx, {
            openExternal: async () => false,
        });

        const index = fs.readFileSync(
            path.join(root, 'pdf-forge-exports', 'INDEX.md'),
            'utf8'
        );
        assert.ok(index.includes('docs/a.pdf'));
        assert.ok(index.includes('manuals/b.pdf'));

        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(root, 'pdf-forge-exports', '.pdf-forge-manifest.json'),
                'utf8'
            )
        );
        assert.ok(manifest.entries.some((e) => e.source === 'docs/a.pdf'));
        assert.ok(manifest.entries.some((e) => e.source === 'manuals/b.pdf'));
    });

    it('rescan docs/ after removing a source: manuals entries remain', async () => {
        const ctx = mock.__createContext();
        await copyFixture('normal.pdf', path.join(root, 'docs', 'a.pdf'));
        await copyFixture('normal.pdf', path.join(root, 'docs', 'gone.pdf'));
        await copyFixture('normal.pdf', path.join(root, 'manuals', 'b.pdf'));

        await runBatchConversion(mock.Uri.file(path.join(root, 'docs')), ctx, {
            openExternal: async () => false,
        });
        __resetBatchLockForTests();
        await runBatchConversion(mock.Uri.file(path.join(root, 'manuals')), ctx, {
            openExternal: async () => false,
        });

        await fs.promises.unlink(path.join(root, 'docs', 'gone.pdf'));
        __resetBatchLockForTests();
        await runBatchConversion(mock.Uri.file(path.join(root, 'docs')), ctx, {
            openExternal: async () => false,
        });

        const manifest = JSON.parse(
            fs.readFileSync(
                path.join(root, 'pdf-forge-exports', '.pdf-forge-manifest.json'),
                'utf8'
            )
        );
        assert.ok(!manifest.entries.some((e) => e.source === 'docs/gone.pdf'));
        assert.ok(manifest.entries.some((e) => e.source === 'manuals/b.pdf'));
        const index = fs.readFileSync(
            path.join(root, 'pdf-forge-exports', 'INDEX.md'),
            'utf8'
        );
        assert.ok(index.includes('manuals/b.pdf'));
    });

    it('cancel during preflight writes nothing (no manifest / INDEX)', async () => {
        const sub = await makeTempDir('pdf-forge-cancel-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await copyFixture('normal.pdf', path.join(sub, 'c.pdf'));

            const token = { isCancellationRequested: true };
            const result = await runBatchConversion(mock.Uri.file(sub), ctx, {
                token,
                openExternal: async () => false,
            });
            assert.strictEqual(result.cancelledEarly, true);
            assert.ok(!fs.existsSync(path.join(sub, 'pdf-forge-exports', 'INDEX.md')));
            assert.ok(
                !fs.existsSync(path.join(sub, 'pdf-forge-exports', '.pdf-forge-manifest.json'))
            );
            // Cancel before conversion must not touch quota for this context
            assert.strictEqual(ctx.globalState.get('pdf-forge.batchUsage'), undefined);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('lock rejects second concurrent batch', async () => {
        const sub = await makeTempDir('pdf-forge-lock-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await copyFixture('large-40.pdf', path.join(sub, 'l.pdf'));

            // First call sets batchRunning synchronously before its first await.
            const first = runBatchConversion(mock.Uri.file(sub), ctx, {
                openExternal: async () => false,
            });
            await assert.rejects(
                () =>
                    runBatchConversion(mock.Uri.file(sub), ctx, {
                        openExternal: async () => false,
                    }),
                /already running/i
            );
            await first;
        } finally {
            mock.__setWorkspaceFolders([root]);
            __resetBatchLockForTests();
            await rimraf(sub);
        }
    });

    it('batch path never requires gitIntegration module', () => {
        const src = fs.readFileSync(
            path.join(__dirname, '..', 'out', 'batchOrchestrator.js'),
            'utf8'
        );
        assert.ok(!/require\(['"]\.\/gitIntegration['"]\)/.test(src));
        assert.ok(!/require\(['"]simple-git['"]\)/.test(src));
        assert.ok(!/autoCommitExactFile/.test(src));
        // Comment mentioning Git is fine; runtime must not call it
        assert.ok(/Never imports or calls GitIntegration/.test(src));
    });
});
