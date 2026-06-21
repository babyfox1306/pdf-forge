import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Config } from './config';
import { ExportManager } from './exportManager';
import { SearchEngine } from './searchEngine';
import { MetadataInspector } from './metadataInspector';
import { NotesManager } from './notesManager';
import { TextExtractor } from './textExtractor';
import { logError, logInfo, logWarn, showOutputChannel } from './log';

interface PdfDocument extends vscode.CustomDocument {
    pdfData: Uint8Array;
}

export class PdfViewerProvider implements vscode.CustomReadonlyEditorProvider {
    private documents = new Map<vscode.Uri, PdfDocument>();
    private currentPanel: vscode.WebviewPanel | undefined;
    private activeDocumentUri: vscode.Uri | undefined;
    private searchEngine: SearchEngine;
    private metadataInspector: MetadataInspector;
    private notesManager: NotesManager;
    private textExtractor: TextExtractor;
    private splitViewEnabled: boolean = false;
    private currentPage: number = 1;
    private currentZoom: number = 1.25;

    constructor(
        private context: vscode.ExtensionContext,
        private config: Config,
        private exportManager: ExportManager
    ) {
        this.searchEngine = new SearchEngine();
        this.metadataInspector = new MetadataInspector();
        this.notesManager = new NotesManager(context);
        this.textExtractor = new TextExtractor();
    }

    async openCustomDocument(uri: vscode.Uri): Promise<vscode.CustomDocument> {
        try {
            // Load PDF data
            const fileData = await vscode.workspace.fs.readFile(uri);
            
            const document: PdfDocument = {
                uri,
                pdfData: fileData,
                dispose: () => {
                    this.documents.delete(uri);
                }
            };
            
            this.documents.set(uri, document);
            logInfo(`Opened document: ${uri.fsPath} (${fileData.length} bytes)`);
            return document;
        } catch (error: any) {
            logError(`Failed to open PDF document: ${error.message}`);
            throw error;
        }
    }

    async resolveCustomEditor(
        document: vscode.CustomDocument,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            logInfo(`Resolving custom editor: ${document.uri.fsPath}`);

            webviewPanel.webview.options = {
                enableScripts: true,
                localResourceRoots: [
                    this.context.extensionUri,
                    vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdfjs')
                ]
            };

            const pdfJsUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdfjs', 'pdf.min.mjs')
            );
            const pdfWorkerUri = webviewPanel.webview.asWebviewUri(
                vscode.Uri.joinPath(this.context.extensionUri, 'media', 'pdfjs', 'pdf.worker.min.mjs')
            );

            logInfo(`PDF.js bundle URIs: main=${pdfJsUri}, worker=${pdfWorkerUri}`);

            const html = this.getHtmlForWebview(
                pdfJsUri,
                pdfWorkerUri,
                webviewPanel.webview.cspSource,
                document.uri
            );
            webviewPanel.webview.html = html;
            logInfo(`Webview HTML set (${html.length} chars)`);

            const pdfDoc = this.documents.get(document.uri);
            if (!pdfDoc) {
                throw new Error('PDF document not found in cache');
            }

            // Set active document
            this.activeDocumentUri = document.uri;
            logInfo(`Active document: ${document.uri.fsPath}`);

