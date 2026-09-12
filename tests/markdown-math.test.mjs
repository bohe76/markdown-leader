import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownMath } from '../src/content/markdown-math.mjs'
import { markdownInline } from '../src/content/markdown-inline.mjs'
import { renderMathSource } from '../src/content/math-renderer.mjs'

const md = new MarkdownIt({ html: false }).use(markdownInline).use(markdownMath, {
  t: (key) => key === 'mathRenderFailed' ? '수식을 표시할 수 없습니다.' : '',
})

test('초기 수식은 엔진 없이 안전한 원문을 먼저 제공한다', () => {
  const inline = md.renderInline('$x^2 + y_1$')
  assert.match(inline, /class="ml-math" data-math-state="pending" data-display-mode="inline"><code>x\^2 \+ y_1<\/code>/)
  assert.match(md.render('$$\n\\frac{a}{b}\n$$'), /data-display-mode="block"/)
  assert.match(md.renderInline('$<script>$'), /&lt;script&gt;/)
  assert.doesNotMatch(inline, /class="katex"/)
})

test('지연 엔진은 인라인·블록 HTML과 접근 가능한 MathML 원문을 제공한다', () => {
  const inline = renderMathSource('x^2 + y_1', false)
  assert.match(inline, /<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/)
  assert.match(inline, /<annotation encoding="application\/x-tex">x\^2 \+ y_1<\/annotation>/)
  assert.match(inline, /class="katex-html" aria-hidden="true"/)
  assert.match(renderMathSource('\\frac{a}{b}', true), /class="katex-display"/)
})

test('통화·이스케이프·닫히지 않은 수식과 코드는 그대로 유지한다', () => {
  assert.equal(md.renderInline('Price $5 and $10.'), 'Price $5 and $10.')
  assert.equal(md.renderInline('\\$x\\$ and $ unfinished'), '$x$ and $ unfinished')
  assert.equal(md.renderInline('`$x^2$`'), '<code>$x^2$</code>')
  assert.equal(md.render('```math\n$x^2$\n```'), '<pre><code class="language-math">$x^2$\n</code></pre>\n')
})

test('잘못된 수식은 엔진에서 실패하며 다음 정상 수식에는 영향이 없다', () => {
  assert.throws(() => renderMathSource('\\unknown{<script>alert(1)</script>}', false))
  assert.match(renderMathSource('x', false), /class="katex"/)
})

test('HTML 매크로·위험한 링크·외부 이미지 명령을 허용하지 않는다', () => {
  for (const source of [
    '\\href{javascript:alert(1)}{click}',
    '\\href{https://example.com}{click}',
    '\\htmlClass{attacker}{x}',
    '\\htmlId{attacker}{x}',
    '\\includegraphics{https://example.com/track.png}',
  ]) {
    const html = renderMathSource(source, false)
    assert.doesNotMatch(html, /<a\b|<img\b|class="attacker"|id="attacker"|href="javascript:/i)
  }
})

test('매크로 반복은 제한하고 수식 사이에 정의를 공유하지 않는다', () => {
  assert.throws(() => renderMathSource('\\def\\loop{\\loop}\\loop', false))
  renderMathSource('\\gdef\\owned{x}', false)
  assert.throws(() => renderMathSource('\\owned', false))
})

test('사용자 지정 수식 크기는 20em으로 제한한다', () => {
  const html = renderMathSource('\\rule{999em}{999em}', false)
  assert.doesNotMatch(html, /999em(?=[;"<])/)
  assert.match(html, /20em/)
  assert.doesNotMatch(html, /ml-math-error/)
})
