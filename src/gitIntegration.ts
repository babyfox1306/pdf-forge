import * as vscode from 'vscode';
import * as path from 'path';

let simpleGit: any;

// Try to load simple-git, but make it optional
try {
    const simpleGitModule = require('simple-git');
    simpleGit = simpleGitModule.default || simpleGitModule;
} catch {
    console.warn('[PDF Forge] simple-git not available, git features disabled');
}

export class GitIntegration {
    private git: any;
    private workspacePath: string;

    constructor(workspacePath: string) {
        if (!simpleGit) {
            throw new Error('simple-git is not available');
        }
        this.workspacePath = workspacePath;
        this.git = simpleGit(workspacePath);
    }

    async isGitRepo(): Promise<boolean> {
        try {
            await this.git.status();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Stage and commit exactly one generated file using pathspec.
     * Never runs a bare commit that could include unrelated staged changes.
     */
    async autoCommitExactFile(generatedFilePath: string, message: string): Promise<void> {
        if (!(await this.isGitRepo())) {
            vscode.window.showWarningMessage('Not a git repository. Skipping auto-commit.');
            return;
        }

        const abs = path.resolve(generatedFilePath);
        const relPath = path.relative(this.workspacePath, abs);
        if (!relPath || relPath.startsWith('..') || path.isAbsolute(relPath)) {
            throw new Error('Generated file is outside the Git workspace');
        }

        // Normalize to forward slashes for Git pathspec on Windows
        const repoRelativePath = relPath.split(path.sep).join('/');

        try {
            await this.git.raw(['add', '--', repoRelativePath]);
            await this.git.raw(['commit', '-m', message, '--', repoRelativePath]);
            vscode.window.showInformationMessage(`Committed: ${message}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Git commit failed: ${error}`);
        }
    }

    /** @deprecated Use autoCommitExactFile — kept temporarily to avoid silent breakages. */
    async autoCommit(exportPath: string, message: string = 'PDF Forge: Export documents'): Promise<void> {
        // Directory-scoped commits are intentionally removed; refuse to bare-commit.
        throw new Error(
            'autoCommit(directory) is removed in v1.0.9; use autoCommitExactFile(generatedFilePath, message)'
        );
    }

    async getLastCommitDiff(filePath: string): Promise<string> {
        try {
            const diff = await this.git.diff([filePath]);
            return diff;
        } catch (error) {
            throw new Error(`Failed to get diff: ${error}`);
        }
    }
}
