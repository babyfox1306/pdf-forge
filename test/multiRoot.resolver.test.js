'use strict';

/**
 * Multi-root workspace resolver (partial C) — output roots + last output + git cwd.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, it, before, after } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const {
    loadWorkspaceContext,
    loadExportManager,
} = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, copyFixture } = require('./helpers/tempWorkspace');
const { ensureGeneratedFixtures } = require('./helpers/makePdf');

function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('multiRoot.resolver', () => {
    let rootA;
    let rootB;
    let mock;

    before(async () => {
        ensureGeneratedFixtures();
        rootA = await makeTempDir('pdf-forge-mr-a-');
        rootB = await makeTempDir('pdf-forge-mr-b-');
        await fs.promises.mkdir(path.join(rootA, 'docs'), { recursive: true });
        await fs.promises.mkdir(path.join(rootB, 'docs'), { recursive: true });
        await copyFixture('normal.pdf', path.join(rootA, 'docs', 'x.pdf'));
        await copyFixture('normal.pdf', path.join(rootB, 'docs', 'x.pdf'));

        git(rootB, ['init']);
        git(rootB, ['config', 'user.email', 'test@example.com']);
        git(rootB, ['config', 'user.name', 'PDF Forge Test']);
        await fs.promises.writeFile(path.join(rootB, 'readme.txt'), 'b\n');
        git(rootB, ['add', 'readme.txt']);
        git(rootB, ['commit', '-m', 'init']);

        mock = createMockVscode({
            workspaceFolders: [rootA, rootB],
            folderNames: ['A', 'B'],
            autoCommit: false,
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
    });

    after(async () => {
        await rimraf(rootA);
        await rimraf(rootB);
    });

    it('resolveWorkspaceContext maps file in A/B to that root pdf-forge-exports', () => {
        const { resolveWorkspaceContext } = loadWorkspaceContext(mock);
        const a = resolveWorkspaceContext(mock.Uri.file(path.join(rootA, 'docs', 'x.pdf')));
        const b = resolveWorkspaceContext(mock.Uri.file(path.join(rootB, 'docs', 'x.pdf')));

        assert.strictEqual(
            path.normalize(a.outputRootUri.fsPath),
            path.normalize(path.join(rootA, 'pdf-forge-exports'))
        );
        assert.strictEqual(
            path.normalize(b.outputRootUri.fsPath),
            path.normalize(path.join(rootB, 'pdf-forge-exports'))
        );
        assert.notStrictEqual(
            path.normalize(a.outputRootUri.fsPath),
            path.normalize(b.outputRootUri.fsPath)
        );
        assert.strictEqual(a.sourceRelativePath, 'docs/x.pdf');
        assert.strictEqual(b.sourceRelativePath, 'docs/x.pdf');
    });

    it('ExportManager export in B sets getLastOutputRootUriForTests to B exports', async () => {
        mock.__setAutoCommit(false);
        const { ExportManager } = loadExportManager(mock);
        const mgr = new ExportManager(mock.__createContext());
        const pdfB = path.join(rootB, 'docs', 'x.pdf');
        await mgr.exportMarkdown(mock.Uri.file(pdfB));

        const last = mgr.getLastOutputRootUriForTests();
        assert.ok(last);
        assert.strictEqual(
            path.normalize(last.fsPath),
            path.normalize(path.join(rootB, 'pdf-forge-exports'))
        );
        assert.ok(
            fs.existsSync(path.join(rootB, 'pdf-forge-exports', 'x', 'x.md'))
        );
    });

    it('autoCommit true for B file: GitIntegration constructed with B workspace path', async () => {
        const constructions = [];
        mock.__setAutoCommit(true);
        const { ExportManager } = loadExportManager(mock, {
            gitConstructions: constructions,
        });
        const mgr = new ExportManager(mock.__createContext());
        const pdfB = path.join(rootB, 'solo.pdf');
        await copyFixture('normal.pdf', pdfB);
        await mgr.exportMarkdown(mock.Uri.file(pdfB));

        assert.ok(constructions.length >= 1, 'GitIntegration should be constructed');
        assert.strictEqual(
            path.normalize(constructions[0]),
            path.normalize(rootB),
            'git cwd must be B, not A'
        );
        assert.ok(
            !constructions.some(
                (p) => path.normalize(p) === path.normalize(rootA)
            ),
            'must not use A workspace path'
        );
    });
});
