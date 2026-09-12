import test from 'node:test'
import assert from 'node:assert/strict'
import { createReviewUI, locateReviewQuote } from '../src/content/review-ui.mjs'
import { writeReview } from '../src/content/review-source.mjs'

test('인용문은 유일하거나 문맥이 유일한 경우에만 연결한다', () => {
  assert.equal(locateReviewQuote('one target two', { quote: 'target' }), 4)
  assert.equal(locateReviewQuote('a target b target', { quote: 'target' }), -1)
  assert.equal(locateReviewQuote('a target b target', { quote: 'target', prefix: ' b ' }), 11)
  assert.equal(locateReviewQuote('a target b target', { quote: 'missing' }), -1)
  assert.equal(locateReviewQuote('anything', { quote: '' }), -1)
})

function setup(onSave) {
  class Element {
    constructor(tag = '') { this.tag = tag; this.children = []; this.events = {}; this.style = {}; this.dataset = {}; this.attributes = {}; this.classes = new Set(); this.classList = { toggle: (key, enabled) => enabled ? this.classes.add(key) : this.classes.delete(key) } }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes) }
    setAttribute(key, value) { this.attributes[key] = value }
    addEventListener(key, fn) { this.events[key] = fn }
    contains(node) { return this === node || this.children.some(child => child === node || child.contains?.(node)) }
    matches(selector) { return selector === '[data-note-id]' ? !!this.dataset.noteId : selector === '[data-review-action=locate]' ? this.dataset.reviewAction === 'locate' : selector === this.tag }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches?.(selector) ? [child] : []), ...(child.querySelectorAll?.(selector) || [])]) }
    closest(selector) { return selector.split(',').some(tag => this.matches(tag.trim())) ? this : this.parentElement?.closest(selector) }
    focus() { document.activeElement = this }
    scrollIntoView() { this.scrolled = true }
    getBoundingClientRect() { return this.rect || { left: 100, right: 1000, top: 100, bottom: 700, width: 900, height: 600 } }
  }
  const document = { events: {}, createElement: tag => new Element(tag), addEventListener(key, fn) { this.events[key] = fn }, createTreeWalker: () => ({ nextNode: () => null }) }
  const window = { events: {}, NodeFilter: { SHOW_TEXT: 4 }, innerHeight: 800, innerWidth: 1200, addEventListener(key, fn) { this.events[key] = fn }, cancelAnimationFrame() {}, getComputedStyle: () => ({ paddingRight: '58px' }), ResizeObserver: class { observe() {} } }
  const content = new Element()
  const ui = createReviewUI({ document, window, content, t: key => key, onSave })
  const panel = ui.element.children[2]
  const list = panel.children[1]
  return { ui, panel, list, document, window, content }
}
const cards = list => list.querySelectorAll('[data-note-id]')
const action = (card, key) => card.querySelectorAll('button').find(button => button.textContent === key)
const quote = card => card.querySelector('blockquote')
const note = { id: 'one', quote: 'target', prefix: '', suffix: '', heading: '', text: 'memo', createdAt: '2026-09-09T00:00:00Z' }

function renderText(context, values) {
  const { document, content } = context
  content.replaceChildren()
  const nodes = values.map((text, index) => {
    const paragraph = document.createElement('p')
    paragraph.rect = { left: 158, right: 942, top: 120 + index * 60, bottom: 150 + index * 60, width: 784, height: 30 }
    const node = { textContent: text, length: text.length, parentElement: paragraph }
    paragraph.append(node)
    content.append(paragraph)
    return node
  })
  document.createTreeWalker = () => {
    let index = 0
    return { nextNode: () => nodes[index++] || null }
  }
  document.createRange = () => ({
    setStart(node, offset) { this.startContainer = node; this.startOffset = offset },
    setEnd(node, offset) { this.endContainer = node; this.endOffset = offset },
    getBoundingClientRect() { return this.startContainer.parentElement.getBoundingClientRect() },
    getClientRects() { return this.endContainer.fragments || [this.getBoundingClientRect()] }
  })
  return nodes
}

