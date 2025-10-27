import DiffMatchPatch from 'diff-match-patch';
import pdf from 'pdf-parse';
import { TextExtractor } from './textExtractor';

export class DiffEngine {
    private dmp: DiffMatchPatch;
    private textExtractor: TextExtractor;

    constructor() {
        this.dmp = new DiffMatchPatch();
        this.textExtractor = new TextExtractor();
    }

    async comparePdfs(pdf1Buffer: Buffer, pdf2Buffer: Buffer): Promise<DiffResult> {
        const text1 = await this.textExtractor.extractFromBuffer(pdf1Buffer);
        const text2 = await this.textExtractor.extractFromBuffer(pdf2Buffer);
        
        return this.compareTexts(text1, text2);
    }

    compareTexts(text1: string, text2: string): DiffResult {
        const diffs = this.dmp.diff_main(text1, text2);
        this.dmp.diff_cleanupSemantic(diffs);

        const added: string[] = [];
        const removed: string[] = [];
        const changed: Array<{ old: string; new: string }> = [];

        for (const [type, text] of diffs) {
            if (type === 1) { // Added
                added.push(text);
            } else if (type === -1) { // Removed
                removed.push(text);
            }
        }

        // Find changed sections
        let currentOld = '';
        let currentNew = '';
        let inChange = false;

        for (const [type, text] of diffs) {
            if (type === 0) {
                if (inChange) {
                    changed.push({ old: currentOld, new: currentNew });
                    currentOld = '';
                    currentNew = '';
                    inChange = false;
                }
            } else if (type === -1) {
                currentOld += text;
                inChange = true;
            } else if (type === 1) {
                currentNew += text;
                inChange = true;
            }
        }

        if (inChange) {
            changed.push({ old: currentOld, new: currentNew });
        }

        return {
            added: added.join(''),
            removed: removed.join(''),
            changed,
            similarity: this.calculateSimilarity(text1, text2)
        };
    }

    private calculateSimilarity(text1: string, text2: string): number {
        const diffs = this.dmp.diff_main(text1, text2);
        let matches = 0;
        let total = 0;

        for (const [type, text] of diffs) {
            total += text.length;
            if (type === 0) {
                matches += text.length;
            }
        }

        return total > 0 ? matches / total : 0;
    }

    async getPageDiff(pdf1Buffer: Buffer, pdf2Buffer: Buffer): Promise<PageDiff> {
        const pdf1 = await pdf(pdf1Buffer);
        const pdf2 = await pdf(pdf2Buffer);

        return {
            pagesAdded: Math.max(0, pdf2.numpages - pdf1.numpages),
            pagesRemoved: Math.max(0, pdf1.numpages - pdf2.numpages),
            totalPages1: pdf1.numpages,
            totalPages2: pdf2.numpages
        };
    }
}

export interface DiffResult {
    added: string;
    removed: string;
    changed: Array<{ old: string; new: string }>;
    similarity: number;
}

export interface PageDiff {
    pagesAdded: number;
    pagesRemoved: number;
    totalPages1: number;
    totalPages2: number;
}


