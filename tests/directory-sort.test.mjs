import test from 'node:test'
import assert from 'node:assert/strict'
import { parseDirectoryListing, directorySignature } from '../src/core.mjs'
import { createHandleSource } from '../src/content/handle-source.mjs'
import { normalizeDirectorySort, selectDirectorySort, sortDirectoryEntries } from '../src/content/directory-sort.mjs'

test('기준별 방향을 독립적으로 보존하고 활성 버튼만 반전한다', () => {
  let state = normalizeDirectorySort()
  assert.deepEqual(state, { mode: 'name', name: 'A', modified: 'N' })
  state = selectDirectorySort(state, 'modified')
  state = selectDirectorySort(state, 'modified')
  state = selectDirectorySort(state, 'name')
  state = selectDirectorySort(state, 'name')
  state = selectDirectorySort(JSON.parse(JSON.stringify(state)), 'modified')
  assert.deepEqual(state, { mode: 'modified', name: 'Z', modified: 'O' })
  assert.deepEqual(normalizeDirectorySort(null), { mode: 'name', name: 'A', modified: 'N' })
})

test('네 방향 모두 폴더 우선이며 미확인 시각은 뒤, 동률은 안정 이름순이다', () => {
  const entries = [
    { name: 'a.md', url: 'a', type: 'file', modifiedAt: 20 },
    { name: 'z.md', url: 'z', type: 'file', modifiedAt: 10 },
    { name: 'b.md', url: 'b', type: 'file', modifiedAt: 20 },
    { name: 'unknown.md', url: 'u', type: 'file' },
    { name: 'folder', url: 'f', type: 'directory', modifiedAt: 1 },
  ]
  const names = state => sortDirectoryEntries(entries, state).map(entry => entry.url)
  assert.deepEqual(names({ name: 'A' }), ['f', 'a', 'b', 'u', 'z'])
  assert.deepEqual(names({ name: 'Z' }), ['f', 'z', 'u', 'b', 'a'])
  assert.deepEqual(names({ mode: 'modified', modified: 'N' }), ['f', 'a', 'b', 'z', 'u'])
  assert.deepEqual(names({ mode: 'modified', modified: 'O' }), ['f', 'z', 'a', 'b', 'u'])
  assert.equal(entries[0].url, 'a')
})

test('Chromium Unix 초를 보존하고 중복 앵커가 수정 시각을 지우지 않는다', () => {
  const html = 'addRow("a.md","a.md",0,123,"123 B",1720000000,"날짜");<a href="a.md">a.md</a>addRow("dir","dir/",1,0,"",1710000000,"날짜");'
  const entries = parseDirectoryListing(html, 'file:///C:/docs/')
  assert.equal(entries[0].modifiedAt, 1710000000000)
  assert.equal(entries[1].modifiedAt, 1720000000000)
  assert.notEqual(directorySignature(entries), directorySignature(entries.map(entry => ({ ...entry, modifiedAt: 1 }))))
  assert.equal(parseDirectoryListing('addRow("a.md","a.md",0,0,"",0,"");', 'file:///C:/')[0].modifiedAt, undefined)
})

test('핸들 문서는 실제 lastModified를 읽고 읽기 실패와 폴더는 시각을 추정하지 않는다', async () => {
  const children = [
    ['a.md', { kind: 'file', getFile: async () => ({ lastModified: 1720000000123 }) }],
    ['bad.md', { kind: 'file', getFile: async () => { throw new Error('denied') } }],
    ['folder', { kind: 'directory' }],
    ['image.png', { kind: 'file', getFile: async () => assert.fail('문서 외 파일의 메타데이터는 읽지 않는다') }],
  ]
  const source = createHandleSource({ kind: 'directory', name: 'root', async *entries() { yield* children } })
  const entries = parseDirectoryListing(await source.readText(source.rootURL), source.rootURL)
  assert.equal(entries.find(entry => entry.name === 'a.md').modifiedAt, 1720000000123)
  assert.equal(entries.find(entry => entry.name === 'bad.md').modifiedAt, undefined)
  assert.equal(entries.find(entry => entry.name === 'folder').modifiedAt, undefined)
})
