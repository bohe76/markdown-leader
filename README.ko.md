# Markdown Leader

[English](README.md) · [한국어](README.ko.md)

Markdown Leader는 일반 Markdown 편집기가 아니라, AI가 작성한 Markdown을 사람이 검토하기 위한 인터페이스입니다. 로컬 문서를 탐색·검색하고 체크박스 판단과 문맥이 포함된 메모를 원본에 남깁니다.

Claude, ChatGPT, OpenAI Codex, Gemini, Google Antigravity 같은 AI 도구가 생성한 Markdown을 검토할 수 있습니다. 이 이름들은 가능한 문서 작성 도구를 설명하며 연동이나 제휴를 뜻하지 않습니다. 문서는 사용자 기기에 머물고 Markdown Leader는 AI 서비스에 연결하지 않으며, 사람이 작성한 Markdown도 동일하게 지원합니다.

데스크톱 Chrome 121 이상을 대상으로 합니다. [Chrome 웹스토어](https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm)에는 1.1.0이 공개되어 있습니다. 이 저장소는 1.2.0 소스 스냅샷이므로 다음 스토어 버전이 공개될 때까지 현재 공개 패키지와 다를 수 있습니다.

## 실제 동작

공개된 1.1.0에서 폴더 정렬, 사이드바 폭 조절, A4/PDF 미리보기와 위치가 바뀐 파일 재연결을 확인할 수 있습니다.

[![Markdown Leader 1.1.0 실제 동작](assets/markdown-leader-1.1.0-demo.gif)](assets/markdown-leader-1.1.0-demo.gif)

## 주요 기능

- 파일 URL, 확장 팝업, 파일·폴더 선택창 또는 드래그 앤 드롭으로 로컬 Markdown 열기
- 폴더 트리, 제목 목차, 파일명·문서 내용 검색
- 문서 탭, 탭 정렬·핀 고정, 최근 파일·즐겨찾기 다시 열기
- 표, 코드 강조, 상대경로 이미지·링크, 각주, 안내 박스, MathJax 기반 수식과 Mermaid 다이어그램
- 체크박스 변경과 선택한 텍스트에 메모 추가, 권한 허용 후 원본 파일 저장
- A4 페이지 미리보기와 Chrome의 PDF 저장 흐름
- 밝게·어둡게·시스템 테마와 글꼴·글자 크기·줄간격·읽기 폭 설정
- 외부 편집기의 변경을 활성 문서에 반영하고 읽던 위치 유지

MDX·MDC는 Markdown으로 읽으며 컴포넌트를 실행하지 않습니다. 읽기만 하면 원본 파일을 변경하지 않습니다. 일반 텍스트 편집기, 계정, AI 연동, 열린 탭 전체의 세션 복원은 제공하지 않습니다.

## 로컬 빌드와 설치

Node.js와 pnpm을 설치한 뒤 실행합니다.

```powershell
pnpm install --frozen-lockfile
pnpm build
```

1. Chrome에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
2. **압축해제된 확장 프로그램을 로드합니다**를 선택하고 생성된 `dist` 폴더를 지정합니다.
3. 확장 상세 화면에서 **파일 URL에 대한 액세스 허용**을 켭니다.
4. Chrome으로 로컬 Markdown을 열거나 확장 팝업의 **리더 열기**를 선택합니다.

## 원본 파일과 개인정보

체크박스와 메모 변경에는 별도 쓰기 권한이 필요합니다. 메모는 Markdown 끝의 HTML 주석에 저장되고 파일과 함께 전달되며, 원문에 접근할 수 있는 누구나 읽을 수 있습니다. 확장은 문서나 메모를 개발자 서버로 업로드하지 않습니다. 문서의 외부 이미지와 링크는 네트워크 요청을 만들 수 있습니다. [공개 개인정보처리방침](https://bohe76.github.io/markdown-leader/)을 참고하세요.

## 지원

재현 가능한 문제는 [GitHub Issues](https://github.com/bohe76/markdown-leader/issues)에 남겨 주세요.

## 라이선스와 출처

[MIT 라이선스](LICENSE)를 따릅니다. `summereasy/md-reader`의 커밋 `58ee254a6cffbeb28c4a7ce260d4b306dcce8d20`을 기반으로 구성했으며 원 저작권 고지를 보존합니다. 내장 Pretendard 글꼴의 OFL 고지는 `src/assets/fonts/OFL.txt`에 있으며, 빌드가 런타임 의존성 고지 `dist/THIRD_PARTY_NOTICES.txt`를 생성합니다.
