import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import definitions from 'markdown-it-deflist'
import { markdownAlerts } from '../src/content/markdown-alerts.mjs'
import { markdownFootnotes } from '../src/content/markdown-footnotes.mjs'
import { createTranslator } from '../src/i18n.mjs'

function parser(language = 'ko') {
  const t = createTranslator(language)
  return new MarkdownIt({ html: false }).use(markdownAlerts, { t }).use(markdownFootnotes, { t }).use(definitions)
}

test('다섯 안내 박스 제목은 UI 언어를 따르고 사용자 지정 제목은 보존한다', () => {
  for (const [language, expected] of [['ko', ['참고', '팁', '중요', '경고', '주의']], ['en', ['Note', 'Tip', 'Important', 'Warning', 'Caution']]]) {
    const md = parser(language)
    for (const [index, type] of ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].entries()) {
      const html = md.render(`> [!${type}]\n> 본문 **강조**`)
      assert.ok(html.includes(`>${expected[index]}</p>`))
      assert.match(html, /<strong>강조<\/strong>/)
    }
    assert.match(md.render('> [!NOTE] 사용자 제목\n> 설명'), />사용자 제목<\/p>/)
  }
})

test('박스의 사용자 제목과 본문 HTML 및 코드 안의 문법은 실행하지 않는다', () => {
  const md = parser()
  const html = md.render('> [!NOTE] <img src=x onerror=alert(1)>\n> <script>bad()</script>')
  assert.doesNotMatch(html, /<img|<script/)
  assert.match(html, /&lt;img/)
  assert.doesNotMatch(md.render('```md\n> [!TIP]\n> 설명\n```'), /class="markdown-alert/)
  assert.match(md.render('> 일반 인용'), /<blockquote>/)
})

test('각주 참조와 복귀 링크를 만들고 다음 문서에 각주가 남지 않는다', () => {
  const md = parser()
  const html = md.render('설명[^a]\n\n[^a]: 각주 **내용**')
  assert.match(html, /href="#fn1"/)
  assert.match(html, /href="#fnref1"/)
  assert.match(html, /aria-label="본문으로 돌아가기"/)
  assert.match(html, /<strong>내용<\/strong>/)
  assert.doesNotMatch(md.render('다음 문서'), /footnotes/)
  assert.doesNotMatch(md.render('`설명[^a]`'), /footnote-ref/)
})

test('용어 정의와 Markdown 설명을 표시하고 일반 문장을 유지한다', () => {
  const md = parser()
  assert.match(md.render('용어\n: **정의**'), /<dl>[\s\S]*<dt>용어<\/dt>[\s\S]*<dd><strong>정의<\/strong><\/dd>/)
  assert.equal(md.render('일반 문장'), '<p>일반 문장</p>\n')
})
