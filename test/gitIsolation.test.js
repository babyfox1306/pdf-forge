'use strict';

/**
 * Git isolation: exact-file commit, autoCommit false, batch never calls git (§16.7).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { describe, it, before, after } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const {
    loadGitIntegration,
    loadBatchOrchestrator,
} = require('./helpers/loadWithMockVscode');
const { makeTempDir, rimraf, writePdf } = require('./helpers/tempWorkspace');

function git(cwd, args) {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

describe('gitIsolation', () => {
    let repo;
    let mock;

    before(async () => {
        repo = await makeTempDir('pdf-forge-git-');
        git(repo, ['init']);
        git(repo, ['config', 'user.email', 'test@example.com']);
        git(repo, ['config', 'user.name', 'PDF Forge Test']);
        await fs.promises.mkdir(path.join(repo, 'src'), { recursive: true });
        await fs.promises.writeFile(path.join(repo, 'src', 'app.ts'), 'export const x = 1;\n');
        git(repo, ['add', 'src/app.ts']);
        // Leave app.ts staged (not committed) for isolation checks after exact-file commit

        mock = createMockVscode({
            workspaceFolders: [repo],
            autoCommit: true,
            onInfo: async () => undefined,
            onWarn: async () => undefined,
        });
    });

    after(async () => {
        await rimraf(repo);
    });

    it('autoCommitExactFile commits only the generated file; staged app.ts remains', async () => {
        const { GitIntegration } = loadGitIntegration(mock);
        const gitApi = new GitIntegration(repo);

        const outDir = path.join(repo, 'pdf-forge-exports', 'sample');
        await fs.promises.mkdir(outDir, { recursive: true });
        const generated = path.join(outDir, 'document.md');
        await fs.promises.writeFile(generated, '# Generated\n', 'utf8');

        // Ensure app.ts still staged
        const stagedBefore = git(repo, ['diff', '--cached', '--name-only']);
        assert.ok(stagedBefore.includes('src/app.ts'));

        await gitApi.autoCommitExactFile(generated, 'PDF Forge: test export');

        const last = git(repo, ['log', '-1', '--name-only', '--pretty=format:']);
        const files = last.split(/\r?\n/).filter(Boolean);
        assert.deepStrictEqual(files, ['pdf-forge-exports/sample/document.md']);

        const stagedAfter = git(repo, ['diff', '--cached', '--name-only']);
        assert.ok(stagedAfter.includes('src/app.ts'));
    });

    it('paths with spaces and pathspec metacharacters commit exactly one file', async () => {
        const { GitIntegration } = loadGitIntegration(mock);
        const gitApi = new GitIntegration(repo);

        const outDir = path.join(repo, 'pdf-forge-exports', 'my file (1)');
        await fs.promises.mkdir(outDir, { recursive: true });
        const generated = path.join(outDir, 'document.md');
        await fs.promises.writeFile(generated, '# Spaced\n', 'utf8');

        await gitApi.autoCommitExactFile(generated, 'PDF Forge: spaced path');
        const last = git(repo, ['log', '-1', '--name-only', '--pretty=format:']);
        const files = last.split(/\r?\n/).filter(Boolean);
        assert.strictEqual(files.length, 1);
        assert.ok(files[0].includes('my file (1)'));
    });

    it('with autoCommit=false, ExportManager.maybeAutoCommit path is gated (config)', () => {
        mock.__setAutoCommit(false);
        const cfg = mock.workspace.getConfiguration('pdf-forge');
        assert.strictEqual(cfg.get('autoCommit', true), false);
    });

    it('deprecated autoCommit(directory) throws', async () => {
        const { GitIntegration } = loadGitIntegration(mock);
        const gitApi = new GitIntegration(repo);
        await assert.rejects(
            () => gitApi.autoCommit(repo, 'should fail'),
            /autoCommit\(directory\) is removed/
        );
    });

    it('batch conversion never invokes git under autoCommit true or false', async () => {
        const sub = await makeTempDir('pdf-forge-batch-git-');
        try {
            // Real git repo so any accidental git call would succeed/leave traces
            git(sub, ['init']);
            git(sub, ['config', 'user.email', 'test@example.com']);
            git(sub, ['config', 'user.name', 'PDF Forge Test']);
            await fs.promises.writeFile(path.join(sub, 'readme.txt'), 'x\n');
            git(sub, ['add', 'readme.txt']);
            git(sub, ['commit', '-m', 'init']);
            const logBefore = git(sub, ['log', '--oneline']);

            for (const auto of [true, false]) {
                const m = createMockVscode({
                    workspaceFolders: [sub],
                    autoCommit: auto,
                    onInfo: async () => undefined,
                    onWarn: async () => undefined,
                });
                const { runBatchConversion, __resetBatchLockForTests } =
                    loadBatchOrchestrator(m);
                __resetBatchLockForTests();
                await writePdf(path.join(sub, `batch-${auto}.pdf`), {
                    text: 'Batch git isolation PDF with enough extractable characters for convert.',
                });
                await runBatchConversion(m.Uri.file(sub), m.__createContext(), {
                    openExternal: async () => false,
                });
            }

            const logAfter = git(sub, ['log', '--oneline']);
            assert.strictEqual(logAfter, logBefore, 'batch must not create commits');

            // Source-level guarantee: no git runtime dependency in batch
            const batchSrc = fs.readFileSync(
                path.join(__dirname, '..', 'src', 'batchOrchestrator.ts'),
                'utf8'
            );
            assert.ok(!/require\(['"].*gitIntegration['"]\)/.test(batchSrc));
            assert.ok(!/from ['"].*gitIntegration['"]/.test(batchSrc));
            assert.ok(!/simple-git/.test(batchSrc));
            assert.ok(!/autoCommitExactFile/.test(batchSrc));
            assert.ok(/Never imports or calls GitIntegration/.test(batchSrc));
        } finally {
            await rimraf(sub);
        }
    });
});
