import type { TextQuality } from './types';

export const NO_TEXT_THRESHOLD = 10;
export const LOW_TEXT_FLOOR = 50;
export const LOW_TEXT_PER_PAGE = 40;

/** Remove all whitespace, then return character length. */
export function normalizeTextChars(text: string): number {
    return text.replace(/\s+/g, '').length;
}

/**
 * Classify extraction quality.
 * no_text  := normalizedTextChars < 10
 * low_text := >= 10 AND < max(50, pageCount * 40)
 * converted := otherwise
 */
export function classifyTextQuality(
    normalizedTextChars: number,
    pageCount: number
): TextQuality {
    if (normalizedTextChars < NO_TEXT_THRESHOLD) {
        return 'no_text';
    }
    const lowCeiling = Math.max(LOW_TEXT_FLOOR, pageCount * LOW_TEXT_PER_PAGE);
    if (normalizedTextChars < lowCeiling) {
        return 'low_text';
    }
    return 'converted';
}
