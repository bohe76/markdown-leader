import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { probeDirectoryDocuments } from '../src/content/directory-documents.mjs'
import { createDirectoryReader } from '../src/content/directory-reader.mjs'

const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const functions = source.slice(source.indexOf('function scheduleDirectoryFilter('), source.indexOf('async function loadDirectory('))
const settle = () => new Promise(resolve => setImmediate(resolve))

function fixture() {
  const frames = [], timers = [], reads = []
  const nodes = ['empty', 'deep', 'unreadable'].map(name => ({
    isConnected: true, hidden: false, dataset: { url: `file:///C:/docs/${name}/` }, contains: () => false,
  }))
  const file = { type: 'file', url: 'file:///C:/docs/deep/nested/README.MD' }
  const listings = new Map([
    [nodes[0].dataset.url, []],
    [nodes[1].dataset.url, [{ type: 'directory', url: 'file:///C:/docs/deep/nested/' }]],
    ['file:///C:/docs/deep/nested/', [file]],
  ])
  const context = vm.createContext({
    explorerGeneration: 0, explorerSource: null, directoryWorkGeneration: 0,
    DIRECTORY_READ_CONCURRENCY: 80,
    createDirectoryReader, DOMException, directoryFilterReader: undefined,
    probeDirectoryDocuments, directoryFilterRunning: false, directoryFilterPending: false,
    directoryVisibility: new Map(), directorySnapshotReader: undefined, directoryPreparations: new Map(), pageActive: true, pageGeneration: 0, refreshGeneration: 0,
    extensionInvalidated: false, renderGeneration: 1, currentFileURL: 'file:///C:/docs/index.md',
    settings: { refreshEnabled: true }, document: { hidden: false },
    fileTree: { isConnected: true, dataset: {}, querySelectorAll: () => nodes },
    readText: async url => { reads.push(url); if (!listings.has(url)) throw Error('unreadable'); return listings.get(url) },
    parseDirectoryListing: value => value,
    requestAnimationFrame: fn => frames.push(fn), window: { setTimeout: fn => timers.push(fn) },
  })
  vm.runInContext(ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const flush = () => { while (frames.length) frames.shift()(); while (timers.length) timers.shift()() }
  return { context, nodes, reads, listings, frames, flush }
}

test('확인한 빈 폴더만 숨기고 하위 문서와 읽기 실패 폴더는 유지한다', async () => {
  const { context, nodes, reads } = fixture()
  await context.filterDirectoryTree()
  assert.deepEqual(nodes.map(node => node.hidden), [true, false, false])
  assert.deepEqual(nodes.map(node => node.dataset.documentState), ['empty', 'present', 'unknown'])
  assert.ok(reads.every(url => url.endsWith('/')), '검사는 문서 본문을 읽지 않는다')
})

test('숨긴 폴더를 다시 검사하여 새 문서 또는 읽기 실패가 생기면 복원한다', async () => {
  for (const failure of [false, true]) {
    const { context, nodes, listings } = fixture()
    await context.filterDirectoryTree()
    if (failure) listings.delete(nodes[0].dataset.url)
    else listings.set(nodes[0].dataset.url, [{ type: 'file', url: `${nodes[0].dataset.url}new.markdown` }])
    await context.filterDirectoryTree()
    assert.equal(nodes[0].hidden, false)
    assert.equal(nodes[0].dataset.documentState, failure ? 'unknown' : 'present')
  }
})

for (const [name, invalidate] of [
  ['숨김과 복귀', context => { context.document.hidden = true; context.directoryWorkGeneration++ }],
  ['탐색 폴더 변경', context => { context.explorerGeneration++ }],
  ['페이지 종료', context => { context.pageActive = false; context.pageGeneration++ }],
  ['트리 제거', context => { context.fileTree.isConnected = false }],
]) {
  test(`${name} 뒤의 오래된 검사 결과는 적용하거나 다음 폴더를 읽지 않는다`, async () => {
    const { context, nodes, reads } = fixture()
    const resolvers = []
    context.readText = url => { reads.push(url); return new Promise(done => { resolvers.push(done) }) }
    const running = context.filterDirectoryTree()
    await settle()
    assert.equal(resolvers.length, 3)
    invalidate(context)
    resolvers.forEach(resolve => resolve([]))
    await running
    assert.equal(context.directoryVisibility.size, 0)
    assert.equal(nodes[0].hidden, false)
    assert.equal(reads.length, 3)
  })
}

test('같은 트리의 항목이 교체되면 이전 항목에 검사 결과를 적용하지 않는다', async () => {
  const { context, nodes, reads } = fixture()
  context.readText = async url => {
    reads.push(url)
    nodes[0].isConnected = false
    return [{ type: 'directory', url: `${url}old-child/` }]
  }
  await context.filterDirectoryTree()
  assert.equal(nodes[0].hidden, false)
  assert.equal(context.directoryVisibility.has(nodes[0].dataset.url), false)
  assert.equal(reads.filter(url => url.startsWith(nodes[0].dataset.url)).length, 1)
})

test('본문 표시 기회 후 단일 검사만 시작하고 대기 중 요청을 합친다', async () => {
  const { context, frames, reads, flush } = fixture()
  const resolvers = []
  context.readText = url => { reads.push(url); return new Promise(done => { resolvers.push(done) }) }
  context.scheduleDirectoryFilter()
  context.scheduleDirectoryFilter()
  assert.equal(frames.length, 1)
  assert.equal(reads.length, 0)
  flush()
  assert.equal(reads.length, 3)
  context.scheduleDirectoryFilter()
  assert.equal(frames.length, 0)
  context.pageActive = false
  resolvers.forEach(resolve => resolve([]))
  await settle()
  assert.equal(context.directoryFilterRunning, false)
  assert.equal(reads.length, 3)
})


test('문서 탭을 전환해도 같은 탐색 폴더의 필터 검사는 끝까지 적용한다', async () => {
  const { context, nodes, reads } = fixture()
  const originalRead = context.readText
  let resolve
  context.readText = url => {
    if (!reads.length) { reads.push(url); return new Promise(done => { resolve = done }) }
    return originalRead(url)
  }
  const running = context.filterDirectoryTree()
  context.renderGeneration++
  context.currentFileURL = 'file:///C:/other/document.md'
  resolve([])
  await running
  assert.deepEqual(nodes.map(node => node.hidden), [true, false, false])
  assert.equal(reads.length, 4)
})

test('최상위 표시를 마친 뒤 남은 하위 폴더를 모두 분류하고 목록을 재사용한다', async () => {
  const { context, nodes, reads, listings } = fixture()
  const root = nodes[1].dataset.url
  const empty = `${root}late-empty/`
  const kept = `${root}later-kept/`
  listings.set(root, [
    { type: 'file', url: `${root}early.md` },
    { type: 'directory', url: empty },
    { type: 'directory', url: kept },
  ])
  listings.set(empty, [])
  listings.set(kept, [{ type: 'file', url: `${kept}guide.md` }])
  await context.filterDirectoryTree()
  assert.equal(context.directoryVisibility.get(empty), 'empty')
  assert.equal(context.directoryVisibility.get(kept), 'present')
  assert.ok(context.directorySnapshotReader)
  const before = reads.length
  await context.directorySnapshotReader.read(empty)
  await context.directorySnapshotReader.read(kept)
  assert.equal(reads.length, before, '전체 준비에서 읽은 하위 목록을 펼칠 때 재사용한다')
})

test('표시 작업의 목록을 한 번 공유한 뒤 다음 검사는 새 목록으로 변경을 확인한다', async () => {
  const { context, nodes, listings, reads } = fixture()
  const shared = context.createExplorerReader(() => true)
  await shared.read(nodes[0].dataset.url)
  assert.equal(reads.length, 1)
  context.directoryFilterReader = shared
  await context.filterDirectoryTree()
  assert.equal(reads.filter(url => url === nodes[0].dataset.url).length, 1)
  assert.equal(context.directoryFilterReader, undefined)
  assert.equal(nodes[0].hidden, true)
  listings.set(nodes[0].dataset.url, [{ type: 'file', url: `${nodes[0].dataset.url}new.md` }])
  await context.filterDirectoryTree()
  assert.equal(reads.filter(url => url === nodes[0].dataset.url).length, 2)
  assert.equal(nodes[0].hidden, false)
  assert.equal(nodes[0].dataset.documentState, 'present')
})
