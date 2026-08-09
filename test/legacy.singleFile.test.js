'use strict';

/**
 * §F legacy single-file export layout + autoCommit gate.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { describe, it, before, after } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { loadExportManager } = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

describe('legacy.singleFile', () => {
    let root;
    let mock;
    let gitConstructions;

    before(async () => {
        ensureGeneratedFixtures();
        root = await makeTempDir('pdf-forge-legacy-');
        gitConstructions = [];
        mock = createMockVscode({
            workspaceFolders: [root],
            autoCommit: false,
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
    });

    after(async () => {
        await rimraf(root);
    });

    it('pdf-forge.autoCommit defaults to false (package.json + Config)', () => {
        const pkg = JSON.parse(
            fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
        );
        assert.strictEqual(
            pkg.contributes.configuration.properties['pdf-forge.autoCommit'].default,
            false
        );

        const { installVscodeMock, clearOutCache, OUT } = require('./helpers/loadWithMockVscode');
        installVscodeMock(mock);
        clearOutCache();
        const { Config } = require(path.join(OUT, 'config.js'));
        const cfg = new Config(mock.__createContext());
        assert.strictEqual(cfg.autoCommit, false);
    });

    it('exportMarkdown writes pdf-forge-exports/<basename>/<basename>.md (not document.md)', async () => {
        gitConstructions.length = 0;
        mock.__setAutoCommit(false);
        const { ExportManager, __gitConstructions } = loadExportManager(mock, {
            gitConstructions,
        });
        assert.strictEqual(__gitConstructions, gitConstructions);

        const pdfPath = path.join(root, 'report.pdf');
        await copyFixture('normal.pdf', pdfPath);
        const mgr = new ExportManager(mock.__createContext());
        await mgr.exportMarkdown(mock.Uri.file(pdfPath));

        const expected = path.join(root, 'pdf-forge-exports', 'report', 'report.md');
        assert.ok(fs.existsSync(expected), `expected ${expected}`);
        assert.ok(!fs.existsSync(path.join(root, 'pdf-forge-exports', 'report', 'document.md')));
        assert.strictEqual(
            path.normalize(expected),
            path.normalize(path.join(root, 'pdf-forge-exports', 'report', 'report.md'))
        );
    });

    it('autoCommit false: GitIntegration never constructed', async () => {
        gitConstructions.length = 0;
        mock.__setAutoCommit(false);
        const { ExportManager } = loadExportManager(mock, { gitConstructions });
        const pdfPath = path.join(root, 'nogit.pdf');
        await copyFixture('normal.pdf', pdfPath);
        const mgr = new ExportManager(mock.__createContext());
        await mgr.exportMarkdown(mock.Uri.file(pdfPath));
        assert.deepStrictEqual(gitConstructions, [], 'GitIntegration must not be constructed');
    });
});
