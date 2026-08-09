# Change Log

All notable changes to the "PDF Forge" extension are documented here.

## [1.0.9] - 2026-08-09

### Added
- **Convert Folder to Markdown** — recursive batch conversion of a workspace folder into local Markdown under `pdf-forge-exports/`, with `.pdf-forge-manifest.json` (ownership, hashes, statuses) and `INDEX.md`.
- Soft **100-page monthly batch threshold** (whole-file accounting). This limit applies only to the new batch command; all existing single-file features remain unlimited.
- Multi-root-aware output: each workspace root owns its own `pdf-forge-exports/`.
- Safe writes and at most one conflict candidate (`document.pdf-forge-new.md`); batch path is cancellable and does not use Git.

### Changed
- **Git auto-commit on single-file export.** Previously, when the workspace was a Git repository, export could auto-commit silently and could include unrelated already-staged changes in that commit. Auto-commit is now controlled by `pdf-forge.autoCommit` (default **false**). When enabled, it commits only the exact generated file. Batch conversion never commits.

### Removed
- Unused OCR module and the `tesseract.js` dependency (OCR was never active in this extension).

## [1.0.8] - 2026-06-21

### Fixed
- Store README on Open VSX updated to match v1.0.7 code (honest feature list).

## [1.0.7] - 2026-06-21

### Fixed
- README and store listing aligned with actual shipped behavior (removed stale OCR/Monaco/md-to-pdf claims).
- Bundled pdf.js continues to load via `asWebviewUri` for VSCodium/offline use.
- Output channel **PDF Forge** surfaces activation, webview, and export errors instead of failing silently.

### Changed
- VSIX packaging trimmed (~5 MB); removed unused runtime deps from bundle.

## [1.0.6] - 2026-06-21

### Fixed
- `.vscodeignore` excludes analysis/temp folders accidentally packed into earlier builds.

## [1.0.5] - 2026-06-21

### Changed
- Republish after packaging fixes.

## [1.0.4] - 2026-06-21

### Fixed
- **Offline pdf.js**: replaced CDN with bundled `media/pdfjs/` (fixes VSCodium CSP / no-network failures).
- **OCR claims removed** from README and commands; `enableOcr` setting reserved for future use.
- **Smart Copy wired**: toolbar **Copy w/ Citation** copies page text with `// From: file.pdf (p.N)`.

### Removed
- `pdf-forge.toggleOcr` command from marketplace manifest.

## [1.0.3] - 2025-10-27

### Changed
- Local implementation pass on viewer, export, and code extraction modules.

## [1.0.0] - 2025-01-XX

### Added
- Initial scaffold: custom PDF editor, commands, export folder layout.

### Note
- Early README overstated features (OCR, Monaco, md-to-pdf, text overlay). See later README for accurate scope.
