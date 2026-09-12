import test from 'node:test'
import assert from 'node:assert/strict'
import { probeDirectoryDocuments } from '../src/content/directory-documents.mjs'

const root = 'file:///C:/docs/'
const directory = (path) => ({ type: 'directory', url: new URL(path, root).href })
const file = (path) => ({ type: 'file', url: new URL(path, root).href })

function fixture(tree, options = {}) {
  const reads = []
  const budget = options.budget || { remaining: 100 }
  return {
    reads, budget,
    run: () => probeDirectoryDocuments(root, {
      budget, isCurrent: options.isCurrent || (() => true),
      readEntries: async (url) => {
        reads.push(url)
        const value = tree[url.slice(root.length)]
        if (value instanceof Error) throw value
        return value
      },
    }),
  }
}

test('직접 문서를 찾으면 자식 폴더나 본문을 읽지 않는다', async () => {
  const probe = fixture({ '': [directory('slow/'), file('readme.md')] })
  assert.equal(await probe.run(), 'present')
  assert.deepEqual(probe.reads, [root])
  assert.equal(probe.budget.remaining, 99)
})

test('전체 준비 검사는 문서를 일찍 찾아도 남은 하위 폴더를 끝까지 분류한다', async () => {
  const states = new Map()
  const probe = fixture({
    '': [file('readme.md'), directory('empty/'), directory('later/')],
    'empty/': [],
    'later/': [directory('later/nested/')],
    'later/nested/': [file('later/nested/guide.md')],
  })
  assert.equal(await probeDirectoryDocuments(root, {
    budget: probe.budget,
    exhaustive: true,
    isCurrent: () => true,
    onResult: (url, state) => states.set(url, state),
    readEntries: async url => {
      probe.reads.push(url)
      return {
        [root]: [file('readme.md'), directory('empty/'), directory('later/')],
        [`${root}empty/`]: [],
        [`${root}later/`]: [directory('later/nested/')],
        [`${root}later/nested/`]: [file('later/nested/guide.md')],
      }[url]
    },
  }), 'present')
  assert.deepEqual(new Set(probe.reads), new Set([root, `${root}empty/`, `${root}later/`, `${root}later/nested/`]))
  assert.equal(states.get(`${root}empty/`), 'empty')
  assert.equal(states.get(`${root}later/`), 'present')
  assert.equal(states.get(`${root}later/nested/`), 'present')
})

test('빠른 검사와 전체 준비 검사는 공유 방문 예산에서 같은 폴더를 두 번 차감하지 않는다', async () => {
  const budget = { remaining: 4 }
  const visited = new Set()
  const listings = new Map([
    [root, [file('readme.md'), directory('empty/')]],
    [`${root}empty/`, []],
  ])
  const readEntries = async url => listings.get(url)
  assert.equal(await probeDirectoryDocuments(root, { budget, visited, readEntries, isCurrent: () => true }), 'present')
  assert.equal(budget.remaining, 3)
  assert.equal(await probeDirectoryDocuments(root, { budget, visited, readEntries, isCurrent: () => true, exhaustive: true }), 'present')
  assert.equal(budget.remaining, 2)
})

test('하위 문서가 있는 조상은 유지하고 빈 트리는 empty로 판정한다', async () => {
  for (const documents of [[], [file('a/b/readme.md')]]) {
    const probe = fixture({ '': [directory('a/')], 'a/': [directory('a/b/')], 'a/b/': documents })
    assert.equal(await probe.run(), documents.length ? 'present' : 'empty')
    assert.equal(probe.reads.length, 3)
  }
})

test('읽기 오류는 unknown이지만 다른 형제의 문서 존재를 우선한다', async () => {
  for (const documents of [[], [file('good/doc.md')]]) {
    const probe = fixture({ '': [directory('bad/'), directory('good/')], 'bad/': new Error('denied'), 'good/': documents })
    assert.equal(await probe.run(), documents.length ? 'present' : 'unknown')
    assert.equal(probe.reads.length, 3)
  }
})

