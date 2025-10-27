# PDF Forge

> **All-in-one PDF toolkit for developers: view, extract code & tables, convert to Markdown, highlight, note, compare — 100% offline, no AI, one .vsix forever.**

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)
[![Install](https://img.shields.io/badge/install-vs--marketplace-brightgreen.svg)](https://marketplace.visualstudio.com/items?itemName=babyfox1306.pdf-forge)

## Features

### 📖 PDF Viewer (15 features)
- Open PDFs with pdf.js renderer
- Zoom, Fit Page/Width controls
- Previous/Next/Jump to page
- Dark mode (syncs with VS Code theme)
- Auto-reload on file changes
- Large file support (>200MB)
- Fixed toolbar with quick actions

### 📝 Text Layer & Search (12 features)
- Selectable text overlay
- Split view: PDF ↔ Text side-by-side
- Copy text (selection or full page)
- Full-text search with regex support
- Highlight search results with jump navigation
- Search history persistence
- Command Palette quick search
- Export text to `.txt`, `.md`, `.json`

### 💻 Code Intelligence (10 features)
- Auto-detect code blocks (fonts, patterns, indentation)
- Syntax highlighting for 50+ languages
- **Deduplicate identical code blocks**
- Auto-detect language + rename extracted files
- Copy 1 click / Export to `.py`, `.js`, etc.
- **Merge all code blocks into 1 master file**
- Monaco mini-panel preview
- Extract terminal commands (`$ pip install...`)

### 📊 Table & Data (3 features)
- Extract tables to CSV/JSON
- Auto-open CSV in VS Code
- Preserve table structure

### 🔄 Conversion Engine (6 features)
- PDF → Markdown (preserves headings, lists, tables, code)
- PDF → Plain text
- Markdown → PDF (using md-to-pdf)
- Auto-create `./pdf-forge-exports/[filename]/` structure
- Auto-open exported files
- Markdown with metadata (title, pages, source)

### ✏️ Highlight, Notes & Bookmarks (8 features)
- Highlight text with color picker
- Note popup/panel UI
- Persist to `.notes.json` with coordinates
- Display note overlay on PDF
- Edit/delete notes
- Export notes to Markdown
- Page bookmarks (Ctrl+Click)
- Sidebar bookmarks tab

### 🚀 Pro Features (6 features)
- **Diff Mode**: Compare 2 PDFs (text diff, page count)
- **OCR**: Tesseract.js integration (toggle on/off)
- **Metadata Inspector**: Author, Date, Encryption, Fonts
- **Smart Copy**: Copy with citation `// From: file.pdf (p.42)`

### 📤 Export System (8 features)
- Unified export folder structure
- Quick Export Panel (floating UI)
- Open export folder 1 click
- Backup old exports before overwrite
- Git auto-commit (optional)

### ⚙️ Configuration (7 features)
- Settings: autoReload, defaultFormat, highlightColor, maxFileSize, enableOcr, autoDedupe
- Debug log panel
- Cross-platform (Windows/macOS/Linux)
- 100% offline (all libs bundled)
- Zero runtime dependencies

## Installation

### From VS Code Marketplace
1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X)
3. Search for "PDF Forge"
4. Click **Install**

### From .vsix file
```bash
code --install-extension pdf-forge-1.0.0.vsix
```

## Usage

### Open a PDF
1. Right-click any `.pdf` file in Explorer
2. Select "Open With..." → "PDF Forge Viewer"
3. Or use Command Palette: `PDF Forge: Open PDF`

### Extract Text
- **Ctrl+Alt+X**: Extract all text
- Or: Command Palette → `PDF Forge: Extract All Text`

### Export to Markdown
- **Ctrl+Alt+E**: Export to Markdown
- Or: Command Palette → `PDF Forge: Export to Markdown`

### Copy All Code Blocks
- **Ctrl+Alt+C**: Copy all detected code blocks
- Or: Command Palette → `PDF Forge: Copy All Code`

### Search in PDF
- **Ctrl+Alt+F**: Search with regex support
- Or: Command Palette → `PDF Forge: Search in PDF`

### Toggle Split View
- **Ctrl+Alt+S**: Show/hide text side-by-side
- Or: Command Palette → `PDF Forge: Toggle Split View`

### Zoom
- **Ctrl+Alt+Z**: Quick zoom menu
- Or: Click +/- buttons in toolbar

## Keyboard Shortcuts

| Shortcut | Command |
|----------|---------|
| `Ctrl+Alt+Z` | Zoom |
| `Ctrl+Alt+X` | Extract Text |
| `Ctrl+Alt+C` | Copy Code |
| `Ctrl+Alt+E` | Export |
| `Ctrl+Alt+S` | Split View |
| `Ctrl+Alt+F` | Search |

## Commands

All commands are accessible via Command Palette (Ctrl+Shift+P):

- `PDF Forge: Open PDF` - Open a PDF file
- `PDF Forge: Extract All Text` - Extract all text to clipboard
- `PDF Forge: Export to Markdown` - Convert PDF to Markdown
- `PDF Forge: Copy All Code` - Copy all detected code blocks
- `PDF Forge: Export Notes` - Export annotations to Markdown
- `PDF Forge: Compare PDFs` - Compare two PDF files
- `PDF Forge: Toggle OCR` - Enable/disable OCR mode
- `PDF Forge: Clear Cache` - Clear extension cache
- `PDF Forge: Open Export Folder` - Open exports directory
- `PDF Forge: Extract Tables` - Extract tables to CSV/JSON
- `PDF Forge: Deduplicate Code` - Remove duplicate code blocks
- `PDF Forge: Toggle Split View` - Show/hide split view
- `PDF Forge: Jump to Page` - Navigate to specific page
- `PDF Forge: Search in PDF` - Search with regex
- `PDF Forge: Show Metadata` - Display PDF information

## Configuration

Add to your `settings.json`:

```json
{
  "pdf-forge.autoReload": true,
  "pdf-forge.defaultFormat": "markdown",
  "pdf-forge.highlightColor": "#FFEB3B",
  "pdf-forge.maxFileSize": 200,
  "pdf-forge.enableOcr": false,
  "pdf-forge.autoDedupe": true
}
```

### Settings

- `pdf-forge.autoReload` (boolean, default: `true`) - Automatically reload PDF when file changes
- `pdf-forge.defaultFormat` (string, default: `markdown`) - Default export format: `markdown`, `text`, or `json`
- `pdf-forge.highlightColor` (string, default: `#FFEB3B`) - Default highlight color (hex format)
- `pdf-forge.maxFileSize` (number, default: `200`) - Maximum file size in MB (0 = unlimited)
- `pdf-forge.enableOcr` (boolean, default: `false`) - Enable OCR for scanned PDFs (uses Tesseract.js)
- `pdf-forge.autoDedupe` (boolean, default: `true`) - Automatically deduplicate code blocks during extraction

## Export Structure

All exports are saved to:
```
./pdf-forge-exports/
  └── [filename]/
      ├── text.txt
      ├── document.md
      ├── code-blocks/
      │   ├── code-block-1.py
      │   ├── code-block-2.js
      │   └── merged-code-all.md
      ├── tables/
      │   ├── table-1.csv
      │   └── table-2.json
      ├── notes.md
      └── metadata.json
```

## How It Works

1. **100% Offline**: All processing happens locally. No API calls.
2. **Bundled Libraries**: pdf.js, Tesseract.js, highlight.js included.
3. **Smart Detection**: Code blocks detected by font, indentation, and patterns.
4. **Git Integration**: Optionally auto-commit exports to your repo.

## Requirements

- VS Code 1.80.0 or higher
- Node.js 18+ (for development)
- 100MB+ disk space (with bundled libraries)

## Limitations

- PDF editing not supported (view-only)
- OCR accuracy depends on image quality
- Large files (>500MB) may be slow

## FAQ

**Q: Is this extension free?**  
A: Yes, 100% free and open source.

**Q: Does it require internet?**  
A: No, everything works offline.

**Q: Can I edit PDFs?**  
A: No, this is a viewer/extractor only.

**Q: How do I extract code from a PDF?**  
A: Just open the PDF, the extension auto-detects code blocks.

**Q: Can I export to other formats?**  
A: Currently supports Markdown, Plain Text, and JSON.

**Q: Is OCR accurate?**  
A: Depends on image quality. Best for high-resolution scans.

## License

MIT License - See LICENSE file for details.

## Contributing

Contributions welcome! Please read our contributing guidelines.

## Credits

- **pdf.js** - Mozilla (PDF rendering)
- **Tesseract.js** - OCR engine
- **highlight.js** - Syntax highlighting
- **diff-match-patch** - Text diffing

## Publisher

Published by **babyfox1306** on:
- [VS Code Marketplace](https://marketplace.visualstudio.com/vscode)
- [Open VSX](https://open-vsx.org/)

## Support

Report issues on [GitHub](https://github.com/babyfox1306/pdf-forge).

---

**PDF FORGE – BUILT ONCE. CODE FOREVER.**


