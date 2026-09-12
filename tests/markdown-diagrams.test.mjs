import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownDiagrams, renderDiagrams, isDiagramSourceAllowed } from '../src/content/markdown-diagrams.mjs'

function fixture(sources) {
  const stages = []
  const doc = { createElement: (tag) => ({ tag, style: {}, children: [], setAttribute() {}, append(...nodes) { this.children.push(...nodes) }, remove() { this.removed = true } }) }
  const blocks = sources.map((source) => ({
    isConnected: true, dataset: {}, children: [],
    querySelector(selector) { return selector === 'pre' ? { querySelector: () => ({ textContent: source }) } : this.children.find((node) => node.tag === selector) },
    replaceChildren(...nodes) { this.children = nodes },
    prepend(node) { this.children.unshift(node) },
  }))
  const content = { isConnected: true, ownerDocument: doc, querySelectorAll: () => blocks, append: (stage) => stages.push(stage) }
  return { content, blocks, stages }
}

const options = { isCurrent: () => true, t: (key) => key }

test('Mermaid만 원문을 보존하는 컨테이너로 렌더링한다', () => {
  const md = new MarkdownIt().use(markdownDiagrams)
  assert.equal(md.render('```js\nx\n```'), new MarkdownIt().render('```js\nx\n```'))
  assert.match(md.render('```mermaid\ngraph TD\nA[<script>]-->B\n```'), /class="ml-diagram".*&lt;script&gt;/s)
})

test('설정 지시문·외부 리소스·큰 입력은 엔진에 전달하지 않는다', async () => {
  const rejected = ['---\nconfig: {}\n---\ngraph TD', '%%{init: {}}%%\ngraph TD', 'graph TD\nA@{img: "//remote/a"}', 'graph TD\nA-->B\nstyle A fill:url(//remote/a)', 'x'.repeat(50_001)]
  for (const source of rejected) assert.equal(isDiagramSourceAllowed(source), false)
  assert.equal(isDiagramSourceAllowed('graph TD\n A[시작] --> B[완료]'), true)
  const { content, blocks } = fixture(rejected)
  let loads = 0
  await renderDiagrams(content, { ...options, loadRenderer: async () => { loads++; throw Error() } })
  assert.equal(loads, 0)
  assert.ok(blocks.every((block) => block.dataset.diagramState === 'fallback'))
})

test('엔진을 불러오는 동안 문서가 바뀌면 렌더링을 시작하지 않는다', async () => {
  const { content, blocks } = fixture(['graph TD\nA-->B'])
  let release
  let rendered = false
  const pending = renderDiagrams(content, { ...options, loadRenderer: () => new Promise((resolve) => { release = resolve }) })
  content.isConnected = false
  release({ renderDiagram: async () => { rendered = true } })
  await pending
  assert.equal(rendered, false)
  assert.deepEqual(blocks[0].dataset, {})
})

test('따옴표·이스케이프·상대 경로 이미지 메타데이터는 엔진 호출 전에 차단한다', async () => {
  const rejected = [
    String.raw`A@{ "img": "//probe.invalid/img.png" }`,
    String.raw`A@{ '\u0069mg': '//probe.invalid/img.png' }`,
    String.raw`A@{ "\u0069mg": "//probe.invalid/img.png" }`,
    String.raw`A@{ "img": "\/\/probe.invalid/img.png" }`,
    String.raw`A@{ "img": "\\\\probe.invalid\\img.png" }`,
    String.raw`A@{ "img": "\x68ttps://probe.invalid/img.png" }`,
    String.raw`A@{ "img": "&#47;&#47;probe.invalid/img.png" }`,
    String.raw`A@{ "icon": "remote:icon", form: circle }`,
    String.raw`A@{ "img": "relative-image.png" }`,
    String.raw`A@{ shape: rect, label: "metadata" }`,
  ].map((node) => `flowchart TD\n${node}`)
  for (const source of rejected) assert.equal(isDiagramSourceAllowed(source), false, source)
  const { content, blocks, stages } = fixture(rejected)
  let loads = 0
  await renderDiagrams(content, { ...options, loadRenderer: async () => { loads++; throw Error('must not load') } })
  assert.equal(loads, 0)
  assert.equal(stages.length, 0)
  assert.ok(blocks.every((block) => block.dataset.diagramState === 'fallback'))
  for (const source of ['flowchart TD\nA[시작] --> B{완료?}', 'sequenceDiagram\nAlice->>Bob: 안녕하세요', 'classDiagram\nAnimal <|-- Duck']) {
    assert.equal(isDiagramSourceAllowed(source), true)
  }
})