        webviewPanel.webview.onDidReceiveMessage(
            async message => {
                try {
                switch (message.command) {
                    case 'error':
                        logError(`Webview error: ${message.message}`);
                        showOutputChannel();
                        break;
                    case 'pdfRendered':
                        logInfo(`PDF rendered in webview (${message.pages} pages)`);
                        break;
                    case 'search':
                        await this.handleSearch(document.uri, message.query, message.useRegex);
                        break;
                    case 'extract':
                        logInfo(`Extract requested from webview: ${document.uri.fsPath}`);
                        await this.exportManager.extractText(document.uri);
                        break;
                    case 'export':
                        logInfo(`Export requested from webview: ${document.uri.fsPath}`);
                        await this.exportManager.exportMarkdown(document.uri);
                        break;
                    case 'webviewReady':
                        logInfo('Webview ready — loading bundled pdf.js succeeded');
                        if (pdfDoc) {
                            const dataArray = Array.from(pdfDoc.pdfData);
                            logInfo(`Sending PDF to webview (${dataArray.length} bytes)`);
                            webviewPanel.webview.postMessage({
                                command: 'loadPdf',
                                data: dataArray
                            });
                            await this.loadMetadata(document.uri, webviewPanel);
                            await this.loadNotes(document.uri, webviewPanel);
                        } else {
                            logError('PDF document not found in cache when webview became ready');
                            webviewPanel.webview.postMessage({
                                command: 'error',
                                message: 'PDF document not found'
                            });
                        }
                        break;
                    case 'jumpToPage':
                        this.currentPage = message.page;
                        webviewPanel.webview.postMessage({
                            command: 'jumpToPage',
                            page: message.page
                        });
                        break;
                    case 'setZoom':
                        this.currentZoom = message.zoom;
                        webviewPanel.webview.postMessage({
                            command: 'setZoom',
                            zoom: message.zoom
                        });
                        break;
                    case 'toggleSplitView':
                        this.splitViewEnabled = !this.splitViewEnabled;
                        webviewPanel.webview.postMessage({
                            command: 'toggleSplitView',
                            enabled: this.splitViewEnabled
                        });
                        break;
                    case 'addNote':
                        await this.addNote(document.uri, message.note);
                        break;
                    case 'addBookmark':
                        await this.addBookmark(document.uri, message.page);
                        break;
                    case 'copyText':
                        await this.copyText(document.uri, message.text, message.page);
                        break;
                    default:
                        logWarn(`Unknown webview message: ${message.command}`);
                        break;
                }
                } catch (error: any) {
                    logError(`Webview handler failed (${message.command}): ${error?.message || error}`);
                }
            }
        );

        // Watch for file changes if auto-reload is enabled
        if (this.config.autoReload) {
            const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
            watcher.onDidChange(async () => {
                if (pdfDoc) {
                    const newData = await vscode.workspace.fs.readFile(document.uri);
                    pdfDoc.pdfData = newData;
                    webviewPanel.webview.postMessage({
                        command: 'reloadPdf',
                        data: Array.from(newData)
                    });
                }
            });
            this.context.subscriptions.push(watcher);
        }

