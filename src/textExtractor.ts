import pdf from 'pdf-parse';

export class TextExtractor {
    async extractFromBuffer(buffer: Buffer): Promise<string> {
        try {
            const data = await pdf(buffer);
            return data.text;
        } catch (error: any) {
            throw new Error(`Failed to extract text: ${error}`);
        }
    }

    async extractWithMetadata(buffer: Buffer): Promise<{ text: string; metadata: any }> {
        const data = await pdf(buffer);
        return {
            text: data.text,
            metadata: {
                pages: data.numpages,
                info: data.info,
                metadata: data.metadata
            }
        };
    }

    extractCodeBlocks(text: string): string[] {
        const codeBlocks: string[] = [];
        
        // Match markdown code blocks
        const markdownPattern = /```[\s\S]*?```/g;
        const matches = text.match(markdownPattern);
        if (matches) {
            codeBlocks.push(...matches);
        }

        // Detect potential code by indentation and structure
        const lines = text.split('\n');
        let inCodeBlock = false;
        let currentBlock: string[] = [];

        for (const line of lines) {
            if (this.isLikelyCode(line)) {
                inCodeBlock = true;
                currentBlock.push(line);
            } else if (inCodeBlock && line.trim() === '') {
                if (currentBlock.length > 3) {
                    codeBlocks.push(currentBlock.join('\n'));
                }
                currentBlock = [];
                inCodeBlock = false;
            } else if (inCodeBlock) {
                currentBlock.push(line);
            }
        }

        return codeBlocks;
    }

    extractTerminalCommands(text: string): string[] {
        const commands: string[] = [];
        const terminalPattern = /\$\s+[a-zA-Z0-9-_./]+\s+[^\n]*/g;
        const matches = text.match(terminalPattern);
        if (matches) {
            commands.push(...matches.map(cmd => cmd.substring(2).trim()));
        }
        return commands;
    }

    private isLikelyCode(line: string): boolean {
        // Heuristics for detecting code
        const codeIndicators = [
            /^\s{4,}/,  // Indented
            /\{|\}|\(\)|=>|\->/,  // Code symbols
            /import\s+|export\s+|def\s+|function\s+|class\s+/,  // Keywords
            /[a-zA-Z_]+\.[a-zA-Z_]+\(/,  // Method calls
        ];

        return codeIndicators.some(pattern => pattern.test(line));
    }
}


