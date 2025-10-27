import * as Tesseract from 'tesseract.js';

export class OcrEngine {
    private worker: Tesseract.Worker | null = null;

    async initialize(): Promise<void> {
        if (!this.worker) {
            this.worker = await Tesseract.createWorker('eng');
        }
    }

    async extractText(imageData: ImageData): Promise<string> {
        if (!this.worker) {
            await this.initialize();
        }

        if (!this.worker) {
            throw new Error('OCR worker not initialized');
        }

        const result = await this.worker.recognize(imageData);
        return result.data.text;
    }

    async terminate(): Promise<void> {
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }
    }

    isEnabled(): boolean {
        // Check if OCR is enabled in settings
        // This will be determined by the Config class
        return false; // Placeholder
    }
}


