import * as path from 'path';
import { pathToFileURL } from 'url';

export type InspectionResult = {
    pageCount: number | null;
    encryption: 'none' | 'encrypted' | 'unknown';
    errorReason?: string;
};

/** Optional hooks for spike / unit instrumentation. Production callers omit these. */
export type InspectInstrumentation = {
    onGetTextContent?: () => void;
    onRender?: () => void;
    onGetOperatorList?: () => void;
    onDestroyDocument?: () => void;
    onDestroyLoadingTask?: () => void;
    /** Fired when a PDFDocumentProxy becomes live (after load, before destroy). */
    onDocumentOpened?: () => void;
};

type PdfJsModule = {
    getDocument: (src: unknown) => {
        promise: Promise<any>;
        destroy?: () => Promise<void>;
    };
    GlobalWorkerOptions: { workerSrc: string };
    PasswordException?: new (...args: any[]) => Error;
};

let pdfJsModulePromise: Promise<PdfJsModule> | null = null;
let workerConfigured = false;

/** Real ESM dynamic import — tsc CommonJS rewrites `import()` to `require()`, which cannot load .mjs. */
const dynamicImport = new Function('modulePath', 'return import(modulePath)') as (
    modulePath: string
) => Promise<PdfJsModule>;

/**
 * Resolve pdfjs-dist legacy ESM build relative to this module when packaged,
 * falling back to process.cwd()/node_modules during development.
 */
function resolvePdfJsPaths(): { moduleUrl: string; workerUrl: string } {
    const candidates = [
        path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build'),
        path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build'),
    ];

    const fs = require('fs') as typeof import('fs');
    for (const dir of candidates) {
        const modulePath = path.join(dir, 'pdf.mjs');
        const workerPath = path.join(dir, 'pdf.worker.mjs');
        if (fs.existsSync(modulePath) && fs.existsSync(workerPath)) {
            return {
                moduleUrl: pathToFileURL(modulePath).href,
                workerUrl: pathToFileURL(workerPath).href,
            };
        }
    }

    throw new Error(
        'pdfjs-dist legacy build not found (expected node_modules/pdfjs-dist/legacy/build/pdf.mjs)'
    );
}

async function loadPdfJs(): Promise<{ pdfjs: PdfJsModule; workerUrl: string }> {
    const { moduleUrl, workerUrl } = resolvePdfJsPaths();
    if (!pdfJsModulePromise) {
        pdfJsModulePromise = dynamicImport(moduleUrl);
    }
    const pdfjs = await pdfJsModulePromise;
    if (!workerConfigured) {
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        workerConfigured = true;
    }
    return { pdfjs, workerUrl };
}

function isPasswordError(error: unknown, pdfjs: PdfJsModule): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const err = error as { name?: string; message?: string; code?: number };
    if (pdfjs.PasswordException && error instanceof pdfjs.PasswordException) {
        return true;
    }
    if (err.name === 'PasswordException') {
        return true;
    }
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('password') || msg.includes('encrypted');
}

function instrumentPage(page: any, instrumentation?: InspectInstrumentation): void {
    if (!instrumentation || !page) {
        return;
    }
    if (typeof page.getTextContent === 'function') {
        const original = page.getTextContent.bind(page);
        page.getTextContent = async (...args: unknown[]) => {
            instrumentation.onGetTextContent?.();
            return original(...args);
        };
    }
    if (typeof page.render === 'function') {
        const original = page.render.bind(page);
        page.render = (...args: unknown[]) => {
            instrumentation.onRender?.();
            return original(...args);
        };
    }
    if (typeof page.getOperatorList === 'function') {
        const original = page.getOperatorList.bind(page);
        page.getOperatorList = async (...args: unknown[]) => {
            instrumentation.onGetOperatorList?.();
            return original(...args);
        };
    }
}

/**
 * Structure-only PDF inspection for preflight.
 * Does not extract text, does not render, does not retain document resources.
 */
export async function inspectPdf(
    buffer: Buffer | Uint8Array,
    instrumentation?: InspectInstrumentation
): Promise<InspectionResult> {
    let loadingTask: { promise: Promise<any>; destroy?: () => Promise<void> } | null = null;
    let doc: any = null;
    let pdfjs: PdfJsModule | null = null;

    try {
        if (!buffer || buffer.byteLength === 0) {
            return {
                pageCount: null,
                encryption: 'unknown',
                errorReason: 'empty_buffer',
            };
        }

        const loaded = await loadPdfJs();
        pdfjs = loaded.pdfjs;

        // Deep-copy into a fresh ArrayBuffer so pdf.js worker transfer/detach
        // cannot touch the caller's Buffer (Node buffer pool / shared preflight bytes).
        const data = new Uint8Array(buffer.byteLength);
        data.set(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer));

        loadingTask = pdfjs.getDocument({
            data,
            disableFontFace: true,
            isEvalSupported: false,
            useSystemFonts: true,
            // Structure / catalog only — no page content pipeline
            stopAtErrors: false,
        });

        doc = await loadingTask.promise;
        instrumentation?.onDocumentOpened?.();

        if (instrumentation && typeof doc.getPage === 'function') {
            const originalGetPage = doc.getPage.bind(doc);
            doc.getPage = async (pageNumber: number) => {
                const page = await originalGetPage(pageNumber);
                instrumentPage(page, instrumentation);
                return page;
            };
        }

        const rawCount = doc.numPages;
        if (typeof rawCount !== 'number' || !Number.isFinite(rawCount) || rawCount < 1) {
            return {
                pageCount: null,
                encryption: 'none',
                errorReason: 'page_count_unavailable',
            };
        }

        return {
            pageCount: Math.floor(rawCount),
            encryption: 'none',
        };
    } catch (error: unknown) {
        if (pdfjs && isPasswordError(error, pdfjs)) {
            return {
                pageCount: null,
                encryption: 'encrypted',
                errorReason: 'encrypted',
            };
        }

        const message = error instanceof Error ? error.message : String(error);
        return {
            pageCount: null,
            encryption: 'unknown',
            errorReason: message.split('\n')[0].slice(0, 200) || 'inspect_failed',
        };
    } finally {
        try {
            if (doc && typeof doc.destroy === 'function') {
                await doc.destroy();
                instrumentation?.onDestroyDocument?.();
            }
        } catch {
            // ignore destroy errors
        }
        try {
            if (loadingTask && typeof loadingTask.destroy === 'function') {
                await loadingTask.destroy();
                instrumentation?.onDestroyLoadingTask?.();
            }
        } catch {
            // ignore destroy errors
        }
        doc = null;
        loadingTask = null;
    }
}

/** Reset cached module state — tests only. */
export function __resetPdfInspectCacheForTests(): void {
    pdfJsModulePromise = null;
    workerConfigured = false;
}
