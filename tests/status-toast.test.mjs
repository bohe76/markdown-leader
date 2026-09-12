import test from 'node:test'
import assert from 'node:assert/strict'
import { createStatusToast } from '../src/content/status-toast.mjs'

function fixture() {
  class Element extends EventTarget {
    children = []
    hidden = false
    attributes = {}
    classList = { add() {}, toggle() {} }
    setAttribute(name, value) { this.attributes[name] = value }
    replaceChildren(...children) { this.children = children }
    contains(element) { return element === this || this.children.includes(element) }
    matches() { return false }
    showPopover() { this.open = true }
    hidePopover() { this.open = false }
  }
  let now = 0
  let serial = 0
  const timers = new Map()
  const window = {
    performance: { now: () => now },
    setTimeout(callback, delay) { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout(id) { timers.delete(id) },
  }
  const advance = milliseconds => {
    const target = now + milliseconds
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].callback()
    }
    now = target
  }
  const container = new Element()
  const document = { createElement: () => new Element(), activeElement: null }
  const toast = createStatusToast({ document, window, container, t: key => key })
  const fire = (name, relatedTarget = null) => {
    const event = new Event(name)
    event.relatedTarget = relatedTarget
    container.dispatchEvent(event)
  }
  return { toast, container, document, advance, fire, timers }
}

test('알림은 5초 후 닫히고 메시지를 HTML로 해석하지 않는다', () => {
  const { toast, container, advance } = fixture()
  toast.show('<img src=x>')
  assert.equal(container.children[0].textContent, '<img src=x>')
  assert.equal(container.children[0].attributes['aria-live'], 'polite')
  assert.equal(container.attributes.popover, 'manual')
  advance(4999)
  assert.equal(container.hidden, false)
  advance(1)
  assert.equal(container.hidden, true)
  assert.equal(container.open, false)
})

test('마우스와 포커스가 모두 빠져야 남은 시간만 재개한다', () => {
  const { toast, container, advance, fire } = fixture()
  toast.show('오류')
  advance(2000)
  fire('mouseenter')
  advance(10000)
  fire('focusin')
  fire('mouseleave')
  advance(10000)
  assert.equal(container.hidden, false)
  fire('focusout', container.children[2])
  advance(10000)
  assert.equal(container.hidden, false)
  fire('focusout')
  advance(2999)
  assert.equal(container.hidden, false)
  advance(1)
  assert.equal(container.hidden, true)
})

test('같은 오류는 수동 닫기 뒤에도 억제하고 복구되면 다시 알린다', () => {
  const { toast, container } = fixture()
  toast.show('첫 오류', { key: 'file:a', error: true })
  container.children[2].dispatchEvent(new Event('click'))
  toast.show('첫 오류', { key: 'file:a', error: true })
  assert.equal(container.hidden, true)
  toast.resolve('file:a')
  toast.show('새 오류', { key: 'file:a', error: true })
  assert.equal(container.hidden, false)
  toast.resolve('file:b')
  assert.equal(container.hidden, false)
  toast.resolve('file:a')
  assert.equal(container.hidden, true)
})

test('같은 파일이라도 오류 내용이 달라지면 다시 표시한다', () => {
  const { toast, container } = fixture()
  toast.show('파일을 찾을 수 없습니다', { key: 'file:a', error: true })
  toast.clear()
  toast.show('파일을 찾을 수 없습니다', { key: 'file:a', error: true })
  assert.equal(container.hidden, true)
  toast.show('접근 권한이 없습니다', { key: 'file:a', error: true })
  assert.equal(container.hidden, false)
  assert.equal(container.children[0].textContent, '접근 권한이 없습니다')
  toast.clear()
  toast.show('접근 권한이 없습니다', { key: 'file:a', error: true })
  assert.equal(container.hidden, true)
})

test('다른 알림이 교체되면 이전 동작을 실행하지 않고 시간도 갱신한다', () => {
  const { toast, container, advance } = fixture()
  const called = []
  toast.show('첫 알림', { actionLabel: '복구', onAction: () => called.push('old') })
  advance(4000)
  toast.show('둘째 알림', { actionLabel: '복구', onAction: () => called.push('new') })
  advance(1001)
  assert.equal(container.hidden, false)
  container.children[1].dispatchEvent(new Event('click'))
  assert.deepEqual(called, ['new'])
  assert.equal(container.hidden, true)
  toast.show('동작 없음')
  container.children[1].dispatchEvent(new Event('click'))
  assert.deepEqual(called, ['new'])
})

test('빈 안내와 destroy는 타이머를 해제하고 destroy 이후 다시 열지 않는다', () => {
  const { toast, container, timers } = fixture()
  toast.show('안내')
  toast.show('')
  assert.equal(container.hidden, true)
  assert.equal(timers.size, 0)
  toast.show('안내')
  toast.destroy()
  toast.show('무시')
  assert.equal(container.hidden, true)
  assert.equal(timers.size, 0)
})
