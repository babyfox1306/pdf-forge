import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TextExtractor } from './textExtractor';
import { ConversionEngine } from './conversionEngine';
import { TableExtractor } from './tableExtractor';
import { CodeIntelligence } from './codeIntelligence';
import { DiffEngine } from './diffEngine';
import { NotesManager } from './notesManager';
import { Config } from './config';
import { logError, logInfo, logWarn } from './log';
import {
    ensureOutputRoot,
    resolveOpenExportFolder,
    resolveWorkspaceContext,
} from './workspaceContext';
import { warmPdfParseEngine } from './convertPdf';

// Git integration is optional
let GitIntegration: any;
try {
    GitIntegration = require('./gitIntegration').GitIntegration;
} catch {
    // Git integration not available
}

export class ExportManager {
    private context: vscode.ExtensionContext;
    private textExtractor: TextExtractor;
    private conversionEngine: ConversionEngine;
    private tableExtractor: TableExtractor;
    private codeIntelligence: CodeIntelligence;
    private diffEngine: DiffEngine;
    private notesManager: NotesManager;
    private config: Config;
    private lastOutputRootUri: vscode.Uri | undefined;

    constructor(context: vscode.ExtensionContext, config?: Config) {
        this.context = context;
        this.config = config || new Config(context);
        this.textExtractor = new TextExtractor();
        this.conversionEngine = new ConversionEngine();
        this.tableExtractor = new TableExtractor();
        this.codeIntelligence = new CodeIntelligence();
        this.diffEngine = new DiffEngine();
        this.notesManager = new NotesManager(context);
        // Do NOT eagerly create pdf-forge-exports on root 0
        logInfo('ExportManager ready (lazy output roots)');
    }

    private async resolveForSource(file: vscode.Uri): Promise<{
        outputRootUri: vscode.Uri;
        exportDir: string;
        workspaceRootFs: string;
    }> {
        const ctx = resolveWorkspaceContext(file, this.lastOutputRootUri);
        await ensureOutputRoot(ctx.outputRootUri);
        this.lastOutputRootUri = ctx.outputRootUri;
        const base = path.basename(file.fsPath, '.pdf');
        // Legacy layout: pdf-forge-exports/<basename>/
        const exportDir = path.join(ctx.outputRootUri.fsPath, base);
        return {
            outputRootUri: ctx.outputRootUri,
            exportDir,
            workspaceRootFs: ctx.workspaceRootUri.fsPath,
        };
    }

    private async maybeAutoCommit(
        workspaceRootFs: string,
        generatedFilePath: string,
        message: string
    ): Promise<void> {
        if (!this.config.autoCommit || !GitIntegration) {
            return;
        }
        try {
            const git = new GitIntegration(workspaceRootFs);
            if (!(await git.isGitRepo())) {
                return;
            }
            await git.autoCommitExactFile(generatedFilePath, message);
        } catch (error: any) {
            logWarn(`Git auto-commit skipped: ${error?.message || error}`);
        }
    }

