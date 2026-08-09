import type { ManifestEntry } from './types';
import { comparePosix, markdownLink, relativeLinkFromIndex, stripControlChars, toPosix } from './paths';

function sanitizeError(reason?: string): string {
    if (!reason) {
        return '—';
    }
    const cleaned = stripControlChars(reason)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
    // Never dump paths that look absolute
    if (/^[A-Za-z]:[\\/]/.test(cleaned) || cleaned.startsWith('/')) {
        return 'error';
    }
    return cleaned || '—';
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Deterministic INDEX.md from validated manifest entries.
 * Links are relative to pdf-forge-exports/INDEX.md.
 */
export function buildIndexMarkdown(entries: ManifestEntry[]): string {
    const sorted = [...entries].sort((a, b) => comparePosix(a.source, b.source));

    const lines: string[] = [
        '# PDF Forge Index',
        '',
        '| Source | Output | Candidate | Pages | Status | Error | Links |',
        '| --- | --- | --- | --- | --- | --- | --- |',
    ];

    for (const e of sorted) {
        const source = toPosix(e.source);
        const output = e.canonicalOutputPath ? toPosix(e.canonicalOutputPath) : '—';
        const candidate = e.conflictCandidate?.outputPath
            ? toPosix(e.conflictCandidate.outputPath)
            : '—';
        const pages =
            typeof e.pageCount === 'number' && Number.isFinite(e.pageCount)
                ? String(e.pageCount)
                : 'unknown';
        const status = e.status;
        const error = sanitizeError(e.errorReason);

        const sourceHref = relativeLinkFromIndex(source, 'source');
        const linkParts: string[] = [markdownLink('source', sourceHref)];
        if (e.canonicalOutputPath) {
            linkParts.push(
                markdownLink('md', relativeLinkFromIndex(e.canonicalOutputPath, 'output'))
            );
        }
        if (e.conflictCandidate?.outputPath) {
            linkParts.push(
                markdownLink(
                    'candidate',
                    relativeLinkFromIndex(e.conflictCandidate.outputPath, 'output')
                )
            );
        }

        lines.push(
            `| ${escapeCell(source)} | ${escapeCell(output)} | ${escapeCell(candidate)} | ${escapeCell(pages)} | ${escapeCell(status)} | ${escapeCell(error)} | ${escapeCell(linkParts.join(' · '))} |`
        );
    }

    lines.push('');
    return lines.join('\n');
}
