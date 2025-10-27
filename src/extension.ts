import * as vscode from 'vscode';
import { PdfViewerProvider } from './pdfViewer';
import { ExportManager } from './exportManager';
import { Config } from './config';

export function activate(context: vscode.ExtensionContext) {
    const config = new Config(context);
    const exportManager = new ExportManager(context);

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
        vscode.commands.registerCommand('pdf-forge.toggleOcr', () => config.toggleOcr()),
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

    vscode.window.showInformationMessage('PDF Forge activated!');
}

function openPdfCommand() {
    vscode.window.showOpenDialog({
        filters: {
            'PDF Files': ['pdf']
        },
        canSelectMany: false
    }).then(uris => {
        if (uris && uris[0]) {
            vscode.commands.executeCommand('vscode.openWith', uris[0], 'pdf-forge.pdfEditor');
        }
    });
}

export function deactivate() {}


