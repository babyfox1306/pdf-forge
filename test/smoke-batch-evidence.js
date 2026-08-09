'use strict';
const fs = require('fs');
const path = require('path');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadBatchOrchestrator } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

(async () => {
    ensureGeneratedFixtures();
    const root = await makeTempDir('pdf-forge-evidence-');
    const mock = createMockVscode({
        workspaceFolders: [root],
        onInfo: async () => undefined,
        onWarn: async () => undefined,
    });
    const { runBatchConversion, __resetBatchLockForTests } = loadBatchOrchestrator(mock);
    const ctx = mock.__createContext();

    await copyFixture('normal.pdf', path.join(root, 'docs', 'a.pdf'));
    await copyFixture('normal.pdf', path.join(root, 'docs', 'b.pdf'));

    const result1 = await runBatchConversion(mock.Uri.file(path.join(root, 'docs')), ctx, {
        openExternal: async () => false,
    });
    const usage1 = ctx.globalState.get('pdf-forge.batchUsage');

    __resetBatchLockForTests();
    const result2 = await runBatchConversion(mock.Uri.file(path.join(root, 'docs')), ctx, {
        openExternal: async () => false,
    });
    const usage2 = ctx.globalState.get('pdf-forge.batchUsage');

    const exportsDir = path.join(root, 'pdf-forge-exports');
    const tree = [];
    function walk(d, prefix = '') {
        for (const n of fs.readdirSync(d).sort()) {
            const p = path.join(d, n);
            const rel = prefix + n;
            if (fs.statSync(p).isDirectory()) {
                tree.push(rel + '/');
                walk(p, rel + '/');
            } else {
                tree.push(`${rel} (${fs.statSync(p).size}b)`);
            }
        }
    }
    walk(exportsDir);

    const manifest = JSON.parse(
        fs.readFileSync(path.join(exportsDir, '.pdf-forge-manifest.json'), 'utf8')
    );
    const indexLines = fs
        .readFileSync(path.join(exportsDir, 'INDEX.md'), 'utf8')
        .split(/\r?\n/)
        .slice(0, 15);

    const out = {
        root,
        result1: {
            converted: result1.converted,
            unchanged: result1.unchanged,
            message: result1.message,
            pagesBefore: result1.pagesBefore,
            pagesAfter: result1.pagesAfter,
        },
        result2: {
            converted: result2.converted,
            unchanged: result2.unchanged,
            message: result2.message,
        },
        usage1,
        usage2,
        quotaUnchanged: JSON.stringify(usage1) === JSON.stringify(usage2),
        tree,
        manifestEntrySanitized: manifest.entries[0]
            ? {
                  source: manifest.entries[0].source,
                  status: manifest.entries[0].status,
                  pageCount: manifest.entries[0].pageCount,
                  converterVersion: manifest.entries[0].converterVersion,
                  chargedCount: (manifest.entries[0].chargedSourceHashes || []).length,
              }
            : null,
        indexSample: indexLines,
    };

    const evidencePath = path.join(__dirname, 'spike', 'batch-evidence.json');
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    await rimraf(root);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
