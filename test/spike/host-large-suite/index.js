'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { stubGuideUi } = require('../stubGuideUi');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-large-probe.json');
    const progressPath = out.replace(/\.json$/, '.progress.log');
    const breadcrumb = (msg) => {
        try {
            fs.appendFileSync(progressPath, `${Date.now()} ${msg}\n`);
        } catch {
            // ignore
        }
    };
    fs.writeFileSync(progressPath, '');
    const ev = { verdict: 'FAIL', timings: {} };
    const t0 = Date.now();
    try {
        breadcrumb('stub-guide');
        const guideEvents = stubGuideUi(vscode, breadcrumb);
        const openExternalCalls = [];
        // Also inject openExternal stub via options; keep env patch
        try {
            Object.defineProperty(vscode.env, 'openExternal', {
                configurable: true,
                writable: true,
                value: async (u) => {
                    openExternalCalls.push(String(u));
                    breadcrumb('openExternal:' + String(u));
                    return true;
                },
            });
        } catch {
            vscode.env.openExternal = async (u) => {
                openExternalCalls.push(String(u));
                return true;
            };
        }
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        breadcrumb('activate');
        await ext.activate();
        const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');
        const { getCurrentPeriodKey } = req('./out/quota.js');
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
        breadcrumb('rootA=' + rootA);

        const mem = new Map();
        mem.set('pdf-forge.batchUsage', { periodKey: getCurrentPeriodKey(), pagesUsed: 0 });
        const ctx = {
            globalState: {
                get(k, d) {
                    return mem.has(k) ? mem.get(k) : d;
                },
                async update(k, v) {
                    mem.set(k, v);
                },
            },
            workspaceState: { get() {}, async update() {} },
            extensionPath: ext.extensionPath,
            globalStorageUri: vscode.Uri.file(path.join(rootA, '.g')),
            subscriptions: [],
        };

        ev.timings.activateMs = Date.now() - t0;
        const t1 = Date.now();
        __resetBatchLockForTests();
        breadcrumb('batch-start');
        const r = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'largefirst')), ctx, {
            openExternal: async (u) => {
                openExternalCalls.push(String(u));
                return true;
            },
            showInformationMessage: async (message, ...items) => {
                guideEvents.push({ type: 'info', message: String(message), items });
                breadcrumb('opt-info:' + String(message).slice(0, 60));
                return items.includes('Not now') ? 'Not now' : undefined;
            },
            showWarningMessage: async (message) => {
                guideEvents.push({ type: 'warn', message: String(message) });
                breadcrumb('opt-warn:' + String(message).slice(0, 60));
                return undefined;
            },
            progress: {
                report(value) {
                    breadcrumb('progress:' + (value && value.message ? value.message : ''));
                },
            },
        });
        breadcrumb('batch-done');
        ev.timings.batchMs = Date.now() - t1;
        const man = JSON.parse(
            fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
        );
        const indexMd = fs.readFileSync(path.join(rootA, 'pdf-forge-exports', 'INDEX.md'), 'utf8');
        const entries = man.entries.filter((e) => String(e.source).startsWith('largefirst/'));
        const large = entries.find((e) => e.source.endsWith('a-large.pdf'));
        const small = entries.find((e) => e.source.endsWith('b-small.pdf'));
        ev.batch = {
            message: r.message,
            pagesBefore: 0,
            pagesAfter: mem.get('pdf-forge.batchUsage')?.pagesUsed,
            largeStatus: large?.status,
            largePages: large?.pageCount,
            smallStatus: small?.status,
            md: fs.existsSync(
                path.join(rootA, 'pdf-forge-exports', 'largefirst', 'a-large', 'document.md')
            ),
            indexHasConverted: /a-large\.pdf/.test(indexMd) && /converted/.test(indexMd),
            indexHasSkipped: /b-small\.pdf/.test(indexMd) && /skipped_limit/.test(indexMd),
            guidePrompted: guideEvents.some((e) => /batch guide/i.test(e.message)),
            openExternalCalls,
        };
        assert.ok(large?.pageCount > 100);
        assert.ok(large?.status === 'converted' || large?.status === 'low_text');
        assert.ok(ev.batch.md);
        assert.ok(ev.batch.pagesAfter > 100);
        assert.strictEqual(small?.status, 'skipped_limit');
        assert.strictEqual(openExternalCalls.length, 0);
        ev.verdict = 'PASS';
    } catch (e) {
        ev.error = String(e && e.stack ? e.stack : e);
        ev.verdict = 'FAIL';
    }
    ev.timings.totalMs = Date.now() - t0;
    fs.writeFileSync(out, JSON.stringify(ev, null, 2));
    if (ev.verdict !== 'PASS') throw new Error(ev.error || 'fail');
}

module.exports = { run };
