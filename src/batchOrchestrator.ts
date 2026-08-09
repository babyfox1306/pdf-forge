import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    CONVERTER_VERSION,
    FailClosedError,
    MONTHLY_PAGE_THRESHOLD,
    type BatchResult,
    type BatchStatus,
    type ManifestEntry,
    type ManifestFile,
    type PreflightItem,
} from './types';
import { inspectPdf } from './pdfInspect';
import { hashBuffer, hashFileContent } from './hash';
import { toPosix } from './paths';
import { discoverPdfs } from './discovery';
import { resolveWorkspaceContext, ensureOutputRoot } from './workspaceContext';
import {
    getEntry,
    loadManifest,
    removeMissingInSubtree,
    saveManifest,
    upsertEntry,
} from './manifest';
import { convertPdf, warmPdfParseEngine } from './convertPdf';
import { writeFileAtomic } from './safeWrite';
import { buildIndexMarkdown } from './indexBuilder';
import {
    canChargeNewRevision,
    chargePages,
    ensurePeriod,
    getCurrentPeriodKey,
    loadBatchUsage,
    loadGuideState,
    saveBatchUsage,
    saveGuideState,
} from './quota';
import { pickGuideUrl, shouldShowGuide } from './guideCta';

const BATCH_ALREADY_RUNNING = 'Batch conversion is already running.';

let batchRunning = false;

export type BatchOrchestratorOptions = {
    openExternal?: (uri: vscode.Uri) => Thenable<boolean>;
    /** Host/QA: inject to avoid headless modal hangs (production omits). */
    showInformationMessage?: (
        message: string,
        ...items: string[]
    ) => Thenable<string | undefined>;
    showWarningMessage?: (
        message: string,
        options: vscode.MessageOptions,
        ...items: string[]
    ) => Thenable<string | undefined>;
    progress?: vscode.Progress<{ message?: string; increment?: number }>;
    token?: vscode.CancellationToken;
};

function outputRelForSource(sourcePosix: string): string {
    const withoutExt = sourcePosix.toLowerCase().endsWith('.pdf')
        ? sourcePosix.slice(0, -4)
        : sourcePosix;
    return toPosix(path.posix.join(withoutExt, 'document.md'));
}

function candidateRelForSource(sourcePosix: string): string {
    const withoutExt = sourcePosix.toLowerCase().endsWith('.pdf')
        ? sourcePosix.slice(0, -4)
        : sourcePosix;
    return toPosix(path.posix.join(withoutExt, 'document.pdf-forge-new.md'));
}

function absUnder(outputRootFs: string, relPosix: string): string {
    return path.join(outputRootFs, ...relPosix.split('/'));
}

async function fileExists(p: string): Promise<boolean> {
    try {
        await fs.promises.access(p);
        return true;
    } catch {
        return false;
    }
}

async function readFileHash(p: string): Promise<string | null> {
    try {
        const buf = await fs.promises.readFile(p);
        return hashFileContent(buf);
    } catch {
        return null;
    }
}

function emptyCounts(): Omit<
    BatchResult,
    'outputRootUri' | 'cancelledEarly' | 'message' | 'pagesBefore' | 'pagesAfter' | 'knownCorpusPages'
> {
    return {
        discovered: 0,
        converted: 0,
        unchanged: 0,
        skippedLimit: 0,
        noText: 0,
        lowText: 0,
        encrypted: 0,
        conflict: 0,
        cancelled: 0,
        failed: 0,
        pagesConverted: 0,
    };
}

function bumpStatus(
    counts: ReturnType<typeof emptyCounts>,
    status: BatchStatus,
    pages?: number
): void {
    switch (status) {
        case 'converted':
            counts.converted++;
            if (pages) {
                counts.pagesConverted += pages;
            }
            break;
        case 'unchanged':
            counts.unchanged++;
            break;
        case 'skipped_limit':
            counts.skippedLimit++;
            break;
        case 'no_text':
            counts.noText++;
            break;
        case 'low_text':
            counts.lowText++;
            break;
        case 'encrypted':
            counts.encrypted++;
            break;
        case 'conflict':
            counts.conflict++;
            break;
        case 'cancelled':
            counts.cancelled++;
            break;
        case 'failed':
            counts.failed++;
            break;
    }
}

