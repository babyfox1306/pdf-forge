import * as vscode from 'vscode';

export class SearchEngine {
    private history: string[] = [];

    search(text: string, query: string, useRegex: boolean = false): SearchResult[] {
        const results: SearchResult[] = [];
        
        if (!query) {
            return results;
        }

        let regex: RegExp;
        if (useRegex) {
            try {
                regex = new RegExp(query, 'gi');
            } catch (error) {
                throw new Error('Invalid regex pattern');
            }
        } else {
            // Escape special characters for literal search
            const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            regex = new RegExp(escaped, 'gi');
        }

        const lines = text.split('\n');
        let lineNumber = 0;

        for (const line of lines) {
            const matches = [...line.matchAll(regex)];
            
            for (const match of matches) {
                if (match.index !== undefined) {
                    results.push({
                        line: lineNumber,
                        column: match.index,
                        length: match[0].length,
                        context: line.substring(
                            Math.max(0, match.index - 20),
                            Math.min(line.length, match.index + match[0].length + 20)
                        )
                    });
                }
            }
            
            lineNumber++;
        }

        this.addToHistory(query);
        return results;
    }

    getHistory(): string[] {
        return [...this.history];
    }

    clearHistory(): void {
        this.history = [];
    }

    private addToHistory(query: string): void {
        if (!this.history.includes(query)) {
            this.history.unshift(query);
            // Keep last 20 queries
            if (this.history.length > 20) {
                this.history = this.history.slice(0, 20);
            }
        }
    }
}

export interface SearchResult {
    line: number;
    column: number;
    length: number;
    context: string;
}

