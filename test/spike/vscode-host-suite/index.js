const path = require('path');
const fs = require('fs');

async function run() {
    const vscode = require('vscode');
    // Activate by executing the packaged command
    const evidence = await vscode.commands.executeCommand('pdf-forge.inspectHostSpike');
    const out =
        process.env.PDF_FORGE_SPIKE_OUT ||
        path.join(__dirname, 'vscode-host-evidence.json');
    // Command also writes evidence; ensure local copy
    if (evidence) {
        fs.writeFileSync(out, JSON.stringify(evidence, null, 2), 'utf8');
    }
    if (!evidence || evidence.verdict !== 'PASS') {
        console.error('Host spike failed', evidence);
        throw new Error('inspectHostSpike verdict is not PASS');
    }
}

module.exports = { run };
