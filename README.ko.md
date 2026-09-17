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

## 집중된 검토 흐름

1. **기존 위치에서 폴더나 파일을 엽니다.** 로컬 파일 URL, 확장 팝업, 파일·폴더 선택창 또는 드래그 앤 드롭으로 시작합니다. 원래 폴더 구조는 그대로 유지됩니다.
2. **읽고 탐색하며 문맥 안에 판단을 남깁니다.** 제목 목차 이동, 본문 검색, 탭 문서 비교, 검토 체크박스 변경과 선택 텍스트 메모 추가를 할 수 있습니다.
3. **결과를 문서와 함께 보관합니다.** 명시적으로 쓰기 권한을 허용한 뒤에만 체크박스 판단과 메모를 원본 Markdown 파일에 저장합니다. PDF로 전달해야 할 때는 A4 미리보기와 Chrome 인쇄 흐름을 사용합니다.

## 주요 기능

### 로컬 문서 작업

- 폴더 트리를 탐색하고 파일명 또는 문서 내용을 검색합니다.
- 헤더 기반으로 자동 생성한 제목 목차로 이동합니다.
- 여러 문서를 탭으로 열고 고정·순서 변경하며 최근 파일과 즐겨찾기를 다시 엽니다.
- 외부 편집 뒤 활성 문서를 읽던 위치를 유지한 채 새로 고칩니다.

### 일반 편집기로 전환하지 않는 검토

- Markdown 체크박스를 바꾸고 선택 텍스트에 문맥 메모를 추가합니다.
- 검토 메모를 원본 Markdown 끝의 HTML 주석에 보관해 문서와 함께 이동하게 합니다.
- 저장 전 외부 변경을 감지해 다른 편집기의 작업을 조용히 덮어쓰지 않습니다.

### 기술 Markdown 읽기

- 표, 코드 강조, 상대경로 이미지·링크, 각주, 안내 박스, MathJax 기반 TeX/LaTeX 수식과 Mermaid 다이어그램을 렌더링합니다.
- 밝게·어둡게·시스템 테마와 글자 크기·줄간격·글꼴·읽기 폭을 로컬 읽기 환경으로 선택합니다.
- 같은 렌더링 문서를 A4 미리보기와 Chrome PDF 인쇄 흐름에 사용합니다.

## 로컬 우선 개인정보와 권한

읽기만 하면 원본 파일은 바뀌지 않습니다. 체크박스와 메모 변경에는 명시적인 쓰기 권한이 필요하며, Markdown Leader는 문서나 메모를 개발자 서버로 업로드하지 않습니다.

메모는 Markdown 원본과 함께 저장되도록 설계했습니다. 파일에 접근할 수 있는 사람은 메모도 읽을 수 있습니다. 문서에 포함된 외부 이미지와 링크는 자체 네트워크 요청을 만들 수 있으며 Markdown Leader 서버를 거치지 않습니다. 저장 위치·권한·삭제는 [공개 개인정보 처리방침](https://bohe76.github.io/markdown-leader/)에서 확인하세요.

## 지원 환경과 범위

- 데스크톱 Chrome 121 이상을 대상으로 합니다. 로컬 Markdown 파일을 직접 열기 전에 확장 상세 화면에서 **파일 URL에 대한 액세스 허용**을 켭니다.
- Chrome 표시 언어가 한국어이면 한국어 UI를, 그 외에는 영어 UI를 사용합니다. 원본 문서와 파일명은 번역하지 않습니다.
- MDX와 MDC 파일은 Markdown으로 렌더링하며 컴포넌트를 실행하지 않습니다.
- Markdown Leader는 일반 텍스트 편집기, 계정 서비스, AI 연동 또는 전체 탭 세션 관리 도구가 아닙니다.

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

## 자주 묻는 질문

**문서를 AI 서비스로 보내나요?** 아닙니다. AI 서비스에 연결하지 않습니다. ‘AI 작성’은 파일 조건이 아니라 제품이 돕는 검토 흐름을 뜻합니다.

**사람이 작성한 Markdown도 쓸 수 있나요?** 네. 사람이 작성한 Markdown도 같은 로컬 읽기·검토 흐름으로 사용할 수 있습니다.

**검토 메모가 원본 파일에 보이는 이유는 무엇인가요?** 메모를 HTML 주석으로 저장해 검토 문맥이 Markdown 파일과 함께 남게 합니다. 다른 사람에게 파일을 전달할 때는 메모도 공유 자료로 취급하세요.

**Chrome 웹스토어 없이 설치할 수 있나요?** 네. 소스를 빌드한 뒤 Chrome의 개발자 모드에서 생성된 `dist` 폴더를 `chrome://extensions`로 불러올 수 있습니다.

## 라이선스

[MIT](LICENSE)
