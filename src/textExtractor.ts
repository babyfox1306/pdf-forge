export class TextExtractor {
    async extractFromBuffer(buffer: Buffer): Promise<string> {
        try {
            // Lazy-load pdf-parse to avoid DOMMatrix errors
            // Wrap in try-catch to handle if pdf-parse tries to load pdfjs-dist
            let pdf: any;
            try {
                pdf = require('pdf-parse');
            } catch (requireError: any) {
                if (requireError?.message?.includes('DOMMatrix') || requireError?.message?.includes('pdfjs')) {
                    throw new Error(
                        'PDF parsing library requires browser environment. ' +
                        'This is a known limitation. Please use the PDF viewer feature instead.'
                    );
                }
                throw requireError;
            }
            // Try pdf-parse first (faster for text-based PDFs)
            const data = await pdf(buffer);
            const text = data.text?.trim();
            
            // If text is empty or very short, might be scanned PDF
            if (!text || text.length < 10) {
                throw new Error('PDF appears to have no text layer (may be scanned). OCR is not available in this version.');
            }
            
            return text;
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            
            // Check if it's an InvalidPDFException or structure error
            if (errorMessage.includes('Invalid PDF') || errorMessage.includes('InvalidPDFException')) {
                throw new Error(
                    `PDF structure is invalid or corrupted.\n` +
                    `Original error: ${errorMessage}\n\n` +
                    `Possible causes:\n` +
                    `- PDF file is corrupted\n` +
                    `- PDF is encrypted/password-protected\n` +
                    `- PDF is a scanned image (no text layer) - OCR is not available in this version\n` +
                    `- PDF format is not supported`
                );
            }
            
            // Check if it's a scanned PDF (no text layer)
            if (errorMessage.includes('no text layer') || errorMessage.includes('scanned')) {
                throw new Error(
                    `This PDF appears to be a scanned image with no text layer.\n` +
                    `OCR is planned for a future release and is not available in this version.`
                );
            }
            
            // Generic error
            throw new Error(`Failed to extract text: ${errorMessage}`);
        }
    }

    private async extractWithPdfJs(buffer: Buffer): Promise<string> {
        // pdfjs-dist requires DOM environment, which is not available in Node.js
        // This fallback is disabled to prevent DOMMatrix errors
        throw new Error(
            'PDF structure is invalid. pdf.js fallback is not available in Node.js environment.\n' +
            'Please ensure the PDF file is valid and not corrupted.'
        );
    }

    async extractWithMetadata(buffer: Buffer): Promise<{ text: string; metadata: any }> {
        try {
            // Lazy-load pdf-parse to avoid DOMMatrix errors
            const pdf = require('pdf-parse');
        const data = await pdf(buffer);
            const text = data.text?.trim();
            
            if (!text || text.length < 10) {
                throw new Error('PDF appears to have no text layer (may be scanned). OCR is not available in this version.');
            }
            
        return {
                text: text,
            metadata: {
                pages: data.numpages,
                info: data.info,
                metadata: data.metadata
            }
        };
        } catch (error: any) {
            const errorMessage = error?.message || String(error);
            
            // pdf.js fallback disabled in Node.js (requires DOM environment)
            // Just throw the original error with helpful message
            
            throw error;
        }
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


