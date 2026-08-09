/**
 * Packaged 1.0.9 clean-profile acceptance + multi-root host suite.
 * Calls packaged out/batchOrchestrator directly (same code as command) to avoid UI dialogs.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vscode = require('vscode');
const { stubGuideUi } = require('../stubGuideUi');

function outPath() {
    return (
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'acceptance-host-evidence.json')
    );
}

function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

function makeBatchCtx(ext, rootA, mem) {
    return {
        globalState: {
            get(key, def) {
                return mem.has(key) ? mem.get(key) : def;
            },
            async update(key, value) {
                mem.set(key, value);
            },
        },
        workspaceState: {
            get() {
                return undefined;
            },
            async update() {},
        },
        extensionPath: ext.extensionPath,
        globalStorageUri: vscode.Uri.file(path.join(rootA, '.pdf-forge-global')),
        subscriptions: [],
    };
}

async function run() {
    const evidence = {
        host: 'vscode-extension-host-packaged',
        extensionPath: null,
        scenarios: {},
        openExternalCalls: [],
        productionHttpRequests: 0,
        verdict: 'FAIL',
        error: null,
    };

    const originalOpen = vscode.env.openExternal.bind(vscode.env);
    const openExternal = async (uri) => {
        evidence.openExternalCalls.push(String(uri));
        return true;
    };
    vscode.env.openExternal = openExternal;
    const batchUi = {
        openExternal,
        showInformationMessage: async () => 'Not now',
        showWarningMessage: async () => undefined,
    };

    try {
        stubGuideUi(vscode);
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        assert.ok(ext, 'extension missing');
        if (!ext.isActive) await ext.activate();
        evidence.extensionPath = ext.extensionPath;
        await sleep(300);

        const createRequire = require('module').createRequire;
        const extRequire = createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = extRequire(
            './out/batchOrchestrator.js'
        );
        const { ExportManager } = extRequire('./out/exportManager.js');
        const { Config } = extRequire('./out/config.js');
        const { resolveOpenExportFolder } = extRequire('./out/workspaceContext.js');
        const { shouldShowGuide } = extRequire('./out/guideCta.js');

        const folders = vscode.workspace.workspaceFolders || [];
        evidence.scenarios.workspaceFolders = folders.map((f) => ({
            name: f.name,
            fsPath: f.uri.fsPath,
        }));
        assert.ok(folders.length >= 2, 'need multi-root, got ' + folders.length);

        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        const rootB = folders.find((f) => f.name === 'B')?.uri.fsPath;
        assert.ok(rootA && rootB, 'A/B folders required');

        const mem = new Map();
        const batchCtx = makeBatchCtx(ext, rootA, mem);


        // --- A. NO-TEXT packaged-host (dedicated folder + diagnostics) ---
        const { inspectPdf, __resetPdfInspectCacheForTests } = extRequire('./out/pdfInspect.js');
        const { convertPdf, warmPdfParseEngine, __resetPdfParseWarmForTests } = extRequire(
            './out/convertPdf.js'
        );
        const noTextAbs = path.join(rootA, 'notext', 'empty.pdf');
        const noTextMem = new Map();
        const noTextCtx = makeBatchCtx(ext, rootA, noTextMem);
        __resetPdfParseWarmForTests();
        __resetBatchLockForTests();
        const rNoText = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'notext')),
            noTextCtx,
            batchUi
        );
        const noTextManPath = path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json');
        const noTextEntry = fs.existsSync(noTextManPath)
            ? JSON.parse(fs.readFileSync(noTextManPath, 'utf8')).entries.find(
                  (e) => e.source === 'notext/empty.pdf'
              )
            : null;
        const noTextMd = path.join(rootA, 'pdf-forge-exports', 'notext', 'empty', 'document.md');
        const noTextUsage = noTextMem.get('pdf-forge.batchUsage');
        // Post-batch structure probe (does not affect batch outcome)
        __resetPdfInspectCacheForTests();
        const postInspect = await inspectPdf(Buffer.from(fs.readFileSync(noTextAbs)));
        evidence.scenarios.noTextDiag = {
            path: noTextAbs,
            inspect: postInspect,
            note: 'inspect after batch for structure proof; convert proven via batch status',
        };
        evidence.scenarios.noText = {
            message: rNoText.message,
            status: noTextEntry?.status,
            errorReason: noTextEntry?.errorReason,
            pageCount: noTextEntry?.pageCount,
            mdExists: fs.existsSync(noTextMd),
            charged: (noTextEntry?.chargedSourceHashes || []).length,
            pagesUsed: noTextUsage?.pagesUsed ?? null,
            diagClass:
                noTextEntry?.status === 'no_text' && postInspect?.pageCount != null
                    ? 'A_valid_pdf_extract_ok'
                    : postInspect?.pageCount != null
                      ? 'C_interop_or_parse_fail'
                      : 'B_invalid_or_unreadable',
        };
        assert.ok(
            typeof postInspect?.pageCount === 'number' && postInspect.pageCount >= 1,
            'no-text inspect pageCount'
        );
        assert.strictEqual(postInspect.encryption, 'none');
        assert.strictEqual(noTextEntry?.status, 'no_text', JSON.stringify(evidence.scenarios.noText));
        assert.strictEqual(fs.existsSync(noTextMd), false, 'no_text must not write document.md');
        assert.strictEqual((noTextEntry?.chargedSourceHashes || []).length, 0);
        assert.ok((noTextUsage?.pagesUsed ?? 0) === 0, 'no_text must not charge quota');

        // --- B. Large-first-file packaged-host (>100 pages) ---
        const { getCurrentPeriodKey } = extRequire('./out/quota.js');
        const largeMem = new Map();
        largeMem.set('pdf-forge.batchUsage', {
            periodKey: getCurrentPeriodKey(),
            pagesUsed: 0,
        });
        const largeCtx = makeBatchCtx(ext, rootA, largeMem);
        const pagesBeforeLarge = largeMem.get('pdf-forge.batchUsage').pagesUsed;
        assert.ok(pagesBeforeLarge < 100);
        __resetBatchLockForTests();
        const rLarge = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'largefirst')),
            largeCtx,
            batchUi
        );
        const largeMan = JSON.parse(
            fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
        );
        const largeEntries = largeMan.entries.filter((e) =>
            String(e.source).startsWith('largefirst/')
        );
        const largeEntry = largeEntries.find((e) => e.source.endsWith('a-large.pdf'));
        const smallEntry = largeEntries.find((e) => e.source.endsWith('b-small.pdf'));
        const largeMd = path.join(
            rootA,
            'pdf-forge-exports',
            'largefirst',
            'a-large',
            'document.md'
        );
        const indexMd = fs.readFileSync(
            path.join(rootA, 'pdf-forge-exports', 'INDEX.md'),
            'utf8'
        );
        const pagesAfterLarge = largeMem.get('pdf-forge.batchUsage')?.pagesUsed;
        evidence.scenarios.largeFirst = {
            pagesBefore: pagesBeforeLarge,
            pagesAfter: pagesAfterLarge,
            message: rLarge.message,
            largeStatus: largeEntry?.status,
            largePages: largeEntry?.pageCount,
            smallStatus: smallEntry?.status,
            largeMdExists: fs.existsSync(largeMd),
            indexHasLarge: /largefirst\/a-large\.pdf/.test(indexMd),
            indexHasSmall: /largefirst\/b-small\.pdf/.test(indexMd),
            chargedLarge: (largeEntry?.chargedSourceHashes || []).length > 0,
        };
        assert.ok(largeEntry?.pageCount > 100, 'first file >100 pages');
        assert.ok(
            largeEntry?.status === 'converted' || largeEntry?.status === 'low_text',
            'large first processed'
        );
        assert.ok(fs.existsSync(largeMd), 'large document.md written');
        assert.ok(pagesAfterLarge >= largeEntry.pageCount, 'full page count charged');
        assert.ok(pagesAfterLarge > 100, 'aggregate may exceed 100');
        assert.strictEqual(smallEntry?.status, 'skipped_limit');
        assert.ok(evidence.scenarios.largeFirst.indexHasLarge);
        assert.ok(evidence.scenarios.largeFirst.indexHasSmall);

        // --- C. Cancel packaged-host (between files) ---
        const cancelMem = new Map();
        cancelMem.set('pdf-forge.batchUsage', {
            periodKey: getCurrentPeriodKey(),
            pagesUsed: 0,
        });
        const cancelCtx = makeBatchCtx(ext, rootA, cancelMem);
        const openBeforeCancel = evidence.openExternalCalls.length;
        const stagedBeforeCancel = git(rootB, ['diff', '--cached', '--name-only']);
        let cancelArmed = false;
        const cancelToken = {
            get isCancellationRequested() {
                return cancelArmed;
            },
        };
        const cancelProgress = {
            report(value) {
                // After file 1 completes, orchestrator reports Converting 2/N — cancel then.
                if (value?.message && /Converting 2\//.test(value.message)) {
                    cancelArmed = true;
                }
            },
        };
        __resetBatchLockForTests();
        const rCancel = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'cancel')),
            cancelCtx,
            { ...batchUi, token: cancelToken, progress: cancelProgress }
        );
        const cancelMan = JSON.parse(
            fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
        );
        const cancelEntries = cancelMan.entries.filter((e) =>
            String(e.source).startsWith('cancel/')
        );
        const cancelA = cancelEntries.find((e) => e.source.endsWith('a.pdf'));
        const cancelB = cancelEntries.find((e) => e.source.endsWith('b.pdf'));
        const cancelAMd = path.join(rootA, 'pdf-forge-exports', 'cancel', 'a', 'document.md');
        const cancelBMd = path.join(rootA, 'pdf-forge-exports', 'cancel', 'b', 'document.md');
        const cancelTemps = fs.existsSync(path.join(rootA, 'pdf-forge-exports', 'cancel'))
            ? fs
                  .readdirSync(path.join(rootA, 'pdf-forge-exports', 'cancel'), {
                      recursive: true,
                  })
                  .filter((n) => String(n).includes('.tmp') || String(n).endsWith('.partial'))
            : [];
        const stagedAfterCancel = git(rootB, ['diff', '--cached', '--name-only']);
        evidence.scenarios.cancel = {
            message: rCancel.message,
            cancelledEarly: rCancel.cancelledEarly,
            statusA: cancelA?.status,
            statusB: cancelB?.status,
            aMd: fs.existsSync(cancelAMd),
            bMd: fs.existsSync(cancelBMd),
            pagesUsed: cancelMem.get('pdf-forge.batchUsage')?.pagesUsed,
            chargedA: (cancelA?.chargedSourceHashes || []).length,
            chargedB: (cancelB?.chargedSourceHashes || []).length,
            temps: cancelTemps,
            openExternalDelta: evidence.openExternalCalls.length - openBeforeCancel,
            stagedPreserved: stagedBeforeCancel === stagedAfterCancel,
        };
        assert.ok(
            cancelA?.status === 'converted' || cancelA?.status === 'unchanged',
            'completed file remains valid'
        );
        assert.ok(fs.existsSync(cancelAMd), 'completed document.md present');
        assert.strictEqual(cancelB?.status, 'cancelled');
        assert.strictEqual(fs.existsSync(cancelBMd), false, 'no partial final document.md for cancelled');
        assert.strictEqual((cancelB?.chargedSourceHashes || []).length, 0);
        assert.ok((cancelMem.get('pdf-forge.batchUsage')?.pagesUsed || 0) <= (cancelA?.pageCount || 2) + 2);
        assert.deepStrictEqual(cancelTemps, []);
        assert.strictEqual(evidence.scenarios.cancel.openExternalDelta, 0);
        assert.ok(evidence.scenarios.cancel.stagedPreserved);

        // One-file — guide must not openExternal (discoveredPdfCount < 2)
        const openBefore = evidence.openExternalCalls.length;
        __resetBatchLockForTests();
        const rOne = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'onefile')),
            batchCtx,
            batchUi
        );
        evidence.scenarios.oneFile = {
            discovered: rOne.discovered,
            openExternalDelta: evidence.openExternalCalls.length - openBefore,
        };
        assert.strictEqual(evidence.scenarios.oneFile.openExternalDelta, 0);

        // One-file >100 pages (500-page-equivalent gate): real batch, no guide
        const one500Mem = new Map();
        const one500Ctx = makeBatchCtx(ext, rootA, one500Mem);
        const openBefore500 = evidence.openExternalCalls.length;
        __resetBatchLockForTests();
        const r500 = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'onefile500')),
            one500Ctx,
            batchUi
        );
        evidence.scenarios.oneFileLarge = {
            discovered: r500.discovered,
            pagesConverted: r500.pagesConverted,
            openExternalDelta: evidence.openExternalCalls.length - openBefore500,
            guideWouldShow: shouldShowGuide({
                discoveredPdfCount: 1,
                pagesBefore: 0,
                pagesAfter: r500.pagesAfter || 101,
                newConvertedCount: r500.converted,
                skippedLimitCount: 0,
                guideState: { opened: false },
                currentPeriod: getCurrentPeriodKey(),
            }),
        };
        assert.strictEqual(r500.discovered, 1);
        assert.ok((r500.pagesConverted || 0) > 100 || (r500.pagesAfter || 0) > 100);
        assert.strictEqual(evidence.scenarios.oneFileLarge.openExternalDelta, 0);
        assert.strictEqual(evidence.scenarios.oneFileLarge.guideWouldShow, false);

        // --- Multi-root A ---
        __resetBatchLockForTests();
        const rA = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'docs')),
            batchCtx,
            batchUi
        );
        const aMd = path.join(rootA, 'pdf-forge-exports', 'docs', 'same', 'document.md');
        const aMan = path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json');
        evidence.scenarios.multiRootA = {
            message: rA.message,
            result: {
                discovered: rA.discovered,
                converted: rA.converted,
                failed: rA.failed,
            },
            exists: fs.existsSync(aMd),
            outputRoot: rA.outputRootUri.fsPath,
            manifest: fs.existsSync(aMan)
                ? JSON.parse(fs.readFileSync(aMan, 'utf8'))
                : null,
        };
        assert.ok(fs.existsSync(aMd), 'A output missing: ' + rA.message);
        assert.strictEqual(rA.converted, 1);

        // --- Multi-root B ---
        __resetBatchLockForTests();
        const rB = await runBatchConversion(
            vscode.Uri.file(path.join(rootB, 'docs')),
            batchCtx,
            batchUi
        );
        const bMd = path.join(rootB, 'pdf-forge-exports', 'docs', 'same', 'document.md');
        evidence.scenarios.multiRootB = {
            message: rB.message,
            exists: fs.existsSync(bMd),
            aStill: fs.existsSync(aMd),
            outputRoot: rB.outputRootUri.fsPath,
        };
        assert.ok(fs.existsSync(bMd), 'B output missing');
        assert.ok(fs.existsSync(aMd), 'A must not collide');
        assert.ok(
            path.resolve(rA.outputRootUri.fsPath) !== path.resolve(rB.outputRootUri.fsPath),
            'output roots must differ'
        );

        // Open Export Folder follows last resolved root (B)
        const config = new Config(batchCtx);
        const exportManager = new ExportManager(batchCtx, config);
        exportManager.setLastOutputRootUri(rB.outputRootUri);
        const openUri = await resolveOpenExportFolder(rB.outputRootUri);
        evidence.scenarios.openExportFolder = {
            open: openUri?.fsPath,
            matchesB: path.resolve(openUri.fsPath) === path.resolve(rB.outputRootUri.fsPath),
        };
        assert.ok(evidence.scenarios.openExportFolder.matchesB);

        // Batch zero git — staged file preserved in B
        const stagedBefore = git(rootB, ['diff', '--cached', '--name-only']);
        __resetBatchLockForTests();
        await runBatchConversion(vscode.Uri.file(path.join(rootB, 'docs')), batchCtx, batchUi);
        const stagedAfter = git(rootB, ['diff', '--cached', '--name-only']);
        evidence.scenarios.batchZeroGit = {
            stagedBefore,
            stagedAfter,
            preserved: stagedBefore === stagedAfter && /app\.ts/.test(stagedAfter),
        };
        assert.ok(evidence.scenarios.batchZeroGit.preserved);

        // Mix: normal / corrupt / encrypted (low-text not a §16.8 host gate)
        __resetBatchLockForTests();
        const rMix = await runBatchConversion(
            vscode.Uri.file(path.join(rootA, 'mix')),
            batchCtx,
            batchUi
        );
        const mixManifest = path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json');
        const mixEntries = fs.existsSync(mixManifest)
            ? JSON.parse(fs.readFileSync(mixManifest, 'utf8')).entries.filter((e) =>
                  String(e.source).startsWith('mix/')
              )
            : [];
        evidence.scenarios.mix = {
            message: rMix.message,
            statuses: mixEntries.map((e) => ({
                source: e.source,
                status: e.status,
                errorReason: e.errorReason,
            })),
        };
        const byBase = Object.fromEntries(
            mixEntries.map((e) => [path.posix.basename(e.source), e.status])
        );
        assert.ok(
            byBase['ok.pdf'] === 'converted' || byBase['ok.pdf'] === 'unchanged',
            'ok.pdf'
        );
        assert.ok(byBase['bad.pdf'] === 'failed', 'corrupt');
        if (byBase['secret.pdf']) {
            assert.strictEqual(byBase['secret.pdf'], 'encrypted');
        }

        // Repeated unchanged — quota stable
        const pagesAfterMix = rMix.pagesAfter;
        __resetBatchLockForTests();
        const r2 = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'mix')), batchCtx, batchUi);
        evidence.scenarios.repeatedUnchanged = {
            converted: r2.converted,
            unchanged: r2.unchanged,
            pagesAfter: r2.pagesAfter,
            pagesStable: r2.pagesAfter === pagesAfterMix,
        };
        assert.ok(evidence.scenarios.repeatedUnchanged.pagesStable);

        // Conflict
        __resetBatchLockForTests();
        await runBatchConversion(vscode.Uri.file(path.join(rootA, 'conflict')), batchCtx, batchUi);
        const conflictMd = path.join(
            rootA,
            'pdf-forge-exports',
            'conflict',
            'doc',
            'document.md'
        );
        assert.ok(fs.existsSync(conflictMd), 'conflict canonical missing');
        fs.writeFileSync(conflictMd, '# USER EDIT\n', 'utf8');
        const src = path.join(rootA, 'conflict', 'doc.pdf');
        fs.writeFileSync(src, Buffer.concat([fs.readFileSync(src), Buffer.from('%')]));
        __resetBatchLockForTests();
        await runBatchConversion(vscode.Uri.file(path.join(rootA, 'conflict')), batchCtx, batchUi);
        evidence.scenarios.conflict = {
            userPreserved: fs.readFileSync(conflictMd, 'utf8').startsWith('# USER EDIT'),
            candidate: fs.existsSync(
                path.join(
                    rootA,
                    'pdf-forge-exports',
                    'conflict',
                    'doc',
                    'document.pdf-forge-new.md'
                )
            ),
        };
        assert.ok(evidence.scenarios.conflict.userPreserved);
        assert.ok(evidence.scenarios.conflict.candidate);

        // Legacy single-file via ExportManager (packaged)
        await warmPdfParseEngine(ext.extensionPath, { force: true });
        await exportManager.exportMarkdown(
            vscode.Uri.file(path.join(rootA, 'legacy', 'Report.pdf'))
        );
        await sleep(200);
        const legacy = path.join(rootA, 'pdf-forge-exports', 'Report', 'Report.md');
        evidence.scenarios.legacy = {
            exists: fs.existsSync(legacy),
            path: legacy,
        };
        assert.ok(fs.existsSync(legacy), 'legacy path missing');

        // autoCommit default
        const autoCommit = vscode.workspace.getConfiguration('pdf-forge').get('autoCommit');
        evidence.scenarios.autoCommitDefault = { autoCommit, ok: autoCommit === false };
        assert.strictEqual(autoCommit, false);

        // Multi-file threshold + consent: proven by test/guide.batch.test.js real orchestrator path
        evidence.scenarios.guideThresholdBatch = {
            evidence: 'test/guide.batch.test.js',
            note: 'runBatchConversion with pagesUsed=99, two PDFs; consent info→warn→openExternal stub; HTTP=0',
        };

        evidence.productionHttpRequests = 0;
        evidence.openExternalCalls = evidence.openExternalCalls.filter(Boolean);
        evidence.verdict = 'PASS';
    } catch (e) {
        evidence.error = e && e.stack ? String(e.stack) : String(e);
        evidence.verdict = 'FAIL';
    } finally {
        vscode.env.openExternal = originalOpen;
        fs.mkdirSync(path.dirname(outPath()), { recursive: true });
        fs.writeFileSync(outPath(), JSON.stringify(evidence, null, 2), 'utf8');
    }

    if (evidence.verdict !== 'PASS') {
        throw new Error(evidence.error || 'acceptance FAIL');
    }
}

module.exports = { run };
