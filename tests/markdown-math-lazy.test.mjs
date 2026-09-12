import test from 'node:test'
import assert from 'node:assert/strict'
import { renderMath } from '../src/content/markdown-math.mjs'

function fixture(sources) {
  const links = []
  const doc = {
    head: { append: (link) => links.push(link) },
    createElement: (tag) => ({ tag, dataset: {}, remove() { this.removed = true } }),
  }
  const blocks = sources.map((source) => ({
    isConnected: true, dataset: { mathState: 'pending', displayMode: 'inline' },
    innerHTML: '', children: [], classes: [],
    querySelector() { return { textContent: source } },
    replaceChildren(...children) { this.children = children },
    classList: { add() {} },
  }))
  const content = {
    isConnected: true, ownerDocument: doc,
    querySelectorAll: () => blocks.filter((block) => block.dataset.mathState === 'pending'),
    contains: (block) => blocks.includes(block),
  }
  return { content, blocks, links }
}

const options = {
  isCurrent: () => true,
  t: () => '수식을 표시할 수 없습니다.',
  loadStyles: async () => {},
  loadRenderer: async () => ({ renderMathSource: (source) => `<math>${source}</math>` }),
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

test('수식이 없거나 대상이 닫히면 엔진과 CSS를 요청하지 않는다', async () => {
  for (const sources of [[], ['x']]) {
    const { content } = fixture(sources)
    if (sources.length) content.isConnected = false
    let loads = 0
    await renderMath(content, { ...options, loadRenderer: () => { loads++ }, loadStyles: () => { loads++ } })
    assert.equal(loads, 0)
  }
})

test('수식마다 실패 안내와 원문을 보존하고 다음 수식 표시를 계속한다', async () => {
  const { content, blocks } = fixture(['<b>invalid</b>', 'x'])
  await renderMath(content, { ...options, loadRenderer: async () => ({ renderMathSource(source) {
    if (source.startsWith('<')) throw Error('invalid')
    return '<math>x</math>'
  } }) })
  assert.equal(blocks[0].dataset.mathState, 'fallback')
  assert.equal(blocks[0].children[0].textContent, '수식을 표시할 수 없습니다.')
  assert.equal(blocks[0].children[2].textContent, '<b>invalid</b>')
  assert.equal(blocks[1].dataset.mathState, 'rendered')
})

test('엔진 또는 CSS 로딩 실패는 안전한 원문 안내로 끝난다', async () => {
  for (const loader of ['loadRenderer', 'loadStyles']) {
    const { content, blocks } = fixture(['x'])
    await renderMath(content, { ...options, [loader]: async () => { throw Error('load failed') } })
    assert.equal(blocks[0].dataset.mathState, 'fallback')
    assert.equal(blocks[0].children[2].textContent, 'x')
  }
})

test('비동기 엔진·CSS·수식 결과 대기 중 문서가 바뀌면 늦은 결과를 버린다', async () => {
  for (const boundary of ['engine', 'styles', 'formula']) {
    const { content, blocks } = fixture(['x', 'y'])
    let release
    let current = true
    const delayed = () => new Promise((resolve) => { release = resolve })
    const renderOptions = { ...options, isCurrent: () => current }
    if (boundary === 'engine') renderOptions.loadRenderer = delayed
    if (boundary === 'styles') renderOptions.loadStyles = delayed
    if (boundary === 'formula') renderOptions.loadRenderer = async () => ({ renderMathSource: delayed })
    const pending = renderMath(content, renderOptions)
    await tick()
    current = false
    release(boundary === 'engine' ? { renderMathSource: () => '<math/>' } : '<math/>')
    await pending
    assert.ok(blocks.every((block) => block.dataset.mathState === 'pending'))
    assert.ok(blocks.every((block) => block.innerHTML === ''))
  }
})

test('닫히거나 제거된 수식의 늦은 실패는 화면을 바꾸지 않는다', async () => {
  const { content, blocks } = fixture(['x'])
  let reject
  const pending = renderMath(content, { ...options, loadRenderer: () => new Promise((_, fail) => { reject = fail }) })
  content.isConnected = false
  blocks[0].isConnected = false
  reject(Error('late'))
  await pending
  assert.equal(blocks[0].dataset.mathState, 'pending')
})

test('새 세대가 이전 결과를 덮고 같은 수식의 재호출은 DOM을 보존한다', async () => {
  const { content, blocks } = fixture(['x'])
  let release
  const previous = renderMath(content, { ...options, loadRenderer: () => new Promise((resolve) => { release = resolve }) })
  await renderMath(content, options)
  release({ renderMathSource: () => '<math>old</math>' })
  await previous
  let loads = 0
  await renderMath(content, { ...options, loadRenderer: () => { loads++ } })
  assert.equal(loads, 0)
  assert.equal(blocks[0].innerHTML, '<math>x</math>')
})

test('수식 사이에 브라우저로 제어를 돌려주고 취소를 검사한다', async () => {
  const { content, blocks } = fixture(['x', 'y'])
  let current = true
  await renderMath(content, { ...options, isCurrent: () => current, loadRenderer: async () => ({
    renderMathSource: () => { setTimeout(() => { current = false }, 0); return '<math>x</math>' },
  }) })
  assert.equal(blocks[0].dataset.mathState, 'rendered')
  assert.equal(blocks[1].dataset.mathState, 'pending')
})

test('기본 CSS 로더는 문서별 링크를 공유하고 실패 링크를 제거한다', async () => {
  const original = globalThis.chrome
  globalThis.chrome = { runtime: { getURL: (path) => `chrome-extension://test/${path}` } }
  try {
    const { content, blocks, links } = fixture(['x'])
    const first = renderMath(content, { ...options, loadStyles: undefined })
    const second = renderMath(content, { ...options, loadStyles: undefined })
    assert.equal(links.length, 1)
    links[0].onload()
    await Promise.all([first, second])
    assert.equal(blocks[0].dataset.mathState, 'rendered')
    const failed = fixture(['y'])
    const loading = renderMath(failed.content, { ...options, loadStyles: undefined })
    failed.links[0].onerror()
    await loading
    assert.equal(failed.links[0].removed, true)
    assert.equal(failed.blocks[0].dataset.mathState, 'fallback')
  } finally {
    if (original === undefined) delete globalThis.chrome
    else globalThis.chrome = original
  }
})
