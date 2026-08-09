'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
  const out =
    process.env.PDF_FORGE_ACCEPTANCE_OUT ||
    path.join(__dirname, '..', 'host-large-batch-local.json');
  const ev = { verdict: 'FAIL', timings: {} };
  const t0 = Date.now();
  try {
    const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
    await ext.activate();
    const req = require('module').createRequire(path.join(ext.extensionPath, 'package.json'));
    const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');
    const { getCurrentPeriodKey } = req('./out/quota.js');
    const folders = vscode.workspace.workspaceFolders || [];
    const rootA = folders.find((f) => f.name === 'A').uri.fsPath;

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
    const batchPromise = runBatchConversion(vscode.Uri.file(path.join(rootA, 'largefirst')), ctx, {
      openExternal: async () => true,
    });
    const r = await Promise.race([
      batchPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('batch timeout 60s')), 60000)),
    ]);
    ev.timings.batchMs = Date.now() - t1;
    const man = JSON.parse(
      fs.readFileSync(path.join(rootA, 'pdf-forge-exports', '.pdf-forge-manifest.json'), 'utf8')
    );
    const entries = man.entries.filter((e) => String(e.source).startsWith('largefirst/'));
    const large = entries.find((e) => e.source.endsWith('a-large.pdf'));
    const small = entries.find((e) => e.source.endsWith('b-small.pdf'));
    ev.batch = {
      message: r.message,
      pagesAfter: mem.get('pdf-forge.batchUsage')?.pagesUsed,
      large,
      small,
      md: fs.existsSync(
        path.join(rootA, 'pdf-forge-exports', 'largefirst', 'a-large', 'document.md')
      ),
    };
    assert.ok(large?.pageCount > 100);
    assert.ok(large?.status === 'converted' || large?.status === 'low_text');
    assert.ok(ev.batch.md);
    assert.ok(ev.batch.pagesAfter > 100);
    assert.strictEqual(small?.status, 'skipped_limit');
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
