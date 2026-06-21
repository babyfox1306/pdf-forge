import * as path from 'path';
import { TextExtractor } from './textExtractor';
import { CodeIntelligence } from './codeIntelligence';

export class ConversionEngine {
    private textExtractor: TextExtractor;
    private codeIntelligence: CodeIntelligence;

    constructor() {
        this.textExtractor = new TextExtractor();
        this.codeIntelligence = new CodeIntelligence();
    }

    async convertToMarkdown(buffer: Buffer, sourcePath: string): Promise<string> {
        const { text, metadata } = await this.textExtractor.extractWithMetadata(buffer);
        
        // Detect code blocks
        const codeBlocks = this.textExtractor.extractCodeBlocks(text);
        
        // Build markdown
        let markdown = `---\n`;
        markdown += `title: ${metadata.metadata?.Title || 'Untitled'}\n`;
        markdown += `source: ${path.basename(sourcePath)}\n`;
        markdown += `pages: ${metadata.pages}\n`;
        markdown += `---\n\n`;

        // Process text line by line to detect structure
        const lines = text.split('\n');
        let inCodeBlock = false;
        let currentBlock: string[] = [];

        for (const line of lines) {
            // Check if line is code
            const isCode = codeBlocks.some(block => block.includes(line));
            
            if (isCode && !inCodeBlock) {
                // Start new code block
                inCodeBlock = true;
                currentBlock = [line];
            } else if (inCodeBlock) {
                if (line.trim() === '' && currentBlock.length > 0) {
                    // End code block
                    const code = currentBlock.join('\n');
                    const language = this.codeIntelligence.detectLanguage(code);
                    markdown += `\`\`\`${language}\n${code}\n\`\`\`\n\n`;
                    currentBlock = [];
                    inCodeBlock = false;
                } else {
                    currentBlock.push(line);
                }
            } else {
                // Regular text
                // Detect headings by size (heuristic)
                if (line.trim().length < 100 && !line.includes('.') && /\s+/.test(line)) {
                    markdown += `## ${line}\n\n`;
                } else {
                    markdown += `${line}\n`;
                }
            }
        }

        return markdown;
    }

    async convertToPlainText(buffer: Buffer): Promise<string> {
        return await this.textExtractor.extractFromBuffer(buffer);
    }
}

