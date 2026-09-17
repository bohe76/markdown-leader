# Markdown Leader

[![Chrome 웹스토어에서 설치](https://img.shields.io/badge/Chrome_Web_Store-Install-4285F4?logo=googlechrome&logoColor=white)](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)
[![Chrome 웹스토어 버전](https://img.shields.io/chrome-web-store/v/mglmfpabbmcifhimdlembgchpaofbogm)](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)
[![라이선스](https://img.shields.io/github/license/bohe76/markdown-leader)](LICENSE)

[![Markdown Leader 핵심 검토 흐름](assets/markdown-leader-1.1.0-demo.gif)](assets/markdown-leader-1.1.0-demo.gif)

> AI가 작성한 초안을 명확한 사람의 피드백으로 바꾸는 로컬 우선 Markdown 검토 작업 공간입니다.

Markdown Leader는 일반 Markdown 편집기가 아닙니다. 로컬 문서를 탐색·검색하고 체크박스 판단과 문맥이 포함된 메모를 원본에 남깁니다. 문서는 사용자 기기에 머물며 Markdown Leader는 AI 서비스에 연결하지 않습니다.

## Markdown Leader가 맞는 경우

| 필요 | Markdown Leader |
| --- | --- |
| AI 작성 초안 검토 | 체크박스 판단과 문맥 메모를 원본 Markdown 파일에 남깁니다. |
| 문서를 로컬에 유지 | 문서와 메모를 개발자 서버로 전송하지 않고 로컬에서 처리합니다. |
| 긴 문서 탐색 | 파일 트리, 문서 검색, 제목 목차와 탭으로 파일 위치를 바꾸지 않고 탐색합니다. |
| 검토 문서 출력 | A4 미리보기와 Chromium 인쇄 흐름으로 PDF를 만듭니다. |

## 설치와 지원

- 공개된 1.3.0 확장은 [Chrome 웹스토어](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)에서 설치합니다.
- [오류 제보](https://github.com/bohe76/markdown-leader/issues/new?template=bug_report.yml) 또는 [기능 제안](https://github.com/bohe76/markdown-leader/issues/new?template=feature_request.yml)을 남길 수 있습니다.
- 보안 취약점은 [bohe76@gmail.com](mailto:bohe76@gmail.com?subject=Markdown%20Leader%20security%20report)으로 비공개 제보합니다. 공개 이슈에는 올리지 마세요.
- 로컬 Markdown 파일을 직접 열기 전에 확장 상세 화면에서 **파일 URL에 대한 액세스 허용**을 켭니다.

## 소스 빌드

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Markdown Leader는 문서를 로컬에서 처리합니다. 체크박스와 검토 메모 변경에는 명시적인 쓰기 권한이 필요합니다. [공개 개인정보 처리방침](https://bohe76.github.io/markdown-leader/)을 확인하세요.

## 라이선스

[MIT](LICENSE)
