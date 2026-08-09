/**
 * Clean-profile / real extension-host proof for inspectPdf.
 * Uses @vscode/test-electron against the unpacked packaged extension tree.
 */
const path = require('path');
const fs = require('fs');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(
        __dirname,
        '..',
        '..',
        '.vsix-spike-unpack',
        'extracted',
        'extension'
    );
    const extensionTestsPath = path.resolve(__dirname, 'vscode-host-suite');
    const evidenceOut = path.resolve(__dirname, 'vscode-host-evidence.json');

    if (!fs.existsSync(path.join(extensionDevelopmentPath, 'package.json'))) {
        console.error('Unpacked VSIX extension missing at', extensionDevelopmentPath);
        process.exit(1);
    }

    process.env.PDF_FORGE_SPIKE_OUT = evidenceOut;
    process.env.PDF_FORGE_SPIKE_FIXTURE = path.join(
        extensionDevelopmentPath,
        'test-fixtures',
        'normal.pdf'
    );

    await runTests({
        extensionDevelopmentPath,
        extensionTestsPath,
        launchArgs: ['--disable-extensions'],
    });

    if (!fs.existsSync(evidenceOut)) {
        console.error('No evidence file written at', evidenceOut);
        process.exit(1);
    }
    const evidence = JSON.parse(fs.readFileSync(evidenceOut, 'utf8'));
    console.log('VSCODE_HOST_EVIDENCE', JSON.stringify(evidence, null, 2));
    process.exit(evidence.verdict === 'PASS' ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