test('시작 전 취소는 읽지 않고 진행 중 취소는 다음 읽기를 막는다', async () => {
  const before = fixture({}, { isCurrent: () => false })
  assert.equal(await before.run(), 'unknown')
  assert.deepEqual(before.reads, [])
  let current = true
  let reads = 0
  assert.equal(await probeDirectoryDocuments(root, {
    budget: { remaining: 20 }, isCurrent: () => current,
    readEntries: async () => { reads++; current = false; return [directory('a/'), file('doc.md')] },
  }), 'unknown')
  assert.equal(reads, 1)
})

test('공유 예산은 실제 읽기에만 차감하고 소진 시 unknown이다', async () => {
  const budget = { remaining: 2 }
  const first = fixture({ '': [directory('a/')], 'a/': [directory('a/b/')] }, { budget })
  assert.equal(await first.run(), 'unknown')
  assert.equal(first.reads.length, 2)
  assert.equal(budget.remaining, 0)
  const second = fixture({ '': [] }, { budget })
  assert.equal(await second.run(), 'unknown')
  assert.equal(second.reads.length, 0)
})

test('정규화한 중복 폴더는 한 번만 읽는다', async () => {
  for (const entries of [[], new Error('denied')]) {
    const probe = fixture({
      '': [directory('a/'), directory('%61/?sort=name#top')], 'a/': entries,
    })
    assert.equal(await probe.run(), entries instanceof Error ? 'unknown' : 'empty')
    assert.equal(probe.reads.length, 2)
  }
})

test('대소문자가 다른 폴더는 합치지 않아 문서가 있는 폴더를 보존한다', async () => {
  const probe = fixture({
    '': [directory('A/'), directory('a/')],
    'A/': [], 'a/': [file('a/doc.md')],
  })
  assert.equal(await probe.run(), 'present')
  assert.deepEqual(probe.reads, [root, `${root}A/`, `${root}a/`])
})

test('상위 경로 대소문자가 다르면 빈 폴더로 판정하지 않는다', async () => {
  const probe = fixture({ '': [directory('file:///C:/DOCS/child/')] })
  assert.equal(await probe.run(), 'unknown')
  assert.deepEqual(probe.reads, [root])
})

test('부모·자기 자신·외부 경로 및 인코딩된 경로 구분자를 탐색하지 않는다', async () => {
  for (const path of ['../', './', '../other/', 'file:///D:/docs/', 'file://server/C:/docs/', 'https://example.com/', 'a%2fb/', 'a%5cb/', '%00/']) {
    const probe = fixture({ '': [directory(path)] })
    assert.equal(await probe.run(), 'unknown', path)
    assert.deepEqual(probe.reads, [root], path)
  }
  const outsideFile = fixture({ '': [file('../outside.md')] })
  assert.equal(await outsideFile.run(), 'unknown')
})

test('잘못된 경로와 순환 링크가 있어도 정상 형제 문서는 유지한다', async () => {
  const probe = fixture({ '': [directory('a/'), directory('good/')], 'a/': [directory('./')], 'good/': [file('good/doc.md')] })
  assert.equal(await probe.run(), 'present')
  assert.equal(probe.reads.length, 3)
})

test('깊이 상한에서는 예산이 남아도 탐색을 끝낸다', async () => {
  let reads = 0
  const budget = { remaining: 100 }
  assert.equal(await probeDirectoryDocuments(root, {
    budget, isCurrent: () => true,
    readEntries: async (url) => { reads++; return [{ type: 'directory', url: `${url}child/` }] },
  }), 'unknown')
  assert.equal(reads, 64)
  assert.equal(budget.remaining, 36)
})

test('잘못된 시작 URL이나 목록은 빈 폴더로 단정하지 않는다', async () => {
  for (const url of ['invalid', 'https://example.com/', 'file:///C:/a%2fb/']) {
    assert.equal(await probeDirectoryDocuments(url, {
      budget: { remaining: 10 }, isCurrent: () => true,
      readEntries: () => { assert.fail('유효하지 않은 시작 경로를 읽으면 안 된다') },
    }), 'unknown')
  }
  assert.equal(await fixture({ '': null }).run(), 'unknown')
})
