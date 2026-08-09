import * as path from 'path';
import type { ConversionResult } from './types';
import { classifyTextQuality, normalizeTextChars } from './textQuality';
import { stripControlChars, toPosix, yamlQuote } from './paths';

const LOW_TEXT_WARNING =
    '> **Warning:** Text extraction may be incomplete. This PDF appears to have little extractable text relative to its page count.\n\n';

let pdfParseEngineWarmed = false;

function loadPdfParse(): (buf: Buffer) => Promise<{
    text?: string;
    numpages?: number;
    info?: { Title?: string };
}> {
    try {
        return require('pdf-parse');
    } catch (requireError: any) {
        if (
            requireError?.message?.includes('DOMMatrix') ||
            requireError?.message?.includes('pdfjs')
        ) {
            throw new Error(
                'PDF parsing library requires browser environment. This is a known limitation.'
            );
        }
        throw requireError;
    }
}

/**
 * Initialize pdf-parse's bundled pdf.js before pdfjs-dist inspect runs.
 * Electron extension-host races when inspect loads first; a successful warm
 * parse first makes subsequent inspect→convert reliable.
 */
export async function warmPdfParseEngine(
    extensionPath?: string,
    options?: { force?: boolean }
): Promise<void> {
    if (pdfParseEngineWarmed && !options?.force) {
        return;
    }
    pdfParseEngineWarmed = false;
    const fs = require('fs') as typeof import('fs');
    const candidates = [
        extensionPath ? path.join(extensionPath, 'media', 'pdf-parse-warm.pdf') : '',
        path.join(__dirname, '..', 'media', 'pdf-parse-warm.pdf'),
        extensionPath ? path.join(extensionPath, 'test-fixtures', 'normal.pdf') : '',
        path.join(__dirname, '..', 'test-fixtures', 'normal.pdf'),
    ].filter((p) => !!p);

    const pdf = loadPdfParse();
    for (const candidate of candidates) {
        try {
            if (!fs.existsSync(candidate)) {
                continue;
            }
            await pdf(Buffer.from(fs.readFileSync(candidate)));
            pdfParseEngineWarmed = true;
            return;
        } catch {
            // try next candidate
        }
    }
    // Require side-effect only — better than nothing if fixtures missing
    pdfParseEngineWarmed = true;
}

/** Test-only: allow re-warming after module cache tricks. */
export function __resetPdfParseWarmForTests(): void {
    pdfParseEngineWarmed = false;
}

function isValidTitle(title: unknown): title is string {
    if (typeof title !== 'string') {
        return false;
    }
    const t = stripControlChars(title).trim();
    return t.length > 0;
}

function basenameWithoutPdf(sourceRelativePath: string): string {
    const base = path.posix.basename(toPosix(sourceRelativePath));
    return base.toLowerCase().endsWith('.pdf') ? base.slice(0, -4) : base;
}

/**
 * Pure PDF → Markdown conversion. No VS Code, no filesystem write, no Git, no quota.
 */
export async function convertPdf(
    buffer: Buffer,
    sourceRelativePath: string
): Promise<ConversionResult> {
    const sourcePosix = toPosix(sourceRelativePath);

    let pdf: (buf: Buffer) => Promise<{
        text?: string;
        numpages?: number;
        info?: { Title?: string };
    }>;
    try {
        pdf = loadPdfParse();
    } catch (requireError: any) {
        if (
            requireError?.message?.includes('DOMMatrix') ||
            requireError?.message?.includes('pdfjs')
        ) {
            throw new Error(
                'PDF parsing library requires browser environment. This is a known limitation.'
            );
        }
        throw requireError;
    }

    // pdfjs-dist (inspect) and pdf-parse's bundled pdf.js share extension-host
    // process state. Immediately after inspect teardown, pdf-parse can flake
    // (bad XRef / illegal character) on the Electron host. Fresh buffers +
    // short backoff retries recover without changing the conversion contract.
    const parseBackoffMs = [0, 400, 1000, 2000];
    // Coexistence flakes with pdfjs-dist inspect on Electron host — retry only;
    // never remap these into no_text without a successful parse.
    const retryable = /xref|illegal character|invalid top-level pages dictionary/i;
    let data: { text?: string; numpages?: number; info?: { Title?: string } } | undefined;
    let lastParseError: string | undefined;

    for (let attempt = 0; attempt < parseBackoffMs.length; attempt++) {
        const wait = parseBackoffMs[attempt];
        if (wait > 0) {
            await new Promise<void>((resolve) => setTimeout(resolve, wait));
        }
        try {
            data = await pdf(Buffer.from(buffer));
            lastParseError = undefined;
            break;
        } catch (error: any) {
            const msg = error?.message || String(error);
            if (/password|encrypted/i.test(msg)) {
                throw Object.assign(new Error('encrypted'), { code: 'encrypted' });
            }
            if (retryable.test(msg) && attempt < parseBackoffMs.length - 1) {
                lastParseError = msg;
                continue;
            }
            throw new Error(`Failed to extract text: ${msg.split('\n')[0]}`);
        }
    }

    if (!data) {
        throw new Error(
            `Failed to extract text: ${(lastParseError || 'parse_failed').split('\n')[0]}`
        );
    }

    const rawPages = data.numpages;
    if (typeof rawPages !== 'number' || !Number.isFinite(rawPages) || rawPages < 1) {
        throw new Error('page_count_unavailable');
    }
    const pageCount = Math.floor(rawPages);

    const extractedText = typeof data.text === 'string' ? data.text : '';
    const normalizedTextChars = normalizeTextChars(extractedText);
    const quality = classifyTextQuality(normalizedTextChars, pageCount);

    const metaTitle = data.info?.Title;
    const title = isValidTitle(metaTitle)
        ? stripControlChars(metaTitle).trim()
        : stripControlChars(basenameWithoutPdf(sourcePosix));

    if (quality === 'no_text') {
        return {
            markdown: '',
            title,
            pageCount,
            normalizedTextChars,
            quality,
        };
    }

    const status = quality === 'low_text' ? 'low_text' : 'converted';
    const frontMatter = [
        '---',
        `title: ${yamlQuote(title)}`,
        `source: ${yamlQuote(sourcePosix)}`,
        `pages: ${pageCount}`,
        `status: ${yamlQuote(status)}`,
        '---',
        '',
    ].join('\n');

    const body =
        quality === 'low_text'
            ? LOW_TEXT_WARNING + extractedText
            : extractedText;

    return {
        markdown: frontMatter + body,
        title,
        pageCount,
        normalizedTextChars,
        quality,
    };
}
