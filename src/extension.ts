import * as vscode from 'vscode';
import { PdfViewerProvider } from './pdfViewer';
import { ExportManager } from './exportManager';
import { Config } from './config';
import { initPdfForgeLog, logError, logInfo } from './log';

export function activate(context: vscode.ExtensionContext) {
    initPdfForgeLog(context);
    logInfo('PDF Forge activating');

    const config = new Config(context);
    const exportManager = new ExportManager(context, config);

    // Register custom editor provider
    const provider = new PdfViewerProvider(context, config, exportManager);
    const disposable = vscode.window.registerCustomEditorProvider('pdf-forge.pdfEditor', provider, {
        webviewOptions: {
            retainContextWhenHidden: true
        }
    });
    context.subscriptions.push(disposable);

    // Register commands
    const commands = [
        vscode.commands.registerCommand('pdf-forge.openPdf', () => openPdfCommand()),
        vscode.commands.registerCommand('pdf-forge.extractText', () => exportManager.extractText()),
        vscode.commands.registerCommand('pdf-forge.exportMarkdown', () => exportManager.exportMarkdown()),
        vscode.commands.registerCommand('pdf-forge.copyCode', () => exportManager.copyAllCode()),
        vscode.commands.registerCommand('pdf-forge.exportNotes', () => exportManager.exportNotes()),
        vscode.commands.registerCommand('pdf-forge.comparePdfs', () => exportManager.comparePdfs()),
        vscode.commands.registerCommand('pdf-forge.clearCache', () => config.clearCache()),
        vscode.commands.registerCommand('pdf-forge.openExportFolder', () => exportManager.openExportFolder()),
        vscode.commands.registerCommand('pdf-forge.extractTables', () => exportManager.extractTables()),
        vscode.commands.registerCommand('pdf-forge.deduplicateCode', () => exportManager.deduplicateCode()),
        vscode.commands.registerCommand('pdf-forge.toggleSplitView', () => provider.toggleSplitView()),
        vscode.commands.registerCommand('pdf-forge.jumpToPage', () => provider.jumpToPage()),
        vscode.commands.registerCommand('pdf-forge.searchInPdf', () => provider.searchInPdf()),
        vscode.commands.registerCommand('pdf-forge.showMetadata', () => provider.showMetadata()),
        vscode.commands.registerCommand('pdf-forge.zoom', () => provider.zoom())
    ];

    commands.forEach(cmd => context.subscriptions.push(cmd));

    logInfo('PDF Forge activated');
    vscode.window.showInformationMessage('PDF Forge activated!');
}

async function openPdfCommand() {
    try {
        const uris = await vscode.window.showOpenDialog({
            filters: {
                'PDF Files': ['pdf']
            },
            canSelectMany: false
        });
        if (uris && uris[0]) {
            logInfo(`Opening PDF: ${uris[0].fsPath}`);
            await vscode.commands.executeCommand('vscode.openWith', uris[0], 'pdf-forge.pdfEditor');
        }
    } catch (error: any) {
        logError(`Failed to open PDF: ${error?.message || error}`);
    }
}

export function deactivate() {}


