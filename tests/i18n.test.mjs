import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createTranslator } from '../src/i18n.mjs'

test('한국어 지역 코드는 한국어이며 그 외 언어는 영어로 표시한다', () => {
  assert.equal(createTranslator('ko-KR')('popupOpenSettings'), '확장 프로그램 설정 열기')
  assert.equal(createTranslator('ko')('popupOpenSettings'), '확장 프로그램 설정 열기')
  for (const locale of ['en', 'en-US', 'ja', 'fr', '']) {
    assert.equal(createTranslator(locale)('popupOpenSettings'), 'Open extension settings')
  }
})

test('Chrome 메시지 자리표시자를 대입하고 원본 오류 문자는 재해석하지 않는다', () => {
  assert.equal(createTranslator('ko')('errorReadTimeout', 4), '파일 읽기 시간 초과 (4초)')
  assert.equal(createTranslator('en')('errorReadTimeout', ['4']), 'File read timeout (4s)')
  const detail = '$1 <tag> & detail'
  assert.ok(createTranslator('en')('errorFileReadAdvice', detail).endsWith(`(${detail})`))
})

test('번역은 Chrome API 연결에 의존하지 않아 연결 무효화 뒤에도 사용할 수 있다', () => {
  const translate = createTranslator('ko')
  assert.equal(translate('popupFileAccessAllowed'), '파일 URL 접근이 허용되어 있습니다.')
  assert.match(translate('errorConnectionInvalidated', 'Extension context invalidated.'), /F5/)
  assert.equal(translate('missingMessage'), '')
})

test('Chrome 메시지 catalog는 같은 키와 자리표시자 계약을 유지한다', () => {
  const english = JSON.parse(readFileSync(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'))
  const korean = JSON.parse(readFileSync(new URL('../src/_locales/ko/messages.json', import.meta.url), 'utf8'))
  assert.deepEqual(Object.keys(english).sort(), Object.keys(korean).sort())
  for (const key of Object.keys(english)) {
    assert.ok(english[key].message && korean[key].message, key)
    assert.deepEqual(english[key].placeholders, korean[key].placeholders, key)
    for (const entry of [english[key], korean[key]]) {
      const references = [...entry.message.matchAll(/\$([a-z0-9_]+)\$/gi)].map((match) => match[1].toLowerCase())
      assert.deepEqual([...new Set(references)].sort(), Object.keys(entry.placeholders || {}).sort(), key)
    }
  }
  const manifest = readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8')
  for (const match of manifest.matchAll(/__MSG_(\w+)__/g)) assert.ok(english[match[1]], match[1])
})
