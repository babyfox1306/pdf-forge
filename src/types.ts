/**
 * Shared types and constants for PDF Forge v1.0.9 batch conversion.
 */

export type { InspectionResult } from './pdfInspect';

export const CONVERTER_VERSION = '1.0.9';
export const MANIFEST_SCHEMA_VERSION = 1;
export const MONTHLY_PAGE_THRESHOLD = 100;
export const CORPUS_BUCKET_THRESHOLD = 2000;

export type BatchStatus =
    | 'converted'
    | 'unchanged'
    | 'skipped_limit'
    | 'no_text'
    | 'low_text'
    | 'encrypted'
    | 'conflict'
    | 'cancelled'
    | 'failed';

export type TextQuality = 'converted' | 'low_text' | 'no_text';

export type ConversionResult = {
    markdown: string;
    title: string;
    pageCount: number;
    normalizedTextChars: number;
    quality: TextQuality;
};

export type ManifestConflictCandidate = {
    sourceHash: string;
    outputPath: string;
    outputHash: string;
};

export type ManifestEntry = {
    source: string;
    observedSourceHash: string;
    canonicalSourceHash?: string;
    canonicalOutputPath?: string;
    canonicalOutputHash?: string;
    pageCount: number | null;
    status: BatchStatus;
    errorReason?: string;
    converterVersion: string;
    chargedSourceHashes: string[];
    conflictCandidate?: ManifestConflictCandidate;
};

export type ManifestFile = {
    schemaVersion: number;
    entries: ManifestEntry[];
};

export type BatchUsage = {
    periodKey: string;
    pagesUsed: number;
};

export type GuideState = {
    opened: boolean;
    lastPromptPeriod?: string;
};

export type WorkspaceContext = {
    owningWorkspaceFolder?: { name: string; uri: import('vscode').Uri };
    workspaceRootUri: import('vscode').Uri;
    outputRootUri: import('vscode').Uri;
    sourceRelativePath: string;
    /** True when the URI is outside any workspace folder (legacy single-file compat). */
    compatibilityMode: boolean;
};

export type PreflightItem = {
    source: string;
    sourceHash: string;
    pageCount: number | null;
    encryption: 'none' | 'encrypted' | 'unknown';
    errorReason?: string;
};

export type BatchResult = {
    discovered: number;
    converted: number;
    unchanged: number;
    skippedLimit: number;
    noText: number;
    lowText: number;
    encrypted: number;
    conflict: number;
    cancelled: number;
    failed: number;
    pagesConverted: number;
    pagesBefore: number;
    pagesAfter: number;
    knownCorpusPages: number;
    outputRootUri: import('vscode').Uri;
    cancelledEarly: boolean;
    message: string;
};

export class FailClosedError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FailClosedError';
    }
}