test('본문 순서로 번호를 붙이고 삭제 후 재번호하며 미연결 메모는 번호 없이 아래 둔다', async () => {
  const context = setup(async value => writeReview(value.expectedRaw, value.notes))
  const { ui, list } = context
  renderText(context, ['first', 'second'])
  const first = { ...note, id: 'first', quote: 'first' }
  const second = { ...note, id: 'second', quote: 'second' }
  ui.setDocument({ id: 'a', raw: writeReview('body', [note, second, first]), ready: true })
  assert.deepEqual(cards(list).map(card => card.dataset.noteId), ['first', 'second', 'one'])
  assert.deepEqual(cards(list).map(card => card.children[0].children[0].textContent), ['1', '2', 'target'])
  assert.equal(list.children[2].textContent, 'reviewUnlocated')
  await action(cards(list)[0], 'reviewDelete').events.click()
  assert.deepEqual(cards(list).map(card => card.dataset.noteId), ['second', 'one'])
  assert.equal(cards(list)[0].children[0].children[0].textContent, '1')
  assert.equal(ui.element.children[0].querySelectorAll('button')[0].textContent, '1')
})

test('번호와 카드 선택은 같은 강조 상태를 토글하고 원래 드래그도 지운다', () => {
  const context = setup()
  const { ui, list, window } = context
  let cleared = 0
  window.getSelection = () => ({ removeAllRanges() { cleared++ } })
  const nodes = renderText(context, ['target'])
  ui.setDocument({ id: 'a', raw: writeReview('body', [note]), ready: true })
  const marker = ui.element.children[0].querySelectorAll('button')[0]
  const highlight = ui.element.children[0].children[0]
  marker.events.click()
  assert.equal(marker.attributes['aria-pressed'], 'true')
  assert.equal(highlight.hidden, false)
  assert.equal(cards(list)[0].classes.has('is-selected'), true)
  marker.events.click()
  assert.equal(marker.attributes['aria-pressed'], 'false')
  assert.equal(highlight.hidden, true)
  const card = cards(list)[0]
  card.events.click({ target: card })
  assert.equal(nodes[0].parentElement.scrolled, true)
  assert.equal(marker.attributes['aria-pressed'], 'true')
  card.events.click({ target: card })
  assert.equal(marker.attributes['aria-pressed'], 'false')
  assert.equal(cleared, 4)
})

test('첫 메모 편집과 저장은 목록 위치·스크롤·원본 배열 순서를 유지한다', async () => {
  let saved
  const context = setup(async value => { saved = value; return writeReview(value.expectedRaw, value.notes) })
  const { ui, list } = context
  renderText(context, ['first', 'second'])
  const first = { ...note, id: 'first', quote: 'first' }
  const second = { ...note, id: 'second', quote: 'second' }
  ui.setDocument({ id: 'a', raw: writeReview('body', [first, second]), ready: true })
  list.scrollTop = 50
  action(cards(list)[0], 'reviewEdit').events.click()
  assert.deepEqual(cards(list).map(card => card.dataset.noteId), ['first', 'second'])
  assert.equal(list.scrollTop, 50)
  assert.equal(cards(list)[0].children[0].children[0].textContent, '1')
  const input = cards(list)[0].querySelector('textarea')
  input.value = 'edited'
  input.events.input()
  await action(cards(list)[0], 'reviewSave').events.click()
  assert.deepEqual(saved.notes.map(item => item.id), ['first', 'second'])
  assert.deepEqual(cards(list).map(card => card.dataset.noteId), ['first', 'second'])
  assert.equal(cards(list)[0].querySelector('p').textContent, 'edited')
})

test('본문 재배치 시 번호와 목록을 갱신하고 선택 끝 좌표를 따른다', () => {
  const context = setup()
  const { ui, list, content } = context
  renderText(context, ['first', 'second'])
  const first = { ...note, id: 'first', quote: 'first' }
  const second = { ...note, id: 'second', quote: 'second' }
  ui.setDocument({ id: 'a', raw: writeReview('body', [first, second]), ready: true })
  let marker = ui.element.children[0].querySelectorAll('button')[0]
  assert.equal(marker.style.left, '944px')
  assert.equal(marker.style.top, '109px')
  const nodes = renderText(context, ['second', 'first'])
  nodes[0].parentElement.rect.top = 160
  nodes[0].parentElement.rect.right = 700
  content.rect = { right: 900 }
  ui.refreshAnchors()
  assert.deepEqual(cards(list).map(card => card.dataset.noteId), ['second', 'first'])
  marker = ui.element.children[0].querySelectorAll('button')[0]
  assert.equal(marker.style.left, '702px')
  assert.equal(marker.style.top, '149px')
  assert.equal(marker.textContent, '1')
  assert.equal(quote(cards(list)[0]).title, 'second')
})

