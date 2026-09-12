import test from 'node:test'
import assert from 'node:assert/strict'
import { createDocumentLoading } from '../src/content/document-loading.mjs'

function setup() {
  let now = 0
  let nextId = 0
  let shown = 0
  const timers = new Map()
  const callbacks = []
  const window = {
    setTimeout(callback, delay) {
      const id = nextId++
      timers.set(id, { callback, at: now + delay })
      callbacks.push(callback)
      return id
    },
    clearTimeout(id) { timers.delete(id) }
  }
  class Element {
    constructor() {
      this.children = []
      this.attributes = {}
      this.style = { removeProperty(name) { if (name === 'min-height') delete this.minHeight } }
    }
    setAttribute(name, value) { this.attributes[name] = value }
    removeAttribute(name) { delete this.attributes[name] }
    append(node) { node.parentElement = this; this.children.push(node) }
    remove() {
      if (!this.parentElement) return
      const siblings = this.parentElement.children
      siblings.splice(siblings.indexOf(this), 1)
      this.parentElement = null
    }
  }
  const document = { createElement: () => new Element() }
  const content = new Element()
  const loading = createDocumentLoading({ content, document, window, onShow() { shown++ } })
  function advance(milliseconds) {
    now += milliseconds
    for (const [id, timer] of timers) {
      if (timer.at <= now) {
        timers.delete(id)
        timer.callback()
      }
    }
  }
  return { loading, content, document, advance, callbacks, timers, shown: () => shown }
}

test('빠른 문서 전환은 카드 높이만 유지하고 149ms까지 스켈레톤을 표시하지 않는다', () => {
  const { loading, content, advance, shown, timers } = setup()
  loading.begin(840, () => true)
  assert.equal(content.style.minHeight, '840px')
  assert.equal(content.attributes['aria-busy'], 'true')
  advance(149)
  assert.equal(content.children.length, 0)
  loading.finish()
  advance(1)
  assert.equal(shown(), 0)
  assert.equal(timers.size, 0)
  assert.equal(content.style.minHeight, undefined)
  assert.equal(content.attributes['aria-busy'], undefined)
})

test('150ms 기다린 현재 문서에 제목과 본문 네 줄의 장식용 스켈레톤을 표시한다', () => {
  const { loading, content, advance, shown } = setup()
  loading.begin(0, () => true)
  assert.equal(content.style.minHeight, '240px')
  advance(150)
  const skeleton = content.children[0]
  assert.equal(skeleton.className, 'ml-document-skeleton')
  assert.equal(skeleton.attributes['aria-hidden'], 'true')
  assert.deepEqual(skeleton.children.map((line) => line.className), [
    'ml-skeleton-title', 'ml-skeleton-line', 'ml-skeleton-line', 'ml-skeleton-line', 'ml-skeleton-line'
  ])
  assert.equal(shown(), 1)
  advance(1000)
  assert.equal(content.children.length, 1)
  assert.equal(shown(), 1)
})

test('취소는 타이머와 이미 대기열에 들어간 콜백의 늦은 표시를 모두 막는다', () => {
  const { loading, content, callbacks, timers, shown } = setup()
  loading.begin(600, () => true)
  const queuedCallback = callbacks[0]
  loading.cancel()
  assert.equal(timers.size, 0)
  queuedCallback()
  assert.equal(content.children.length, 0)
  assert.equal(content.attributes['aria-busy'], undefined)
  assert.equal(content.style.minHeight, undefined)
  assert.equal(shown(), 0)
})

test('새 전환은 이전 예약 표시를 무효화하고 자신의 150ms부터 다시 기다린다', () => {
  const { loading, content, advance, callbacks, shown } = setup()
  loading.begin(900, () => true)
  advance(100)
  loading.begin(500, () => true)
  callbacks[0]()
  advance(149)
  assert.equal(content.children.length, 0)
  assert.equal(content.style.minHeight, '500px')
  advance(1)
  assert.equal(content.children.length, 1)
  assert.equal(shown(), 1)
})

test('현재 요청이 아니면 예약 시간이 지나도 스켈레톤을 표시하지 않는다', () => {
  const { loading, content, advance, shown } = setup()
  let current = true
  loading.begin(400, () => current)
  current = false
  advance(150)
  assert.equal(content.children.length, 0)
  assert.equal(shown(), 0)
  loading.finish()
})

test('완료는 자신이 만든 스켈레톤만 제거하고 새로 렌더링한 본문은 보존한다', () => {
  const { loading, content, document, advance } = setup()
  loading.begin(800, () => true)
  advance(150)
  const rendered = document.createElement('article')
  content.append(rendered)
  loading.finish()
  assert.deepEqual(content.children, [rendered])
  assert.equal(content.attributes['aria-busy'], undefined)
  assert.equal(content.style.minHeight, undefined)
  loading.cancel()
  assert.deepEqual(content.children, [rendered])
})

test('표시된 스켈레톤도 다음 문서 전환 때 즉시 제거한다', () => {
  const { loading, content, advance, shown } = setup()
  loading.begin(700, () => true)
  advance(150)
  const previous = content.children[0]
  loading.begin(700, () => true)
  assert.equal(previous.parentElement, null)
  assert.equal(content.children.length, 0)
  advance(150)
  assert.notEqual(content.children[0], previous)
  assert.equal(shown(), 2)
})
