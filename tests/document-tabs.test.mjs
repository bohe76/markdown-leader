import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocumentTabStrip } from '../src/content/document-tabs.mjs'

function setup() {
  let disconnected = false
  const timers = new Map()
  let timerId = 0
  const doc = { activeElement: null, defaultView: { setInterval(fn) { timers.set(++timerId, fn); return timerId }, clearInterval(id) { timers.delete(id) }, ResizeObserver: class {
    observe() {}
    disconnect() { disconnected = true }
  } } }
  class Element {
    constructor() {
      this.children = []; this.attributes = {}; this.events = {}; this.style = {}
      this.clientWidth = 400; this.offsetWidth = 28; this.offsetLeft = 0
      this.scrollWidth = 400; this.scrollLeft = 0; this.writes = 0
      const classes = new Set()
      this.classList = { add: (...names) => names.forEach((name) => classes.add(name)), remove: (...names) => names.forEach((name) => classes.delete(name)), toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: (name) => classes.has(name) }
    }
    setAttribute(key, value) { this.attributes[key] = value; this.writes++ }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node) } }
    insertBefore(node, reference) { node.remove(); node.parentElement = this; this.children.splice(reference ? this.children.indexOf(reference) : this.children.length, 0, node) }
    getBoundingClientRect() { return { left: 0, right: this.clientWidth } }
    addEventListener(name, action) { (this.events[name] ??= []).push(action) }
    dispatch(name, event = {}) { for (const action of this.events[name] || []) action(event) }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)) }
    remove() {
      if (this.contains(doc.activeElement)) doc.activeElement = null
      if (this.parentElement) this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1)
      this.parentElement = null
    }
    focus(options) { doc.activeElement = this; this.focusOptions = options; this.dispatch('focus') }
    get firstElementChild() { return this.children[0] }
    get lastElementChild() { return this.children.at(-1) }
    get previousElementSibling() { return this.parentElement.children[this.parentElement.children.indexOf(this) - 1] }
    get nextElementSibling() { return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] }
  }
  doc.createElement = doc.createElementNS = () => new Element()
  const calls = []
  const strip = createDocumentTabStrip({ document: doc, t: (key, value) => `${key}${value || ''}`,
    onPin: (id) => calls.push(`pin:${id}`), onFavorite: (id) => calls.push(`favorite:${id}`), onReorder: (ids) => calls.push(['reorder', ...ids]),
    onAdd: () => calls.push('add'), onSelect: (id) => calls.push(`select:${id}`), onClose: (id) => calls.push(`close:${id}`) })
  const list = strip.element.children[1]
  return { strip, list, calls, timers, focused: () => doc.activeElement, disconnected: () => disconnected }
}

test('탭 추가와 활성 전환은 기존 노드를 유지하고 이전·새 활성 탭만 변경한다', () => {
  const { strip, list } = setup()
  assert.equal(strip.element.hidden, true)
  for (let id = 0; id < 100; id++) strip.add({ id: String(id), title: `${id}.md`, description: `/docs/${id}.md` })
  const nodes = [...list.children]
  strip.select('0')
  const untouchedWrites = nodes[50].firstElementChild.writes
  strip.select('99')
  assert.deepEqual(list.children, nodes)
  assert.equal(nodes[50].firstElementChild.writes, untouchedWrites)
  assert.equal(nodes[0].firstElementChild.attributes['aria-selected'], 'false')
  assert.equal(nodes[99].firstElementChild.attributes['aria-selected'], 'true')
  assert.equal(nodes[99].firstElementChild.id, 'ml-document-tab-99')
  assert.equal(nodes[99].firstElementChild.title, '99.md\n/docs/99.md')
  strip.add({ id: '99', title: 'duplicate' })
  assert.equal(list.children.length, 100)
  strip.setDescription('99', '/folder/99.md')
  assert.equal(list.children[99], nodes[99])
  assert.equal(nodes[99].firstElementChild.title, '99.md\n/folder/99.md')
})

test('방향 키는 포커스만 이동하고 클릭·Delete·추가만 동작을 요청한다', () => {
  const { strip, list, calls } = setup()
  strip.add({ id: 'a', title: 'a.md' }); strip.add({ id: 'b', title: 'b.md' })
  strip.select('a')
  const [first, second] = list.children.map((item) => item.firstElementChild)
  first.dispatch('keydown', { key: 'ArrowRight', preventDefault() {} })
  assert.deepEqual(calls, [])
  assert.equal(first.tabIndex, -1)
  assert.equal(second.tabIndex, 0)
  assert.deepEqual(second.focusOptions, { preventScroll: true })
  second.dispatch('click')
  second.dispatch('keydown', { key: 'Delete', preventDefault() {} })
  strip.element.lastElementChild.dispatch('click')
  assert.deepEqual(calls, ['select:b', 'close:b', 'add'])
})

