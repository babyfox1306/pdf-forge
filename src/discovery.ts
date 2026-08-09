import * as fs from 'fs';
import * as path from 'path';
import { comparePosix, toPosix } from './paths';

const PRUNE_DIR_NAMES = new Set(['pdf-forge-exports', 'node_modules', '.git']);

/**
 * Recursively discover PDF files under folderFsPath.
 * Returns POSIX paths relative to workspaceRootFsPath, sorted with comparePosix.
 * Does not follow directory symlinks. Prunes pdf-forge-exports, node_modules, .git at any depth.
 */
export async function discoverPdfs(
    folderFsPath: string,
    workspaceRootFsPath: string
): Promise<string[]> {
    const results: string[] = [];
    const rootNorm = path.resolve(workspaceRootFsPath);
    const startNorm = path.resolve(folderFsPath);

    async function walk(dir: string): Promise<void> {
        let entries: fs.Dirent[];
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }

        for (const entry of entries) {
            const full = path.join(dir, entry.name);

            let lstat: fs.Stats;
            try {
                lstat = await fs.promises.lstat(full);
            } catch {
                continue;
            }

            if (lstat.isSymbolicLink()) {
                // Do not follow directory symlinks; allow PDF file symlinks only
                try {
                    const st = await fs.promises.stat(full);
                    if (st.isDirectory()) {
                        continue;
                    }
                    if (!st.isFile() || !entry.name.toLowerCase().endsWith('.pdf')) {
                        continue;
                    }
                } catch {
                    continue;
                }
                const rel = toPosix(path.relative(rootNorm, full));
                if (rel && !rel.startsWith('..')) {
                    results.push(rel);
                }
                continue;
            }

            if (lstat.isDirectory()) {
                if (PRUNE_DIR_NAMES.has(entry.name)) {
                    continue;
                }
                await walk(full);
                continue;
            }

            if (lstat.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
                const rel = toPosix(path.relative(rootNorm, full));
                if (rel && !rel.startsWith('..') && rel !== '') {
                    results.push(rel);
                }
            }
        }
    }

    // If start is itself a pruned name segment, still walk — prune applies to children named those dirs
    let startStat: fs.Stats;
    try {
        startStat = await fs.promises.lstat(startNorm);
    } catch {
        return [];
    }

    if (startStat.isSymbolicLink()) {
        try {
            const followed = await fs.promises.stat(startNorm);
            if (followed.isDirectory()) {
                // Do not follow directory symlinks as the scan root
                return [];
            }
            if (followed.isFile() && startNorm.toLowerCase().endsWith('.pdf')) {
                const rel = toPosix(path.relative(rootNorm, startNorm));
                if (rel && !rel.startsWith('..')) {
                    results.push(rel);
                }
            }
        } catch {
            return [];
        }
    } else if (startStat.isDirectory()) {
        await walk(startNorm);
    } else if (startStat.isFile() && startNorm.toLowerCase().endsWith('.pdf')) {
        const rel = toPosix(path.relative(rootNorm, startNorm));
        if (rel && !rel.startsWith('..')) {
            results.push(rel);
        }
    }

    results.sort(comparePosix);
    return results;
}
