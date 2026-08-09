# PDF Forge

[![Open VSX](https://img.shields.io/open-vsx/dt/babyfox1306/pdf-forge?label=Open%20VSX%20downloads)](https://open-vsx.org/extension/babyfox1306/pdf-forge) [![Marketplace](https://img.shields.io/visual-studio-marketplace/i/babyfox1306.pdf-forge?label=VS%20Code%20installs)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge) [![No telemetry](https://img.shields.io/badge/telemetry-none-brightgreen)](#privacy)

> Turn PDF collections into searchable, diffable, source-traceable Markdown that coding agents can use as repository context — fully local. Documents never leave your machine.

[![Version](https://img.shields.io/badge/version-1.0.9-blue.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)
[![Install](https://img.shields.io/badge/install-vs--marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)
[![Open VSX](https://img.shields.io/badge/open--vsx-babyfox1306.pdf--forge-blue.svg)](https://open-vsx.org/extension/babyfox1306/pdf-forge)

## What it does

**Core PDF processing is fully local and works offline. Documents never leave your machine.** PDF Forge views PDFs with bundled **pdf.js** (no CDN), extracts text with **pdf-parse**, and — new in **v1.0.9** — batch-converts a folder of PDFs into a Markdown corpus your editor and coding agents can search and diff, with source paths recorded in front matter and the index.

Identity: **`babyfox1306.pdf-forge`** (Marketplace and Open VSX).

### Convert Folder to Markdown (v1.0.9)

Command: **`PDF Forge: Convert Folder to Markdown`**

- Recursively finds `.pdf` files under a workspace folder
- Writes a source-traceable tree under `<workspace>/pdf-forge-exports/`
- Maintains `.pdf-forge-manifest.json` (ownership, hashes, statuses) and `INDEX.md`
- Soft **100-page monthly batch threshold** (whole-file accounting; free regenerations when unchanged). Single-file commands stay unlimited.
- Safe writes: does not overwrite user-modified or unowned Markdown
- Conflict candidate (at most one): `document.pdf-forge-new.md`
- Cancellable; sequential; no Git side effects on the batch path
- Fully local — documents never leave your machine

**Batch output layout** (example for `docs/api/authentication.pdf`):

```text
pdf-forge-exports/
  INDEX.md
  .pdf-forge-manifest.json
  docs/api/authentication/document.md
```

**Legacy single-file export** (unchanged layout):

```text
pdf-forge-exports/<basename>/<basename>.md
```

### PDF Viewer
- Custom editor with canvas page rendering (pdf.js, bundled offline)
- Toolbar: zoom, fit, search, extract, export, **Copy w/ Citation**, sidebar
- Auto-reload when the PDF file changes on disk
- Output channel **PDF Forge** for diagnostics

### Text extraction & single-file export
- Extract full document text to `extracted-text.txt`
- Export to Markdown with YAML front matter
- Optional Git auto-commit of the **exact generated file** when `pdf-forge.autoCommit` is enabled (**default: false**)

### Code intelligence, tables, compare, notes
- Heuristic code-block detection, dedupe, clipboard copy
- Tables → CSV / JSON
- Compare two PDFs (text diff)
- Notes beside the PDF (`.notes.json`) + Markdown export

## Settings

| Setting | Default | Meaning |
|--------|---------|---------|
| `pdf-forge.autoCommit` | `false` | Commit only the exact single-file export result. Batch never commits. |
| `pdf-forge.autoReload` | `true` | Reload PDF when it changes on disk |
| `pdf-forge.maxFileSize` | `200` | Max PDF size in MB (`0` = unlimited) |
| `pdf-forge.enableOcr` | `false` | Reserved — OCR is **not** active |

## Not in this version

| Topic | Reality |
|-------|---------|
| OCR / scanned PDFs | Not available (no OCR engine ships; image-only PDFs get `no_text` in batch) |
| MCP / CLI / CI / watch mode | Not shipped |
| Payment / Pro / licensing UI | Not shipped |
| Telemetry / install ID / fingerprints | Not shipped |
| Hidden network / document upload | Not shipped |

## Privacy

PDF processing is fully local. PDF Forge does not upload documents or document text and makes no background network requests. If you explicitly choose to open the batch guide, your browser visits a public GitHub Pages URL.

## Installation

### VS Code Marketplace
1. Extensions (`Ctrl+Shift+X`)
2. Search **PDF Forge**
3. Install **`babyfox1306.pdf-forge`**

### Open VSX (VSCodium and forks)
Install **`babyfox1306.pdf-forge`** from [Open VSX](https://open-vsx.org/extension/babyfox1306/pdf-forge).

### From VSIX
`Extensions: Install from VSIX…` and select the packaged `.vsix`.

## Commands (selection)

- `PDF Forge: Convert Folder to Markdown`
- `PDF Forge: Export to Markdown`
- `PDF Forge: Extract All Text`
- `PDF Forge: Open Export Folder`
- `PDF Forge: Compare PDFs`
- `PDF Forge: Show Metadata`

## License

See [LICENSE](LICENSE).
