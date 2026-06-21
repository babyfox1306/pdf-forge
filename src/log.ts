import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function initPdfForgeLog(context: vscode.ExtensionContext): void {
    channel = vscode.window.createOutputChannel('PDF Forge');
    context.subscriptions.push(channel);
    logInfo('PDF Forge output channel ready');
}

export function logInfo(message: string): void {
    const line = `[INFO] ${message}`;
    channel?.appendLine(line);
    console.log(`[PDF Forge] ${message}`);
}

export function logWarn(message: string, showUser = false): void {
    const line = `[WARN] ${message}`;
    channel?.appendLine(line);
    console.warn(`[PDF Forge] ${message}`);
    if (showUser) {
        vscode.window.showWarningMessage(message);
    }
}

export function logError(message: string, showUser = true): void {
    const line = `[ERROR] ${message}`;
    channel?.appendLine(line);
    console.error(`[PDF Forge] ${message}`);
    if (showUser) {
        vscode.window.showErrorMessage(message);
    }
}

export function showOutputChannel(): void {
    channel?.show(true);
}
