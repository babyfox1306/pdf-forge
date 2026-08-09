import * as vscode from 'vscode';
import { PdfViewerProvider } from './pdfViewer';
import { ExportManager } from './exportManager';
import { Config } from './config';
import { initPdfForgeLog, logError, logInfo } from './log';
import { runBatchConversion } from './batchOrchestrator';

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
        vscode.commands.registerCommand('pdf-forge.zoom', () => provider.zoom()),
        vscode.commands.registerCommand('pdf-forge.convertFolder', async (folderUri?: vscode.Uri) => {
            try {
                let target = folderUri;
                if (!target) {
                    const picked = await vscode.window.showOpenDialog({
                        canSelectFiles: false,
                        canSelectFolders: true,
                        canSelectMany: false,
                        openLabel: 'Convert Folder to Markdown',
                    });
                    if (!picked || !picked[0]) {
                        return;
                    }
                    target = picked[0];
                }

                const result = await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'PDF Forge: Convert Folder',
                        cancellable: true,
                    },
                    async (progress, token) => {
                        return runBatchConversion(target!, context, { progress, token });
                    }
                );

                exportManager.setLastOutputRootUri(result.outputRootUri);
                vscode.window
                    .showInformationMessage(result.message, 'Open Export Folder')
                    .then((selection) => {
                        if (selection === 'Open Export Folder') {
                            exportManager.openExportFolder();
                        }
                    });
            } catch (error: any) {
                const msg = error?.message || String(error);
                logError(`convertFolder failed: ${msg}`);
                vscode.window.showErrorMessage(msg);
            }
        }),
        // Phase 0.5: packaged-host inspection spike (internal evidence command)
        vscode.commands.registerCommand('pdf-forge.inspectHostSpike', async () => {
            const fs = await import('fs');
            const path = await import('path');
            const { inspectPdf, __resetPdfInspectCacheForTests } = await import('./pdfInspect');
            __resetPdfInspectCacheForTests();
            const outPath =
                process.env.PDF_FORGE_SPIKE_OUT ||
                path.join(context.globalStorageUri.fsPath, 'inspect-host-spike.json');
            const fixtureCandidates = [
                process.env.PDF_FORGE_SPIKE_FIXTURE,
                path.join(context.extensionPath, 'test-fixtures', 'normal.pdf'),
            ].filter(Boolean) as string[];
            const fixturePath = fixtureCandidates.find((p) => fs.existsSync(p));
            const counts = {
                getTextContent: 0,
                render: 0,
                getOperatorList: 0,
                destroyDocument: 0,
                destroyLoadingTask: 0,
            };
            const evidence: Record<string, unknown> = {
                host: 'vscode-extension-host',
                extensionPath: context.extensionPath,
                fixturePath: fixturePath || null,
                importMechanism:
                    'dynamic import(file URL of packaged node_modules/pdfjs-dist/legacy/build/pdf.mjs) from CommonJS out/pdfInspect.js',
                packageSubpath: 'pdfjs-dist/legacy/build/pdf.mjs',
            };
            try {
                if (!fixturePath) {
                    throw new Error('No fixture PDF found (expected test-fixtures/normal.pdf in VSIX)');
                }
                const buf = fs.readFileSync(fixturePath);
                const t0 = Date.now();
                const result = await inspectPdf(buf, {
                    onGetTextContent: () => counts.getTextContent++,
                    onRender: () => counts.render++,
                    onGetOperatorList: () => counts.getOperatorList++,
                    onDestroyDocument: () => counts.destroyDocument++,
                    onDestroyLoadingTask: () => counts.destroyLoadingTask++,
                });
                evidence.result = result;
                evidence.instrumentation = counts;
                evidence.wallMs = Date.now() - t0;
                evidence.verdict =
                    typeof result.pageCount === 'number' &&
                    result.pageCount > 0 &&
                    counts.getTextContent === 0 &&
                    counts.render === 0 &&
                    counts.destroyDocument >= 1
                        ? 'PASS'
                        : 'FAIL';
            } catch (error: any) {
                evidence.error = error?.stack || String(error);
                evidence.verdict = 'FAIL';
            }
            fs.mkdirSync(path.dirname(outPath), { recursive: true });
            fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), 'utf8');
            logInfo(`inspectHostSpike wrote ${outPath} verdict=${evidence.verdict}`);
            return evidence;
        })
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
