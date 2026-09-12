# Contributing

Contributions that fix bugs or improve documentation are welcome. This guide covers local development and contributions to this public source repository.

## Getting started

Follow [Local installation and usage](docs/operations/local_install.md) to prepare Node.js, pnpm, Python, the project `.venv`, and the unpacked extension. That guide is the source of truth for environment setup, Python dependencies, and browser installation.

Run these commands from the project root:

```powershell
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` runs JavaScript syntax checks, unit tests, the documentation index check, TypeScript checks, and a development build. There is no separate ESLint check. If a check fails, record the failing command and cause with your change.

## Scope and validation

- Follow existing patterns and keep changes focused on the requested behavior. Discuss the need and alternatives before adding a dependency.
- Reading must leave original files unchanged. Writes are limited to user-requested checklist and note changes; preserve permission handling and rejection of saves when external changes are detected.
- Add or update relevant tests for behavior changes. Follow [DESIGN.md](DESIGN.md) for visual changes and the [UI content style guide](docs/standards/ui_content_style_guide.md) for product text.
- Record user-facing changes under `Unreleased` in [CHANGELOG.md](CHANGELOG.md). Do not bump the version for ordinary development work.
- Regenerate the [documentation index](docs/INDEX.md) after documentation changes. Follow the generation and validation steps in [Local installation and usage](docs/operations/local_install.md).

For browser behavior changes, run the relevant smoke test after building. `pnpm python` uses the project's `.venv`. This example checks the recent-items and favorites workflow in a separate Chromium profile:

```powershell
pnpm python scripts/reader_library_smoke.py
```

A browser test does not establish that every operating-system file picker or permission dialog works. Follow the local installation guide's native validation procedure when a change affects those flows, and state which environments or behavior remain unverified.

## Change descriptions and bug reports

Describe the conditions that trigger the problem, the resulting behavior after the change, and the commands and results used for validation. Use this repository's issue tracker for general bug reports.

Include the extension, Chrome, and operating-system versions; whether the document was opened through a file URL or the standalone reader; reproduction steps; and expected versus actual behavior. Prefer a small Markdown sample without personal information. Check logs and screenshots for private paths and document content before sharing them. Report vulnerabilities through the private channel in [SECURITY.md](SECURITY.md).

## License

Contributions use the project's [MIT license](LICENSE). Preserve existing copyright and license notices, and identify the source and license of any third-party code you include.
