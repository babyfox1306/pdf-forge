/**
 * Install a Module._load hook so `require('vscode')` returns our mock,
 * then load compiled batch modules with a clean cache.
 */
'use strict';

const Module = require('module');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'out');

const VSCODE_DEPENDENT = [
    'batchOrchestrator.js',
    'workspaceContext.js',
    'quota.js',
    'gitIntegration.js',
    'exportManager.js',
    'config.js',
    'extension.js',
    'notesManager.js',
    'safeWrite.js',
    'log.js',
    'guideCta.js',
    'manifest.js',
].map((f) => path.join(OUT, f));

let hookInstalled = false;
let currentMock = null;
const originalLoad = Module._load;

function installVscodeMock(mock) {
    currentMock = mock;
    if (hookInstalled) {
        return;
    }
    hookInstalled = true;
    Module._load = function (request, parent, isMain) {
        if (request === 'vscode') {
            return currentMock;
        }
        return originalLoad.apply(this, arguments);
    };
}

function clearOutCache() {
    for (const file of VSCODE_DEPENDENT) {
        try {
            delete require.cache[require.resolve(file)];
        } catch {
            // not loaded yet
        }
    }
}

/**
 * @param {ReturnType<typeof import('./mockVscode').createMockVscode>} mock
 */
function loadBatchOrchestrator(mock) {
    installVscodeMock(mock);
    clearOutCache();
    return require(path.join(OUT, 'batchOrchestrator.js'));
}

function loadGitIntegration(mock) {
    installVscodeMock(mock);
    clearOutCache();
    return require(path.join(OUT, 'gitIntegration.js'));
}

function loadWorkspaceContext(mock) {
    installVscodeMock(mock);
    clearOutCache();
    return require(path.join(OUT, 'workspaceContext.js'));
}

/**
 * Load ExportManager with optional GitIntegration construction tracking.
 * @param {ReturnType<typeof import('./mockVscode').createMockVscode>} mock
 * @param {{ gitConstructions?: string[] }} [opts]
 */
function loadExportManager(mock, opts = {}) {
    installVscodeMock(mock);
    clearOutCache();

    const gitConstructions = opts.gitConstructions || [];
    const gitPath = path.join(OUT, 'gitIntegration.js');
    const realGit = require(gitPath);
    class TrackingGitIntegration extends realGit.GitIntegration {
        constructor(workspacePath) {
            gitConstructions.push(workspacePath);
            super(workspacePath);
        }
    }
    require.cache[require.resolve(gitPath)].exports = {
        GitIntegration: TrackingGitIntegration,
    };

    const mod = require(path.join(OUT, 'exportManager.js'));
    return { ...mod, __gitConstructions: gitConstructions };
}

module.exports = {
    installVscodeMock,
    clearOutCache,
    loadBatchOrchestrator,
    loadGitIntegration,
    loadWorkspaceContext,
    loadExportManager,
    OUT,
};
