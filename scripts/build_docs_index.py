#!/usr/bin/env python3
"""docs/INDEX.md 전수 카탈로그를 생성한다.

모든 Markdown 문서를 포함한다. 관리 문서는 front matter의 title/description을
우선 사용하고, 메타가 없거나 샘플 문서면 H1과 파일명으로 보완한다.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


META = re.compile(r"^---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
FIELD = re.compile(r"^(title|name|description):\s*(.+?)\s*$", re.MULTILINE)
H1 = re.compile(r"^#\s+(.+?)\s*$", re.MULTILINE)
DOC_EXTENSIONS = {".md", ".markdown", ".mdown", ".mdwn", ".mkd", ".mkdn", ".mkdown", ".mdx", ".mdc"}
CATEGORY_NAMES = {
    "design": "설계",
    "operations": "운영",
    "requirements": "요구사항",
    "research": "조사",
    "samples": "샘플",
    "standards": "표준",
}


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().strip("\"'`*_"))


def catalog_fields(path: Path, relative: Path) -> tuple[str, str]:
    text = path.read_text(encoding="utf-8-sig")
    body = text
    metadata: dict[str, str] = {}
    match = META.match(text)
    # 샘플은 front matter 렌더링을 검증하므로 카탈로그 메타로 해석하지 않는다.
    if match and relative.parts[0] != "samples":
        metadata = {key: clean(value) for key, value in FIELD.findall(match.group(1))}
        body = text[match.end():]
    heading = H1.search(body)
    title = metadata.get("title") or metadata.get("name") or (clean(heading.group(1)) if heading else relative.stem)
    return title, metadata.get("description", "")


def collect(docs: Path, output: Path) -> list[Path]:
    files = []
    for path in docs.rglob("*"):
        if not path.is_file() or path.resolve() == output.resolve():
            continue
        if path.suffix.lower() not in DOC_EXTENSIONS or ".omc" in path.parts:
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.as_posix().lower())


def render(root: Path, docs: Path, output: Path) -> str:
    groups: dict[str, list[tuple[Path, str, str]]] = {}
    for path in collect(docs, output):
        relative = path.relative_to(docs)
        category = relative.parts[0] if len(relative.parts) > 1 else "root"
        title, description = catalog_fields(path, relative)
        groups.setdefault(category, []).append((relative, title, description))

    root_documents = [root / name for name in ("README.md", "README.ko.md", "CONTRIBUTING.md", "SECURITY.md", "DESIGN.md", "CHANGELOG.md") if (root / name).exists()]
    total = sum(map(len, groups.values())) + len(root_documents)
    lines = [
        "<!-- AUTO-GENERATED: pnpm docs:index. 수동 편집 금지. -->",
        "",
        "# 문서 인덱스",
        "",
        f"> 모든 문서 {total}개를 포함한 프로젝트 문서 지도입니다. 제목·설명은 관리 문서의 front matter를 우선 사용하고, 메타가 없으면 H1·파일명으로 보완합니다.",
        "",
    ]
    if root_documents:
        lines.extend(["## 프로젝트 기준 문서", ""])
        for path in root_documents:
            title, description = catalog_fields(path, Path("__root__") / path.name)
            suffix = f" — {description}" if description else ""
            lines.append(f"- [{title}](../{path.name}){suffix}")
        lines.append("")
    order = ["requirements", "design", "standards", "operations", "research", "samples"]
    for category in sorted(groups, key=lambda key: (order.index(key) if key in order else len(order), key)):
        lines.extend([f"## {CATEGORY_NAMES.get(category, category)}", ""])
        for relative, title, description in groups[category]:
            target = relative.as_posix()
            suffix = f" — {description}" if description else ""
            lines.append(f"- [{title}]({target}){suffix}")
        lines.append("")
    lines.extend([
        "## 생성 규칙",
        "",
        "- `docs/`의 모든 Markdown 확장자와 루트 기준 문서 README·README.ko·CONTRIBUTING·SECURITY·DESIGN·CHANGELOG를 포함한다.",
        "- 관리 문서는 `title`, `description` front matter를 쓸 수 있다.",
        "- 메타가 없으면 H1, H1도 없으면 파일명을 사용한다.",
        "- 샘플 문서의 front matter는 렌더링 시험 데이터이므로 카탈로그 메타로 해석하지 않는다.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stdout", action="store_true")
    parser.add_argument("--check", action="store_true", help="INDEX가 생성 결과와 같은지 검사")
    args = parser.parse_args()
    root = Path.cwd()
    docs = root / "docs"
    output = docs / "INDEX.md"
    result = render(root, docs, output)
    if args.check:
        current = output.read_text(encoding="utf-8") if output.exists() else ""
        if current != result:
            print("docs/INDEX.md가 오래됐습니다. python scripts/build_docs_index.py를 실행하세요.")
            raise SystemExit(1)
        print(f"docs/INDEX.md 검사 통과: {len(collect(docs, output))}개 문서")
        return
    if args.stdout:
        print(result)
    else:
        output.write_text(result, encoding="utf-8", newline="\r\n")
        print(f"docs/INDEX.md 갱신: {len(collect(docs, output))}개 문서")


if __name__ == "__main__":
    main()
