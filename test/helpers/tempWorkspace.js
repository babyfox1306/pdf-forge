/**
 * Temp workspace helpers for batch / discovery / git tests.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSimplePdf, buildTextPdfWithChars, FIXTURES } = require('./makePdf');

async function makeTempDir(prefix = 'pdf-forge-test-') {
    return fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writePdf(absPath, bufferOrOpts) {
    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    let buf;
    if (Buffer.isBuffer(bufferOrOpts)) {
        buf = bufferOrOpts;
    } else if (bufferOrOpts && bufferOrOpts.fixture) {
        buf = await fs.promises.readFile(path.join(FIXTURES, bufferOrOpts.fixture));
    } else {
        // Prefer real text-bearing fixture — synthetic Helvetica streams often
        // yield 0 extractable chars under pdf-parse's bundled pdf.js.
        buf = await fs.promises.readFile(path.join(FIXTURES, 'normal.pdf'));
    }
    await fs.promises.writeFile(absPath, buf);
    return absPath;
}

async function copyFixture(name, dest) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.copyFile(path.join(FIXTURES, name), dest);
}

async function rimraf(dir) {
    await fs.promises.rm(dir, { recursive: true, force: true });
}

module.exports = {
    makeTempDir,
    writePdf,
    copyFixture,
    rimraf,
    buildSimplePdf,
    buildTextPdfWithChars,
    FIXTURES,
};
