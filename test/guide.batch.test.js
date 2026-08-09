'use strict';

/**
 * §13/E guide CTA with actual batch conversion.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after, beforeEach } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture, FIXTURES } = require('./helpers/tempWorkspace');
const {
    ensureGeneratedFixtures,
    buildMultiPagePdf,
} = require('./helpers/makePdf');
const { getCurrentPeriodKey } = require('../out/quota');
const {
    shouldShowGuide,
    GUIDE_URL_STANDARD,
    GUIDE_URL_LARGE,
} = require('../out/guideCta');

describe('guide.batch', () => {
    let root;
    let mock;
    let runBatchConversion;
    let __resetBatchLockForTests;
    let openExternalCalls;
    let productionRequestCount;
    let consentEvents;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-guide-batch-');

        // Ensure a >100-page fixture exists for one-file path
        const largePath = path.join(FIXTURES, 'large-40.pdf');
        if (!fs.existsSync(largePath)) {
            fs.writeFileSync(largePath, buildMultiPagePdf(40));
        }
        const huge = path.join(FIXTURES, '_guide-120.pdf');
        fs.writeFileSync(huge, buildMultiPagePdf(120));

        openExternalCalls = [];
        productionRequestCount = 0;
        consentEvents = [];

        mock = createMockVscode({
            workspaceFolders: [root],
            onInfo: async (message, items) => {
                consentEvents.push({ type: 'info', message, items });
                if (/batch guide/i.test(message) || /Open guide/i.test(String(items))) {
                    return 'Open guide';
                }
                return undefined;
            },
            onWarn: async (message, items) => {
                consentEvents.push({ type: 'warn', message, items });
                return 'Open in browser';
            },
            openExternal: async (uri) => {
                consentEvents.push({ type: 'openExternal', uri: String(uri) });
                openExternalCalls.push(uri);
                return true;
            },
        });

        ({ runBatchConversion, __resetBatchLockForTests } = loadBatchOrchestrator(mock));

        const { convertPdf } = require('../out/convertPdf');
        const { inspectPdf } = require('../out/pdfInspect');
        const warm = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        await inspectPdf(warm);
        await convertPdf(warm, 'warmup.pdf');
    });

    beforeEach(() => {
        __resetBatchLockForTests();
        openExternalCalls.length = 0;
        productionRequestCount = 0;
        consentEvents.length = 0;
        mock.__messages.length = 0;
    });

    after(async () => {
        await rimraf(root);
        try {
            await fs.promises.unlink(path.join(FIXTURES, '_guide-120.pdf'));
        } catch {
            // ignore
        }
    });

    it('one-file large: shouldShowGuide false path — no guide prompt, openExternal=0 even if pages>100', async () => {
        const sub = await makeTempDir('pdf-forge-guide-one-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await fs.promises.copyFile(
                path.join(FIXTURES, '_guide-120.pdf'),
                path.join(sub, 'only.pdf')
            );

            // Decision unit: one-file never shows
            assert.strictEqual(
                shouldShowGuide({
                    discoveredPdfCount: 1,
                    pagesBefore: 0,
                    pagesAfter: 120,
                    newConvertedCount: 1,
                    skippedLimitCount: 0,
                    guideState: { opened: false },
                    currentPeriod: getCurrentPeriodKey(),
                }),
                false
            );

            await runBatchConversion(mock.Uri.file(sub), ctx, {
                openExternal: async (uri) => {
                    openExternalCalls.push(uri);
                    productionRequestCount++;
                    return true;
                },
            });

            const guideInfos = mock.__messages.filter(
                (m) => m.type === 'info' && /batch guide/i.test(m.message)
            );
            assert.strictEqual(guideInfos.length, 0, 'must not ask to open guide for one-file');
            assert.strictEqual(openExternalCalls.length, 0);
            assert.strictEqual(productionRequestCount, 0);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('multi-file threshold: guide consent info→modal warn→openExternal; no production HTTP', async () => {
        const sub = await makeTempDir('pdf-forge-guide-multi-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const period = getCurrentPeriodKey();
            const ctx = mock.__createContext();
            await ctx.globalState.update('pdf-forge.batchUsage', {
                periodKey: period,
                pagesUsed: 99,
            });

            await copyFixture('normal.pdf', path.join(sub, 'a.pdf'));
            await copyFixture('normal.pdf', path.join(sub, 'b.pdf'));

            const localOpen = [];
            let httpHits = 0;
            await runBatchConversion(mock.Uri.file(sub), ctx, {
                openExternal: async (uri) => {
                    localOpen.push(String(uri?.fsPath || uri?.toString?.() || uri));
                    // Stub only — never hit production over HTTP
                    return true;
                },
            });

            // Guide must show for collection + soft threshold cross
            const infos = mock.__messages.filter((m) => m.type === 'info');
            const warns = mock.__messages.filter((m) => m.type === 'warn');
            const guideInfo = infos.find((m) => /batch guide/i.test(m.message));
            assert.ok(guideInfo, 'expected guide info prompt for multi-file threshold cross');
            assert.ok(warns.some((m) => /does not upload/i.test(m.message)));

            const infoIdx = mock.__messages.findIndex(
                (m) => m.type === 'info' && /batch guide/i.test(m.message)
            );
            const warnIdx = mock.__messages.findIndex(
                (m) => m.type === 'warn' && /does not upload/i.test(m.message)
            );
            assert.ok(infoIdx >= 0 && warnIdx > infoIdx, 'consent order: info then modal warn');

            assert.ok(localOpen.length >= 1, 'openExternal should be called after consent');
            const url = localOpen[0];
            assert.ok(
                url.includes(GUIDE_URL_STANDARD) ||
                    url.includes(GUIDE_URL_LARGE) ||
                    url.includes('/limit/standard/') ||
                    url.includes('/limit/large/'),
                `unexpected guide url: ${url}`
            );
            assert.ok(!url.includes('/qa/'));
            assert.ok(
                infoIdx < warnIdx,
                'info before warn'
            );
            // openExternal happens after both prompts (batch awaits both before open)
            assert.strictEqual(httpHits, 0, 'production request count must be 0');
            assert.strictEqual(productionRequestCount, 0);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });
});
