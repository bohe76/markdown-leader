# Markdown Leader

[English](README.md) · [한국어](README.ko.md)

Read and review local Markdown files in your browser, with folder navigation, search, checklists, and notes saved in the original document.

Markdown Leader targets desktop Chrome 121 or later. Browser validation currently focuses on Windows with a separate Chromium test profile. Version 1.0.0 is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm). This source snapshot contains the next update and may differ from the currently published store version.

## Features

- Open local Markdown files from a file URL, the extension popup, a file/folder picker, or drag and drop.
- Browse a folder tree, navigate headings, and search file names or document contents.
- Read multiple documents in tabs, reorder or pin tabs, and reopen recent files and favorites.
- Render tables, highlighted code, relative images and links, footnotes, alerts, KaTeX math, and Mermaid diagrams.
- Review checklists and attach notes to selected text, with changes saved to the original file after permission is granted.
- Choose light, dark, or system themes, a system font or bundled Pretendard, text size, and reading width.
- Refresh the active document after changes in an external editor while preserving the reading position.
- Use Korean UI when Chrome's display language is Korean, or English otherwise. Document contents and file names stay unchanged.

MDX and MDC files render as Markdown; their components do not execute. Reading alone does not modify files. The reader does not provide a general text editor, account system, or full tab-session restoration.

## Build and load locally

Install the development tools described in [Local installation and usage](docs/operations/local_install.md), then run these commands from the project root:

```powershell
pnpm install --frozen-lockfile
pnpm build
```

1. Open `chrome://extensions` in Chrome and enable **Developer mode**.
2. Select **Load unpacked** and choose the generated `dist` folder.
3. Open the extension's details and enable **Allow access to file URLs**.
4. Open a local Markdown file in Chrome, or choose **Open reader** from the extension popup.

After rebuilding, reload the extension and any document tabs already open. Local builds do not receive store updates.

## Files and privacy

Checklist changes and note saves, edits, or deletions require write permission. A document opened through a file URL may need to be connected to its original file using the file picker. Detected external changes stop a save; avoid saving the same file concurrently in another editor.

Notes are stored in an HTML comment at the end of the Markdown file. They travel with the file and are readable by anyone who can access its source. The extension does not upload documents or notes to a developer server. External images and links in a document can still make network requests. See the [Privacy Policy](docs/operations/privacy_policy.md) for storage, permissions, and deletion details.

## Development and support

- [Contributing](CONTRIBUTING.md): development workflow, checks, and bug reports.
- [Security](SECURITY.md): private vulnerability reports.
- [Documentation index](docs/INDEX.md): usage, project structure, and development standards; most detailed guides are in Korean.
- [Changelog](CHANGELOG.md): changes by version. `package.json` is the version source of truth; development builds may differ from the submitted build at the same numeric version.

## License and attribution

[MIT](LICENSE). Markdown Leader builds on `summereasy/md-reader` at commit `58ee254a6cffbeb28c4a7ce260d4b306dcce8d20`; original copyright notices are preserved. See [Source provenance](docs/operations/upstream_provenance.md) for reused components and bundled font licenses. The build includes dependency notices in `dist/THIRD_PARTY_NOTICES.txt`.
