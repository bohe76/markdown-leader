import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownInline } from '../src/content/markdown-inline.mjs'

const md = new MarkdownIt({ html: false, linkify: true, typographer: true }).use(markdownInline)

test('이모지 이름은 Unicode로 표시하고 모르는 이름과 ASCII 표정은 보존한다', () => {
  assert.equal(md.renderInline(':smile: :+1: :sparkles: :heart: :unknown_emoji: :)'), '😄 👍 ✨ ❤️ :unknown_emoji: :)')
})

test('위첨자와 아래첨자를 표시하고 기존 취소선을 유지한다', () => {
  assert.equal(md.renderInline('19^th^ H~2~O ~~삭제~~'), '19<sup>th</sup> H<sub>2</sub>O <s>삭제</s>')
})

test('삽입·강조 안의 기존 Markdown과 이모지가 함께 동작한다', () => {
  assert.equal(md.renderInline('++**추가**++ ==:sparkles: *중요*=='), '<ins><strong>추가</strong></ins> <mark>✨ <em>중요</em></mark>')
})

test('인라인 코드와 코드 블록에는 문법을 적용하지 않는다', () => {
  const literal = ':smile: 19^th^ H~2~O ++추가++ ==강조=='
  assert.equal(md.renderInline('`' + literal + '`'), '<code>' + literal + '</code>')
  assert.equal(md.render('```text\n' + literal + '\n```'), '<pre><code class="language-text">' + literal + '\n</code></pre>\n')
})

test('이스케이프·닫히지 않은 구분자·URL을 변경하지 않는다', () => {
  assert.equal(md.renderInline('\\:smile: 19\\^th^ H\\~2~O \\+\\+추가++ \\=\\=강조=='), ':smile: 19^th^ H~2~O ++추가++ ==강조==')
  assert.equal(md.renderInline('19^th H~2 ++추가 ==강조'), '19^th H~2 ++추가 ==강조')
  assert.equal(md.renderInline('[문서](https://example.com/:smile:)'), '<a href="https://example.com/:smile:">문서</a>')
})

test('확장 문법이 HTML 실행이나 위험한 링크를 허용하지 않는다', () => {
  const html = md.render('==<img src=x onerror=alert(1)>== ++<script>alert(1)</script>++ [위험](javascript:alert(1))')
  assert.doesNotMatch(html, /<img|<script|href="javascript:/i)
  assert.match(html, /&lt;img/)
  assert.match(html, /<mark>/)
  assert.match(html, /<ins>/)
})

test('Typographer와 일반 Unicode 이모지를 유지한다', () => {
  assert.equal(md.renderInline('(c) (tm) 😄 👍 ✨'), '© ™ 😄 👍 ✨')
})