test('지연 응답과 지연 실패는 폐기하고 대기 중인 다음 다이어그램도 취소한다', async () => {
  for (const fail of [false, true]) {
    const { content, blocks, stages } = fixture(['graph TD\nA-->B', 'graph TD\nB-->C'])
    let release
    let count = 0
    let current = true
    const pending = renderDiagrams(content, {
      ...options, isCurrent: () => current,
      loadRenderer: async () => ({ renderDiagram: () => { count++; return new Promise((resolve, reject) => { release = fail ? () => reject(Error()) : () => resolve('<svg/>') }) } }),
    })
    await new Promise((resolve) => setImmediate(resolve))
    current = false
    release()
    await pending
    assert.equal(count, 1)
    assert.ok(blocks.every((block) => block.children.length === 0))
    assert.ok(stages.every((stage) => stage.removed))
  }
})

test('한 다이어그램의 실패는 다음 다이어그램 표시를 막지 않는다', async () => {
  const { content, blocks, stages } = fixture(['invalid', 'graph TD\nA-->B'])
  await renderDiagrams(content, { ...options, loadRenderer: async () => ({ renderDiagram: async (source) => {
    if (source === 'invalid') throw Error('parse failed')
    return '<svg></svg>'
  } }) })
  assert.equal(blocks[0].dataset.diagramState, 'fallback')
  assert.equal(blocks[1].dataset.diagramState, 'rendered')
  assert.equal(blocks[1].children[1].children[0].textContent, 'diagramSource')
  assert.ok(stages.every((stage) => stage.removed))
})

test('같은 본문에서 새 렌더링이 시작되면 이전 세대의 결과를 버린다', async () => {
  const { content, blocks } = fixture(['graph TD\nA-->B'])
  let release
  const previous = renderDiagrams(content, { ...options, loadRenderer: async () => ({
    renderDiagram: () => new Promise((resolve) => { release = resolve }),
  }) })
  await new Promise((resolve) => setImmediate(resolve))
  await renderDiagrams(content, { ...options, loadRenderer: async () => ({ renderDiagram: async () => '<svg id="new"/>' }) })
  release('<svg id="old"/>')
  await previous
  assert.equal(blocks[0].children[0].innerHTML, '<svg id="new"/>')
})

test('테마·글꼴이 바뀔 때만 다시 그리고 원문 펼침 상태와 기존 SVG를 유지한다', async () => {
  const { content, blocks } = fixture(['graph TD\nA-->B'])
  let renders = 0
  const loadRenderer = async () => ({ renderDiagram: async () => { renders++; return '<svg id="light"/>' } })
  await renderDiagrams(content, { ...options, colors: { dark: false }, loadRenderer })
  const details = blocks[0].children[1]
  details.open = true
  await renderDiagrams(content, { ...options, colors: { dark: false }, loadRenderer })
  assert.equal(renders, 1)
  let release
  const pending = renderDiagrams(content, { ...options, colors: { dark: true, fontFamily: 'system-ui' }, loadRenderer: async () => ({
    renderDiagram: () => new Promise((resolve) => { release = resolve }),
  }) })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(blocks[0].children[0].innerHTML, '<svg id="light"/>')
  release('<svg id="dark"/>')
  await pending
  assert.equal(blocks[0].children[0].innerHTML, '<svg id="dark"/>')
  assert.equal(blocks[0].children[1], details)
  assert.equal(details.open, true)
})