test('여러 줄 선택은 마지막 글자 끝에 표시하며 패널과 같은 높이의 다른 메모 때문에 옮기지 않는다', () => {
  const context = setup()
  const { ui, panel } = context
  const nodes = renderText(context, ['first', 'second'])
  nodes[0].fragments = [
    { left: 158, right: 900, top: 120, bottom: 150, width: 742, height: 30 },
    { left: 158, right: 680, top: 150, bottom: 180, width: 522, height: 30 }
  ]
  nodes[1].fragments = [{ left: 700, right: 800, top: 150, bottom: 180, width: 100, height: 30 }]
  panel.rect = { left: 600 }
  ui.setDocument({ id: 'a', raw: writeReview('body', [
    { ...note, id: 'first', quote: 'first' }, { ...note, id: 'second', quote: 'second' }
  ]), ready: true })
  const positions = () => ui.element.children[0].querySelectorAll('button').map(marker => [marker.style.left, marker.style.top])
  assert.deepEqual(positions(), [['682px', '139px'], ['802px', '139px']])
  ui.toggle()
  ui.refreshAnchors()
  assert.deepEqual(positions(), [['682px', '139px'], ['802px', '139px']])
})

test('패널 열림 상태는 문서 정리 후에도 유지하고 위치 없는 메모를 보존한다', () => {
  const { ui, panel, list } = setup()
  ui.setDocument({ id: 'a', raw: writeReview('body', [note]), ready: true })
  assert.equal(quote(cards(list)[0]).textContent, 'target')
  assert.equal(action(cards(list)[0], 'reviewLocate').disabled, true)
  assert.equal(list.children[0].textContent, 'reviewUnlocated')
  ui.toggle()
  assert.equal(panel.hidden, false)
  ui.clear()
  assert.equal(list.children.length, 0)
  assert.equal(ui.isOpen(), true)
})

test('이전 문서 저장 완료가 새 문서 메모를 덮어쓰지 않는다', async () => {
  let release
  const request = new Promise(resolve => { release = resolve })
  let saved
  const { ui, list } = setup(value => { saved = value; return request })
  const raw = writeReview('body', [note])
  ui.setDocument({ id: 'a', raw, ready: true })
  const deleting = action(cards(list)[0], 'reviewDelete').events.click()
  assert.equal(saved.documentId, 'a')
  assert.equal(saved.expectedRaw, raw)
  assert.deepEqual(saved.notes, [])
  ui.clear()
  ui.setDocument({ id: 'b', raw: writeReview('new', [{ ...note, text: 'new memo' }]), ready: true })
  release('body')
  await deleting
  assert.equal(cards(list)[0].querySelector('p').textContent, 'new memo')
})

test('저장 거절은 메모를 보존하고 패널에 오류를 표시한다', async () => {
  const { ui, list } = setup(async () => { throw new Error('conflict') })
  ui.setDocument({ id: 'a', raw: writeReview('body', [note]), ready: true })
  await action(cards(list)[0], 'reviewDelete').events.click()
  assert.match(list.children[0].textContent, /conflict/)
  assert.equal(cards(list)[0].querySelector('p').textContent, 'memo')
})

test('앵커 갱신과 같은 문서 재설정은 편집기 노드와 입력을 유지한다', () => {
  const { ui, list } = setup()
  const value = { id: 'a', raw: writeReview('body', [note]), ready: true }
  ui.setDocument(value)
  action(cards(list)[0], 'reviewEdit').events.click()
  const editor = cards(list)[0]
  const input = editor.querySelector('textarea')
  input.value = 'draft in progress'
  input.events.input()
  ui.refreshAnchors()
  ui.setDocument(value)
  assert.equal(cards(list)[0], editor)
  assert.equal(cards(list)[0].querySelector('textarea'), input)
  assert.equal(input.value, 'draft in progress')
  ui.forget('a')
  ui.setDocument(value)
  assert.equal(cards(list)[0].querySelector('p').textContent, 'memo')
})

