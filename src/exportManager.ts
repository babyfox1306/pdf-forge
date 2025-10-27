import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class ExportManager {
    private context: vscode.ExtensionContext;
    private exportFolder: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.exportFolder = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pdf-forge-exports');
        this.ensureExportFolder();
    }

    private ensureExportFolder() {
        if (!fs.existsSync(this.exportFolder)) {
            fs.mkdirSync(this.exportFolder, { recursive: true });
        }
    }

    async extractText() {
        const file = await this.getActivePdf();
        if (!file) return;

        vscode.window.showInformationMessage('Extracting text...');
        // Implementation will be added
    }

    async exportMarkdown() {
        const file = await this.getActivePdf();
        if (!file) return;

        vscode.window.showInformationMessage('Exporting to Markdown...');
        // Implementation will be added
    }

    async copyAllCode() {
        vscode.window.showInformationMessage('Copying all code blocks...');
        // Implementation will be added
    }

    async exportNotes() {
        vscode.window.showInformationMessage('Exporting notes...');
        // Implementation will be added
    }

    async comparePdfs() {
        const files = await vscode.window.showOpenDialog({
            filters: { 'PDF Files': ['pdf'] },
            canSelectMany: true,
            openLabel: 'Select PDFs to compare'
        });

        if (files && files.length === 2) {
            vscode.window.showInformationMessage('Comparing PDFs...');
            // Implementation will be added
        }
    }

    async openExportFolder() {
        const uri = vscode.Uri.file(this.exportFolder);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }

    async extractTables() {
        const file = await this.getActivePdf();
        if (!file) return;

        vscode.window.showInformationMessage('Extracting tables...');
        // Implementation will be added
    }

    async deduplicateCode() {
        vscode.window.showInformationMessage('Deduplicating code blocks...');
        // Implementation will be added
    }

    private async getActivePdf(): Promise<vscode.Uri | null> {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.uri.fsPath.endsWith('.pdf')) {
            return editor.document.uri;
        }
        return null;
    }

    private getExportPath(filename: string): string {
        const base = path.basename(filename, '.pdf');
        return path.join(this.exportFolder, base);
    }
}


