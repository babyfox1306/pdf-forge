import { createHash } from 'node:crypto';

/** SHA-256 hex digest of a buffer. */
export function hashBuffer(buf: Buffer | Uint8Array): string {
    return createHash('sha256').update(buf).digest('hex');
}

/** SHA-256 hex digest of string or buffer content. */
export function hashFileContent(content: string | Buffer): string {
    if (typeof content === 'string') {
        return createHash('sha256').update(content, 'utf8').digest('hex');
    }
    return hashBuffer(content);
}