test('문단 요소 경계의 전체 선택에서도 메모 추가가 표시된다', () => {
  const { ui, document, window, content } = setup()
  ui.setDocument({ id: 'a', raw: 'target', ready: true })
  const paragraph = document.createElement('p')
  content.append(paragraph)
  const node = { length: 6, textContent: 'target' }
  document.createTreeWalker = () => {
    let visited = false
    return { nextNode() { if (visited) return null; visited = true; return node } }
  }
  document.createRange = () => {
    let endpoint
    return { setStart(container, offset) { endpoint = offset }, collapse() {}, comparePoint() { return endpoint === 0 ? 1 : -1 } }
  }
  window.getSelection = () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({
    startContainer: paragraph, startOffset: 0, endContainer: paragraph, endOffset: 1,
    getBoundingClientRect: () => ({ left: 100, bottom: 120 })
  }) })
  window.innerWidth = 1200
  window.innerHeight = 800
  const add = ui.element.children[1]
  add.offsetWidth = 80
  add.offsetHeight = 30
  document.events.pointerdown({ button: 0, pointerId: 1, target: paragraph })
  document.events.selectionchange()
  assert.equal(add.hidden, true, '드래그 중에는 표시하지 않는다')
  document.events.pointerup({ pointerId: 1, clientX: 300, clientY: 120 })
  assert.equal(add.hidden, false)
  assert.equal(add.style.left, '260px')
  assert.equal(add.style.top, '126px')
  document.events.selectionchange()
  assert.equal(add.style.left, '260px', '늦게 도착한 선택 이벤트가 위치를 바꾸지 않는다')
  window.events.wheel()
  assert.equal(add.hidden, true)
  assert.equal(window.getSelection().isCollapsed, false)
  document.events.selectionchange()
  assert.equal(add.hidden, true, '휠로 닫은 버튼을 다시 띄우지 않는다')
  document.events.pointerdown({ button: 0, pointerId: 2, target: paragraph })
  document.events.pointerup({ pointerId: 2, clientX: 120, clientY: 120 })
  assert.equal(add.style.left, '80px', '역방향도 포인터 종료 위치를 따른다')
  document.events.pointerdown({ button: 0, pointerId: 3, target: paragraph })
  window.events.wheel()
  document.events.pointerup({ pointerId: 3, clientX: 120, clientY: 120 })
  assert.equal(add.hidden, true, '휠을 움직인 드래그의 종료에서도 표시하지 않는다')
})

for (const remoteNotes of [[{ ...note, text: 'remote edit' }], []]) {
  test(`편집 중 대상 메모가 ${remoteNotes.length ? '변경' : '삭제'}되면 덮어쓰지 않고 초안을 보존한다`, async () => {
    let calls = 0
    const { ui, list } = setup(async () => { calls++ })
    ui.setDocument({ id: 'a', raw: writeReview('body', [note]), ready: true })
    action(cards(list)[0], 'reviewEdit').events.click()
    const input = cards(list)[0].querySelector('textarea')
    input.value = 'local edit'
    input.events.input()
    ui.setDocument({ id: 'a', raw: writeReview('updated body', remoteNotes), ready: true })
    await action(cards(list)[0], 'reviewSave').events.click()
    assert.equal(calls, 0)
    assert.match(list.children[0].textContent, /reviewNoteChanged/)
    assert.equal(cards(list)[0].querySelector('textarea').value, 'local edit')
  })
}

test('본문만 외부에서 바뀌면 최신 원문을 기준으로 메모 편집을 저장한다', async () => {
  let saved
  const { ui, list } = setup(async value => { saved = value; return writeReview(value.expectedRaw, value.notes) })
  ui.setDocument({ id: 'a', raw: writeReview('body', [note]), ready: true })
  action(cards(list)[0], 'reviewEdit').events.click()
  const input = cards(list)[0].querySelector('textarea')
  input.value = 'local edit'
  input.events.input()
  const remote = writeReview('updated body', [note])
  ui.setDocument({ id: 'a', raw: remote, ready: true })
  await action(cards(list)[0], 'reviewSave').events.click()
  assert.equal(saved.expectedRaw, remote)
  assert.equal(saved.notes[0].text, 'local edit')
  assert.equal(cards(list)[0].querySelector('p').textContent, 'local edit')
})

test('연결이 변경된 같은 내용의 파일에 기존 초안을 저장하지 않고 탭 왕복에도 보존한다', async () => {
  let calls = 0
  const { ui, list } = setup(async value => { calls++; return writeReview(value.expectedRaw, value.notes) })
  const value = { id: 'a', raw: writeReview('body', [note]), ready: true }
  ui.setDocument(value)
  action(cards(list)[0], 'reviewEdit').events.click()
  const input = cards(list)[0].querySelector('textarea')
  input.value = 'local draft'
  input.events.input()
  ui.clear()
  ui.invalidateDraft('a')
  ui.setDocument(value)
  assert.equal(cards(list)[0].querySelector('textarea').value, 'local draft')
  assert.equal(action(cards(list)[0], 'reviewSave').disabled, true)
  await action(cards(list)[0], 'reviewSave').events.click()
  assert.equal(calls, 0)
  assert.match(list.querySelectorAll('p').map(node => node.textContent).join(' '), /reviewDraftReconnected/)
  ui.setDocument({ id: 'b', raw: 'other', ready: true })
  ui.setDocument(value)
  assert.equal(cards(list)[0].querySelector('textarea').value, 'local draft')
  assert.equal(action(cards(list)[0], 'reviewSave').disabled, true)
  action(cards(list)[0], 'reviewCancel').events.click()
  action(cards(list)[0], 'reviewEdit').events.click()
  await action(cards(list)[0], 'reviewSave').events.click()
  assert.equal(calls, 1)
})

