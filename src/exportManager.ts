import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TextExtractor } from './textExtractor';
import { ConversionEngine } from './conversionEngine';
import { TableExtractor } from './tableExtractor';
import { CodeIntelligence } from './codeIntelligence';
import { DiffEngine } from './diffEngine';
// Git integration is optional
let GitIntegration: any;
try {
    GitIntegration = require('./gitIntegration').GitIntegration;
} catch (error) {
    // Git integration not available
}
import { NotesManager } from './notesManager';
import { Config } from './config';
import { logError, logInfo, logWarn } from './log';

export class ExportManager {
    private context: vscode.ExtensionContext;
    private exportFolder: string;
    private textExtractor: TextExtractor;
    private conversionEngine: ConversionEngine;
    private tableExtractor: TableExtractor;
    private codeIntelligence: CodeIntelligence;
    private diffEngine: DiffEngine;
    private gitIntegration: any = null;
    private notesManager: NotesManager;
    private config: Config;

    constructor(context: vscode.ExtensionContext, config?: Config) {
        this.context = context;
        this.config = config || new Config(context);
        this.exportFolder = path.join(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '', 'pdf-forge-exports');
        this.textExtractor = new TextExtractor();
        this.conversionEngine = new ConversionEngine();
        this.tableExtractor = new TableExtractor();
        this.codeIntelligence = new CodeIntelligence();
        this.diffEngine = new DiffEngine();
        this.notesManager = new NotesManager(context);
        this.ensureExportFolder();
        logInfo(`Export folder: ${this.exportFolder}`);
        this.initializeGit();
    }

