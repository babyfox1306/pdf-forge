'use strict';

const assert = require('assert');
const { describe, it, before } = require('node:test');
const { createMockVscode } = require('./helpers/mockVscode');
const { installVscodeMock, clearOutCache } = require('./helpers/loadWithMockVscode');

describe('quotaLogic', () => {
    let canChargeNewRevision;
    let ensurePeriod;
    let getCurrentPeriodKey;
    let loadBatchUsage;
    let chargePages;
    let BATCH_USAGE_KEY;
    let MONTHLY_PAGE_THRESHOLD;
    let mock;
    let context;

    before(() => {
        mock = createMockVscode({});
        installVscodeMock(mock);
        clearOutCache();
        const quota = require('../out/quota');
        const types = require('../out/types');
        canChargeNewRevision = quota.canChargeNewRevision;
        ensurePeriod = quota.ensurePeriod;
        getCurrentPeriodKey = quota.getCurrentPeriodKey;
        loadBatchUsage = quota.loadBatchUsage;
        chargePages = quota.chargePages;
        BATCH_USAGE_KEY = quota.BATCH_USAGE_KEY;
        MONTHLY_PAGE_THRESHOLD = types.MONTHLY_PAGE_THRESHOLD;
        context = mock.__createContext();
    });

    it('threshold is 100; soft crossing allows charge when under 100', () => {
        assert.strictEqual(MONTHLY_PAGE_THRESHOLD, 100);
        assert.strictEqual(canChargeNewRevision(0), true);
        assert.strictEqual(canChargeNewRevision(99), true);
        // Soft: already at/above 100 blocks a new chargeable revision
        assert.strictEqual(canChargeNewRevision(100), false);
        assert.strictEqual(canChargeNewRevision(150), false);
    });

    it('pagesUsed already above 100 blocks new revision', () => {
        assert.strictEqual(canChargeNewRevision(101), false);
        assert.strictEqual(canChargeNewRevision(500), false);
    });

    it('monthly reset changes aggregate usage only via ensurePeriod', () => {
        const usage = { periodKey: '2020-01', pagesUsed: 87 };
        const next = ensurePeriod(usage, '2026-08');
        assert.deepStrictEqual(next, { periodKey: '2026-08', pagesUsed: 0 });
        // Same period keeps pagesUsed
        assert.deepStrictEqual(ensurePeriod(usage, '2020-01'), usage);
    });

    it('getCurrentPeriodKey is YYYY-MM local', () => {
        const key = getCurrentPeriodKey(new Date(2026, 7, 8)); // Aug = month 7
        assert.strictEqual(key, '2026-08');
    });

    it('chargePages can push pagesUsed above threshold (soft threshold)', async () => {
        const ctx = mock.__createContext();
        await ctx.globalState.update(BATCH_USAGE_KEY, {
            periodKey: getCurrentPeriodKey(),
            pagesUsed: 90,
        });
        const after = await chargePages(ctx, 20);
        assert.strictEqual(after.pagesUsed, 110);
        assert.strictEqual(canChargeNewRevision(after.pagesUsed), false);
        // Unchanged / free-regeneration decisions remain allowed by policy outside chargePages
        assert.ok(loadBatchUsage(ctx).pagesUsed >= 100);
    });
});
