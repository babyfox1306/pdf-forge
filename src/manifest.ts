import * as fs from 'fs';
import * as path from 'path';
import {
    FailClosedError,
    MANIFEST_SCHEMA_VERSION,
    type ManifestEntry,
    type ManifestFile,
} from './types';
import { comparePosix, toPosix } from './paths';
import { writeFileAtomic } from './safeWrite';

export const MANIFEST_FILENAME = '.pdf-forge-manifest.json';

function isObject(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isBatchStatus(v: unknown): boolean {
    return (
        typeof v === 'string' &&
        [
            'converted',
            'unchanged',
            'skipped_limit',
            'no_text',
            'low_text',
            'encrypted',
            'conflict',
            'cancelled',
            'failed',
        ].includes(v)
    );
}

function validateEntry(raw: unknown, index: number): ManifestEntry {
    if (!isObject(raw)) {
        throw new FailClosedError(`Manifest entry[${index}] is not an object`);
    }
    if (typeof raw.source !== 'string' || !raw.source) {
        throw new FailClosedError(`Manifest entry[${index}] missing source`);
    }
    if (typeof raw.observedSourceHash !== 'string') {
        throw new FailClosedError(`Manifest entry[${index}] missing observedSourceHash`);
    }
    if (!isBatchStatus(raw.status)) {
        throw new FailClosedError(`Manifest entry[${index}] invalid status`);
    }
    if (typeof raw.converterVersion !== 'string') {
        throw new FailClosedError(`Manifest entry[${index}] missing converterVersion`);
    }
    if (!Array.isArray(raw.chargedSourceHashes)) {
        throw new FailClosedError(`Manifest entry[${index}] missing chargedSourceHashes`);
    }
    for (const h of raw.chargedSourceHashes) {
        if (typeof h !== 'string') {
            throw new FailClosedError(`Manifest entry[${index}] chargedSourceHashes must be strings`);
        }
    }

    const pageCount =
        raw.pageCount === null || raw.pageCount === undefined
            ? null
            : typeof raw.pageCount === 'number' && Number.isFinite(raw.pageCount)
              ? raw.pageCount
              : (() => {
                    throw new FailClosedError(`Manifest entry[${index}] invalid pageCount`);
                })();

    const entry: ManifestEntry = {
        source: toPosix(raw.source),
        observedSourceHash: raw.observedSourceHash,
        pageCount,
        status: raw.status as ManifestEntry['status'],
        converterVersion: raw.converterVersion,
        chargedSourceHashes: [...raw.chargedSourceHashes],
    };

    if (typeof raw.canonicalSourceHash === 'string') {
        entry.canonicalSourceHash = raw.canonicalSourceHash;
    }
    if (typeof raw.canonicalOutputPath === 'string') {
        entry.canonicalOutputPath = toPosix(raw.canonicalOutputPath);
    }
    if (typeof raw.canonicalOutputHash === 'string') {
        entry.canonicalOutputHash = raw.canonicalOutputHash;
    }
    if (typeof raw.errorReason === 'string') {
        entry.errorReason = raw.errorReason;
    }
    if (raw.conflictCandidate !== undefined) {
        if (!isObject(raw.conflictCandidate)) {
            throw new FailClosedError(`Manifest entry[${index}] invalid conflictCandidate`);
        }
        const c = raw.conflictCandidate;
        if (
            typeof c.sourceHash !== 'string' ||
            typeof c.outputPath !== 'string' ||
            typeof c.outputHash !== 'string'
        ) {
            throw new FailClosedError(`Manifest entry[${index}] incomplete conflictCandidate`);
        }
        entry.conflictCandidate = {
            sourceHash: c.sourceHash,
            outputPath: toPosix(c.outputPath),
            outputHash: c.outputHash,
        };
    }

    return entry;
}

export function validateManifest(raw: unknown): ManifestFile {
    if (!isObject(raw)) {
        throw new FailClosedError('Manifest is not an object');
    }
    if (raw.schemaVersion !== MANIFEST_SCHEMA_VERSION) {
        throw new FailClosedError(
            `Unsupported or missing manifest schemaVersion (expected ${MANIFEST_SCHEMA_VERSION})`
        );
    }
    if (!Array.isArray(raw.entries)) {
        throw new FailClosedError('Manifest entries must be an array');
    }
    const entries = raw.entries.map((e, i) => validateEntry(e, i));
    return { schemaVersion: MANIFEST_SCHEMA_VERSION, entries };
}

export function createEmptyManifest(): ManifestFile {
    return { schemaVersion: MANIFEST_SCHEMA_VERSION, entries: [] };
}

export function manifestPath(outputRootFsPath: string): string {
    return path.join(outputRootFsPath, MANIFEST_FILENAME);
}

/**
 * Load and validate manifest. Missing file → empty. Corrupt → FailClosedError.
 */
export async function loadManifest(outputRootFsPath: string): Promise<ManifestFile> {
    const filePath = manifestPath(outputRootFsPath);
    let rawText: string;
    try {
        rawText = await fs.promises.readFile(filePath, 'utf8');
    } catch (error: any) {
        if (error?.code === 'ENOENT') {
            return createEmptyManifest();
        }
        throw new FailClosedError(`Cannot read manifest: ${error?.message || error}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(rawText);
    } catch {
        throw new FailClosedError('Manifest JSON is corrupt or unreadable');
    }

    return validateManifest(parsed);
}

/** Atomic save of validated manifest. */
export async function saveManifest(
    outputRootFsPath: string,
    manifest: ManifestFile
): Promise<void> {
    validateManifest(manifest);
    const sorted = {
        schemaVersion: MANIFEST_SCHEMA_VERSION,
        entries: [...manifest.entries].sort((a, b) => comparePosix(a.source, b.source)),
    };
    const filePath = manifestPath(outputRootFsPath);
    await writeFileAtomic(filePath, JSON.stringify(sorted, null, 2) + '\n');
}

export function getEntry(manifest: ManifestFile, source: string): ManifestEntry | undefined {
    const key = toPosix(source);
    return manifest.entries.find((e) => e.source === key);
}

/** Upsert by source path. */
export function upsertEntry(manifest: ManifestFile, entry: ManifestEntry): void {
    const key = toPosix(entry.source);
    entry.source = key;
    const idx = manifest.entries.findIndex((e) => e.source === key);
    if (idx >= 0) {
        manifest.entries[idx] = entry;
    } else {
        manifest.entries.push(entry);
    }
}

/**
 * Remove entries whose source is under scannedSubtreePrefix and not in discoveredSources.
 * Preserve entries outside the scanned subtree.
 */
export function removeMissingInSubtree(
    manifest: ManifestFile,
    scannedSubtreePrefix: string,
    discoveredSources: string[]
): void {
    const prefix = toPosix(scannedSubtreePrefix);
    const discovered = new Set(discoveredSources.map(toPosix));

    const underSubtree = (source: string): boolean => {
        if (prefix === '.' || prefix === '') {
            return true;
        }
        return source === prefix || source.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
    };

    manifest.entries = manifest.entries.filter((e) => {
        if (!underSubtree(e.source)) {
            return true;
        }
        return discovered.has(e.source);
    });
}
