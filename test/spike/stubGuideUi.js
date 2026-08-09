'use strict';

/**
 * Headless Electron host: batch guide uses vscode.window.show*Message,
 * which blocks forever with no UI response. Force-override to auto-decline.
 * Never opens a production guide URL during QA.
 */
function stubGuideUi(vscode, breadcrumb) {
    const events = [];
    const log = (m) => {
        try {
            breadcrumb && breadcrumb(m);
        } catch {
            // ignore
        }
    };

    const declineInfo = async (message, ...rest) => {
        events.push({ type: 'info', message: String(message), rest: rest.map(String) });
        log('guide-info:' + String(message).slice(0, 80));
        // Always decline in host smoke — never block on modal.
        if (rest.length && typeof rest[0] === 'string') {
            // Prefer explicit "Not now" when present among button labels
            const buttons = rest.filter((x) => typeof x === 'string');
            if (buttons.includes('Not now')) return 'Not now';
            return undefined;
        }
        return undefined;
    };

    const declineWarn = async (message, ...rest) => {
        events.push({ type: 'warn', message: String(message), rest: rest.map(String) });
        log('guide-warn:' + String(message).slice(0, 80));
        return undefined;
    };

    try {
        Object.defineProperty(vscode.window, 'showInformationMessage', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: declineInfo,
        });
    } catch {
        vscode.window.showInformationMessage = declineInfo;
    }

    try {
        Object.defineProperty(vscode.window, 'showWarningMessage', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: declineWarn,
        });
    } catch {
        vscode.window.showWarningMessage = declineWarn;
    }

    // Also patch showErrorMessage / showQuickPick to avoid other UI hangs
    try {
        Object.defineProperty(vscode.window, 'showErrorMessage', {
            configurable: true,
            enumerable: true,
            writable: true,
            value: async (message) => {
                log('guide-error:' + String(message).slice(0, 80));
                return undefined;
            },
        });
    } catch {
        // ignore
    }

    log('stub-installed');
    return events;
}

module.exports = { stubGuideUi };
