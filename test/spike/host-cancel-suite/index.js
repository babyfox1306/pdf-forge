'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const vscode = require('vscode');
const { stubGuideUi } = require('../stubGuideUi');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-cancel-probe.json');
    const ev = { verdict: 'FAIL' };
    try {
        stubGuideUi(vscode);
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');
        const { getCurrentPeriodKey } = req('./out/quota.js');
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A').uri.fsPath;
        const rootB = folders.find((f) => f.name === 'B').uri.fsPath;

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

        const openCalls = [];
        const stagedBefore = execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd: rootB,
            encoding: 'utf8',
        }).trim();

        let cancelArmed = false;
        const token = {
            get isCancellationRequested() {
                return cancelArmed;
            },
        };
        const progress = {
            report(value) {
                if (value?.message && /Converting 2\//.test(value.message)) {
                    cancelArmed = true;
                }
            },
        };

        __resetBatchLockForTests();
        const r = await runBatchConversion(vscode.Uri.file(path.join(rootA, 'cancel')), ctx, {
            openExternal: async (u) => {
                openCalls.push(String(u));
                return true;
            },
            showInformationMessage: async () => 'Not now',
            showWarningMessage: async () => undefined,
            token,
            progress,
        });

        const man = JSON.parse(
            fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
        );
        const entries = man.entries.filter((e) => String(e.source).startsWith('cancel/'));
        const a = entries.find((e) => e.source.endsWith('a.pdf'));
        const b = entries.find((e) => e.source.endsWith('b.pdf'));
        const aMd = path.join(rootA, 'pdf-forge-exports', 'cancel', 'a', 'document.md');
        const bMd = path.join(rootA, 'pdf-forge-exports', 'cancel', 'b', 'document.md');
        const temps = fs.existsSync(path.join(rootA, 'pdf-forge-exports', 'cancel'))
            ? fs
                  .readdirSync(path.join(rootA, 'pdf-forge-exports', 'cancel'), { recursive: true })
                  .filter((n) => String(n).includes('.tmp') || String(n).endsWith('.partial'))
            : [];
        const stagedAfter = execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd: rootB,
            encoding: 'utf8',
        }).trim();

        ev.batch = {
            message: r.message,
            statusA: a?.status,
            statusB: b?.status,
            aMd: fs.existsSync(aMd),
            bMd: fs.existsSync(bMd),
            pagesUsed: mem.get('pdf-forge.batchUsage')?.pagesUsed,
            chargedB: (b?.chargedSourceHashes || []).length,
            temps,
            openCalls,
            stagedPreserved: stagedBefore === stagedAfter,
        };
        assert.ok(a?.status === 'converted' || a?.status === 'unchanged');
        assert.ok(fs.existsSync(aMd));
        assert.strictEqual(b?.status, 'cancelled');
        assert.strictEqual(fs.existsSync(bMd), false);
        assert.strictEqual((b?.chargedSourceHashes || []).length, 0);
        assert.deepStrictEqual(temps, []);
        assert.strictEqual(openCalls.length, 0);
        assert.ok(ev.batch.stagedPreserved);
        ev.verdict = 'PASS';
    } catch (e) {
        ev.error = String(e && e.stack ? e.stack : e);
        ev.verdict = 'FAIL';
    }
    fs.writeFileSync(out, JSON.stringify(ev, null, 2));
    if (ev.verdict !== 'PASS') throw new Error(ev.error || 'fail');
}

module.exports = { run };
