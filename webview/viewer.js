const vscode = acquireVsCodeApi();

let pdfDoc = null;
let currentPage = 1;
let currentScale = 1.0;

// Initialize PDF.js
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.1.392/pdf.worker.min.js';

// Toolbar controls
document.getElementById('btn-zoom-in').addEventListener('click', () => setZoom(1.1));
document.getElementById('btn-zoom-out').addEventListener('click', () => setZoom(0.9));
document.getElementById('btn-fit-page').addEventListener('click', () => fitPage());
document.getElementById('btn-fit-width').addEventListener('click', () => fitWidth());
document.getElementById('btn-prev-page').addEventListener('click', () => prevPage());
document.getElementById('btn-next-page').addEventListener('click', () => nextPage());
document.getElementById('btn-search').addEventListener('click', search);
document.getElementById('btn-extract').addEventListener('click', extract);
document.getElementById('btn-export').addEventListener('click', exportFile);

// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        switchTab(btn.dataset.tab);
    });
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
        if (e.key === 'f') {
            e.preventDefault();
            document.getElementById('search-input').focus();
        }
    }
});

function setZoom(factor) {
    currentScale *= factor;
    currentScale = Math.max(0.5, Math.min(3.0, currentScale));
    document.getElementById('zoom-level').textContent = Math.round(currentScale * 100) + '%';
    renderAllPages();
}

function fitPage() {
    // Implement fit page logic
    renderAllPages();
}

function fitWidth() {
    // Implement fit width logic
    renderAllPages();
}

function prevPage() {
    if (currentPage > 1) {
        currentPage--;
        updatePageInfo();
    }
}

function nextPage() {
    if (currentPage < pdfDoc?.numPages) {
        currentPage++;
        updatePageInfo();
    }
}

function updatePageInfo() {
    document.getElementById('page-info').textContent = `Page ${currentPage} / ${pdfDoc?.numPages || 0}`;
}

function search() {
    const query = document.getElementById('search-input').value;
    if (query) {
        vscode.postMessage({ command: 'search', query });
    }
}

function extract() {
    vscode.postMessage({ command: 'extract' });
}

function exportFile() {
    vscode.postMessage({ command: 'export' });
}

function switchTab(tabName) {
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Update pane visibility
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `tab-${tabName}`);
    });
}

async function renderAllPages() {
    if (!pdfDoc) return;
    
    const container = document.getElementById('pdf-container');
    container.innerHTML = '';
    
    for (let i = 1; i <= pdfDoc.numPages; i++) {
        await renderPage(i);
    }
}

async function renderPage(pageNum) {
    const page = await pdfDoc.getPage(pageNum);
    const scale = currentScale;
    const viewport = page.getViewport({ scale });
    
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;
    
    const pageDiv = document.createElement('div');
    pageDiv.className = 'page';
    pageDiv.appendChild(canvas);
    
    document.getElementById('pdf-container').appendChild(pageDiv);
    
    await page.render({ canvasContext: context, viewport }).promise;
}

// Message handling from extension
window.addEventListener('message', async (event) => {
    const message = event.data;
    
    switch (message.command) {
        case 'loadPdf':
            await loadPdf(message.data);
            break;
    }
});

async function loadPdf(data) {
    try {
        pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        currentPage = 1;
        updatePageInfo();
        await renderAllPages();
    } catch (error) {
        console.error('Error loading PDF:', error);
    }
}

