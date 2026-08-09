import { CORPUS_BUCKET_THRESHOLD, MONTHLY_PAGE_THRESHOLD, type GuideState } from './types';

export const GUIDE_URL_STANDARD =
    'https://babyfox1306.github.io/pdf-forge/limit/standard/';
export const GUIDE_URL_LARGE =
    'https://babyfox1306.github.io/pdf-forge/limit/large/';

export type GuideDecisionInput = {
    discoveredPdfCount: number;
    pagesBefore: number;
    pagesAfter: number;
    newConvertedCount: number;
    skippedLimitCount: number;
    guideState: GuideState;
    currentPeriod: string;
};

/**
 * Pure CTA decision for the batch guide.
 */
export function shouldShowGuide(input: GuideDecisionInput): boolean {
    const isCollection = input.discoveredPdfCount >= 2;
    const crossedThisRun =
        input.pagesBefore < MONTHLY_PAGE_THRESHOLD &&
        input.pagesAfter >= MONTHLY_PAGE_THRESHOLD &&
        input.newConvertedCount > 0;

    return (
        isCollection &&
        input.guideState.opened !== true &&
        input.guideState.lastPromptPeriod !== input.currentPeriod &&
        (crossedThisRun || input.skippedLimitCount > 0)
    );
}

/** standard when knownCorpusPages <= 2000; large when > 2000. */
export function pickGuideUrl(knownCorpusPages: number): string {
    if (knownCorpusPages > CORPUS_BUCKET_THRESHOLD) {
        return GUIDE_URL_LARGE;
    }
    return GUIDE_URL_STANDARD;
}
