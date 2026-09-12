import test from 'node:test'
import assert from 'node:assert/strict'
import { createDirectoryReader } from '../src/content/directory-reader.mjs'

function deferred() {
  let resolve
  const promise = new Promise(yes => { resolve = yes })
  return { promise, resolve }
}
const settle = () => new Promise(resolve => setImmediate(resolve))

test('동일 갱신의 목록과 수정일 요청은 각각 한 번만 읽는다', async () => {
  let preparations = 0, metadata = 0
  const reader = createDirectoryReader({
    isCurrent: () => true,
    prepare: async () => {
      preparations++
      return { text: 'names', withMetadata: async () => { metadata++; return 'dates' } }
    },
  })
  assert.deepEqual(await Promise.all([reader.read('root'), reader.read('root'), reader.read('root', true), reader.read('root', true)]), ['names', 'names', 'dates', 'dates'])
  assert.equal(await reader.read('root', true), 'dates')
  assert.equal(preparations, 1)
  assert.equal(metadata, 1)
})

test('폴더 목록과 수정일 작업이 섞여도 동시 실행은 최대 3개다', async () => {
  let active = 0, maximum = 0
  const work = async value => {
    active++
    maximum = Math.max(maximum, active)
    await settle()
    active--
    return value
  }
  const reader = createDirectoryReader({
    isCurrent: () => true,
    prepare: async url => { await work(); return { text: url, withMetadata: () => work(`${url}:dates`) } },
  })
  const urls = Array.from({ length: 12 }, (_, index) => String(index))
  assert.deepEqual(await Promise.all(urls.map(url => reader.read(url, true))), urls.map(url => `${url}:dates`))
  assert.equal(maximum, 3)
  assert.equal(active, 0)
})

test('설정한 상한 80개까지만 폴더 목록을 동시에 읽는다', async () => {
  let active = 0, maximum = 0
  const pending = deferred()
  const reader = createDirectoryReader({
    maxConcurrent: 80,
    isCurrent: () => true,
    prepare: async url => {
      active++
      maximum = Math.max(maximum, active)
      await pending.promise
      active--
      return { text: url, withMetadata: async () => url }
    },
  })
  const reads = Promise.all(Array.from({ length: 100 }, (_, index) => reader.read(String(index))))
  await settle()
  assert.equal(maximum, 80)
  assert.equal(active, 80)
  pending.resolve()
  assert.equal((await reads).length, 100)
})

test('상한 80개가 실행 중 무효화되면 남은 20개를 시작하지 않는다', async () => {
  let current = true, started = 0
  const pending = deferred()
  const reader = createDirectoryReader({
    maxConcurrent: 80,
    isCurrent: () => current,
    prepare: async url => {
      started++
      await pending.promise
      return { text: url, withMetadata: async () => url }
    },
  })
  const reads = Promise.allSettled(Array.from({ length: 100 }, (_, index) => reader.read(String(index))))
  await settle()
  assert.equal(started, 80)
  current = false
  pending.resolve()
  assert.equal((await reads).filter(result => result.status === 'rejected').length, 100)
  assert.equal(started, 80)
})

test('무효화 시 진행 중 결과를 버리고 대기 목록과 수정일 작업을 시작하지 않는다', async () => {
  let current = true, prepared = 0, metadata = 0
  const pending = deferred()
  const reader = createDirectoryReader({
    isCurrent: () => current,
    prepare: async () => {
      prepared++
      await pending.promise
      return { text: 'names', withMetadata: async () => { metadata++; return 'dates' } }
    },
  })
  const results = Promise.allSettled(Array.from({ length: 8 }, (_, index) => reader.read(String(index), true)))
  assert.equal(prepared, 3)
  current = false
  pending.resolve()
  for (const result of await results) {
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason.name, 'AbortError')
  }
  assert.equal(prepared, 3)
  assert.equal(metadata, 0)
})

test('실패한 목록은 같은 갱신에서 공유하지만 새 갱신에서는 다시 읽는다', async () => {
  let attempts = 0
  const options = {
    isCurrent: () => true,
    prepare: async () => {
      if (++attempts === 1) throw Error('temporary failure')
      return { text: 'fresh', withMetadata: async () => 'fresh dates' }
    },
  }
  const first = createDirectoryReader(options)
  await assert.rejects(first.read('root'), /temporary failure/)
  await assert.rejects(first.read('root'), /temporary failure/)
  assert.equal(attempts, 1)
  assert.equal(await createDirectoryReader(options).read('root'), 'fresh')
  assert.equal(attempts, 2)
})
