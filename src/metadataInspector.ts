export class MetadataInspector {
    async inspect(buffer: Buffer): Promise<PDFMetadata> {
        // Lazy-load pdf-parse to avoid DOMMatrix errors
        const pdf = require('pdf-parse');
        const data = await pdf(buffer);

        return {
            pages: data.numpages,
            title: data.info?.Title || data.metadata?.title || 'Untitled',
            author: data.info?.Author || data.metadata?.author || '',
            subject: data.info?.Subject || data.metadata?.subject || '',
            keywords: data.info?.Keywords || '',
            creator: data.info?.Creator || '',
            producer: data.info?.Producer || '',
            creationDate: data.info?.CreationDate || '',
            modDate: data.info?.ModDate || '',
            isEncrypted: data.info?.Encrypt ? true : false,
            fonts: this.extractFonts(data),
            fileSize: buffer.length,
            version: ''
        };
    }

    private extractFonts(data: any): string[] {
        const fonts: string[] = [];
        
        if (data.fonts) {
            for (const font of data.fonts) {
                fonts.push(font.name || 'Unknown');
            }
        }

        return [...new Set(fonts)];
    }
}

export interface PDFMetadata {
    pages: number;
    title: string;
    author: string;
    subject: string;
    keywords: string;
    creator: string;
    producer: string;
    creationDate: string;
    modDate: string;
    isEncrypted: boolean;
    fonts: string[];
    fileSize: number;
    version: string;
}


