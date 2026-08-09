import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/** Test-only interceptor. Production leaves this undefined. */
let writeInterceptor:
    | ((ctx: {
          finalPath: string;
          tempPath: string;
          content: string | Buffer;
      }) => Promise<void> | void)
    | undefined;

export function __setWriteFileAtomicInterceptorForTests(
    fn:
        | ((ctx: {
              finalPath: string;
              tempPath: string;
              content: string | Buffer;
          }) => Promise<void> | void)
        | undefined
): void {
    writeInterceptor = fn;
}

/**
 * Atomic write: temp file in same directory, optional fsync, then rename.
 */
export async function writeFileAtomic(
    finalPath: string,
    content: string | Buffer
): Promise<void> {
    const dir = path.dirname(finalPath);
    await fs.promises.mkdir(dir, { recursive: true });

    const base = path.basename(finalPath);
    const tempName = `.${base}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tempPath = path.join(dir, tempName);

    try {
        if (typeof content === 'string') {
            await fs.promises.writeFile(tempPath, content, 'utf8');
        } else {
            await fs.promises.writeFile(tempPath, content);
        }

        try {
            const fh = await fs.promises.open(tempPath, 'r+');
            try {
                await fh.sync();
            } finally {
                await fh.close();
            }
        } catch {
            // fsync optional on some platforms
        }

        if (writeInterceptor) {
            await writeInterceptor({ finalPath, tempPath, content });
        }

        await fs.promises.rename(tempPath, finalPath);
    } catch (error) {
        await cleanupTemp(tempPath);
        throw error;
    }
}

/** Best-effort removal of a known temp path. Does not delete unknown files. */
export async function cleanupTemp(tempPath: string): Promise<void> {
    try {
        await fs.promises.unlink(tempPath);
    } catch {
        // ignore
    }
}
