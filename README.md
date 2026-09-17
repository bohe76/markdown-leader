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

## Install and support

- Install the published 1.3.0 extension from the [Chrome Web Store](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm).
- [Report a bug](https://github.com/bohe76/markdown-leader/issues/new?template=bug_report.yml) or [request a feature](https://github.com/bohe76/markdown-leader/issues/new?template=feature_request.yml).
- Report security vulnerabilities privately at [bohe76@gmail.com](mailto:bohe76@gmail.com?subject=Markdown%20Leader%20security%20report). Do not post them in a public issue.
- Enable **Allow access to file URLs** in the extension details before opening local Markdown files directly.

## Build from source

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Markdown Leader processes documents locally. Checklist and review-note changes require explicit write permission. See the [public privacy policy](https://bohe76.github.io/markdown-leader/).

## License

[MIT](LICENSE)