test('넘침 화살표는 문서를 바꾸지 않고 가로 이동하며 선택 탭만 가로로 노출한다', () => {
  const { strip, list, calls } = setup()
  for (let id = 0; id < 5; id++) strip.add({ id, title: `${id}.md` })
  list.clientWidth = 300; list.scrollWidth = 560
  assert.equal(strip.element.children[0].hidden, false)
  strip.element.children[2].dispatch('click')
  assert.equal(list.scrollLeft, 240)
  assert.deepEqual(calls, [])
  list.children[0].offsetLeft = 7; list.children[0].offsetWidth = 180
  strip.select(0)
  assert.equal(list.scrollLeft, 0)
  strip.setBounds(350, 600)
  assert.equal(strip.element.style.left, '350px')
  assert.equal(strip.element.style.width, '600px')
  list.scrollLeft = 200
  strip.setBounds(350, 600)
  assert.equal(list.scrollLeft, 200, '문서 높이만 바뀌면 사용자가 이동한 탭 목록을 유지한다')
})

test('닫은 탭은 제거하고 마지막 탭을 닫으면 숨기며 관찰자를 정리한다', () => {
  const { strip, list, disconnected } = setup()
  strip.add({ id: 'a', title: 'a.md' }); strip.add({ id: 'b', title: 'b.md' })
  list.children[0].firstElementChild.focus({ preventScroll: true })
  const remaining = list.children[1].firstElementChild
  strip.remove('a')
  assert.equal(remaining.tabIndex, 0)
  assert.deepEqual(remaining.focusOptions, { preventScroll: true })
  strip.remove('b')
  assert.equal(strip.element.hidden, true)
  assert.equal(list.children.length, 0)
  strip.dispose()
  assert.equal(disconnected(), true)
})


test('핀과 즐겨찾기는 선택 없이 토글 요청하고 핀 그룹을 앞에 유지한다', () => {
  const { strip, list, calls } = setup()
  for (const id of ['a', 'b', 'c']) strip.add({ id, title: id })
  const nodes = [...list.children]
  const pin = nodes[1].children.find(node => node.className.split(' ').includes('ml-document-tab-pin'))
  const favorite = nodes[1].children.find(node => node.className.split(' ').includes('ml-document-tab-favorite'))
  pin.dispatch('click')
  favorite.dispatch('click')
  assert.deepEqual(calls, ['pin:b', 'favorite:b'])
  strip.setFlags('b', { pinned: true, favorite: true })
  assert.deepEqual(strip.getOrder(), ['b', 'a', 'c'])
  assert.equal(list.children[0], nodes[1])
  assert.equal(pin.attributes['aria-pressed'], 'true')
  strip.setOrder(['c', 'a', 'b'])
  assert.deepEqual(strip.getOrder(), ['b', 'c', 'a'])
  strip.setFlags('b', { pinned: false, favorite: false })
  assert.equal(favorite.attributes['aria-pressed'], 'false')
})

function dragEvent(x = 0, types = []) {
  return { clientX: x, preventDefault() {}, stopPropagation() {}, dataTransfer: { types, setData() {} } }
}

