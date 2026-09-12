import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownComments } from '../src/content/markdown-comments.mjs'

const md = new MarkdownIt({ html: false, typographer: true }).use(markdownComments)

test('독립된 HTML 주석과 여러 줄 주석은 숨기고 주변 문서를 유지한다', () => {
  assert.equal(md.render('# 제목\n\n<!-- USER:OMX:POLICY:START -->\n\n본문'), '<h1>제목</h1>\n<p>본문</p>\n')
  assert.equal(md.render('앞\n<!-- 숨김\n\n# 숨긴 제목\n-->\n뒤'), '<p>앞</p>\n<p>뒤</p>\n')
  assert.equal(md.render('<!-- 하나 -->\n<!-- 둘 -->'), '')
})

test('문장 안 주석은 공백과 주변 인라인 서식을 보존한다', () => {
  assert.equal(md.renderInline('앞<!-- 숨김 -->뒤'), '앞뒤')
  assert.equal(md.renderInline('앞 <!-- 여러\n줄 --> **뒤**'), '앞  <strong>뒤</strong>')
  assert.equal(md.renderInline('**앞<!-- 숨김 -->뒤**'), '<strong>앞뒤</strong>')
  assert.equal(md.render('<!-- 숨김 --> **보임**'), '<p><strong>보임</strong></p>\n')
  assert.equal(md.render('<!-- 여러\n줄 --> 뒤<!-- 숨김 -->끝'), '<p>뒤끝</p>\n')
})

test('코드 블록과 인라인 코드의 주석은 문자 그대로 표시한다', () => {
  const literal = '<!-- USER:OMX:POLICY:START -->'
  const escaped = '&lt;!-- USER:OMX:POLICY:START --&gt;'
  assert.equal(md.renderInline('`' + literal + '`'), '<code>' + escaped + '</code>')
  assert.equal(md.render('```html\n' + literal + '\n```'), '<pre><code class="language-html">' + escaped + '\n</code></pre>\n')
  assert.equal(md.render('~~~\n' + literal + '\n~~~'), '<pre><code>' + escaped + '\n</code></pre>\n')
  assert.equal(md.render('    ' + literal), '<pre><code>' + escaped + '\n</code></pre>\n')
})

test('이스케이프와 엔티티로 작성한 주석 구분자는 숨기지 않는다', () => {
  assert.match(md.render('\\<!-- 보임 -->'), /&lt;!-- 보임/)
  assert.match(md.render('&lt;!-- 보임 --&gt;'), /&lt;!-- 보임/)
})

test('닫히지 않은 블록 주석은 블록 끝까지 숨기고 문장 안 주석은 보존한다', () => {
  assert.equal(md.render('<!-- 숨김\n\n# 숨김'), '')
  assert.match(md.render('앞 <!-- 미완성'), /앞 &lt;!-- 미완성/)
  assert.equal(md.render('> <!-- 숨김\n\n밖'), '<blockquote></blockquote>\n<p>밖</p>\n')
})

test('목록과 인용문 안의 주석은 해당 블록 범위에서만 숨긴다', () => {
  assert.equal(md.render('> <!-- 숨김 -->\n> 보임'), '<blockquote>\n<p>보임</p>\n</blockquote>\n')
  assert.equal(md.render('- 앞 <!-- 숨김 --> 뒤\n- 다음'), '<ul>\n<li>앞  뒤</li>\n<li>다음</li>\n</ul>\n')
})

test('주석을 숨겨도 HTML 실행 차단과 원본을 유지한다', () => {
  const source = '<!-- 숨김 -->\r\n<img src=x onerror=alert(1)>\r\n<script>alert(1)</script>'
  const html = md.render(source)
  assert.equal(md.options.html, false)
  assert.equal(source, '<!-- 숨김 -->\r\n<img src=x onerror=alert(1)>\r\n<script>alert(1)</script>')
  assert.doesNotMatch(html, /<img|<script|숨김/)
  assert.match(html, /&lt;img/)
  assert.match(html, /&lt;script/)
  assert.doesNotMatch(md.render('<!-- 숨김 --> <img src=x onerror=alert(1)>'), /<img/)
})
