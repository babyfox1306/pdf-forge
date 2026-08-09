'use strict';

const assert = require('assert');
const { describe, it } = require('node:test');
const {
    toPosix,
    comparePosix,
    yamlQuote,
    markdownLink,
    relativeLinkFromIndex,
    stripControlChars,
} = require('../out/paths');

describe('paths', () => {
    it('toPosix normalizes backslashes', () => {
        assert.strictEqual(toPosix('a\\b\\c.pdf'), 'a/b/c.pdf');
        assert.strictEqual(toPosix('already/posix'), 'already/posix');
    });

    it('yamlQuote always double-quotes and escapes', () => {
        assert.strictEqual(yamlQuote('plain'), '"plain"');
        assert.strictEqual(yamlQuote('say "hi"'), '"say \\"hi\\""');
        assert.strictEqual(yamlQuote('a\\b'), '"a\\\\b"');
        assert.strictEqual(yamlQuote('line\nbreak'), '"line\\nbreak"');
        // Title / source path requiring YAML escaping
        const tricky = 'docs/My "Special" File#1.pdf';
        const quoted = yamlQuote(tricky);
        assert.ok(quoted.startsWith('"') && quoted.endsWith('"'));
        assert.ok(quoted.includes('\\"'));
        assert.ok(!quoted.includes('\u0000'));
    });

    it('stripControlChars removes C0/C1', () => {
        assert.strictEqual(stripControlChars('a\u0001b\u007Fc'), 'abc');
    });

    it('comparePosix is locale-independent / deterministic', () => {
        const items = ['z/a.pdf', 'B/b.pdf', 'a/c.pdf', 'a/A.pdf'];
        const sorted = [...items].sort(comparePosix);
        // Code-point order: uppercase before lowercase in ASCII
        assert.deepStrictEqual(sorted, [...items].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
        // Stable across repeated sorts
        assert.deepStrictEqual([...sorted].sort(comparePosix), sorted);
    });

    it('markdownLink handles spaces, parentheses, #, Unicode', () => {
        const withSpace = markdownLink('my file', 'docs/my file.pdf');
        assert.ok(withSpace.includes('%20') || withSpace.includes('my%20file'));
        assert.match(withSpace, /^\[my file\]\(/);

        const withParen = markdownLink('label', 'docs/file(1).pdf');
        assert.ok(withParen.includes('%28') && withParen.includes('%29'));

        const withHash = markdownLink('doc', 'docs/doc#1.pdf');
        // encodeURI keeps # — link still formed
        assert.match(withHash, /^\[doc\]\(/);

        const withUnicode = markdownLink('日本語', 'docs/日本語.pdf');
        assert.ok(withUnicode.startsWith('[日本語]('));
        assert.ok(withUnicode.includes('%'));
    });

    it('relativeLinkFromIndex prefixes sources with ../', () => {
        assert.strictEqual(relativeLinkFromIndex('docs/a.pdf', 'source'), '../docs/a.pdf');
        assert.strictEqual(relativeLinkFromIndex('docs/a/document.md', 'output'), 'docs/a/document.md');
    });
});