            this.currentPanel = webviewPanel;
            logInfo('Custom editor resolved successfully');
        } catch (error: any) {
            logError(`Failed to open PDF viewer: ${error.message}`);
            showOutputChannel();
            throw error;
        }
    }

    getActiveDocumentUri(): vscode.Uri | undefined {
        return this.activeDocumentUri;
    }

    private async handleSearch(uri: vscode.Uri, query: string, useRegex: boolean = false): Promise<void> {
        try {
            const buffer = await vscode.workspace.fs.readFile(uri);
            const text = await this.textExtractor.extractFromBuffer(Buffer.from(buffer));
            const results = this.searchEngine.search(text, query, useRegex);
            
            if (this.currentPanel) {
                this.currentPanel.webview.postMessage({
                    command: 'searchResults',
                    results: results,
                    query: query
                });
            }

            if (results.length > 0) {
                vscode.window.showInformationMessage(`Found ${results.length} result(s)`);
            } else {
                vscode.window.showInformationMessage('No results found');
            }
        } catch (error: any) {
            logError(`Search failed: ${error.message}`);
        }
    }

    private async loadMetadata(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const buffer = await vscode.workspace.fs.readFile(uri);
            const metadata = await this.metadataInspector.inspect(Buffer.from(buffer));
            panel.webview.postMessage({
                command: 'metadata',
                data: metadata
            });
        } catch (error: any) {
            logWarn(`Failed to load metadata: ${error?.message || error}`);
        }
    }

    private async loadNotes(uri: vscode.Uri, panel: vscode.WebviewPanel): Promise<void> {
        try {
            const notes = await this.notesManager.getNotes(uri.fsPath);
            panel.webview.postMessage({
                command: 'notes',
                data: notes
            });
        } catch (error: any) {
            logWarn(`Failed to load notes: ${error?.message || error}`);
        }
    }

    private async addNote(uri: vscode.Uri, note: any): Promise<void> {
        try {
            const noteObj = {
                id: Date.now().toString(),
                page: note.page,
                text: note.text,
                highlight: note.highlight || this.config.highlightColor,
                comment: note.comment,
                position: note.position,
                createdAt: new Date().toISOString()
            };
            await this.notesManager.saveNote(uri.fsPath, noteObj);
            if (this.currentPanel) {
                await this.loadNotes(uri, this.currentPanel);
            }
        } catch (error: any) {
            logError(`Failed to add note: ${error?.message || error}`);
        }
    }

    private async addBookmark(uri: vscode.Uri, page: number): Promise<void> {
        const bookmarks = this.context.workspaceState.get<Array<{uri: string, page: number}>>('pdf-bookmarks', []);
        const bookmark = { uri: uri.fsPath, page };
        if (!bookmarks.some(b => b.uri === bookmark.uri && b.page === bookmark.page)) {
            bookmarks.push(bookmark);
            await this.context.workspaceState.update('pdf-bookmarks', bookmarks);
            if (this.currentPanel) {
                this.currentPanel.webview.postMessage({
                    command: 'bookmarks',
                    data: bookmarks.filter(b => b.uri === uri.fsPath)
                });
            }
        }
    }

    private async copyText(uri: vscode.Uri, text: string, page: number): Promise<void> {
        const filename = path.basename(uri.fsPath);
        const citation = `// From: ${filename} (p.${page})`;
        await vscode.env.clipboard.writeText(`${text}\n\n${citation}`);
        vscode.window.showInformationMessage('Copied with citation');
    }

    private getHtmlForWebview(
        pdfJsUri: string | vscode.Uri,
        pdfWorkerUri: string | vscode.Uri,
        cspSource: string,
        pdfUri: vscode.Uri
    ): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src ${cspSource} 'unsafe-inline' 'unsafe-eval'; img-src ${cspSource} data: blob:; font-src ${cspSource}; worker-src ${cspSource} blob:;">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PDF Forge</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background: var(--vscode-editor-background);
            font-family: var(--vscode-font-family);
        }
        #toolbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 8px 16px;
            display: flex;
            gap: 8px;
            z-index: 1000;
        }
        #toolbar button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            cursor: pointer;
            border-radius: 2px;
        }
        #toolbar button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        #sidebar {
            position: fixed;
            top: 48px;
            right: 0;
            width: 300px;
            height: calc(100vh - 48px);
            background: var(--vscode-sideBar-background);
            border-left: 1px solid var(--vscode-panel-border);
            display: none;
            flex-direction: column;
        }
        #sidebar.active {
            display: flex;
        }
        #sidebar-tabs {
            display: flex;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .tab-btn {
            flex: 1;
            padding: 8px;
            background: transparent;
            color: var(--vscode-foreground);
            border: none;
            cursor: pointer;
            border-bottom: 2px solid transparent;
        }
        .tab-btn.active {
            background: var(--vscode-tab-activeBackground);
            border-bottom-color: var(--vscode-button-background);
        }
        #sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        .tab-pane {
            display: none;
        }
        .tab-pane.active {
            display: block;
        }
        .note-item, .bookmark-item {
            padding: 8px;
            margin: 8px 0;
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
            cursor: pointer;
        }
        .bookmark-item:hover {
            background: var(--vscode-list-activeSelectionBackground);
        }
        .split-view {
            display: flex;
        }
        .text-panel {
            width: 50%;
            padding: 20px;
            overflow-y: auto;
            background: var(--vscode-editor-background);
            border-left: 1px solid var(--vscode-panel-border);
        }
        #viewer {
            margin-top: 48px;
            padding: 20px;
            overflow: auto;
            height: calc(100vh - 48px);
        }
        .page {
            margin-bottom: 20px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            background: white;
        }
        canvas {
            display: block;
            margin: 0 auto;
        }
        #loading {
            text-align: center;
            padding: 50px;
            color: var(--vscode-foreground);
        }
    </style>
