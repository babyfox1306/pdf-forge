import type * as vscode from 'vscode';
import {
    MONTHLY_PAGE_THRESHOLD,
    type BatchUsage,
    type GuideState,
} from './types';

export const BATCH_USAGE_KEY = 'pdf-forge.batchUsage';
export const GUIDE_STATE_KEY = 'pdf-forge.guideState';

/** Local timezone YYYY-MM period key. */
export function getCurrentPeriodKey(date: Date = new Date()): string {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    return `${y}-${String(m).padStart(2, '0')}`;
}

export function loadBatchUsage(context: vscode.ExtensionContext): BatchUsage {
    const raw = context.globalState.get<BatchUsage>(BATCH_USAGE_KEY);
    if (
        raw &&
        typeof raw.periodKey === 'string' &&
        typeof raw.pagesUsed === 'number' &&
        Number.isFinite(raw.pagesUsed)
    ) {
        return { periodKey: raw.periodKey, pagesUsed: Math.max(0, Math.floor(raw.pagesUsed)) };
    }
    return { periodKey: getCurrentPeriodKey(), pagesUsed: 0 };
}

export async function saveBatchUsage(
    context: vscode.ExtensionContext,
    usage: BatchUsage
): Promise<void> {
    await context.globalState.update(BATCH_USAGE_KEY, {
        periodKey: usage.periodKey,
        pagesUsed: usage.pagesUsed,
    });
}

/** Reset pagesUsed when period changes; keep only aggregate reset. */
export function ensurePeriod(usage: BatchUsage, periodKey: string = getCurrentPeriodKey()): BatchUsage {
    if (usage.periodKey !== periodKey) {
        return { periodKey, pagesUsed: 0 };
    }
    return usage;
}

export function canChargeNewRevision(pagesUsed: number): boolean {
    return pagesUsed < MONTHLY_PAGE_THRESHOLD;
}

/**
 * Charge pages after a successful write. May push pagesUsed above the threshold.
 */
export async function chargePages(
    context: vscode.ExtensionContext,
    pages: number
): Promise<BatchUsage> {
    if (!Number.isFinite(pages) || pages < 1) {
        throw new Error('Cannot charge without a finite positive page count');
    }
    let usage = ensurePeriod(loadBatchUsage(context));
    usage = {
        periodKey: usage.periodKey,
        pagesUsed: usage.pagesUsed + Math.floor(pages),
    };
    await saveBatchUsage(context, usage);
    return usage;
}

export function loadGuideState(context: vscode.ExtensionContext): GuideState {
    const raw = context.globalState.get<GuideState>(GUIDE_STATE_KEY);
    if (raw && typeof raw.opened === 'boolean') {
        return {
            opened: raw.opened,
            lastPromptPeriod:
                typeof raw.lastPromptPeriod === 'string' ? raw.lastPromptPeriod : undefined,
        };
    }
    return { opened: false };
}

export async function saveGuideState(
    context: vscode.ExtensionContext,
    state: GuideState
): Promise<void> {
    await context.globalState.update(GUIDE_STATE_KEY, {
        opened: state.opened,
        lastPromptPeriod: state.lastPromptPeriod,
    });
}
