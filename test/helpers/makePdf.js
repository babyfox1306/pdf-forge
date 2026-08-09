/**
 * Minimal PDF builders for automated fixtures (no external deps).
 * Structure mirrors common pdf-parse-friendly files (binary comment + classic IDs).
 */
'use strict';

const fs = require('fs');
const path = require('path');

function escapePdfLiteral(text) {
    return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * @param {{ text?: string, pages?: number, title?: string }} opts
 * @returns {Buffer}
 */
function buildSimplePdf(opts = {}) {
    const pageCount = Math.max(1, opts.pages || 1);
    const text = opts.text != null ? String(opts.text) : 'Hello PDF Forge';
    const title = opts.title ? String(opts.title) : '';

    // Classic layout:
    // 1 Catalog, 2 Pages, 3.. Page objects, then Contents, Font, optional Info
    const objs = {};

    const pageIds = [];
    const contentIds = [];
    let nextId = 3;

    for (let i = 0; i < pageCount; i++) {
        const pageId = nextId++;
        const contentId = nextId++;
        pageIds.push(pageId);
        contentIds.push(contentId);

        const pageLabel = pageCount > 1 ? ` p${i + 1}` : '';
        const streamText = text
            ? `BT /F1 12 Tf 72 720 Td (${escapePdfLiteral(text + pageLabel)}) Tj ET`
            : '';
        const len = Buffer.byteLength(streamText, 'latin1');
        objs[contentId] = streamText
            ? `<< /Length ${len} >>\nstream\n${streamText}\nendstream`
            : `<< /Length 0 >>\nstream\nendstream`;
    }

    const fontId = nextId++;
    objs[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

    for (let i = 0; i < pageCount; i++) {
        const pageId = pageIds[i];
        const contentId = contentIds[i];
        objs[pageId] =
            `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
            `/Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    }

    objs[2] =
        `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';

    let infoId = null;
    if (title) {
        infoId = nextId++;
        objs[infoId] = `<< /Title (${escapePdfLiteral(title)}) >>`;
    }

    // Binary comment required by many parsers after header
    let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = { 0: 0 };

    for (let id = 1; id < nextId; id++) {
        offsets[id] = Buffer.byteLength(body, 'latin1');
        body += `${id} 0 obj\n${objs[id]}\nendobj\n`;
    }

    const xrefStart = Buffer.byteLength(body, 'latin1');
    body += `xref\n0 ${nextId}\n`;
    body += '0000000000 65535 f \n';
    for (let id = 1; id < nextId; id++) {
        body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    }

    const trailer = [`/Size ${nextId}`, '/Root 1 0 R'];
    if (infoId) {
        trailer.push(`/Info ${infoId} 0 R`);
    }
    body += `trailer\n<< ${trailer.join(' ')} >>\n`;
    body += `startxref\n${xrefStart}\n%%EOF\n`;

    return Buffer.from(body, 'latin1');
}

function buildNoTextPdf() {
    // Image-only white PDF (ImageMagick-origin) — pdf-parse on Electron rejects
    // empty/short buildSimplePdf streams with bad XRef / pages dictionary.
    // Extractable text normalizes to 0 chars → no_text.
    const { NO_TEXT_IMAGE_PDF_B64 } = require('./noTextPdfB64');
    return Buffer.from(NO_TEXT_IMAGE_PDF_B64, 'base64');
}

/**
 * @param {number} pageCount
 * @returns {Buffer}
 */
function buildMultiPagePdf(pageCount) {
    return buildSimplePdf({
        pages: Math.max(1, pageCount | 0),
        text: 'Multi page fixture content for PDF Forge tests with enough characters.',
    });
}


function buildTextPdfWithChars(n, pages = 1) {
    return buildSimplePdf({ text: 'x'.repeat(Math.max(0, n)), pages });
}

function buildEncryptedPdfStub() {
    let body = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offsets = { 0: 0 };

    function add(id, obj) {
        offsets[id] = Buffer.byteLength(body, 'latin1');
        body += `${id} 0 obj\n${obj}\nendobj\n`;
    }

    add(1, '<< /Type /Catalog /Pages 2 0 R >>');
    add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    add(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>');
    add(
        4,
        '<< /Filter /Standard /V 1 /R 2 /O <00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff> /U <00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff> /P -4 /Length 40 >>'
    );

    const xrefStart = Buffer.byteLength(body, 'latin1');
    body += 'xref\n0 5\n';
    body += '0000000000 65535 f \n';
    for (let i = 1; i <= 4; i++) {
        body += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    }
    body += 'trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R >>\n';
    body += `startxref\n${xrefStart}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
}

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function ensureGeneratedFixtures() {
    fs.mkdirSync(FIXTURES, { recursive: true });

    fs.writeFileSync(path.join(FIXTURES, 'no-text.pdf'), buildNoTextPdf());
    fs.writeFileSync(path.join(FIXTURES, 'nine-chars.pdf'), buildTextPdfWithChars(9));
    fs.writeFileSync(path.join(FIXTURES, 'ten-chars.pdf'), buildTextPdfWithChars(10));
    fs.writeFileSync(path.join(FIXTURES, 'low-text.pdf'), buildTextPdfWithChars(25));
    fs.writeFileSync(path.join(FIXTURES, 'converted-min.pdf'), buildTextPdfWithChars(60));
    fs.writeFileSync(
        path.join(FIXTURES, 'yaml-title.pdf'),
        buildSimplePdf({
            text: 'Body text for yaml fixture document content here enough chars.',
            title: 'Title: "Quotes" \\ Slash',
        })
    );
    fs.writeFileSync(path.join(FIXTURES, 'encrypted.pdf'), buildEncryptedPdfStub());

    const trees = path.join(FIXTURES, 'trees');
    const normalSrc = path.join(FIXTURES, 'normal.pdf');
    const payload = fs.existsSync(normalSrc)
        ? fs.readFileSync(normalSrc)
        : buildSimplePdf({ text: 'Shared basename content for discovery tests enough.' });

    for (const rel of [
        'folder-a/report.pdf',
        'folder-b/report.pdf',
        'pruned/keep/visible.pdf',
        'pruned/pdf-forge-exports/nested/hidden.pdf',
        'pruned/node_modules/pkg/hidden.pdf',
        'pruned/.git/objects/hidden.pdf',
    ]) {
        const dest = path.join(trees, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, payload);
    }

    const escapeDir = path.join(trees, 'yaml path (test)');
    fs.mkdirSync(escapeDir, { recursive: true });
    fs.writeFileSync(
        path.join(escapeDir, 'doc#1.pdf'),
        buildSimplePdf({ text: 'YAML path escaping fixture with enough characters here.' })
    );
}

module.exports = {
    buildSimplePdf,
    buildMultiPagePdf,
    buildNoTextPdf,
    buildTextPdfWithChars,
    buildEncryptedPdfStub,
    ensureGeneratedFixtures,
    FIXTURES,
};
