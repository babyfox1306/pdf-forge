/**
 * Path helpers: POSIX normalization, YAML quoting, Markdown links.
 * Never use locale-dependent sorting.
 */

/** Normalize path separators to `/`. */
export function toPosix(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Bytewise / code-point sort comparator (locale-independent).
 * Returns negative if a < b, positive if a > b, 0 if equal.
 */
export function comparePosix(a: string, b: string): number {
    if (a < b) {
        return -1;
    }
    if (a > b) {
        return 1;
    }
    return 0;
}

/** Strip C0/C1 control characters (keep tab/LF/CR for body text callers that need them separately). */
export function stripControlChars(s: string): string {
    // eslint-disable-next-line no-control-regex
    return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

/**
 * Always double-quote a YAML scalar, escaping `"`, `\`, and control chars.
 */
export function yamlQuote(value: string): string {
    const cleaned = stripControlChars(value);
    const escaped = cleaned
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t');
    return `"${escaped}"`;
}

/**
 * Escape label/href for Markdown links `[label](href)`.
 */
export function markdownLink(label: string, href: string): string {
    const safeLabel = stripControlChars(label)
        .replace(/\\/g, '\\\\')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]');
    // Percent-encode spaces and characters that break MD link destinations
    const safeHref = encodeURI(href.replace(/\\/g, '/'))
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29');
    return `[${safeLabel}](${safeHref})`;
}

/**
 * Build a relative Markdown link target from INDEX.md (inside pdf-forge-exports/).
 * - Workspace-relative source paths get a `../` prefix.
 * - Output paths already under the exports root stay relative to INDEX.md.
 */
export function relativeLinkFromIndex(
    targetPosixFromExportsRootOrWorkspace: string,
    kind: 'source' | 'output' = 'output'
): string {
    const posix = toPosix(targetPosixFromExportsRootOrWorkspace).replace(/^\.\//, '');
    if (kind === 'source') {
        if (posix.startsWith('../')) {
            return posix;
        }
        return `../${posix}`;
    }
    // Output: relative to pdf-forge-exports/INDEX.md
    return posix.replace(/^\.\//, '');
}