</head>
<body>
    <div id="toolbar">
        <button onclick="zoomIn()">+</button>
        <button onclick="zoomOut()">-</button>
        <button onclick="fitPage()">Fit Page</button>
        <button onclick="search()">Search</button>
        <button onclick="extract()">Extract</button>
        <button onclick="export()">Export</button>
        <button onclick="copyWithCitation()" title="Copy visible page text with citation">Copy w/ Citation</button>
        <button onclick="toggleSidebar()">Sidebar</button>
    </div>
    <div id="sidebar">
        <div id="sidebar-tabs">
            <button class="tab-btn active" data-tab="info" onclick="showTab('info')">Info</button>
            <button class="tab-btn" data-tab="notes" onclick="showTab('notes')">Notes</button>
            <button class="tab-btn" data-tab="exports" onclick="showTab('exports')">Exports</button>
            <button class="tab-btn" data-tab="bookmarks" onclick="showTab('bookmarks')">Bookmarks</button>
        </div>
        <div id="sidebar-content">
            <div id="tab-info" class="tab-pane active">
                <h3>PDF Information</h3>
                <div id="metadata">Loading...</div>
            </div>
            <div id="tab-notes" class="tab-pane">
                <h3>Notes</h3>
                <div id="notes-list">Loading...</div>
            </div>
            <div id="tab-exports" class="tab-pane">
                <h3>Exports</h3>
                <div id="exports-list">No exports yet</div>
            </div>
            <div id="tab-bookmarks" class="tab-pane">
                <h3>Bookmarks</h3>
                <div id="bookmarks-list">Loading...</div>
            </div>
        </div>
    </div>
    <div id="viewer">
        <div id="loading">Loading PDF.js...</div>
    </div>
    <script type="module">
        const vscode = acquireVsCodeApi();
        const pdfJsUri = '${typeof pdfJsUri === 'string' ? pdfJsUri : pdfJsUri.toString()}';
        const pdfWorkerUri = '${typeof pdfWorkerUri === 'string' ? pdfWorkerUri : pdfWorkerUri.toString()}';

        let pdfjsLib = null;
        let pdfDoc = null;
        let currentScale = 1.25;
        let isRendering = false;

        const viewerEl = document.getElementById('viewer');
        const loadingEl = document.getElementById('loading');

        async function ensurePdfJs() {
            if (pdfjsLib) {
                return pdfjsLib;
            }

            try {
                loadingEl.textContent = 'Loading PDF engine...';
                
                const module = await import(pdfJsUri);
                pdfjsLib = module?.default ? module.default : module;

                if (!pdfjsLib?.GlobalWorkerOptions) {
                    throw new Error('Failed to load pdf.js module');
                }

                pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUri;
                
                loadingEl.textContent = 'PDF engine ready.';
                vscode.postMessage({ command: 'webviewReady' });
                return pdfjsLib;
            } catch (error) {
                console.error('[PDF Forge] Unable to load pdf.js', error);
                loadingEl.textContent = 'Failed to load PDF engine: ' + (error?.message || error);
                loadingEl.style.color = 'var(--vscode-errorForeground)';
                // Show error details with retry button
                loadingEl.innerHTML = 'Failed to load PDF engine.<br><small style="font-size: 11px;">' + (error?.message || error) + '</small><br><br><button style="padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; border-radius: 3px;" onclick="location.reload()">Retry</button>';
                vscode.postMessage({ command: 'error', message: 'Failed to load PDF engine: ' + (error?.message || error) });
                throw error;
            }
        }

        window.addEventListener('message', async (event) => {
            const message = event.data;
            console.log('[PDF Forge Webview] Received message:', message.command);
            if (message.command === 'loadPdf') {
                await loadPdf(message.data);
            }
        });

        async function loadPdf(data) {
            try {
                console.log('[PDF Forge Webview] Loading PDF, data length:', data.length);
                await ensurePdfJs();
                loadingEl.textContent = 'Rendering PDF...';
                loadingEl.style.display = 'block';

                const uint8Array = new Uint8Array(data);
                console.log('[PDF Forge Webview] Creating PDF document from', uint8Array.length, 'bytes');
                pdfDoc = await pdfjsLib.getDocument({ data: uint8Array }).promise;
                console.log('[PDF Forge Webview] PDF loaded, pages:', pdfDoc.numPages);

                await renderAllPages();
                loadingEl.style.display = 'none';
                console.log('[PDF Forge Webview] PDF rendered successfully');
                vscode.postMessage({ command: 'pdfRendered', pages: pdfDoc.numPages });
            } catch (error) {
                console.error('[PDF Forge Webview] Error loading PDF', error);
                loadingEl.textContent = 'Error loading PDF: ' + (error?.message || error);
                loadingEl.style.display = 'block';
                loadingEl.style.color = 'var(--vscode-errorForeground)';
                // Send error to extension
                vscode.postMessage({ command: 'error', message: error?.message || error });
            }
        }

        async function renderAllPages() {
            if (!pdfDoc || isRendering) {
                return;
            }

            isRendering = true;
            viewerEl.innerHTML = '';

            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
                await renderPage(pageNum);
            }

            isRendering = false;
        }

        async function renderPage(pageNum) {
            try {
                const page = await pdfDoc.getPage(pageNum);
                const viewport = page.getViewport({ scale: currentScale });

                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d', { alpha: false });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const pageWrapper = document.createElement('div');
                pageWrapper.className = 'page';
                pageWrapper.setAttribute('data-page', pageNum);
                pageWrapper.appendChild(canvas);
                viewerEl.appendChild(pageWrapper);

                await page.render({ canvasContext: context, viewport }).promise;
            } catch (error) {
                console.error(\`[PDF Forge] Error rendering page \${pageNum}\`, error);
                vscode.postMessage({ command: 'error', message: 'Failed to render page ' + pageNum + ': ' + (error?.message || error) });
            }
        }

        async function rerenderPages() {
            if (!pdfDoc) {
                return;
            }

            loadingEl.textContent = 'Updating view...';
            loadingEl.style.display = 'block';
            await renderAllPages();
            loadingEl.style.display = 'none';
        }

        window.zoomIn = async function zoomIn() {
            currentScale = Math.min(currentScale * 1.2, 4);
            await rerenderPages();
        };

        window.zoomOut = async function zoomOut() {
            currentScale = Math.max(currentScale / 1.2, 0.25);
            await rerenderPages();
        };

        window.fitPage = async function fitPage() {
            currentScale = 1.0;
            await rerenderPages();
        };

        window.search = function search() {
            const query = prompt('Search:');
            if (query) {
                vscode.postMessage({ command: 'search', query });
            }
        };

        window.extract = function extract() {
            vscode.postMessage({ command: 'extract' });
        };

        window.export = function exportData() {
            vscode.postMessage({ command: 'export' });
        };

        function getVisiblePageNumber() {
            const pages = document.querySelectorAll('.page[data-page]');
            if (pages.length === 0) {
                return 1;
            }
            let bestPage = 1;
            let bestDist = Infinity;
            pages.forEach(function(el) {
                const rect = el.getBoundingClientRect();
                const dist = Math.abs(rect.top - 60);
                const pageNum = parseInt(el.getAttribute('data-page') || '1', 10);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestPage = pageNum;
                }
            });
            return bestPage;
        }

        window.copyWithCitation = async function copyWithCitation() {
            if (!pdfDoc) {
                return;
            }
            try {
                const pageNum = getVisiblePageNumber();
                const page = await pdfDoc.getPage(pageNum);
                const textContent = await page.getTextContent();
                const text = textContent.items.map(function(item) { return item.str; }).join(' ').trim();
                if (!text) {
                    loadingEl.textContent = 'No selectable text on page ' + pageNum;
                    loadingEl.style.display = 'block';
                    loadingEl.style.color = 'var(--vscode-errorForeground)';
                    setTimeout(function() { loadingEl.style.display = 'none'; }, 3000);
                    return;
                }
                vscode.postMessage({ command: 'copyText', text: text, page: pageNum });
            } catch (error) {
                console.error('[PDF Forge] Copy with citation failed', error);
            }
        };

        window.toggleSidebar = function toggleSidebar() {
            document.getElementById('sidebar').classList.toggle('active');
        };

        window.showTab = function showTab(tabName) {
            // Update active tab
            document.querySelectorAll('.tab-btn').forEach(function(btn) {
                btn.classList.remove('active');
            });
            document.querySelectorAll('.tab-pane').forEach(function(pane) {
                pane.classList.remove('active');
            });
            
            const activeBtn = document.querySelector('[data-tab="' + tabName + '"]');
            const activePane = document.getElementById('tab-' + tabName);
            
            if (activeBtn) activeBtn.classList.add('active');
            if (activePane) activePane.classList.add('active');
        };

        // Handle messages from extension
        window.addEventListener('message', async (event) => {
            const message = event.data;
            
            switch (message.command) {
                case 'searchResults':
                    highlightSearchResults(message.results, message.query);
                    break;
                case 'metadata':
                    displayMetadata(message.data);
                    break;
                case 'notes':
                    displayNotes(message.data);
                    break;
                case 'bookmarks':
                    displayBookmarks(message.data);
                    break;
                case 'toggleSplitView':
                    toggleSplitViewUI(message.enabled);
                    break;
                case 'jumpToPage':
                    scrollToPage(message.page);
                    break;
                case 'setZoom':
                    currentScale = message.zoom;
                    rerenderPages();
                    break;
                case 'reloadPdf':
                    await loadPdf(message.data);
                    break;
            }
        });

        function highlightSearchResults(results, query) {
            // Remove previous highlights
            document.querySelectorAll('.search-highlight').forEach(el => {
                el.classList.remove('search-highlight');
            });
            
            // Highlight results (simplified - would need text layer for proper highlighting)
            if (results.length > 0) {
                vscode.postMessage({ command: 'showSearchResults', count: results.length });
            }
        }

        function displayMetadata(data) {
            const metadataEl = document.getElementById('metadata');
            if (metadataEl) {
                const title = data.title || 'N/A';
                const author = data.author || 'N/A';
                const pages = data.pages;
                const fileSize = (data.fileSize / 1024 / 1024).toFixed(2);
                const encrypted = data.isEncrypted ? 'Yes' : 'No';
                const fonts = data.fonts.length > 0 ? data.fonts.join(', ') : 'N/A';
                metadataEl.innerHTML = 
                    '<p><strong>Title:</strong> ' + title + '</p>' +
                    '<p><strong>Author:</strong> ' + author + '</p>' +
                    '<p><strong>Pages:</strong> ' + pages + '</p>' +
                    '<p><strong>File Size:</strong> ' + fileSize + ' MB</p>' +
                    '<p><strong>Encrypted:</strong> ' + encrypted + '</p>' +
                    '<p><strong>Fonts:</strong> ' + fonts + '</p>';
            }
        }

        function displayNotes(notes) {
            const notesEl = document.getElementById('notes-list');
            if (notesEl) {
                if (notes.length === 0) {
                    notesEl.innerHTML = '<p>No notes yet</p>';
                } else {
                    notesEl.innerHTML = notes.map(function(note) {
                        const pageNum = note.page + 1;
                        const text = note.text.substring(0, 100);
                        const comment = note.comment ? '<p><em>' + note.comment + '</em></p>' : '';
                        return '<div class="note-item">' +
                            '<p><strong>Page ' + pageNum + '</strong></p>' +
                            '<p>' + text + '...</p>' +
                            comment +
                            '</div>';
                    }).join('');
                }
            }
        }

        function displayBookmarks(bookmarks) {
            const bookmarksEl = document.getElementById('bookmarks-list');
            if (bookmarksEl) {
                if (bookmarks.length === 0) {
                    bookmarksEl.innerHTML = '<p>No bookmarks yet</p>';
                } else {
                    bookmarksEl.innerHTML = bookmarks.map(function(bm) {
                        return '<div class="bookmark-item" onclick="jumpToPage(' + bm.page + ')">' +
                            '<p>Page ' + bm.page + '</p>' +
                            '</div>';
                    }).join('');
                }
            }
        }

        function toggleSplitViewUI(enabled) {
            const viewer = document.getElementById('viewer');
            if (enabled) {
                viewer.classList.add('split-view');
                // Create text panel
                if (!document.getElementById('text-panel')) {
                    const textPanel = document.createElement('div');
                    textPanel.id = 'text-panel';
                    textPanel.className = 'text-panel';
                    viewer.appendChild(textPanel);
                }
            } else {
                viewer.classList.remove('split-view');
                const textPanel = document.getElementById('text-panel');
                if (textPanel) {
                    textPanel.remove();
                }
            }
        }

        function scrollToPage(pageNum) {
            const pageEl = document.querySelector('[data-page="' + pageNum + '"]');
            if (pageEl) {
                pageEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        window.jumpToPage = function(pageNum) {
            scrollToPage(pageNum);
        };

        // Start loading bundled pdf.js
        ensurePdfJs().catch((error) => {
            vscode.postMessage({ command: 'error', message: error?.message || String(error) });
        });
    </script>
</body>
</html>`;
    }

    toggleSplitView(): void {
        this.splitViewEnabled = !this.splitViewEnabled;
        if (this.currentPanel) {
            this.currentPanel.webview.postMessage({
                command: 'toggleSplitView',
                enabled: this.splitViewEnabled
            });
        }
        vscode.window.showInformationMessage(`Split view ${this.splitViewEnabled ? 'enabled' : 'disabled'}`);
    }

    async jumpToPage(): Promise<void> {
        const pageNum = await vscode.window.showInputBox({
            prompt: 'Jump to page',
            validateInput: (value) => {
                const page = parseInt(value);
                return isNaN(page) || page < 1 ? 'Invalid page number' : null;
            }
        });
        
        if (pageNum && this.currentPanel) {
            this.currentPage = parseInt(pageNum);
            this.currentPanel.webview.postMessage({
                command: 'jumpToPage',
                page: this.currentPage
            });
        }
    }

    async searchInPdf(): Promise<void> {
        const query = await vscode.window.showInputBox({
            prompt: 'Search in PDF',
            placeHolder: 'Enter search query (regex supported)'
        });
        
        if (query && this.activeDocumentUri) {
            const useRegex = query.startsWith('/') && query.endsWith('/');
            const searchQuery = useRegex ? query.slice(1, -1) : query;
            await this.handleSearch(this.activeDocumentUri, searchQuery, useRegex);
        }
    }

    async showMetadata(): Promise<void> {
        if (!this.activeDocumentUri) {
            vscode.window.showWarningMessage('No PDF file is currently open');
            return;
        }

        try {
            const buffer = await vscode.workspace.fs.readFile(this.activeDocumentUri);
            const metadata = await this.metadataInspector.inspect(Buffer.from(buffer));
            
            const metadataText = `
PDF Metadata:
- Title: ${metadata.title}
- Author: ${metadata.author}
- Pages: ${metadata.pages}
- File Size: ${(metadata.fileSize / 1024 / 1024).toFixed(2)} MB
- Created: ${metadata.creationDate || 'N/A'}
- Modified: ${metadata.modDate || 'N/A'}
- Encrypted: ${metadata.isEncrypted ? 'Yes' : 'No'}
- Fonts: ${metadata.fonts.length > 0 ? metadata.fonts.join(', ') : 'N/A'}
            `.trim();

            const doc = await vscode.workspace.openTextDocument({
                content: metadataText,
                language: 'plaintext'
            });
            await vscode.window.showTextDocument(doc);
        } catch (error: any) {
            logError(`Failed to show metadata: ${error.message}`);
        }
    }

    async zoom(): Promise<void> {
        const level = await vscode.window.showQuickPick(['50%', '75%', '100%', '125%', '150%', '200%'], {
            placeHolder: 'Select zoom level'
        });
        
        if (level && this.currentPanel) {
            const zoomValue = parseFloat(level) / 100;
            this.currentZoom = zoomValue;
            this.currentPanel.webview.postMessage({
                command: 'setZoom',
                zoom: zoomValue
            });
        }
    }
}


