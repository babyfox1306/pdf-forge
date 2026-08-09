/**
 * Run one packaged-host suite against already-unpacked VSIX (no re-unpack).
 * Usage: node test/spike/run-one-packaged.js notext|large|cancel
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { runTests } = require('@vscode/test-electron');

const kind = process.argv[2];
if (!['notext', 'large', 'cancel'].includes(kind)) {
    console.error('usage: node test/spike/run-one-packaged.js notext|large|cancel');
    process.exit(2);
}

const repo = path.resolve(__dirname, '..', '..');
const ext =
    process.env.PDF_FORGE_EXT_PATH ||
    path.join(repo, '.vsix-acceptance-unpack', 'extracted', 'extension');
if (!fs.existsSync(path.join(ext, 'package.json'))) {
    throw new Error('Missing unpacked extension at ' + ext);
}

const fixtures = path.join(repo, 'test', 'fixtures');
const outMap = {
    notext: 'host-notext-probe.json',
    large: 'host-large-probe.json',
    cancel: 'host-cancel-probe.json',
};
const suiteMap = {
    notext: 'host-notext-suite',
    large: 'host-large-suite',
    cancel: 'host-cancel-suite',
};

function writeWs(tmp, folders) {
    const ws = path.join(tmp, 'w.code-workspace');
    fs.writeFileSync(
        ws,
        JSON.stringify({
            folders,
            settings: { 'pdf-forge.autoCommit': false },
        })
    );
    return ws;
}

async function prepare(tmp) {
    const rootA = path.join(tmp, 'A');
    const rootB = path.join(tmp, 'B');
    if (kind === 'notext') {
        fs.mkdirSync(path.join(rootA, 'notext'), { recursive: true });
        fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
        fs.copyFileSync(path.join(fixtures, 'no-text.pdf'), path.join(rootA, 'notext', 'empty.pdf'));
        fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootB, 'docs', 'same.pdf'));
    } else if (kind === 'large') {
        const { buildMultiPagePdf } = require('../helpers/makePdf');
        fs.writeFileSync(path.join(fixtures, 'large-101.pdf'), buildMultiPagePdf(101));
        fs.mkdirSync(path.join(rootA, 'largefirst'), { recursive: true });
        fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
        fs.copyFileSync(path.join(fixtures, 'large-101.pdf'), path.join(rootA, 'largefirst', 'a-large.pdf'));
        fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootA, 'largefirst', 'b-small.pdf'));
        fs.copyFileSync(path.join(fixtures, 'normal.pdf'), path.join(rootB, 'docs', 'x.pdf'));
    } else {
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
    }
    return writeWs(tmp, [
        { path: rootA, name: 'A' },
        { path: rootB, name: 'B' },
    ]);
}

(async () => {
    const out = path.join(__dirname, outMap[kind]);
    process.env.PDF_FORGE_ACCEPTANCE_OUT = out;
    fs.rmSync(out, { force: true });
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-one-'));
    const workspaceFile = await prepare(tmp);
    console.log('START', kind, 'ext=', ext);
    const t0 = Date.now();
    await runTests({
        extensionDevelopmentPath: ext,
        extensionTestsPath: path.join(__dirname, suiteMap[kind]),
        launchArgs: [workspaceFile, '--disable-extensions'],
    });
    console.log('DONE', kind, Date.now() - t0, 'ms');
    const ev = JSON.parse(fs.readFileSync(out, 'utf8'));
    console.log('VERDICT', ev.verdict);
    process.exit(ev.verdict === 'PASS' ? 0 : 1);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
