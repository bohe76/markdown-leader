import test from 'node:test'
import assert from 'node:assert/strict'
import { clampSidebarWidth, createSidebarResizer } from '../src/content/sidebar-resizer.mjs'

class Element {
  constructor() {
    this.children = []
    this.listeners = new Map()
    this.attributes = {}
    this.hidden = false
    this.className = ''
    this.style = { values: new Map(), setProperty: (name, value) => this.style.values.set(name, value) }
    this.classList = {
      values: new Set(),
      add: value => this.classList.values.add(value),
      remove: value => this.classList.values.delete(value),
      contains: value => this.classList.values.has(value),
    }
  }
  append(child) { this.children.push(child) }
  setAttribute(name, value) { this.attributes[name] = value }
  addEventListener(name, listener) { this.listeners.set(name, listener) }
  setPointerCapture(pointerId) { this.captured = pointerId }
  releasePointerCapture(pointerId) { if (this.captured === pointerId) this.captured = undefined }
  dispatch(name, values = {}) {
    const event = { button: 0, pointerId: 1, clientX: 300, clientY: 200, preventDefault() { this.prevented = true }, ...values }
    this.listeners.get(name)?.(event)
    return event
  }
}

function setup(initialWidth = 300) {
  const root = new Element()
  root.dataset = {}
  const document = { documentElement: root, createElement: () => new Element() }
  const window = { innerWidth: 1600, innerHeight: 900 }
  const resized = []
  const committed = []
  const resizer = createSidebarResizer({
    document, window, initialWidth,
    onResize: width => resized.push(width),
    onCommit: width => committed.push(width),
  })
  resizer.setEnabled(true)
  return { document, window, resized, committed, resizer, element: resizer.element }
}

test('사이드바 폭은 데스크톱 300px과 min(520px, 45vw) 사이로 제한한다', () => {
  assert.equal(clampSidebarWidth(100, 1600), 300)
  assert.equal(clampSidebarWidth(900, 1600), 520)
  assert.equal(clampSidebarWidth(500, 1000), 450)
  assert.equal(clampSidebarWidth(412.7, 1600), 413)
})

test('손잡이는 포인터 높이를 따르고 드래그 중 실시간 조절한 뒤 놓을 때만 저장한다', () => {
  const { element, resized, committed, document } = setup()
  element.dispatch('pointerenter', { clientY: 8 })
  assert.equal(element.style.values.get('--ml-sidebar-handle-y'), '18px')
  element.dispatch('pointermove', { clientY: 460 })
  assert.equal(element.style.values.get('--ml-sidebar-handle-y'), '460px')

  const down = element.dispatch('pointerdown', { clientX: 300, clientY: 460, pointerId: 7 })
  assert.equal(down.prevented, true)
  assert.equal(element.captured, 7)
  assert.equal(document.documentElement.dataset.mlSidebarResizing, 'true')
  element.dispatch('pointermove', { clientX: 470, clientY: 600, pointerId: 7 })
  assert.deepEqual(resized, [470])
  assert.equal(element.style.values.get('--ml-sidebar-handle-y'), '600px')
  element.dispatch('pointerup', { clientX: 470, clientY: 600, pointerId: 7 })
  assert.deepEqual(committed, [470])
  assert.equal(element.captured, undefined)
  assert.equal(document.documentElement.dataset.mlSidebarResizing, undefined)
})

test('클릭만 하거나 비활성 상태에서는 폭을 저장하지 않는다', () => {
  const { element, resized, committed, resizer } = setup(360)
  element.dispatch('pointerdown', { clientX: 360, pointerId: 3 })
  element.dispatch('pointerup', { clientX: 360, pointerId: 3 })
  assert.deepEqual(resized, [])
  assert.deepEqual(committed, [])

  resizer.setEnabled(false)
  assert.equal(element.hidden, true)
  element.dispatch('pointerdown', { clientX: 420, pointerId: 4 })
  element.dispatch('pointermove', { clientX: 480, pointerId: 4 })
  element.dispatch('pointerup', { clientX: 480, pointerId: 4 })
  assert.deepEqual(resized, [])
  assert.deepEqual(committed, [])
})

test('취소된 드래그는 시작 폭으로 되돌리고 저장하지 않는다', () => {
  const { element, resized, committed } = setup(340)
  element.dispatch('pointerdown', { clientX: 340, pointerId: 5 })
  element.dispatch('pointermove', { clientX: 430, pointerId: 5 })
  element.dispatch('pointercancel', { clientX: 430, pointerId: 5 })
  assert.deepEqual(resized, [430, 340])
  assert.deepEqual(committed, [])
})
