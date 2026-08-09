'use strict';

/**
 * §16.5 injected write failures — atomic write / batch resilience.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture, FIXTURES } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

function listTmpUnder(dir) {
    const found = [];
    if (!fs.existsSync(dir)) {
        return found;
    }
    function walk(d) {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, ent.name);
            if (ent.isDirectory()) {
                walk(p);
            } else if (/\.tmp$/i.test(ent.name)) {
                found.push(p);
            }
        }
    }
    walk(dir);
    return found;
}

describe('safeWrite.failures', () => {
    let root;
    let mock;
    let runBatchConversion;
    let __resetBatchLockForTests;
    let setInterceptor;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-swfail-');
        mock = createMockVscode({
            workspaceFolders: [root],
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
        ({ runBatchConversion, __resetBatchLockForTests } = loadBatchOrchestrator(mock));
        ({ __setWriteFileAtomicInterceptorForTests: setInterceptor } = require('../out/safeWrite'));

        const { convertPdf } = require('../out/convertPdf');
        const { inspectPdf } = require('../out/pdfInspect');
        const warm = fs.readFileSync(path.join(FIXTURES, 'normal.pdf'));
        await inspectPdf(warm);
        await convertPdf(warm, 'warmup.pdf');
    });

    beforeEach(() => {
        __resetBatchLockForTests();
        setInterceptor(undefined);
    });

    afterEach(() => {
        setInterceptor(undefined);
    });

    after(async () => {
        setInterceptor(undefined);
        await rimraf(root);
    });

    async function runOn(folderFs, ctx) {
        return runBatchConversion(mock.Uri.file(folderFs), ctx, {
            openExternal: async () => false,
        });
    }

    it('writeFileAtomic: interceptor throws after temp created → final absent, temp cleaned', async () => {
        const { writeFileAtomic, __setWriteFileAtomicInterceptorForTests } = require('../out/safeWrite');
        const dir = await makeTempDir('pdf-forge-atomic-');
        try {
            const finalPath = path.join(dir, 'document.md');
            let sawTemp = false;
            __setWriteFileAtomicInterceptorForTests(async ({ tempPath }) => {
                sawTemp = fs.existsSync(tempPath);
                throw new Error('injected atomic write failure');
            });
            await assert.rejects(
                () => writeFileAtomic(finalPath, '# boom\n'),
                /injected atomic write failure/
            );
            assert.ok(sawTemp, 'temp should have existed before throw');
            assert.ok(!fs.existsSync(finalPath), 'final path must not exist');
            assert.deepStrictEqual(listTmpUnder(dir), []);
        } finally {
            __setWriteFileAtomicInterceptorForTests(undefined);
            await rimraf(dir);
        }
    });

    it('document.md write failure: user-modified survives, no .tmp final, quota unchanged, temps cleaned', async () => {
        const sub = await makeTempDir('pdf-forge-sw-doc-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await copyFixture('normal.pdf', path.join(sub, 'alpha.pdf'));
            const r1 = await runOn(sub, ctx);
            assert.ok(r1.converted >= 1, `expected convert, got ${JSON.stringify(r1)}`);

            const out = path.join(sub, 'pdf-forge-exports', 'alpha', 'document.md');
            assert.ok(fs.existsSync(out));
            const edited = fs.readFileSync(out, 'utf8') + '\n\nUSER EDIT DOC FAIL\n';
            fs.writeFileSync(out, edited, 'utf8');

            const pagesBefore = ctx.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;

            // Distinct fixture avoids pdf-parse XRef flake on re-read of the same bytes
            await copyFixture('large-40.pdf', path.join(sub, 'beta.pdf'));
            let threwForDoc = false;
            setInterceptor(async ({ finalPath }) => {
                const parent = path.basename(path.dirname(finalPath));
                if (path.basename(finalPath) === 'document.md' && parent === 'beta') {
                    threwForDoc = true;
                    throw new Error('injected document.md write failure');
                }
            });

            __resetBatchLockForTests();
            const r2 = await runOn(sub, ctx);
            assert.ok(
                threwForDoc,
                `interceptor should have fired for beta document.md; result=${JSON.stringify(r2)}`
            );
            assert.strictEqual(fs.readFileSync(out, 'utf8'), edited);
            assert.ok(!fs.existsSync(out + '.tmp'));
            assert.ok(!/\.tmp$/i.test(path.basename(out)));
            const betaMd = path.join(sub, 'pdf-forge-exports', 'beta', 'document.md');
            assert.ok(!fs.existsSync(betaMd), 'failed write must not leave final document.md');
            assert.deepStrictEqual(listTmpUnder(path.join(sub, 'pdf-forge-exports')), []);

            const pagesAfter = ctx.globalState.get('pdf-forge.batchUsage')?.pagesUsed || 0;
            assert.strictEqual(
                pagesAfter,
                pagesBefore,
                'pagesUsed must not increase when write fails before successful final write+manifest'
            );
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('manifest write failure: user-modified survives, temps cleaned', async () => {
        const sub = await makeTempDir('pdf-forge-sw-man-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            await copyFixture('normal.pdf', path.join(sub, 'gamma.pdf'));
            const r1 = await runOn(sub, ctx);
            assert.ok(r1.converted >= 1);

            const out = path.join(sub, 'pdf-forge-exports', 'gamma', 'document.md');
            const edited = fs.readFileSync(out, 'utf8') + '\n\nUSER EDIT MANIFEST FAIL\n';
            fs.writeFileSync(out, edited, 'utf8');

            await copyFixture('normal.pdf', path.join(sub, 'delta.pdf'));
            let threwForManifest = false;
            let manifestAttempts = 0;
            setInterceptor(async ({ finalPath }) => {
                if (path.basename(finalPath) === '.pdf-forge-manifest.json') {
                    manifestAttempts++;
                    // Fail the first manifest write after delta's document.md succeeds
                    if (manifestAttempts === 1 && fs.existsSync(
                        path.join(sub, 'pdf-forge-exports', 'delta', 'document.md')
                    )) {
                        threwForManifest = true;
                        throw new Error('injected manifest write failure');
                    }
                }
            });

            __resetBatchLockForTests();
            await runOn(sub, ctx);

            assert.ok(threwForManifest, 'interceptor should fail manifest write');
            assert.strictEqual(fs.readFileSync(out, 'utf8'), edited);
            assert.deepStrictEqual(listTmpUnder(path.join(sub, 'pdf-forge-exports')), []);
            assert.ok(!fs.existsSync(out + '.tmp'));
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });

    it('unowned pre-existing document.md survives write-failure injection', async () => {
        const sub = await makeTempDir('pdf-forge-sw-unowned-');
        try {
            mock.__setWorkspaceFolders([sub]);
            const ctx = mock.__createContext();
            const outDir = path.join(sub, 'pdf-forge-exports', 'fresh');
            await fs.promises.mkdir(outDir, { recursive: true });
            const out = path.join(outDir, 'document.md');
            const owned = '# User owned file — do not overwrite\n';
            fs.writeFileSync(out, owned, 'utf8');

            setInterceptor(async ({ finalPath }) => {
                if (path.basename(finalPath) === 'document.md' && finalPath.includes(`${path.sep}fresh${path.sep}`)) {
                    throw new Error('injected unowned document.md write');
                }
            });

            await copyFixture('normal.pdf', path.join(sub, 'fresh.pdf'));
            await runOn(sub, ctx);

            assert.strictEqual(fs.readFileSync(out, 'utf8'), owned);
            assert.ok(!fs.existsSync(path.join(outDir, 'document.pdf-forge-new.md')));
            assert.deepStrictEqual(listTmpUnder(path.join(sub, 'pdf-forge-exports')), []);
        } finally {
            mock.__setWorkspaceFolders([root]);
            await rimraf(sub);
        }
    });
});
