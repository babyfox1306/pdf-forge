/** Host cold batch-only (no prior convert). */
'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

async function run() {
    const out =
        process.env.PDF_FORGE_ACCEPTANCE_OUT ||
        path.join(__dirname, '..', 'host-batch-cold.json');
    const evidence = { trials: [], verdict: 'FAIL' };
    try {
        const ext = vscode.extensions.getExtension('babyfox1306.pdf-forge');
        await ext.activate();
        const folders = vscode.workspace.workspaceFolders || [];
        const rootA = folders.find((f) => f.name === 'A')?.uri.fsPath;
        if (!rootA) throw new Error('no root A');

        const createRequire = require('module').createRequire;
        const req = createRequire(path.join(ext.extensionPath, 'package.json'));
        const { runBatchConversion, __resetBatchLockForTests } = req('./out/batchOrchestrator.js');

        for (let t = 0; t < 3; t++) {
            // fresh exports each trial
            const exportsDir = path.join(rootA, 'pdf-forge-exports');
            fs.rmSync(exportsDir, { recursive: true, force: true });
            const mem = new Map();
            const batchCtx = {
                globalState: {
                    get(key, def) {
                        return mem.has(key) ? mem.get(key) : def;
                    },
                    async update(key, value) {
                        mem.set(key, value);
                    },
                },
                workspaceState: { get() {}, async update() {} },
                extensionPath: ext.extensionPath,
                globalStorageUri: vscode.Uri.file(path.join(rootA, '.g')),
                subscriptions: [],
            };
            __resetBatchLockForTests();
            const r = await runBatchConversion(
                vscode.Uri.file(path.join(rootA, 'docs')),
                batchCtx,
                { openExternal: async () => true }
            );
            const man = path.join(exportsDir, '.pdf-forge-manifest.json');
            evidence.trials.push({
                t,
                message: r.message,
                converted: r.converted,
                failed: r.failed,
                errorReason: fs.existsSync(man)
                    ? JSON.parse(fs.readFileSync(man, 'utf8')).entries[0]?.errorReason
                    : null,
            });
        }
        evidence.verdict = evidence.trials.every((x) => x.converted === 1) ? 'PASS' : 'FAIL';
    } catch (e) {
        evidence.error = String(e && e.stack ? e.stack : e);
        evidence.verdict = 'FAIL';
    }
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    if (evidence.verdict !== 'PASS') throw new Error(JSON.stringify(evidence, null, 2));
}

module.exports = { run };