test('파일이 잠시 읽히지 않아도 연결이 그대로면 초안을 보존하고 다시 저장한다', async () => {
  let saved
  const { ui, list } = setup(async value => { saved = value; return writeReview(value.expectedRaw, value.notes) })
  const value = { id: 'a', raw: writeReview('body', [note]), ready: true }
  ui.setDocument(value)
  action(cards(list)[0], 'reviewEdit').events.click()
  const input = cards(list)[0].querySelector('textarea')
  input.value = 'preserved draft'
  input.events.input()
  ui.clear()
  ui.setDocument({ id: 'b', raw: 'other', ready: true })
  ui.clear()
  ui.setDocument(value)
  assert.equal(cards(list)[0].querySelector('textarea').value, 'preserved draft')
  await action(cards(list)[0], 'reviewSave').events.click()
  assert.equal(saved.notes[0].text, 'preserved draft')
})

test('새 메모 초안도 재연결 후 입력을 유지하되 저장하지 않는다', async () => {
  let calls = 0
  const context = setup(async () => { calls++ })
  const { ui, list, window } = context
  const [node] = renderText(context, ['target'])
  window.crypto = { randomUUID: () => 'draft-new' }
  window.getSelection = () => ({ rangeCount: 1, isCollapsed: false, getRangeAt: () => ({
    startContainer: node, startOffset: 0, endContainer: node, endOffset: 6,
    getBoundingClientRect: () => ({ left: 100, bottom: 120 })
  }) })
  ui.setDocument({ id: 'a', raw: 'target', ready: true })
  window.innerWidth = 1200
  window.innerHeight = 800
  context.document.events.keyup({ key: 'Shift' })
  ui.element.children[1].events.click()
  let input = cards(list)[0].querySelector('textarea')
  input.value = 'new unsaved note'
  input.events.input()
  ui.invalidateDraft('a')
  renderText(context, ['another document'])
  ui.setDocument({ id: 'a', raw: writeReview('another document', [note]), ready: true })
  const savedCard = cards(list).find(card => card.dataset.noteId === note.id)
  assert.equal(action(savedCard, 'reviewEdit').disabled, true)
  action(savedCard, 'reviewEdit').events.click()
  ui.element.children[1].events.click()
  const draftCard = cards(list).find(card => card.dataset.noteId === 'draft-new')
  input = draftCard.querySelector('textarea')
  assert.equal(input.value, 'new unsaved note')
  assert.equal(input.disabled, false, '복사할 수 있도록 입력란은 유지한다')
  input.value = 'still unsaved'
  input.events.input()
  assert.equal(action(draftCard, 'reviewSave').disabled, true)
  await action(draftCard, 'reviewSave').events.click()
  assert.equal(calls, 0)
})

test('저장 중 재연결되면 늦은 저장 완료도 보존한 초안을 지우지 않는다', async () => {
  let finish
  const request = new Promise(resolve => { finish = resolve })
  const { ui, list } = setup(() => request)
  const raw = writeReview('body', [note])
  ui.setDocument({ id: 'a', raw, ready: true })
  action(cards(list)[0], 'reviewEdit').events.click()
  const input = cards(list)[0].querySelector('textarea')
  input.value = 'in flight draft'
  input.events.input()
  const pending = action(cards(list)[0], 'reviewSave').events.click()
  ui.invalidateDraft('a')
  ui.clear()
  ui.setDocument({ id: 'a', raw, ready: true })
  finish(writeReview('body', [{ ...note, text: 'in flight draft' }]))
  await pending
  assert.equal(cards(list)[0].querySelector('textarea').value, 'in flight draft')
  assert.equal(action(cards(list)[0], 'reviewSave').disabled, true)
  assert.equal(action(cards(list)[0], 'reviewCancel').disabled, false)
})