    private async initializeGit(): Promise<void> {
        if (!GitIntegration) {
            this.gitIntegration = null;
            return;
        }
        
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspacePath) {
            try {
                this.gitIntegration = new GitIntegration(workspacePath);
                const isRepo = await this.gitIntegration.isGitRepo();
                if (!isRepo) {
                    this.gitIntegration = null;
                }
            } catch (error: any) {
                logWarn(`Git integration initialization failed: ${error?.message || error}`);
                this.gitIntegration = null;
            }
        }
    }

    private ensureExportFolder() {
        if (!fs.existsSync(this.exportFolder)) {
            fs.mkdirSync(this.exportFolder, { recursive: true });
        }
    }

    async extractText(uri?: vscode.Uri) {
        const file = uri || await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            logInfo(`Extracting text: ${file.fsPath}`);
            vscode.window.showInformationMessage('Extracting text...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));
            
            const exportPath = this.getExportPath(file.fsPath);
            if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
            }

            const textPath = path.join(exportPath, 'extracted-text.txt');
            if (fs.existsSync(textPath)) {
                const backupPath = path.join(exportPath, `extracted-text.backup.${Date.now()}.txt`);
                fs.copyFileSync(textPath, backupPath);
            }
            
            fs.writeFileSync(textPath, text, 'utf-8');
            logInfo(`Text extracted (${text.length} chars) → ${textPath}`);
            
            if (this.gitIntegration) {
                try {
                    await this.gitIntegration.autoCommit(exportPath, `PDF Forge: Extract text from ${path.basename(file.fsPath)}`);
                } catch (error: any) {
                    logWarn(`Git auto-commit skipped: ${error?.message || error}`);
                }
            }
            
            vscode.window.showInformationMessage(`Text extracted to: ${textPath}`, 'Open File').then(selection => {
                if (selection === 'Open File') {
                    vscode.window.showTextDocument(vscode.Uri.file(textPath));
                }
            });
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            logError(`Extract text failed: ${errorMessage.split('\n')[0]}`);
            
            if (errorMessage.includes('scanned') || errorMessage.includes('no text layer')) {
                vscode.window.showErrorMessage(errorMessage);
            } else {
                vscode.window.showErrorMessage(
                    `Failed to extract text: ${errorMessage.split('\n')[0]}`,
                    'Show Details'
                ).then(selection => {
                    if (selection === 'Show Details') {
                        logError(errorMessage, true);
                    }
                });
            }
        }
    }

    async exportMarkdown(uri?: vscode.Uri) {
        const file = uri || await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            vscode.window.showInformationMessage('Exporting to Markdown...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const markdown = await this.conversionEngine.convertToMarkdown(Buffer.from(buffer), file.fsPath);
            
            const exportPath = this.getExportPath(file.fsPath);
            const mdPath = path.join(exportPath, path.basename(file.fsPath, '.pdf') + '.md');
            
            if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
            }

            // Backup old export if exists
            if (fs.existsSync(mdPath)) {
                const backupPath = path.join(exportPath, `${path.basename(file.fsPath, '.pdf')}.backup.${Date.now()}.md`);
                fs.copyFileSync(mdPath, backupPath);
            }
            
            fs.writeFileSync(mdPath, markdown, 'utf-8');
            
            // Auto-commit if git integration is enabled
            if (this.gitIntegration) {
                try {
                    await this.gitIntegration.autoCommit(exportPath, `PDF Forge: Export Markdown from ${path.basename(file.fsPath)}`);
                } catch (error) {
                    // Git commit is optional
                }
            }
            
            vscode.window.showInformationMessage(`Markdown exported to: ${mdPath}`, 'Open File').then(selection => {
                if (selection === 'Open File') {
                    vscode.window.showTextDocument(vscode.Uri.file(mdPath));
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export Markdown: ${error.message}`);
        }
    }

    async copyAllCode(uri?: vscode.Uri) {
        const file = uri || await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            vscode.window.showInformationMessage('Extracting code blocks...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));
            const codeBlocks = this.textExtractor.extractCodeBlocks(text);
            
            if (codeBlocks.length === 0) {
                vscode.window.showInformationMessage('No code blocks found in PDF');
                return;
            }

            // Deduplicate if enabled
            const autoDedupe = this.config.autoDedupe;
            const finalBlocks = autoDedupe 
                ? this.codeIntelligence.deduplicateCodeBlocks(codeBlocks)
                : codeBlocks;

            const allCode = this.codeIntelligence.mergeCodeBlocks(finalBlocks);
            
            // Add citation
            const filename = path.basename(file.fsPath);
            const codeWithCitation = `${allCode}\n\n// Extracted from: ${filename}`;
            
            await vscode.env.clipboard.writeText(codeWithCitation);
            
            vscode.window.showInformationMessage(`Copied ${finalBlocks.length} code block(s) to clipboard`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to copy code: ${error.message}`);
        }
    }

    async exportNotes(uri?: vscode.Uri) {
        const file = uri || await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            const notes = await this.notesManager.getNotes(file.fsPath);
        
        if (notes.length === 0) {
            vscode.window.showInformationMessage('No notes to export');
            return;
        }

            const markdown = await this.notesManager.exportToMarkdown(file.fsPath);
            const exportPath = this.getExportPath(file.fsPath);
            const notesPath = path.join(exportPath, 'notes.md');
            
            if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
            }
            
            fs.writeFileSync(notesPath, markdown, 'utf-8');
            
            // Auto-commit if git integration is enabled
            if (this.gitIntegration && this.config.autoReload) {
                try {
                    await this.gitIntegration.autoCommit(exportPath, `PDF Forge: Export notes for ${path.basename(file.fsPath)}`);
                } catch (error) {
                    // Git commit is optional, don't fail the export
                }
            }
            
            vscode.window.showInformationMessage(`Notes exported to: ${notesPath}`, 'Open File').then(selection => {
                if (selection === 'Open File') {
                    vscode.window.showTextDocument(vscode.Uri.file(notesPath));
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export notes: ${error.message}`);
        }
    }

    async comparePdfs() {
        const files = await vscode.window.showOpenDialog({
            filters: { 'PDF Files': ['pdf'] },
            canSelectMany: true,
            openLabel: 'Select PDFs to compare'
        });

        if (files && files.length === 2) {
            try {
            vscode.window.showInformationMessage('Comparing PDFs...');
                const buffer1 = await vscode.workspace.fs.readFile(files[0]);
                const buffer2 = await vscode.workspace.fs.readFile(files[1]);
                
                const diffResult = await this.diffEngine.comparePdfs(
                    Buffer.from(buffer1),
                    Buffer.from(buffer2)
                );
                const pageDiff = await this.diffEngine.getPageDiff(
                    Buffer.from(buffer1),
                    Buffer.from(buffer2)
                );

                const diffText = `
PDF Comparison Results:

Text Differences:
- Similarity: ${(diffResult.similarity * 100).toFixed(2)}%
- Added: ${diffResult.added.length} characters
- Removed: ${diffResult.removed.length} characters
- Changed sections: ${diffResult.changed.length}

Page Differences:
- PDF 1: ${pageDiff.totalPages1} pages
- PDF 2: ${pageDiff.totalPages2} pages
- Pages added: ${pageDiff.pagesAdded}
- Pages removed: ${pageDiff.pagesRemoved}

Changed Sections:
${diffResult.changed.map((c, i) => `\n${i + 1}. Old: ${c.old.substring(0, 100)}...\n   New: ${c.new.substring(0, 100)}...`).join('\n')}
                `.trim();

                const doc = await vscode.workspace.openTextDocument({
                    content: diffText,
                    language: 'plaintext'
                });
                await vscode.window.showTextDocument(doc);
            } catch (error: any) {
                vscode.window.showErrorMessage(`Failed to compare PDFs: ${error.message}`);
            }
        } else {
            vscode.window.showWarningMessage('Please select exactly 2 PDF files to compare');
        }
    }

    async openExportFolder() {
        const uri = vscode.Uri.file(this.exportFolder);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }

    async extractTables() {
        const file = await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            vscode.window.showInformationMessage('Extracting tables...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));
            const tables = await this.tableExtractor.extractTable(text);
            
            if (tables.length === 0) {
                vscode.window.showInformationMessage('No tables found in PDF');
                return;
            }

            const exportPath = this.getExportPath(file.fsPath);
            if (!fs.existsSync(exportPath)) {
                fs.mkdirSync(exportPath, { recursive: true });
            }

            const csvPath = path.join(exportPath, 'tables.csv');
            const jsonPath = path.join(exportPath, 'tables.json');
            
            await this.tableExtractor.exportToCsv(tables, csvPath);
            await this.tableExtractor.exportToJson(tables, jsonPath);
            
            vscode.window.showInformationMessage(`Extracted ${tables.length} table(s) to ${exportPath}`, 'Open Folder').then(selection => {
                if (selection === 'Open Folder') {
                    this.openExportFolder();
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to extract tables: ${error.message}`);
        }
    }

    async deduplicateCode() {
        const file = await this.getActivePdf();
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            vscode.window.showInformationMessage('Deduplicating code blocks...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));
            const codeBlocks = this.textExtractor.extractCodeBlocks(text);
            
            if (codeBlocks.length === 0) {
                vscode.window.showInformationMessage('No code blocks found in PDF');
                return;
            }

            const deduplicated = this.codeIntelligence.deduplicateCodeBlocks(codeBlocks);
            const exportPath = this.getExportPath(file.fsPath);
            const codeBlocksPath = path.join(exportPath, 'code-blocks');
            
            if (!fs.existsSync(codeBlocksPath)) {
                fs.mkdirSync(codeBlocksPath, { recursive: true });
            }

            // Export individual code blocks
            for (let i = 0; i < deduplicated.length; i++) {
                const block = deduplicated[i];
                const language = this.codeIntelligence.detectLanguage(block);
                const filename = this.codeIntelligence.extractFilename(language, i);
                const filePath = path.join(codeBlocksPath, filename);
                fs.writeFileSync(filePath, block, 'utf-8');
            }

            // Export merged code
            const mergedCode = this.codeIntelligence.mergeCodeBlocks(deduplicated);
            const mergedPath = path.join(codeBlocksPath, 'merged-code-all.md');
            fs.writeFileSync(mergedPath, mergedCode, 'utf-8');
            
            vscode.window.showInformationMessage(
                `Deduplicated ${codeBlocks.length} → ${deduplicated.length} code blocks. Exported to: ${codeBlocksPath}`,
                'Open Folder'
            ).then(selection => {
                if (selection === 'Open Folder') {
                    const uri = vscode.Uri.file(codeBlocksPath);
                    vscode.commands.executeCommand('revealFileInOS', uri);
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to deduplicate code: ${error.message}`);
        }
    }

    private async getActivePdf(): Promise<vscode.Uri | null> {
        // Try to get PDF from active custom editor (PDF viewer)
        const activeEditor = vscode.window.activeTextEditor;
        
        // Check if active editor is a PDF
        if (activeEditor?.document.uri.fsPath.endsWith('.pdf')) {
            return activeEditor.document.uri;
        }

        // Check visible editors (custom editors)
        const visibleEditors = vscode.window.visibleTextEditors;
        for (const editor of visibleEditors) {
            if (editor.document.uri.fsPath.endsWith('.pdf')) {
                return editor.document.uri;
            }
        }

        // Try to get from active custom editor via tab groups
        const tabGroups = vscode.window.tabGroups;
        for (const group of tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputCustom) {
                    const uri = (tab.input as any).uri;
                    if (uri && uri.fsPath && uri.fsPath.endsWith('.pdf')) {
                        return uri;
                    }
                }
            }
        }

        // Last resort: ask user to select a file
        const files = await vscode.window.showOpenDialog({
            filters: { 'PDF Files': ['pdf'] },
            canSelectMany: false,
            openLabel: 'Select PDF file'
        });

        return files && files.length > 0 ? files[0] : null;
    }

    private getExportPath(filename: string): string {
        const base = path.basename(filename, '.pdf');
        return path.join(this.exportFolder, base);
    }
}