/** Pluralize "file" / "files" for notification copy. */
function fileLabel(count: number): string {
    return `${count} ${count === 1 ? 'file' : 'files'}`;
}

/**
 * User-facing batch summary. Counts come only from status bumps / charge events:
 * - converted + pagesConverted = successful chargeable converts (not discovered/preflight)
 * - unchanged / skippedLimit reported separately so a skip is never called "converted"
 */
function buildFinalMessage(
    counts: ReturnType<typeof emptyCounts>,
    pagesAfter: number,
    cancelledEarly: boolean
): string {
    const convertedBit = `Converted ${fileLabel(counts.converted)} (${counts.pagesConverted} pages)`;
    const parts: string[] = [convertedBit];

    if (counts.unchanged > 0) {
        parts.push(`${counts.unchanged} unchanged`);
    }
    if (counts.skippedLimit > 0) {
        parts.push(`${fileLabel(counts.skippedLimit)} skipped this month`);
    }

    if (cancelledEarly) {
        return `Batch cancelled. ${convertedBit}.`;
    }

    if (parts.length > 1) {
        return `${parts.join('. ')}.`;
    }

    if (pagesAfter >= MONTHLY_PAGE_THRESHOLD && counts.converted > 0) {
        return `${convertedBit} — above this month's batch threshold.`;
    }

    const total = counts.discovered;
    if (total > 0 && total !== counts.converted) {
        return `Converted ${counts.converted} of ${fileLabel(total)} (${counts.pagesConverted} pages).`;
    }
    return `${convertedBit}.`;
}

/** Test helper: exercise notification copy without a full batch. */
export function __buildFinalMessageForTests(
    counts: Partial<ReturnType<typeof emptyCounts>> & {
        converted: number;
        pagesConverted: number;
    },
    pagesAfter: number,
    cancelledEarly = false
): string {
    return buildFinalMessage({ ...emptyCounts(), ...counts }, pagesAfter, cancelledEarly);
}

function baseEntry(
    source: string,
    sourceHash: string,
    pageCount: number | null,
    status: BatchStatus,
    prev?: ManifestEntry
): ManifestEntry {
    return {
        source,
        observedSourceHash: sourceHash,
        pageCount,
        status,
        converterVersion: CONVERTER_VERSION,
        chargedSourceHashes: prev?.chargedSourceHashes ? [...prev.chargedSourceHashes] : [],
        canonicalSourceHash: prev?.canonicalSourceHash,
        canonicalOutputPath: prev?.canonicalOutputPath,
        canonicalOutputHash: prev?.canonicalOutputHash,
        conflictCandidate: prev?.conflictCandidate,
        errorReason: undefined,
    };
}

async function rebuildIndex(outputRootFs: string, manifest: ManifestFile): Promise<void> {
    const md = buildIndexMarkdown(manifest.entries);
    await writeFileAtomic(path.join(outputRootFs, 'INDEX.md'), md);
}

