import * as vscode from 'vscode';
import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';

export class GitIntegration {
    private git: SimpleGit;

    constructor(workspacePath: string) {
        this.git = simpleGit(workspacePath);
    }

    async isGitRepo(): Promise<boolean> {
        try {
            await this.git.status();
            return true;
        } catch (error) {
            return false;
        }
    }

    async autoCommit(exportPath: string, message: string = 'PDF Forge: Export documents'): Promise<void> {
        if (!await this.isGitRepo()) {
            vscode.window.showWarningMessage('Not a git repository. Skipping auto-commit.');
            return;
        }

        try {
            // Stage the export directory
            await this.git.add(exportPath);
            
            // Commit with message
            await this.git.commit(message);
            
            vscode.window.showInformationMessage(`Committed: ${message}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Git commit failed: ${error}`);
        }
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

