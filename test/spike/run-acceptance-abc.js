/**
 * Packaged-host ABC gate: no-text, large-first, cancel — separate focused runs
 * against unpacked pdf-forge-1.0.9.vsix.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');

async function ensureUnpackedVsix() {
    const repo = path.resolve(__dirname, '..', '..');
    const vsix = path.join(repo, 'pdf-forge-1.0.9.vsix');
    if (!fs.existsSync(vsix)) throw new Error('Missing pdf-forge-1.0.9.vsix');
    const unpack = path.join(repo, '.vsix-acceptance-unpack');
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.mkdirSync(unpack, { recursive: true });
    const zip = path.join(unpack, 'pkg.zip');
    fs.copyFileSync(vsix, zip);
    execFileSync(
        'powershell.exe',
        [
            '-NoProfile',
            '-Command',
            `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${path.join(unpack, 'extracted')}' -Force`,
        ],
        { stdio: 'inherit' }
    );
    const ext = path.join(unpack, 'extracted', 'extension');
    if (!fs.existsSync(path.join(ext, 'package.json'))) {
        throw new Error('Unpack failed: ' + ext);
    }
    console.log('UNPACKED', ext);
    return ext;
}

function writeWs(tmp, folders, settings) {
    const ws = path.join(tmp, 'w.code-workspace');
    fs.writeFileSync(
        ws,
        JSON.stringify({ folders, settings: settings || { 'pdf-forge.autoCommit': false } }, null, 2)
    );
    return ws;
}

async function runSuite(extensionDevelopmentPath, suiteDir, prepare, outName) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-abc-'));
    const { workspaceFile } = prepare(tmp);
    const out = path.resolve(__dirname, outName);
    process.env.PDF_FORGE_ACCEPTANCE_OUT = out;
    fs.rmSync(out, { force: true });
    console.log('RUN_SUITE', suiteDir, '->', out);
    const t0 = Date.now();
    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath: path.resolve(__dirname, suiteDir),
            launchArgs: [workspaceFile, '--disable-extensions'],
        });
    } catch (e) {
        console.error('SUITE_ERROR', suiteDir, String(e && e.message ? e.message : e));
        if (!fs.existsSync(out)) {
            fs.writeFileSync(
                out,
                JSON.stringify({ verdict: 'FAIL', error: String(e && e.message ? e.message : e) }, null, 2)
            );
        }
    }
    console.log('SUITE_DONE', suiteDir, Date.now() - t0, 'ms');
    return JSON.parse(fs.readFileSync(out, 'utf8'));
}

async function main() {
    const only = process.env.PDF_FORGE_ABC_ONLY; // notext|large|cancel
    const { buildMultiPagePdf, ensureGeneratedFixtures } = require('../helpers/makePdf');
    ensureGeneratedFixtures();
    const fixtures = path.resolve(__dirname, '..', 'fixtures');
    fs.writeFileSync(path.join(fixtures, 'large-101.pdf'), buildMultiPagePdf(101));

    const extensionDevelopmentPath = await ensureUnpackedVsix();
    const results = {};

    if (!only || only === 'notext') {
        results.noText = await runSuite(
            extensionDevelopmentPath,
            'host-notext-suite',
            (tmp) => {
                const rootA = path.join(tmp, 'A');
                const rootB = path.join(tmp, 'B');
                fs.mkdirSync(path.join(rootA, 'notext'), { recursive: true });
                fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
                fs.copyFileSync(path.join(fixtures, 'no-text.pdf'), path.join(rootA, 'notext', 'empty.pdf'));
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootB, 'docs', 'same.pdf'));
                return {
                    workspaceFile: writeWs(tmp, [
                        { path: rootA, name: 'A' },
                        { path: rootB, name: 'B' },
                    ]),
                };
            },
            'host-notext-probe.json'
        );
        console.log('RESULT_NOTEXT', results.noText.verdict);
    }

    if (!only || only === 'large') {
        results.largeFirst = await runSuite(
            extensionDevelopmentPath,
            'host-large-suite',
            (tmp) => {
                const rootA = path.join(tmp, 'A');
                const rootB = path.join(tmp, 'B');
                fs.mkdirSync(path.join(rootA, 'largefirst'), { recursive: true });
                fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
                fs.copyFileSync(
                    path.join(fixtures, 'large-101.pdf'),
                    path.join(rootA, 'largefirst', 'a-large.pdf')
                );
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootA, 'largefirst', 'b-small.pdf'));
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootB, 'docs', 'x.pdf'));
                return {
                    workspaceFile: writeWs(tmp, [
                        { path: rootA, name: 'A' },
                        { path: rootB, name: 'B' },
                    ]),
                };
            },
            'host-large-probe.json'
        );
        console.log('RESULT_LARGE', results.largeFirst.verdict);
    }

    if (!only || only === 'cancel') {
        results.cancel = await runSuite(
            extensionDevelopmentPath,
            'host-cancel-suite',
            (tmp) => {
                const rootA = path.join(tmp, 'A');
                const rootB = path.join(tmp, 'B');
                fs.mkdirSync(path.join(rootA, 'cancel'), { recursive: true });
                fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootA, 'cancel', 'a.pdf'));
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootA, 'cancel', 'b.pdf'));
                fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootB, 'docs', 'x.pdf'));
                execFileSync('git', ['init'], { cwd: rootB });
                execFileSync('git', ['config', 'user.email', 't@example.com'], { cwd: rootB });
                execFileSync('git', ['config', 'user.name', 't'], { cwd: rootB });
                fs.mkdirSync(path.join(rootB, 'src'), { recursive: true });
                fs.writeFileSync(path.join(rootB, 'src', 'app.ts'), 'export {};\n');
                execFileSync('git', ['add', 'src/app.ts'], { cwd: rootB });
                return {
                    workspaceFile: writeWs(tmp, [
                        { path: rootA, name: 'A' },
                        { path: rootB, name: 'B' },
                    ]),
                };
            },
            'host-cancel-probe.json'
        );
        console.log('RESULT_CANCEL', results.cancel.verdict);
    }

    const summary = {
        host: 'vscode-extension-host-packaged-abc-split',
        extensionPath: extensionDevelopmentPath,
        results,
        verdict:
            results.noText?.verdict === 'PASS' &&
            results.largeFirst?.verdict === 'PASS' &&
            results.cancel?.verdict === 'PASS'
                ? 'PASS'
                : 'FAIL',
    };
    const out = path.resolve(__dirname, 'acceptance-abc-evidence.json');
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log('ABC_EVIDENCE', JSON.stringify(summary, null, 2));
    process.exit(summary.verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