async function maybeShowGuide(args: {
    context: vscode.ExtensionContext;
    discoveredPdfCount: number;
    pagesBefore: number;
    pagesAfter: number;
    newConvertedCount: number;
    skippedLimitCount: number;
    knownCorpusPages: number;
    openExternal: (uri: vscode.Uri) => Thenable<boolean>;
    showInformationMessage: (
        message: string,
        ...items: string[]
    ) => Thenable<string | undefined>;
    showWarningMessage: (
        message: string,
        options: vscode.MessageOptions,
        ...items: string[]
    ) => Thenable<string | undefined>;
}): Promise<void> {
    const currentPeriod = getCurrentPeriodKey();
    const guideState = loadGuideState(args.context);
    if (
        !shouldShowGuide({
            discoveredPdfCount: args.discoveredPdfCount,
            pagesBefore: args.pagesBefore,
            pagesAfter: args.pagesAfter,
            newConvertedCount: args.newConvertedCount,
            skippedLimitCount: args.skippedLimitCount,
            guideState,
            currentPeriod,
        })
    ) {
        return;
    }

    const url = pickGuideUrl(args.knownCorpusPages);
    const choice = await args.showInformationMessage(
        'You have reached this month\'s batch threshold. Open the PDF Forge batch guide for tips on large local collections?',
        'Open guide',
        'Not now'
    );

    if (choice !== 'Open guide') {
        await saveGuideState(args.context, {
            ...guideState,
            lastPromptPeriod: currentPeriod,
        });
        return;
    }

    const confirm = await args.showWarningMessage(
        'PDF Forge does not upload documents or document text. If you choose to open the batch guide, your browser visits a public GitHub Pages page on babyfox1306.github.io classified only as a standard or large document set. Continue?',
        { modal: true },
        'Open in browser'
    );

    if (confirm !== 'Open in browser') {
        await saveGuideState(args.context, {
            ...guideState,
            lastPromptPeriod: currentPeriod,
        });
        return;
    }

    try {
        const ok = await args.openExternal(vscode.Uri.parse(url));
        if (ok) {
            await saveGuideState(args.context, {
                opened: true,
                lastPromptPeriod: currentPeriod,
            });
        } else {
            await saveGuideState(args.context, {
                ...guideState,
                lastPromptPeriod: currentPeriod,
            });
        }
    } catch {
        await saveGuideState(args.context, {
            ...guideState,
            lastPromptPeriod: currentPeriod,
        });
    }
}

/**
 * Run batch conversion for a workspace folder.
 * Never imports or calls GitIntegration.
 */
