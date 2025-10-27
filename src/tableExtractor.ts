import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export class TableExtractor {
    async extractTable(text: string): Promise<Array<Record<string, any>>> {
        // Simple table detection by analyzing text structure
        const lines = text.split('\n');
        const tables: Array<Record<string, any>> = [];
        
        // Detect potential table by consistent spacing
        let inTable = false;
        let tableRows: string[] = [];
        let headers: string[] = [];

        for (const line of lines) {
            // Check if line has table-like structure (multiple columns)
            const parts = line.split(/\s{2,}|\t/).filter(p => p.trim());
            
            if (parts.length >= 3) {
                if (!inTable) {
                    headers = parts;
                    inTable = true;
                    tableRows = [];
                } else {
                    if (parts.length === headers.length) {
                        tableRows.push(line);
                    }
                }
            } else if (inTable && line.trim() === '') {
                // End of table
                inTable = false;
                if (tableRows.length > 0) {
                    const table = this.buildTableObject(headers, tableRows);
                    tables.push(...table);
                }
                tableRows = [];
                headers = [];
            }
        }

        return tables;
    }

    async exportToCsv(data: Array<Record<string, any>>, outputPath: string): Promise<void> {
        if (data.length === 0) {
            throw new Error('No data to export');
        }

        const headers = Object.keys(data[0]);
        const rows = [headers.join(',')];
        
        for (const record of data) {
            const values = headers.map(h => {
                const value = record[h];
                // Escape values that contain commas
                if (typeof value === 'string' && value.includes(',')) {
                    return `"${value}"`;
                }
                return value || '';
            });
            rows.push(values.join(','));
        }

        fs.writeFileSync(outputPath, rows.join('\n'), 'utf-8');
    }

    async exportToJson(data: Array<Record<string, any>>, outputPath: string): Promise<void> {
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf-8');
    }

    private buildTableObject(headers: string[], rows: string[]): Record<string, any>[] {
        return rows.map(row => {
            const values = row.split(/\s{2,}|\t/).filter(v => v.trim());
            const record: Record<string, any> = {};
            
            headers.forEach((header, index) => {
                record[header.trim()] = values[index]?.trim() || '';
            });
            
            return record;
        });
    }
}

