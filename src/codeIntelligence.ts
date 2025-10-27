import hljs from 'highlight.js';

export class CodeIntelligence {
    private languages: Map<string, string> = new Map();

    constructor() {
        this.detectLanguage('import sys\nprint("Hello")', 'python');
    }

    detectLanguage(code: string, hint?: string): string {
        const result = hljs.highlightAuto(code);
        return result.language || 'plaintext';
    }

    highlightCode(code: string, language: string): string {
        try {
            const highlighted = hljs.highlight(code, { language });
            return highlighted.value;
        } catch (error) {
            return code;
        }
    }

    deduplicateCodeBlocks(blocks: string[]): string[] {
        const unique = new Set<string>();
        const cleaned: string[] = [];

        for (const block of blocks) {
            const normalized = this.normalizeCodeBlock(block);
            if (!unique.has(normalized)) {
                unique.add(normalized);
                cleaned.push(block);
            }
        }

        return cleaned;
    }

    mergeCodeBlocks(blocks: string[]): string {
        return blocks.join('\n\n// ---\n\n');
    }

    extractFilename(language: string, index: number): string {
        const extensions: Record<string, string> = {
            python: 'py',
            javascript: 'js',
            typescript: 'ts',
            java: 'java',
            cpp: 'cpp',
            c: 'c',
            csharp: 'cs',
            go: 'go',
            rust: 'rs',
            php: 'php',
            ruby: 'rb',
            swift: 'swift',
            kotlin: 'kt',
            bash: 'sh',
            shell: 'sh'
        };

        const ext = extensions[language.toLowerCase()] || 'txt';
        return `code-block-${index + 1}.${ext}`;
    }

    private normalizeCodeBlock(block: string): string {
        // Normalize whitespace and remove comments for comparison
        return block
            .replace(/\s+/g, ' ')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '')
            .trim();
    }
}


