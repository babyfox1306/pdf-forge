'use strict';

/**
 * Batch result notification: never call a skipped file "converted";
 * page counts are charged pages only; pluralization.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');
const { getCurrentPeriodKey } = require('../out/quota');

describe('batchSummaryNotify', () => {
    let root;
    let mock;
    let runBatchConversion;
    let __resetBatchLockForTests;
    let __buildFinalMessageForTests;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-summary-');
        mock = createMockVscode({
            workspaceFolders: [root],
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
        ({
            runBatchConversion,
            __resetBatchLockForTests,
            __buildFinalMessageForTests,
        } = loadBatchOrchestrator(mock));
    });

    beforeEach(() => {
        __resetBatchLockForTests();
    });

    after(async () => {
        await rimraf(root);
    });

    it('plural: 1 file / N files; skipped never labeled converted', () => {
        assert.strictEqual(
            __buildFinalMessageForTests(
                { converted: 1, pagesConverted: 101, discovered: 1 },
                101
            ),
            'Converted 1 file (101 pages) — above this month\'s batch threshold.'
        );
        assert.strictEqual(
            __buildFinalMessageForTests(
                {
                    converted: 0,
                    pagesConverted: 0,
                    discovered: 1,
                    skippedLimit: 1,
                },
                100
            ),
            'Converted 0 files (0 pages). 1 file skipped this month.'
        );
        assert.strictEqual(
            __buildFinalMessageForTests(
                {
                    converted: 1,
                    pagesConverted: 101,
                    discovered: 2,
                    skippedLimit: 1,
                    unchanged: 0,
                },
                101
            ),
            'Converted 1 file (101 pages). 1 file skipped this month.'
        );
        assert.strictEqual(
            __buildFinalMessageForTests(
                {
                    converted: 2,
                    pagesConverted: 50,
                    discovered: 3,
                    unchanged: 1,
                },
                50
            ),
            'Converted 2 files (50 pages). 1 unchanged.'
        );
    });

    it('all skipped_limit: zero converted, zero charged pages, notification matches', async () => {
        const sub = await makeTempDir('pdf-forge-summary-skip-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await ctx.globalState.update('pdf-forge.batchUsage', {
                periodKey: getCurrentPeriodKey(),
                pagesUsed: 100,
            });
            await copyFixture('normal.pdf', path.join(sub, 'a.pdf'));
            await copyFixture('normal.pdf', path.join(sub, 'b.pdf'));

            const result = await runBatchConversion(mock.Uri.file(sub), ctx, {
                openExternal: async () => false,
            });

            assert.strictEqual(result.converted, 0);
            assert.strictEqual(result.pagesConverted, 0);
            assert.strictEqual(result.skippedLimit, 2);
            assert.strictEqual(result.pagesAfter, 100);
            assert.strictEqual(
                result.message,
                'Converted 0 files (0 pages). 2 files skipped this month.'
            );
            assert.ok(!/Converted [1-9]/.test(result.message), 'must not claim any file converted');
            assert.ok(!/\([1-9]\d* pages\)/.test(result.message), 'must not report charged pages');

            const manifest = JSON.parse(
                fs.readFileSync(
                    path.join(sub, 'pdf-forge-exports', '.pdf-forge-manifest.json'),
                    'utf8'
                )
            );
            assert.ok(manifest.entries.every((e) => e.status === 'skipped_limit'));
            assert.ok(manifest.entries.every((e) => (e.chargedSourceHashes || []).length === 0));
            assert.ok(
                !fs.existsSync(path.join(sub, 'pdf-forge-exports', 'a', 'document.md'))
            );
            assert.ok(
                !fs.existsSync(path.join(sub, 'pdf-forge-exports', 'b', 'document.md'))
            );
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });
});