    async extractText(uri?: vscode.Uri) {
        const file = uri || (await this.getActivePdf());
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            logInfo(`Extracting text: ${file.fsPath}`);
            vscode.window.showInformationMessage('Extracting text...');
            const buffer = await vscode.workspace.fs.readFile(file);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));

            const { exportDir, workspaceRootFs } = await this.resolveForSource(file);
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const textPath = path.join(exportDir, 'extracted-text.txt');
            if (fs.existsSync(textPath)) {
                const backupPath = path.join(exportDir, `extracted-text.backup.${Date.now()}.txt`);
                fs.copyFileSync(textPath, backupPath);
            }

            fs.writeFileSync(textPath, text, 'utf-8');
            logInfo(`Text extracted (${text.length} chars) → ${textPath}`);

            await this.maybeAutoCommit(
                workspaceRootFs,
                textPath,
                `PDF Forge: Extract text from ${path.basename(file.fsPath)}`
            );

            vscode.window.showInformationMessage(`Text extracted to: ${textPath}`, 'Open File').then((selection) => {
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
                vscode.window
                    .showErrorMessage(
                        `Failed to extract text: ${errorMessage.split('\n')[0]}`,
                        'Show Details'
                    )
                    .then((selection) => {
                        if (selection === 'Show Details') {
                            logError(errorMessage, true);
                        }
                    });
            }
        }
    }

    async exportMarkdown(uri?: vscode.Uri) {
        const file = uri || (await this.getActivePdf());
        if (!file) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            vscode.window.showInformationMessage('Exporting to Markdown...');
            await warmPdfParseEngine(this.context.extensionPath, { force: true });
            const buffer = await vscode.workspace.fs.readFile(file);
            const markdown = await this.conversionEngine.convertToMarkdown(
                Buffer.from(buffer),
                file.fsPath
            );

            const { exportDir, workspaceRootFs } = await this.resolveForSource(file);
            const mdPath = path.join(exportDir, path.basename(file.fsPath, '.pdf') + '.md');

            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            if (fs.existsSync(mdPath)) {
                const backupPath = path.join(
                    exportDir,
                    `${path.basename(file.fsPath, '.pdf')}.backup.${Date.now()}.md`
                );
                fs.copyFileSync(mdPath, backupPath);
            }

            fs.writeFileSync(mdPath, markdown, 'utf-8');

            await this.maybeAutoCommit(
                workspaceRootFs,
                mdPath,
                `PDF Forge: Export Markdown from ${path.basename(file.fsPath)}`
            );

            vscode.window.showInformationMessage(`Markdown exported to: ${mdPath}`, 'Open File').then((selection) => {
                if (selection === 'Open File') {
                    vscode.window.showTextDocument(vscode.Uri.file(mdPath));
                }
            });
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to export Markdown: ${error.message}`);
        }
    }

    async copyAllCode(uri?: vscode.Uri) {
        const file = uri || (await this.getActivePdf());
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

            const autoDedupe = this.config.autoDedupe;
            const finalBlocks = autoDedupe
                ? this.codeIntelligence.deduplicateCodeBlocks(codeBlocks)
                : codeBlocks;

            const allCode = this.codeIntelligence.mergeCodeBlocks(finalBlocks);

            const filename = path.basename(file.fsPath);
            const codeWithCitation = `${allCode}\n\n// Extracted from: ${filename}`;

            await vscode.env.clipboard.writeText(codeWithCitation);

            vscode.window.showInformationMessage(`Copied ${finalBlocks.length} code block(s) to clipboard`);
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to copy code: ${error.message}`);
        }
    }

    async exportNotes(uri?: vscode.Uri) {
        const file = uri || (await this.getActivePdf());
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
            const { exportDir, workspaceRootFs } = await this.resolveForSource(file);
            const notesPath = path.join(exportDir, 'notes.md');

            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            fs.writeFileSync(notesPath, markdown, 'utf-8');

            // Gate on autoCommit only — do NOT use autoReload
            await this.maybeAutoCommit(
                workspaceRootFs,
                notesPath,
                `PDF Forge: Export notes for ${path.basename(file.fsPath)}`
            );

            vscode.window.showInformationMessage(`Notes exported to: ${notesPath}`, 'Open File').then((selection) => {
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
            openLabel: 'Select PDFs to compare',
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
                    language: 'plaintext',
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
        const uri = await resolveOpenExportFolder(this.lastOutputRootUri);
        if (!uri) {
            vscode.window.showWarningMessage('No workspace folder available to open exports.');
            return;
        }
        await ensureOutputRoot(uri);
        await vscode.commands.executeCommand('revealFileInOS', uri);
    }

    /** Used by batch orchestrator to record last output root for Open Export Folder. */
    setLastOutputRootUri(uri: vscode.Uri): void {
        this.lastOutputRootUri = uri;
    }

    /** Test helper — last resolved output root (Open Export Folder target). */
    getLastOutputRootUriForTests(): vscode.Uri | undefined {
        return this.lastOutputRootUri;
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

            const { exportDir } = await this.resolveForSource(file);
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            const csvPath = path.join(exportDir, 'tables.csv');
            const jsonPath = path.join(exportDir, 'tables.json');

            await this.tableExtractor.exportToCsv(tables, csvPath);
            await this.tableExtractor.exportToJson(tables, jsonPath);

            vscode.window
                .showInformationMessage(`Extracted ${tables.length} table(s) to ${exportDir}`, 'Open Folder')
                .then((selection) => {
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
            const { exportDir } = await this.resolveForSource(file);
            const codeBlocksPath = path.join(exportDir, 'code-blocks');

            if (!fs.existsSync(codeBlocksPath)) {
                fs.mkdirSync(codeBlocksPath, { recursive: true });
            }

            for (let i = 0; i < deduplicated.length; i++) {
                const block = deduplicated[i];
                const language = this.codeIntelligence.detectLanguage(block);
                const filename = this.codeIntelligence.extractFilename(language, i);
                const filePath = path.join(codeBlocksPath, filename);
                fs.writeFileSync(filePath, block, 'utf-8');
            }

            const mergedCode = this.codeIntelligence.mergeCodeBlocks(deduplicated);
            const mergedPath = path.join(codeBlocksPath, 'merged-code-all.md');
            fs.writeFileSync(mergedPath, mergedCode, 'utf-8');

            vscode.window
                .showInformationMessage(
                    `Deduplicated ${codeBlocks.length} → ${deduplicated.length} code blocks. Exported to: ${codeBlocksPath}`,
                    'Open Folder'
                )
                .then((selection) => {
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
        const activeEditor = vscode.window.activeTextEditor;

        if (activeEditor?.document.uri.fsPath.endsWith('.pdf')) {
            return activeEditor.document.uri;
        }

        const visibleEditors = vscode.window.visibleTextEditors;
        for (const editor of visibleEditors) {
            if (editor.document.uri.fsPath.endsWith('.pdf')) {
                return editor.document.uri;
            }
        }

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

        const files = await vscode.window.showOpenDialog({
            filters: { 'PDF Files': ['pdf'] },
            canSelectMany: false,
            openLabel: 'Select PDF file',
        });

        return files && files.length > 0 ? files[0] : null;
    }
}
