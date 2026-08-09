'use strict';

const assert = require('assert');
const path = require('path');
const { describe, it, before } = require('node:test');
const { discoverPdfs } = require('../out/discovery');
const { ensureGeneratedFixtures, FIXTURES } = require('./helpers/makePdf');

describe('discovery', () => {
    const trees = path.join(FIXTURES, 'trees');

    before(() => {
        ensureGeneratedFixtures();
    });

    it('prunes pdf-forge-exports, node_modules, and .git at any depth', async () => {
        const root = path.join(trees, 'pruned');
        const found = await discoverPdfs(root, root);
        assert.deepStrictEqual(found, ['keep/visible.pdf']);
        assert.ok(!found.some((p) => p.includes('pdf-forge-exports')));
        assert.ok(!found.some((p) => p.includes('node_modules')));
        assert.ok(!found.some((p) => p.includes('.git')));
    });

    it('deterministic order independent of discovery walk', async () => {
        const root = trees;
        const a = await discoverPdfs(root, root);
        const b = await discoverPdfs(root, root);
        assert.deepStrictEqual(a, b);
        const sorted = [...a].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0));
        assert.deepStrictEqual(a, sorted);
    });

    it('identical basenames in different folders are both discovered', async () => {
        const root = trees;
        const found = await discoverPdfs(root, root);
        assert.ok(found.includes('folder-a/report.pdf'));
        assert.ok(found.includes('folder-b/report.pdf'));
        const reports = found.filter((p) => p.endsWith('/report.pdf') || p === 'report.pdf');
        assert.ok(reports.length >= 2);
    });

    it('returns paths relative to workspace root', async () => {
        const workspace = trees;
        const folder = path.join(trees, 'folder-a');
        const found = await discoverPdfs(folder, workspace);
        assert.deepStrictEqual(found, ['folder-a/report.pdf']);
    });
});
