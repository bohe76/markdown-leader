# Markdown Leader

[![Install from Chrome Web Store](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)
[![Chrome Web Store version](https://img.shields.io/chrome-web-store/v/mglmfpabbmcifhimdlembgchpaofbogm)](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)
[![License](https://img.shields.io/github/license/bohe76/markdown-leader)](LICENSE)

[![Markdown Leader core review workflow](assets/markdown-leader-1.1.0-demo.gif)](assets/markdown-leader-1.1.0-demo.gif)

> A local-first Markdown review workspace for turning AI-written drafts into clear human feedback.

Markdown Leader is not a general Markdown editor. Browse and search local documents, then save checklist decisions and contextual notes in the original files. Documents stay on your device, and Markdown Leader does not connect to an AI service.

## Why Markdown Leader?

| Need | Markdown Leader |
| --- | --- |
| Review AI-written drafts | Save checklist decisions and contextual notes in the original Markdown file. |
| Keep documents private | Process documents locally without sending documents or notes to a developer server. |
| Navigate long documents | Use the folder tree, document search, outline, and tabs without moving the files. |
| Present a reviewed document | Use the A4 preview and Chromium print flow for PDF output. |

## A focused review workflow

1. **Open the folder or file where it already lives.** Start from a local file URL, the extension popup, a file or folder picker, or drag and drop. The original folder structure stays in place.
2. **Read, navigate, and leave a decision in context.** Move through headings, search document text, compare documents in tabs, change review checklists, and attach a note to selected text.
3. **Keep the result with the document.** After you explicitly grant write permission, checklist decisions and notes are saved in the original Markdown file. Use the A4 preview and Chrome print flow when a PDF is the useful handoff.

## Features

### Work with local documents

- Browse a folder tree and search file names or document contents.
- Navigate headings with an automatically generated outline.
- Open several documents in tabs, pin or reorder them, and reopen recent files or favorites.
- Refresh an active document after an external edit while keeping the reading position.

### Review without switching to a general editor

- Change Markdown checklists and add contextual notes to selected text.
- Keep review notes in an HTML comment at the end of the original Markdown file, so they travel with the document.
- Detect external changes before saving instead of silently overwriting another editor's work.

### Read technical Markdown

- Render tables, highlighted code, relative images and links, footnotes, alerts, MathJax-based TeX/LaTeX math, and Mermaid diagrams.
- Choose light, dark, or system theme; text size, line spacing, font, and reading width are local reading preferences.
- Use the same rendered document for A4 preview and Chrome's PDF print flow.

## Local-first privacy and permissions

Reading a document does not change it. Checklist and note changes require explicit write permission, and Markdown Leader does not upload documents or notes to a developer server.

Notes are intentionally stored with the Markdown source. Anyone who can access the file can read them. External images and links embedded in a document can still make their own network requests; they are not routed through a Markdown Leader server. See the [public privacy policy](https://bohe76.github.io/markdown-leader/) for storage, permissions, and deletion details.

## Compatibility and scope

- Designed for desktop Chrome 121 or later. Enable **Allow access to file URLs** in the extension details before opening local Markdown files directly.
- Korean UI is used when Chrome's display language is Korean; other locales use English. Your document text and file names are never translated.
- MDX and MDC files are rendered as Markdown; their components do not execute.
- Markdown Leader is not a general text editor, an account service, an AI integration, or a complete tab-session manager.

## Install and support

- This repository contains the 1.4.1 source snapshot. The [Chrome Web Store](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm) listing shows the currently available version.
- [Report a bug](https://github.com/bohe76/markdown-leader/issues/new?template=bug_report.yml) or [request a feature](https://github.com/bohe76/markdown-leader/issues/new?template=feature_request.yml).
- Report security vulnerabilities privately at [bohe76@gmail.com](mailto:bohe76@gmail.com?subject=Markdown%20Leader%20security%20report). Do not post them in a public issue.
- Enable **Allow access to file URLs** in the extension details before opening local Markdown files directly.

## Build from source

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Markdown Leader processes documents locally. Checklist and review-note changes require explicit write permission. See the [public privacy policy](https://bohe76.github.io/markdown-leader/).

## FAQ

**Does Markdown Leader send my document to an AI service?** No. It does not connect to an AI service. “AI-written” describes the review workflow, not a file requirement.

**Can I use Markdown written by a person?** Yes. Human-authored Markdown uses the same local reading and review workflow.

**Why are review notes visible in the source file?** Notes are saved in an HTML comment so the review context stays with the Markdown file. Treat that file as shared review material when you send it to someone else.

**Can I install it without the Chrome Web Store?** Yes. Build the source, then load the generated `dist` folder from `chrome://extensions` with Developer mode enabled.

## License

[MIT](LICENSE)
