# PDF Forge

> **PDF toolkit for developers: view, extract text/code/tables, export to Markdown, compare PDFs — offline-first, no cloud APIs.**

[![Version](https://img.shields.io/badge/version-1.0.8-blue.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)
[![Install](https://img.shields.io/badge/install-vs--marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)
[![Open VSX](https://img.shields.io/badge/open--vsx-babyfox1306.pdf--forge-blue.svg)](https://open-vsx.org/extension/babyfox1306/pdf-forge)

## What it does

PDF Forge is a VS Code custom editor for `.pdf` files. It renders pages with bundled **pdf.js** (no CDN), extracts text with **pdf-parse**, and organizes exports under `./pdf-forge-exports/` in your workspace.

### PDF Viewer
- Custom editor with canvas page rendering (pdf.js, bundled offline)
- Toolbar: zoom +/-, fit page, search, extract, export, **Copy w/ Citation**, sidebar
- Sidebar tabs: metadata, notes, exports, bookmarks
- Auto-reload when the PDF file changes on disk
- Respects VS Code theme colors in the webview UI
- Configurable max file size (default 200 MB)
- **Output channel** `PDF Forge` for diagnostics (View → Output)

### Text extraction & export
- Extract full document text to `extracted-text.txt`
- Export to Markdown with YAML front matter (title, source, page count)
- Export plain text and JSON via settings / export flow
- Optional Git auto-commit when workspace is a Git repo

### Code intelligence
- Heuristic code-block detection (fonts, indentation, patterns)
- Language detection via highlight.js
- Copy all code blocks to clipboard
- Deduplicate identical blocks
- Merge blocks into `merged-code-all.md`
- Per-block files under `code-blocks/` (`.py`, `.js`, etc.)

### Tables
- Extract tables to CSV / JSON under `tables/`
- Opens CSV in VS Code after export

### Compare & metadata
- **Compare PDFs**: text diff between two PDFs (diff-match-patch)
- **Show Metadata**: title, author, pages, encryption, fonts, file size

### Search & navigation
- Command Palette search with optional regex (`PDF Forge: Search in PDF`)
- In-viewer search via toolbar prompt (plain text)
- Jump to page (Command Palette)
- Page bookmarks (stored in workspace state; sidebar list)

### Notes
- Notes saved to `.notes.json` beside the PDF
- Export notes to Markdown
- Notes listed in sidebar (no on-page highlight overlay yet)

### Smart copy
- Toolbar **Copy w/ Citation** copies visible page text plus `// From: filename.pdf (p.N)`

## Not in this version

These are **not** shipped or are incomplete — do not expect them today:

| Claim (old docs) | Reality in v1.0.8 |
|---|---|
| OCR / scanned PDFs | **Not available** — setting reserved for a future release |
| Markdown → PDF | **Removed** — export is PDF → text/Markdown only |
| Selectable text overlay on pages | **No** — viewer is canvas; copy via commands/toolbar |
| Monaco code preview | **No** |
| Visual search highlights on PDF | **Partial** — search runs on extracted text; no text-layer overlay |
| Split view text panel | **Shell only** — toggles layout; panel is not auto-filled with page text |
| Floating quick-export panel | **No** — use Command Palette / toolbar |
| On-page note/highlight overlays | **No** — notes are file-based + sidebar list |

## Installation

### VS Code Marketplace
1. Extensions (`Ctrl+Shift+X`)
2. Search **PDF Forge**
3. Install **`babyfox1306.pdf-forge`**

### Open VSX (VSCodium and forks)
Install **`babyfox1306.pdf-forge`**: https://open-vsx.org/extension/babyfox1306/pdf-forge

> Uninstall **`babyfox1306-dev.pdf-forge`** if you have it — that is an old duplicate listing.

### From `.vsix`
```bash
code --install-extension pdf-forge-1.0.8.vsix
```

## Usage

### Open a PDF
- Explorer → right-click `.pdf` → **Open With…** → **PDF Forge Viewer**
- Or Command Palette → `PDF Forge: Open PDF`

### Common commands

| Shortcut | Command |
|---|---|
| `Ctrl+Alt+Z` | Zoom menu |
| `Ctrl+Alt+X` | Extract all text |
| `Ctrl+Alt+C` | Copy all code blocks |
| `Ctrl+Alt+E` | Export to Markdown |
| `Ctrl+Alt+S` | Toggle split view (layout) |
| `Ctrl+Alt+F` | Search in PDF (regex optional) |

All commands: Command Palette (`Ctrl+Shift+P`) → type `PDF Forge`.

## Configuration

```json
{
  "pdf-forge.autoReload": true,
  "pdf-forge.defaultFormat": "markdown",
  "pdf-forge.highlightColor": "#FFEB3B",
  "pdf-forge.maxFileSize": 200,
  "pdf-forge.autoDedupe": true,
  "pdf-forge.enableOcr": false
}
```

- `enableOcr` — reserved; OCR is **not active** in this release.

## Export layout

```
./pdf-forge-exports/
  └── [filename]/
      ├── extracted-text.txt
      ├── document.md
      ├── code-blocks/
      ├── tables/
      ├── notes.md
      └── metadata.json
```

## Requirements

- VS Code **1.80.0+**
- PDFs with a **text layer** (born-digital or OCR’d elsewhere)
- Workspace folder for exports (uses first workspace root)

## Limitations

- View-only — no PDF editing
- Scanned/image-only PDFs cannot be extracted until OCR ships
- Very large files (>500 MB) may be slow
- Split view does not yet mirror live page text in the side panel

## FAQ

**Is it free?** Yes — MIT license.

**Does it need internet?** No for normal use. pdf.js is bundled in the extension.

**Can I edit PDFs?** No.

**How do I debug issues?** Open **View → Output → PDF Forge**.

## Publisher

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge) — `babyfox1306.pdf-forge`
- [Open VSX](https://open-vsx.org/extension/babyfox1306/pdf-forge) — `babyfox1306.pdf-forge`

Issues: [GitHub](https://github.com/babyfox1306/pdf-forge)

## Credits

- [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla)
- [highlight.js](https://highlightjs.org/)
- [diff-match-patch](https://github.com/google/diff-match-patch)
