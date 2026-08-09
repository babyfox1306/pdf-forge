'use strict';

const assert = require('assert');
const { describe, it } = require('node:test');
const {
    shouldShowGuide,
    pickGuideUrl,
    GUIDE_URL_STANDARD,
    GUIDE_URL_LARGE,
} = require('../out/guideCta');
const { CORPUS_BUCKET_THRESHOLD, MONTHLY_PAGE_THRESHOLD } = require('../out/types');

function base(overrides = {}) {
    return {
        discoveredPdfCount: 2,
        pagesBefore: 50,
        pagesAfter: 120,
        newConvertedCount: 1,
        skippedLimitCount: 0,
        guideState: { opened: false },
        currentPeriod: '2026-08',
        ...overrides,
    };
}

describe('guideCta', () => {
    it('truth table: show when collection + crossed + not opened + not dismissed this period', () => {
        assert.strictEqual(shouldShowGuide(base()), true);
    });

    it('truth table: show when skippedLimitCount > 0 even without soft cross in same shape', () => {
        assert.strictEqual(
            shouldShowGuide(
                base({
                    pagesBefore: 100,
                    pagesAfter: 100,
                    newConvertedCount: 0,
                    skippedLimitCount: 2,
                })
            ),
            true
        );
    });

    it('one-file folder (>100 pages corpus) never shows guide', () => {
        assert.strictEqual(
            shouldShowGuide(base({ discoveredPdfCount: 1, pagesAfter: 500 })),
            false
        );
    });

    it('dismiss this period (lastPromptPeriod) suppresses guide', () => {
        assert.strictEqual(
            shouldShowGuide(
                base({
                    guideState: { opened: false, lastPromptPeriod: '2026-08' },
                })
            ),
            false
        );
    });

    it('opened permanent suppresses guide forever', () => {
        assert.strictEqual(
            shouldShowGuide(base({ guideState: { opened: true } })),
            false
        );
        assert.strictEqual(
            shouldShowGuide(
                base({
                    guideState: { opened: true, lastPromptPeriod: '2025-01' },
                    currentPeriod: '2026-08',
                })
            ),
            false
        );
    });

    it('no show when did not cross and no skips', () => {
        assert.strictEqual(
            shouldShowGuide(
                base({
                    pagesBefore: 10,
                    pagesAfter: 40,
                    newConvertedCount: 1,
                    skippedLimitCount: 0,
                })
            ),
            false
        );
    });

    it('cross without newConvertedCount does not count as crossedThisRun', () => {
        assert.strictEqual(
            shouldShowGuide(
                base({
                    pagesBefore: 90,
                    pagesAfter: 110,
                    newConvertedCount: 0,
                    skippedLimitCount: 0,
                })
            ),
            false
        );
    });

    it('pickGuideUrl buckets at CORPUS_BUCKET_THRESHOLD', () => {
        assert.strictEqual(CORPUS_BUCKET_THRESHOLD, 2000);
        assert.strictEqual(MONTHLY_PAGE_THRESHOLD, 100);
        assert.strictEqual(pickGuideUrl(2000), GUIDE_URL_STANDARD);
        assert.strictEqual(pickGuideUrl(2001), GUIDE_URL_LARGE);
        assert.strictEqual(pickGuideUrl(0), GUIDE_URL_STANDARD);
        // QA paths must not be used
        assert.ok(!GUIDE_URL_STANDARD.includes('/qa/'));
        assert.ok(!GUIDE_URL_LARGE.includes('/qa/'));
    });
});