export async function runBatchConversion(
    folderUri: vscode.Uri,
    context: vscode.ExtensionContext,
    options: BatchOrchestratorOptions = {}
): Promise<BatchResult> {
    if (batchRunning) {
        throw new Error(BATCH_ALREADY_RUNNING);
    }
    batchRunning = true;

    const openExternal = options.openExternal || ((u) => vscode.env.openExternal(u));
    const showInformationMessage =
        options.showInformationMessage ||
        ((message: string, ...items: string[]) =>
            vscode.window.showInformationMessage(message, ...items));
    const showWarningMessage =
        options.showWarningMessage ||
        ((message: string, opts: vscode.MessageOptions, ...items: string[]) =>
            vscode.window.showWarningMessage(message, opts, ...items));
    const progress = options.progress;
    const token = options.token;

    try {
        const ws = resolveWorkspaceContext(folderUri);
        if (ws.compatibilityMode || !ws.owningWorkspaceFolder) {
            throw new Error(
                'Convert Folder requires a folder inside a VS Code workspace. Open a workspace folder and try again.'
            );
        }

        const workspaceRootFs = ws.workspaceRootUri.fsPath;
        const outputRootFs = ws.outputRootUri.fsPath;
        const scannedPrefix =
            ws.sourceRelativePath === '.' ? '' : toPosix(ws.sourceRelativePath);

        // Load pdf-parse before any pdfjs-dist inspect in this process.
        // Prevents Electron-host "bad XRef entry" when inspect runs first.
        await warmPdfParseEngine(context.extensionPath);

        progress?.report({ message: 'Discovering PDFs…' });
        const discovered = await discoverPdfs(folderUri.fsPath, workspaceRootFs);
        const counts = emptyCounts();
        counts.discovered = discovered.length;

        if (token?.isCancellationRequested) {
            return {
                ...counts,
                pagesBefore: 0,
                pagesAfter: 0,
                knownCorpusPages: 0,
                outputRootUri: ws.outputRootUri,
                cancelledEarly: true,
                message: 'Batch cancelled before processing.',
            };
        }

        // --- Preflight ---
        const preflight: PreflightItem[] = [];
        let knownCorpusPages = 0;

        for (let i = 0; i < discovered.length; i++) {
            if (token?.isCancellationRequested) {
                return {
                    ...counts,
                    pagesBefore: 0,
                    pagesAfter: 0,
                    knownCorpusPages,
                    outputRootUri: ws.outputRootUri,
                    cancelledEarly: true,
                    message: 'Batch cancelled during inspection.',
                };
            }

            const source = discovered[i];
            progress?.report({
                message: `Inspecting ${i + 1}/${discovered.length}: ${source}`,
            });

            const abs = path.join(workspaceRootFs, ...source.split('/'));
            let buffer: Buffer;
            try {
                buffer = await fs.promises.readFile(abs);
            } catch (error: any) {
                preflight.push({
                    source,
                    sourceHash: '',
                    pageCount: null,
                    encryption: 'unknown',
                    errorReason: 'read_failed',
                });
                continue;
            }

            const sourceHash = hashBuffer(buffer);
            // Pass an isolated copy so inspection never aliases the pooled read Buffer.
            const inspection = await inspectPdf(Buffer.from(buffer));
            // Drop local reference after hash+inspect (do not assign null in a way that
            // races worker teardown against Node's buffer pool — Buffer.from copy above
            // is the ownership boundary).
            void buffer;

            if (typeof inspection.pageCount === 'number') {
                knownCorpusPages += inspection.pageCount;
            }

            preflight.push({
                source,
                sourceHash,
                pageCount: inspection.pageCount,
                encryption: inspection.encryption,
                errorReason: inspection.errorReason,
            });
        }

        // Let pdfjs-dist host teardown settle before pdf-parse conversion begins.
        await new Promise<void>((resolve) => setTimeout(resolve, 800));
        await warmPdfParseEngine(context.extensionPath, { force: true });

        if (token?.isCancellationRequested) {
            return {
                ...counts,
                pagesBefore: 0,
                pagesAfter: 0,
                knownCorpusPages,
                outputRootUri: ws.outputRootUri,
                cancelledEarly: true,
                message: 'Batch cancelled during inspection.',
            };
        }

        await ensureOutputRoot(ws.outputRootUri);

        let manifest: ManifestFile;
        try {
            manifest = await loadManifest(outputRootFs);
        } catch (error) {
            if (error instanceof FailClosedError) {
                throw error;
            }
            throw new FailClosedError(
                `Cannot load manifest: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        removeMissingInSubtree(
            manifest,
            scannedPrefix || '.',
            discovered
        );

        let usage = ensurePeriod(loadBatchUsage(context));
        await saveBatchUsage(context, usage);
        const pagesBefore = usage.pagesUsed;
        let newConvertedCount = 0;

        // --- Process each file ---
        const markCancelledFrom = async (startIndex: number): Promise<void> => {
            for (let j = startIndex; j < preflight.length; j++) {
                const src = preflight[j].source;
                const prev = getEntry(manifest, src);
                const entry = baseEntry(
                    src,
                    preflight[j].sourceHash || prev?.observedSourceHash || '',
                    preflight[j].pageCount,
                    'cancelled',
                    prev
                );
                if (
                    prev &&
                    (prev.status === 'converted' ||
                        prev.status === 'unchanged' ||
                        prev.status === 'low_text' ||
                        prev.status === 'conflict') &&
                    prev.observedSourceHash === preflight[j].sourceHash
                ) {
                    continue;
                }
                upsertEntry(manifest, entry);
                bumpStatus(counts, 'cancelled');
            }
            await saveManifest(outputRootFs, manifest);
            await rebuildIndex(outputRootFs, manifest);
        };

        for (let i = 0; i < preflight.length; i++) {
            if (token?.isCancellationRequested) {
                await markCancelledFrom(i);
                break;
            }

            const item = preflight[i];
            progress?.report({
                message: `Converting ${i + 1}/${preflight.length}: ${item.source}`,
            });
            // Re-check after progress so UI/host cancel at "file 2 of N" skips conversion.
            if (token?.isCancellationRequested) {
                await markCancelledFrom(i);
                break;
            }

            const prev = getEntry(manifest, item.source);
            let entry = baseEntry(
                item.source,
                item.sourceHash,
                item.pageCount,
                'failed',
                prev
            );

            try {
                if (!item.sourceHash) {
                    entry.status = 'failed';
                    entry.errorReason = item.errorReason || 'read_failed';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'failed');
                    continue;
                }

                if (item.encryption === 'encrypted') {
                    entry.status = 'encrypted';
                    entry.errorReason = 'encrypted';
                    // Reuse prior if same hash+converter
                    if (
                        prev &&
                        prev.observedSourceHash === item.sourceHash &&
                        prev.converterVersion === CONVERTER_VERSION &&
                        prev.status === 'encrypted'
                    ) {
                        entry = { ...prev, observedSourceHash: item.sourceHash };
                    }
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'encrypted');
                    continue;
                }

                const outRel = outputRelForSource(item.source);
                const candRel = candidateRelForSource(item.source);
                const outAbs = absUnder(outputRootFs, outRel);
                const candAbs = absUnder(outputRootFs, candRel);

                const sameSourceHash =
                    prev && prev.canonicalSourceHash === item.sourceHash;
                const outHashNow = (await fileExists(outAbs))
                    ? await readFileHash(outAbs)
                    : null;
                const toolOwnsCanonical =
                    !!prev?.canonicalOutputPath &&
                    prev.canonicalOutputPath === outRel &&
                    !!prev.canonicalOutputHash;
                const outputMatchesManifest =
                    toolOwnsCanonical &&
                    outHashNow !== null &&
                    outHashNow === prev!.canonicalOutputHash;

                // Same source hash + matching output → unchanged
                if (
                    sameSourceHash &&
                    outputMatchesManifest &&
                    prev!.status !== 'skipped_limit' &&
                    prev!.status !== 'cancelled' &&
                    prev!.status !== 'failed'
                ) {
                    entry = {
                        ...prev!,
                        observedSourceHash: item.sourceHash,
                        pageCount: item.pageCount ?? prev!.pageCount,
                        status: 'unchanged',
                        converterVersion: CONVERTER_VERSION,
                    };
                    // Converter upgrade with same hash: if we need regenerate, fall through —
                    // but matching output hash means content is fine → unchanged, no charge
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'unchanged');
                    continue;
                }

                // Same source hash + output deleted → free regenerate (below)
                // Same source hash + user-modified output → conflict, no overwrite
                if (sameSourceHash && outHashNow !== null && !outputMatchesManifest) {
                    entry = {
                        ...baseEntry(item.source, item.sourceHash, item.pageCount, 'conflict', prev),
                        canonicalSourceHash: prev?.canonicalSourceHash,
                        canonicalOutputPath: prev?.canonicalOutputPath,
                        canonicalOutputHash: prev?.canonicalOutputHash,
                        conflictCandidate: prev?.conflictCandidate,
                        errorReason: 'canonical_output_modified',
                    };
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'conflict');
                    continue;
                }

                // Reuse deterministic no_text / low_text / encrypted when hash+converter match
                if (
                    prev &&
                    prev.observedSourceHash === item.sourceHash &&
                    prev.converterVersion === CONVERTER_VERSION &&
                    (prev.status === 'no_text' ||
                        (prev.status === 'low_text' && outputMatchesManifest))
                ) {
                    entry = {
                        ...prev,
                        observedSourceHash: item.sourceHash,
                        status: prev.status === 'low_text' ? 'unchanged' : prev.status,
                    };
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, entry.status);
                    continue;
                }

                const isNewRevision = !prev || prev.canonicalSourceHash !== item.sourceHash;
                const alreadyCharged =
                    !!prev?.chargedSourceHashes?.includes(item.sourceHash);

                // Chargeable new revision blocked by quota
                if (isNewRevision && !alreadyCharged && !canChargeNewRevision(usage.pagesUsed)) {
                    // Still allow free regenerations — this is chargeable path only
                    entry = baseEntry(
                        item.source,
                        item.sourceHash,
                        item.pageCount,
                        'skipped_limit',
                        prev
                    );
                    entry.errorReason = 'monthly_page_threshold';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'skipped_limit');
                    continue;
                }

                // Unowned existing output (no manifest ownership) → conflict, never adopt
                if (outHashNow !== null && !toolOwnsCanonical) {
                    // New source wanting that path but file exists unowned
                    entry = baseEntry(
                        item.source,
                        item.sourceHash,
                        item.pageCount,
                        'conflict',
                        prev
                    );
                    entry.errorReason = 'unowned_output_exists';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'conflict');
                    continue;
                }

                // Need conversion: read file again
                const absPdf = path.join(workspaceRootFs, ...item.source.split('/'));
                let pdfBuffer: Buffer;
                try {
                    pdfBuffer = await fs.promises.readFile(absPdf);
                } catch {
                    entry.status = 'failed';
                    entry.errorReason = 'read_failed';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'failed');
                    continue;
                }

                // Cancel check before write — may discard conversion result
                let conversion;
                try {
                    conversion = await convertPdf(pdfBuffer, item.source);
                } catch (error: any) {
                    const msg = error?.message || String(error);
                    if (msg === 'encrypted' || error?.code === 'encrypted') {
                        entry.status = 'encrypted';
                        entry.errorReason = 'encrypted';
                    } else {
                        entry.status = 'failed';
                        entry.errorReason = msg.split('\n')[0].slice(0, 200);
                    }
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, entry.status);
                    continue;
                } finally {
                    void pdfBuffer;
                }

                if (token?.isCancellationRequested) {
                    entry.status = 'cancelled';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'cancelled');
                    // Mark rest cancelled in next loop iteration via token check
                    continue;
                }

                entry.pageCount = conversion.pageCount;

                if (conversion.quality === 'no_text') {
                    entry.status = 'no_text';
                    entry.errorReason = 'no_text_layer';
                    entry.observedSourceHash = item.sourceHash;
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'no_text');
                    continue;
                }

                // low_text or converted — decide canonical vs conflict candidate
                const willCharge =
                    isNewRevision &&
                    !alreadyCharged &&
                    conversion.quality === 'converted';

                // User-modified canonical + new source → write candidate
                const canonicalUserModified =
                    toolOwnsCanonical &&
                    outHashNow !== null &&
                    outHashNow !== prev!.canonicalOutputHash;

                if (canonicalUserModified || (outHashNow !== null && !toolOwnsCanonical)) {
                    // Conflict candidate path
                    const candExists = await fileExists(candAbs);
                    const candHashNow = candExists ? await readFileHash(candAbs) : null;
                    const candOwned =
                        !!prev?.conflictCandidate &&
                        prev.conflictCandidate.outputPath === candRel;

                    if (
                        candOwned &&
                        prev!.conflictCandidate!.sourceHash === item.sourceHash &&
                        candHashNow === prev!.conflictCandidate!.outputHash
                    ) {
                        // Same revision candidate already exists
                        entry = {
                            ...baseEntry(item.source, item.sourceHash, conversion.pageCount, 'conflict', prev),
                            conflictCandidate: prev!.conflictCandidate,
                            canonicalSourceHash: prev?.canonicalSourceHash,
                            canonicalOutputPath: prev?.canonicalOutputPath,
                            canonicalOutputHash: prev?.canonicalOutputHash,
                            errorReason: 'conflict_candidate_exists',
                        };
                        upsertEntry(manifest, entry);
                        await saveManifest(outputRootFs, manifest);
                        bumpStatus(counts, 'conflict');
                        continue;
                    }

                    if (candExists && !candOwned) {
                        entry = baseEntry(
                            item.source,
                            item.sourceHash,
                            conversion.pageCount,
                            'conflict',
                            prev
                        );
                        entry.errorReason = 'unowned_candidate_exists';
                        entry.canonicalSourceHash = prev?.canonicalSourceHash;
                        entry.canonicalOutputPath = prev?.canonicalOutputPath;
                        entry.canonicalOutputHash = prev?.canonicalOutputHash;
                        upsertEntry(manifest, entry);
                        await saveManifest(outputRootFs, manifest);
                        bumpStatus(counts, 'conflict');
                        continue;
                    }

                    if (
                        candOwned &&
                        candHashNow !== null &&
                        candHashNow !== prev!.conflictCandidate!.outputHash
                    ) {
                        // User modified both — overwrite neither
                        entry = {
                            ...baseEntry(item.source, item.sourceHash, conversion.pageCount, 'conflict', prev),
                            conflictCandidate: prev!.conflictCandidate,
                            canonicalSourceHash: prev?.canonicalSourceHash,
                            canonicalOutputPath: prev?.canonicalOutputPath,
                            canonicalOutputHash: prev?.canonicalOutputHash,
                            errorReason: 'canonical_and_candidate_modified',
                        };
                        upsertEntry(manifest, entry);
                        await saveManifest(outputRootFs, manifest);
                        bumpStatus(counts, 'conflict');
                        continue;
                    }

                    // Write/replace candidate
                    if (willCharge && !canChargeNewRevision(usage.pagesUsed)) {
                        entry.status = 'skipped_limit';
                        entry.errorReason = 'monthly_page_threshold';
                        upsertEntry(manifest, entry);
                        await saveManifest(outputRootFs, manifest);
                        bumpStatus(counts, 'skipped_limit');
                        continue;
                    }

                    await writeFileAtomic(candAbs, conversion.markdown);
                    const newCandHash = hashFileContent(conversion.markdown);
                    entry.status = 'conflict';
                    entry.observedSourceHash = item.sourceHash;
                    entry.conflictCandidate = {
                        sourceHash: item.sourceHash,
                        outputPath: candRel,
                        outputHash: newCandHash,
                    };
                    entry.canonicalSourceHash = prev?.canonicalSourceHash;
                    entry.canonicalOutputPath = prev?.canonicalOutputPath;
                    entry.canonicalOutputHash = prev?.canonicalOutputHash;

                    if (willCharge) {
                        if (!entry.chargedSourceHashes.includes(item.sourceHash)) {
                            entry.chargedSourceHashes.push(item.sourceHash);
                        }
                        usage = await chargePages(context, conversion.pageCount);
                        newConvertedCount++;
                        counts.converted++;
                        counts.pagesConverted += conversion.pageCount;
                    }
                    bumpStatus(counts, 'conflict');

                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    continue;
                }

                // Write canonical (new, or free regenerate, or replace tool-owned)
                if (conversion.quality === 'converted' && willCharge && !canChargeNewRevision(usage.pagesUsed)) {
                    entry.status = 'skipped_limit';
                    entry.errorReason = 'monthly_page_threshold';
                    upsertEntry(manifest, entry);
                    await saveManifest(outputRootFs, manifest);
                    bumpStatus(counts, 'skipped_limit');
                    continue;
                }

                await writeFileAtomic(outAbs, conversion.markdown);
                const newOutHash = hashFileContent(conversion.markdown);

                entry.status =
                    conversion.quality === 'low_text' ? 'low_text' : 'converted';
                entry.observedSourceHash = item.sourceHash;
                entry.canonicalSourceHash = item.sourceHash;
                entry.canonicalOutputPath = outRel;
                entry.canonicalOutputHash = newOutHash;
                entry.pageCount = conversion.pageCount;

                if (willCharge && conversion.quality === 'converted') {
                    if (!entry.chargedSourceHashes.includes(item.sourceHash)) {
                        entry.chargedSourceHashes.push(item.sourceHash);
                    }
                    usage = await chargePages(context, conversion.pageCount);
                    newConvertedCount++;
                }

                upsertEntry(manifest, entry);
                await saveManifest(outputRootFs, manifest);
                bumpStatus(
                    counts,
                    entry.status,
                    entry.status === 'converted' ? conversion.pageCount : undefined
                );
            } catch (error: any) {
                entry.status = 'failed';
                entry.errorReason = (error?.message || String(error)).split('\n')[0].slice(0, 200);
                upsertEntry(manifest, entry);
                await saveManifest(outputRootFs, manifest);
                bumpStatus(counts, 'failed');
            }
        }

        await rebuildIndex(outputRootFs, manifest);

        usage = ensurePeriod(loadBatchUsage(context));
        const pagesAfter = usage.pagesUsed;
        const cancelledEarly = !!token?.isCancellationRequested;

        if (!cancelledEarly) {
            await maybeShowGuide({
                context,
                discoveredPdfCount: discovered.length,
                pagesBefore,
                pagesAfter,
                newConvertedCount,
                skippedLimitCount: counts.skippedLimit,
                knownCorpusPages,
                openExternal,
                showInformationMessage,
                showWarningMessage,
            });
        }

        const message = buildFinalMessage(counts, pagesAfter, cancelledEarly);
        return {
            ...counts,
            pagesBefore,
            pagesAfter,
            knownCorpusPages,
            outputRootUri: ws.outputRootUri,
            cancelledEarly,
            message,
        };
    } finally {
        batchRunning = false;
    }
}

/** Test helper: reset in-memory lock. */
export function __resetBatchLockForTests(): void {
    batchRunning = false;
}