for (const overflow of [false, true]) {
  for (const active of ['2', '7']) {
    test(`고정·해제는 문서 ${active}의 활성 상태와 해제 스크롤을 유지한다 (넘침 ${overflow})`, () => {
      const { strip, list, calls, focused } = setup()
      for (const id of ['1', '2', '3', '4', '5', '6', '7']) strip.add({ id, title: id })
      for (const node of list.children) {
        Object.defineProperty(node, 'offsetLeft', { get: () => list.children.indexOf(node) * 180 })
        node.offsetWidth = 180
      }
      list.clientWidth = overflow ? 400 : 1400; list.scrollWidth = 1260
      strip.select(active)
      for (const id of ['3', '2', '1']) {
        list.scrollLeft = overflow ? 860 : 0
        strip.setFlags(id, { pinned: true })
        assert.equal(strip.getOrder()[0], id)
        assert.equal(list.scrollLeft, 0, '새 고정은 항상 맨 왼쪽으로 이동한다')
      }
      assert.deepEqual(strip.getOrder(), ['1', '2', '3', '4', '5', '6', '7'])
      list.scrollLeft = overflow ? 120 : 0
      const pin = list.children[1].children.find(node => node.className.split(' ').includes('ml-document-tab-pin'))
      pin.focus()
      strip.setFlags('2', { pinned: false })
      assert.deepEqual(strip.getOrder(), ['1', '3', '2', '4', '5', '6', '7'])
      assert.equal(list.scrollLeft, overflow ? 120 : 0)
      assert.equal(focused(), pin, '정렬 변경 후에도 버튼 포커스를 유지한다')
      strip.setFlags('2', { pinned: false, favorite: true })
      assert.equal(list.scrollLeft, overflow ? 120 : 0, '즐겨찾기도 스크롤을 유지한다')
      const selected = list.children.filter((node) => node.firstElementChild.attributes['aria-selected'] === 'true')
      assert.deepEqual(selected.map((node) => node.firstElementChild.textContent), [active])
      const lastPin = list.lastElementChild.children.find(node => node.className.split(' ').includes('ml-document-tab-pin'))
      lastPin.focus()
      strip.setFlags('7', { pinned: true })
      assert.equal(focused(), lastPin)
      assert.deepEqual(lastPin.focusOptions, { preventScroll: true })
      assert.equal(list.scrollLeft, 0)
      assert.deepEqual(calls, [])
    })
  }
}
test('드롭은 같은 고정 그룹 안에서만 정렬하고 문서를 선택하지 않는다', () => {
  const { strip, list, calls } = setup()
  for (const id of ['a', 'b', 'c', 'd']) strip.add({ id, title: id })
  strip.setFlags('a', { pinned: true })
  list.children.forEach((node, index) => { node.offsetLeft = index * 180; node.offsetWidth = 180 })
  list.children[3].firstElementChild.dispatch('dragstart', dragEvent())
  list.dispatch('dragover', dragEvent(0))
  list.dispatch('drop', dragEvent(0))
  assert.deepEqual(strip.getOrder(), ['a', 'd', 'b', 'c'])
  assert.deepEqual(calls, [['reorder', 'a', 'd', 'b', 'c']])
})

test('취소·바깥 이동·dispose는 드래그 자동 스크롤을 멈추며 파일 드롭을 건드리지 않는다', () => {
  const { strip, list, calls, timers } = setup()
  for (const id of ['a', 'b']) strip.add({ id, title: id })
  const tab = list.firstElementChild.firstElementChild
  tab.dispatch('dragstart', dragEvent())
  list.dispatch('dragover', dragEvent(399))
  assert.equal(timers.size, 1)
  list.dispatch('dragleave', { relatedTarget: null })
  assert.equal(timers.size, 0)
  list.dispatch('dragover', dragEvent(399))
  tab.dispatch('dragend')
  assert.equal(timers.size, 0)
  assert.deepEqual(strip.getOrder(), ['a', 'b'])
  list.dispatch('drop', { dataTransfer: { types: ['Files'] }, preventDefault() { throw Error('file drop intercepted') } })
  assert.deepEqual(calls, [])
  tab.dispatch('dragstart', dragEvent())
  list.dispatch('dragover', dragEvent(399))
  strip.dispose()
  assert.equal(timers.size, 0)
})


test('동일 플래그와 즐겨찾기 갱신은 진행 중인 드래그를 취소하지 않는다', () => {
  const { strip, list, calls, timers } = setup()
  for (const id of ['a', 'b', 'c']) strip.add({ id, title: id })
  list.children.forEach((node, index) => { node.offsetLeft = index * 180; node.offsetWidth = 180 })
  const moving = list.children[2]
  moving.firstElementChild.dispatch('dragstart', dragEvent())
  list.dispatch('dragover', dragEvent(0))
  assert.equal(timers.size, 1)
  const pin = moving.children.find(node => node.className.split(' ').includes('ml-document-tab-pin'))
  const writes = pin.writes
  strip.setFlags('c', { pinned: false, favorite: false })
  assert.equal(pin.writes, writes)
  strip.setFlags('c', { pinned: false, favorite: true })
  assert.equal(timers.size, 1)
  list.dispatch('drop', dragEvent(0))
  assert.deepEqual(strip.getOrder(), ['c', 'a', 'b'])
  assert.deepEqual(calls, [['reorder', 'c', 'a', 'b']])
  assert.equal(timers.size, 0)
})
