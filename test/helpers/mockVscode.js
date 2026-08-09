/**
 * Minimal VS Code API mock for Node unit/integration tests.
 */
'use strict';

const path = require('path');

function createUri(fsPath) {
    const normalized = path.resolve(fsPath);
    const uri = {
        fsPath: normalized,
        scheme: 'file',
        path: normalized.replace(/\\/g, '/'),
        toString() {
            return `file:///${this.path.replace(/^\/+/, '')}`;
        },
    };
    return uri;
}

function createMockVscode(options = {}) {
    const workspaceFolders = (options.workspaceFolders || []).map((folderPath, i) => {
        const uri = createUri(folderPath);
        return {
            name: options.folderNames?.[i] || path.basename(folderPath) || `root${i}`,
            uri,
            index: i,
        };
    });

    const initialGlobalState = options.globalState || {};

    const gitCalls = [];
    const messages = [];
    let autoCommit = options.autoCommit === true;

    const vscode = {
        Uri: {
            file: (p) => createUri(p),
            parse: (s) => {
                const str = String(s);
                if (/^https?:\/\//i.test(str)) {
                    return {
                        fsPath: str,
                        scheme: str.startsWith('https') ? 'https' : 'http',
                        path: str,
                        toString() {
                            return str;
                        },
                    };
                }
                return createUri(str.replace(/^file:\/\//, ''));
            },
            joinPath: (base, ...parts) =>
                createUri(path.join(base.fsPath, ...parts)),
        },
        workspace: {
            workspaceFolders,
            getWorkspaceFolder(uri) {
                const target = path.resolve(uri.fsPath);
                for (const folder of workspaceFolders) {
                    const root = path.resolve(folder.uri.fsPath);
                    if (target === root || target.startsWith(root + path.sep)) {
                        return folder;
                    }
                }
                return undefined;
            },
            getConfiguration(_section) {
                return {
                    get(key, defaultValue) {
                        if (key === 'autoCommit') {
                            return autoCommit;
                        }
                        return defaultValue;
                    },
                };
            },
            fs: {
                async readFile(uri) {
                    const fs = require('fs');
                    return new Uint8Array(fs.readFileSync(uri.fsPath));
                },
            },
        },
        window: {
            async showInformationMessage(message, ...items) {
                messages.push({ type: 'info', message, items });
                if (typeof options.onInfo === 'function') {
                    return options.onInfo(message, items);
                }
                return undefined;
            },
            async showWarningMessage(message, ...items) {
                messages.push({ type: 'warn', message, items });
                if (typeof options.onWarn === 'function') {
                    return options.onWarn(message, items);
                }
                return undefined;
            },
            async showErrorMessage(message) {
                messages.push({ type: 'error', message });
            },
            async showQuickPick() {
                return undefined;
            },
        },
        env: {
            async openExternal(uri) {
                if (typeof options.openExternal === 'function') {
                    return options.openExternal(uri);
                }
                return true;
            },
        },
        ProgressLocation: { Notification: 15 },
        // helpers for tests
        __messages: messages,
        __gitCalls: gitCalls,
        __setAutoCommit(v) {
            autoCommit = !!v;
        },
        __createContext() {
            const store = new Map();
            for (const [k, v] of Object.entries(initialGlobalState)) {
                store.set(k, v);
            }
            const wsStore = new Map();
            const storageRoot = path.join(
                require('os').tmpdir(),
                'pdf-forge-mock-storage'
            );
            return {
                globalState: {
                    get(key) {
                        return store.has(key) ? store.get(key) : undefined;
                    },
                    async update(key, value) {
                        if (value === undefined) {
                            store.delete(key);
                        } else {
                            store.set(key, value);
                        }
                    },
                },
                workspaceState: {
                    get(key, defaultValue) {
                        return wsStore.has(key) ? wsStore.get(key) : defaultValue;
                    },
                    async update(key, value) {
                        if (value === undefined) {
                            wsStore.delete(key);
                        } else {
                            wsStore.set(key, value);
                        }
                    },
                },
                globalStorageUri: createUri(storageRoot),
                subscriptions: [],
                extensionPath: options.extensionPath || process.cwd(),
            };
        },
        __setWorkspaceFolders(paths) {
            workspaceFolders.length = 0;
            for (let i = 0; i < paths.length; i++) {
                const uri = createUri(paths[i]);
                workspaceFolders.push({
                    name: path.basename(paths[i]) || `root${i}`,
                    uri,
                    index: i,
                });
            }
        },
    };

    return vscode;
}

module.exports = { createMockVscode, createUri };
