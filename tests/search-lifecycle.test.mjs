import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const start = source.indexOf('async function searchFiles()')
const end = source.indexOf('\nlet extensionInvalidated', start)
assert.ok(start >= 0 && end > start, '실제 폴더 검색 함수를 검증해야 합니다.')
const searchSource = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function reader() {
  const effects = { decorations: 0, loads: [], errors: [] }
  const context = vm.createContext({
    explorerGeneration: 0, explorerSource: null,
    searchGeneration: 0, searchMode: 'files', searchQuery: '문서',
    rootDirectoryURL: 'file:///old/', extensionInvalidated: false, originalExpanded: null,
    matchedFiles: new Set(), matchedDirectories: new Set(), expandedDirectories: new Set(),
    fileTree: { dataset: { searching: 'false' } }, searchFilesStatus: { textContent: '' },
    decorateSearchTree: () => effects.decorations++,
    readText: async () => '', parseDirectoryListing: () => [],
    loadDirectory: async (url) => { effects.loads.push(url); return true },
    reportError: (...args) => effects.errors.push(args), t: (key) => key,
  })
  vm.runInContext(searchSource, context)
  return { context, effects }
}

for (const action of ['닫기', '소스 전환']) {
  test(`최종 폴더 갱신 중 검색 ${action} 후 늦은 결과가 파일 필터를 다시 켜지 않는다`, async () => {
    const { context, effects } = reader()
    const started = deferred()
    const listing = deferred()
    context.loadDirectory = () => { started.resolve(); return listing.promise }
    const pending = context.searchFiles()
    await started.promise

    // 닫기 또는 새 소스 채택이 무효화한 검색 상태를 유지해야 합니다.
    context.searchGeneration++
    context.searchMode = null
    context.searchQuery = ''
    context.fileTree.dataset.searching = 'false'
    context.searchFilesStatus.textContent = ''
    if (action === '소스 전환') context.rootDirectoryURL = 'file:///new/'
    const decorations = effects.decorations
    listing.resolve(true)
    await pending

    assert.equal(context.fileTree.dataset.searching, 'false')
    assert.equal(context.searchFilesStatus.textContent, '')
    assert.equal(effects.decorations, decorations)
    assert.deepEqual(effects.errors, [])
  })
}

test('검색어를 빈 문자열로 지우면 파일 필터와 결과를 해제하고 원래 폴더 펼침을 복원한다', async () => {
  const { context, effects } = reader()
  context.searchQuery = ''
  context.fileTree.dataset.searching = 'true'
  context.searchFilesStatus.textContent = '이전 검색 결과'
  context.matchedFiles.add('file:///old/match.md')
  context.matchedDirectories.add('file:///old/search/')
  context.expandedDirectories.add('file:///old/search/')
  context.originalExpanded = new Set(['file:///old/original/'])

  await context.searchFiles()

  assert.equal(context.fileTree.dataset.searching, 'false')
  assert.equal(context.searchFilesStatus.textContent, '')
  assert.equal(context.matchedFiles.size, 0)
  assert.equal(context.matchedDirectories.size, 0)
  assert.deepEqual([...context.expandedDirectories], ['file:///old/original/'])
  assert.equal(context.originalExpanded, null)
  assert.deepEqual(effects.loads, ['file:///old/'])
})

for (const stage of ['폴더', '파일']) {
  test(`이전 검색의 늦은 ${stage} 읽기 실패가 새 소스의 상태와 오류 로그를 덮지 않는다`, async () => {
    const { context, effects } = reader()
    const started = deferred()
    const read = deferred()
    context.parseDirectoryListing = () => [{ type: 'file', name: 'doc.md', url: 'file:///old/doc.md' }]
    context.readText = (url) => {
      if (stage === '파일' && url === 'file:///old/') return Promise.resolve('listing')
      started.resolve()
      return read.promise
    }
    const pending = context.searchFiles()
    await started.promise
    context.searchGeneration++
    context.rootDirectoryURL = 'file:///new/'
    context.searchFilesStatus.textContent = '새 소스 상태'
    read.reject(new Error('ML_HANDLE_DISPOSED'))
    await pending

    assert.deepEqual(effects.errors, [])
    assert.deepEqual(effects.loads, [])
    assert.equal(context.searchFilesStatus.textContent, '새 소스 상태')
  })
}

test('현재 검색의 폴더 읽기 실패는 계속 보고한다', async () => {
  const { context, effects } = reader()
  const error = new Error('NotAllowedError')
  context.readText = async () => { throw error }
  await context.searchFiles()
  assert.equal(effects.errors.length, 1)
  assert.equal(effects.errors[0][0], 'readerSearchFolderReadFailed')
  assert.equal(effects.errors[0][1], 'file:///old/')
  assert.equal(effects.errors[0][2], error)
})
