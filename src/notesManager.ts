import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface Note {
    id: string;
    page: number;
    text: string;
    highlight: string;
    comment?: string;
    position: { x: number; y: number; width: number; height: number };
    createdAt: string;
}

export class NotesManager {
    private context: vscode.ExtensionContext;
    private notesFile: string;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        this.notesFile = path.join(
            workspaceFolder || context.globalStorageUri.fsPath,
            'notes.json'
        );
    }

    async getNotes(pdfPath: string): Promise<Note[]> {
        const filePath = this.getNotesFilePath(pdfPath);
        if (!fs.existsSync(filePath)) {
            return [];
        }

        try {
            const data = fs.readFileSync(filePath, 'utf-8');
            return JSON.parse(data) as Note[];
        } catch (error) {
            return [];
        }
    }

    async saveNote(pdfPath: string, note: Note): Promise<void> {
        const notes = await this.getNotes(pdfPath);
        notes.push(note);
        await this.saveNotes(pdfPath, notes);
    }

    async updateNote(pdfPath: string, noteId: string, updates: Partial<Note>): Promise<void> {
        const notes = await this.getNotes(pdfPath);
        const index = notes.findIndex(n => n.id === noteId);
        if (index >= 0) {
            notes[index] = { ...notes[index], ...updates };
            await this.saveNotes(pdfPath, notes);
        }
    }

    async deleteNote(pdfPath: string, noteId: string): Promise<void> {
        const notes = await this.getNotes(pdfPath);
        const filtered = notes.filter(n => n.id !== noteId);
        await this.saveNotes(pdfPath, filtered);
    }

    async exportToMarkdown(pdfPath: string): Promise<string> {
        const notes = await this.getNotes(pdfPath);
        let markdown = `# Notes\n\n`;
        let bookmarkSection = '';
        let highlightSection = '';

        notes.forEach(note => {
            if (note.comment) {
                highlightSection += `### Page ${note.page + 1}\n\n`;
                highlightSection += `> ${note.text}\n\n`;
                highlightSection += `${note.comment}\n\n`;
            }
        });

        return markdown + highlightSection;
    }

    private async saveNotes(pdfPath: string, notes: Note[]): Promise<void> {
        const filePath = this.getNotesFilePath(pdfPath);
        const dir = path.dirname(filePath);
        
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(filePath, JSON.stringify(notes, null, 2));
    }

    private getNotesFilePath(pdfPath: string): string {
        const baseName = path.basename(pdfPath, '.pdf');
        const dir = path.dirname(pdfPath);
        return path.join(dir, `${baseName}.notes.json`);
    }
}


