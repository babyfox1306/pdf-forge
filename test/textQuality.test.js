'use strict';

const assert = require('assert');
const { describe, it } = require('node:test');
const {
    normalizeTextChars,
    classifyTextQuality,
    NO_TEXT_THRESHOLD,
    LOW_TEXT_FLOOR,
    LOW_TEXT_PER_PAGE,
} = require('../out/textQuality');

describe('textQuality', () => {
    it('normalizeTextChars strips all whitespace', () => {
        assert.strictEqual(normalizeTextChars('a b\tc\n d'), 4);
        assert.strictEqual(normalizeTextChars('   '), 0);
        assert.strictEqual(normalizeTextChars(''), 0);
    });

    it('no_text boundary: 9 chars → no_text, 10 → not no_text', () => {
        assert.strictEqual(NO_TEXT_THRESHOLD, 10);
        assert.strictEqual(classifyTextQuality(9, 1), 'no_text');
        assert.strictEqual(classifyTextQuality(0, 100), 'no_text');
        assert.notStrictEqual(classifyTextQuality(10, 1), 'no_text');
    });

    it('low_text lower boundary at 10', () => {
        assert.strictEqual(classifyTextQuality(10, 1), 'low_text');
    });

    it('low_text / converted boundary at max(50, pageCount * 40)', () => {
        assert.strictEqual(LOW_TEXT_FLOOR, 50);
        assert.strictEqual(LOW_TEXT_PER_PAGE, 40);

        // 1 page → ceiling = max(50, 40) = 50
        assert.strictEqual(Math.max(50, 1 * 40), 50);
        assert.strictEqual(classifyTextQuality(49, 1), 'low_text');
        assert.strictEqual(classifyTextQuality(50, 1), 'converted');

        // 2 pages → ceiling = max(50, 80) = 80
        assert.strictEqual(classifyTextQuality(79, 2), 'low_text');
        assert.strictEqual(classifyTextQuality(80, 2), 'converted');

        // 10 pages → ceiling = max(50, 400) = 400
        assert.strictEqual(classifyTextQuality(399, 10), 'low_text');
        assert.strictEqual(classifyTextQuality(400, 10), 'converted');
    });
});
