/**
 * Launch @vscode/test-electron against the packaged 1.0.9 VSIX (unpacked)
 * with a real multi-root workspace for acceptance smoke.
 */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { runTests } = require('@vscode/test-electron');

async function ensureUnpackedVsix() {
    const repo = path.resolve(__dirname, '..', '..');
    const vsix = path.join(repo, 'pdf-forge-1.0.9.vsix');
    if (!fs.existsSync(vsix)) {
        throw new Error('Missing pdf-forge-1.0.9.vsix — run npm run package first');
    }
    const unpack = path.join(repo, '.vsix-acceptance-unpack');
    fs.rmSync(unpack, { recursive: true, force: true });
    fs.mkdirSync(unpack, { recursive: true });
    const zip = path.join(unpack, 'pkg.zip');
    fs.copyFileSync(vsix, zip);
    const { execFileSync } = require('child_process');
    // Use PowerShell Expand-Archive on Windows
    if (process.platform === 'win32') {
        execFileSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-Command',
                `Expand-Archive -Path '${zip}' -DestinationPath '${path.join(unpack, 'extracted')}' -Force`,
            ],
            { stdio: 'inherit' }
        );
    } else {
        execFileSync('unzip', ['-o', zip, '-d', path.join(unpack, 'extracted')], {
            stdio: 'inherit',
        });
    }
    const extensionDevelopmentPath = path.join(unpack, 'extracted', 'extension');
    if (!fs.existsSync(path.join(extensionDevelopmentPath, 'package.json'))) {
        throw new Error('Unpacked extension missing package.json');
    }
    return extensionDevelopmentPath;
}

function prepareWorkspace() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-forge-ws-'));
    const rootA = path.join(tmp, 'A');
    const rootB = path.join(tmp, 'B');
    fs.mkdirSync(path.join(rootA, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(rootB, 'docs'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'mix'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'notext'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'largefirst'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'cancel'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'onefile'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'onefile500'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'conflict'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'legacy'), { recursive: true });
    fs.mkdirSync(path.join(rootA, 'threshold'), { recursive: true });

    const fixtures = path.resolve(__dirname, '..', 'fixtures');
    const normal = path.join(fixtures, 'normal.pdf');
    const corrupt = path.join(fixtures, 'corrupt.pdf');
    const noText = path.join(fixtures, 'no-text.pdf');
    const encrypted = path.join(fixtures, 'encrypted.pdf');
    const large101 = path.join(fixtures, 'large-101.pdf');

    fs.copyFileSync(normal, path.join(rootA, 'docs', 'same.pdf'));
    fs.copyFileSync(normal, path.join(rootB, 'docs', 'same.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'mix', 'ok.pdf'));
    fs.copyFileSync(corrupt, path.join(rootA, 'mix', 'bad.pdf'));
    if (fs.existsSync(encrypted)) {
        fs.copyFileSync(encrypted, path.join(rootA, 'mix', 'secret.pdf'));
    }
    // Dedicated no-text folder (isolated from corrupt-neighbor coexistence noise)
    fs.copyFileSync(noText, path.join(rootA, 'notext', 'empty.pdf'));
    // Large-first: a-*.pdf sorts before b-*.pdf under comparePosix
    fs.copyFileSync(large101, path.join(rootA, 'largefirst', 'a-large.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'largefirst', 'b-small.pdf'));
    // Cancel: two normals; host cancels when starting file 2
    fs.copyFileSync(normal, path.join(rootA, 'cancel', 'a.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'cancel', 'b.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'onefile', 'only.pdf'));
    // One-file >100 pages for guide gate (same as §17 one-file case)
    fs.copyFileSync(large101, path.join(rootA, 'onefile500', 'only.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'conflict', 'doc.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'legacy', 'Report.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'threshold', 't1.pdf'));
    fs.copyFileSync(normal, path.join(rootA, 'threshold', 't2.pdf'));

    // Git repo only in B with unrelated staged file
    const { execFileSync } = require('child_process');
    const git = (args) =>
        execFileSync('git', args, { cwd: rootB, encoding: 'utf8' });
    git(['init']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'PDF Forge Test']);
    fs.mkdirSync(path.join(rootB, 'src'), { recursive: true });
    fs.writeFileSync(path.join(rootB, 'src', 'app.ts'), 'export {};\n');
    git(['add', 'src/app.ts']);

    const workspaceFile = path.join(tmp, 'accept.code-workspace');
    fs.writeFileSync(
        workspaceFile,
        JSON.stringify(
            {
                folders: [
                    { path: rootA, name: 'A' },
                    { path: rootB, name: 'B' },
                ],
                settings: {
                    'pdf-forge.autoCommit': false,
                },
            },
            null,
            2
        )
    );

    return { tmp, rootA, rootB, workspaceFile, fixtures };
}

async function main() {
    const extensionDevelopmentPath = await ensureUnpackedVsix();
    const ws = prepareWorkspace();
    const evidenceOut = path.resolve(__dirname, 'acceptance-host-evidence.json');

    process.env.PDF_FORGE_ACCEPTANCE_OUT = evidenceOut;
    process.env.PDF_FORGE_ACCEPTANCE_ROOT_A = ws.rootA;
    process.env.PDF_FORGE_ACCEPTANCE_ROOT_B = ws.rootB;
    process.env.PDF_FORGE_ACCEPTANCE_FIXTURES = ws.fixtures;

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath: path.resolve(__dirname, 'acceptance-host-suite'),
        launchArgs: [ws.workspaceFile, '--disable-extensions'],
    });

    if (!fs.existsSync(evidenceOut)) {
        console.error('No acceptance evidence at', evidenceOut);
        process.exit(1);
    }
    const evidence = JSON.parse(fs.readFileSync(evidenceOut, 'utf8'));
    console.log('ACCEPTANCE_HOST_EVIDENCE', JSON.stringify(evidence, null, 2));
    process.exit(evidence.verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
