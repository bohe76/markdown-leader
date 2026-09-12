---
title: 소스 출처와 MVP 구성
description: 기반 저장소, 재사용 범위와 라이선스 고지
---

# 소스 출처와 MVP 구성

- 도입일: 2026-09-07
- 기반 저장소: https://github.com/summereasy/md-reader
- 기준 커밋: `58ee254a6cffbeb28c4a7ce260d4b306dcce8d20`
- 라이선스: MIT, 루트 `LICENSE`의 Bener 및 Wei/summereasy 고지 보존

## 재사용과 변경

원본 포크의 파일 URL·디렉터리 목록 파싱 방식을 기반으로 읽기 전용 MVP를 구성했다. 원본 앱 전체를 동일하게 유지한 복제본은 아니다.

- 폴더 목록 파싱과 URL 처리 기반을 재사용했다.
- 읽기 화면과 설정 UI는 작은 TypeScript content script로 다시 구성했다.
- Markdown 파서는 `markdown-it`, 코드 강조는 `highlight.js`를 사용한다.
- Vue UI와 고급 플러그인 설정은 포함하지 않는다. 초기 MVP에서 제외했던 Mermaid와 KaTeX는 0.8.0에서 별도로 통합했다. 현재 지원 범위는 [지원 기능](../../README.ko.md#주요-기능)을 따른다.
- 초기 MVP에서 제외했던 원본 쓰기는 0.12.0부터 체크박스 변경과 검토 메모 저장·수정·삭제에 한해 지원한다. 저장 형식과 안전장치·제한은 [검토 메모 저장 형식](../design/review_note_format.md)을 따른다. 일반 Markdown 편집과 HTML 내보내기는 포함하지 않는다.
- 로컬 파일에만 적용되는 Manifest V3 확장으로 구성한다.
- 자동 갱신 주기, 요청 중복 방지, 폴더 갱신과 스크롤 복원을 추가한다.
- 공식 Markdown Reader 3.x 비공개 설치 패키지의 코드는 사용하지 않는다.

## 내장 글꼴

- Pretendard Variable v1.3.9, 원본 WOFF2 약 2MB를 변경 없이 포함한다.
- 출처: https://github.com/orioncactus/pretendard/tree/v1.3.9
- 저작권: Kil Hyung-jin, 라이선스 SIL Open Font License 1.1.
- 라이선스 파일: `src/assets/fonts/OFL.txt`, 빌드 시 `dist/assets/fonts/OFL.txt`로 복사된다.
- Pretendard 선택 시 확장에 내장된 글꼴을 사용하며 CDN 요청이나 OS 글꼴 설치가 필요 없다. 시스템 글꼴 선택 시 운영체제의 UI 글꼴을 사용한다.
- 수식용 KaTeX 글꼴은 설치 패키지의 `dist/fonts`에서 빌드의 `assets/katex`로 복사한다. 런타임 의존성과 전이 의존성의 라이선스 고지는 실제 설치 버전에서 수집해 `dist/THIRD_PARTY_NOTICES.txt`에 포함한다.

## 향후 유지보수

기준 커밋 이후 upstream 변경은 필요한 항목을 검토해 선별 반영한다. 의존성 실제 버전은 `pnpm-lock.yaml`을 기준으로 재현한다.
