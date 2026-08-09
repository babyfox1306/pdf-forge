import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { WorkspaceContext } from './types';
import { toPosix } from './paths';

const EXPORTS_DIR = 'pdf-forge-exports';

/**
 * Resolve owning workspace root, output root, and POSIX source-relative path.
 * Never puts absolute paths into relative fields.
 */
export function resolveWorkspaceContext(
    sourceOrFolderUri: vscode.Uri,
    _lastOutputRootUri?: vscode.Uri
): WorkspaceContext {
    const folder = vscode.workspace.getWorkspaceFolder(sourceOrFolderUri);

    if (folder) {
        const workspaceRootUri = folder.uri;
        const outputRootUri = vscode.Uri.joinPath(workspaceRootUri, EXPORTS_DIR);
        const rel = path.relative(workspaceRootUri.fsPath, sourceOrFolderUri.fsPath);
        const sourceRelativePath = toPosix(rel === '' ? '.' : rel);
        return {
            owningWorkspaceFolder: { name: folder.name, uri: folder.uri },
            workspaceRootUri,
            outputRootUri,
            sourceRelativePath,
            compatibilityMode: false,
        };
    }

    // Outside workspace: compatibility mode for single-file commands
    const isFile = !sourceOrFolderUri.fsPath.endsWith(path.sep);
    const parentDir = path.dirname(sourceOrFolderUri.fsPath);
    const firstRoot = vscode.workspace.workspaceFolders?.[0];

    // Prefer dirname of the file as the synthetic root for output placement
    const workspaceRootUri = vscode.Uri.file(isFile ? parentDir : sourceOrFolderUri.fsPath);
    const outputRootUri = vscode.Uri.joinPath(workspaceRootUri, EXPORTS_DIR);
    const sourceRelativePath = toPosix(path.basename(sourceOrFolderUri.fsPath));

    return {
        owningWorkspaceFolder: firstRoot
            ? { name: firstRoot.name, uri: firstRoot.uri }
            : undefined,
        workspaceRootUri,
        outputRootUri,
        sourceRelativePath,
        compatibilityMode: true,
    };
}

/** Lazily create the output root directory. */
export async function ensureOutputRoot(outputRootUri: vscode.Uri): Promise<void> {
    await fs.promises.mkdir(outputRootUri.fsPath, { recursive: true });
}

/**
 * Resolve which export folder to open: last output root, or ask if multi-root.
 */
export async function resolveOpenExportFolder(
    lastOutputRootUri?: vscode.Uri
): Promise<vscode.Uri | undefined> {
    if (lastOutputRootUri) {
        return lastOutputRootUri;
    }

    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return undefined;
    }

    if (folders.length === 1) {
        return vscode.Uri.joinPath(folders[0].uri, EXPORTS_DIR);
    }

    const pick = await vscode.window.showQuickPick(
        folders.map((f) => ({
            label: f.name,
            description: f.uri.fsPath,
            folder: f,
        })),
        { placeHolder: 'Select workspace folder whose pdf-forge-exports to open' }
    );

    if (!pick) {
        return undefined;
    }
    return vscode.Uri.joinPath(pick.folder.uri, EXPORTS_DIR);
}
