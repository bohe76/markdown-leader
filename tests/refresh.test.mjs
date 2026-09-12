import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { sortDirectoryEntries, selectDirectorySort } from '../src/content/directory-sort.mjs'
import { createDirectoryReader } from '../src/content/directory-reader.mjs'

const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const guardStart = source.indexOf('function captureReadTarget(')
const guardSource = guardStart < 0 ? '' : source.slice(guardStart, source.indexOf('async function loadDirectory('))
const refreshSource = source.slice(source.indexOf('async function refreshNow()'), source.indexOf('\nfunction applySettings'))

function reader(hidden = false) {
  const reads = []
  const timers = new Map()
  const effects = { renders: [], statuses: [], errors: [] }
  const logs = []
  const listeners = new Map()
  let timerId = 0
  const context = vm.createContext({
    sortDirectoryEntries, createDirectoryReader, DOMException,
    directoryMetadata: new Map(), directoryLoads: new WeakMap(),
    directoryWorkGeneration: 0, directoryFilterReader: undefined, directorySnapshotReader: undefined, directoryPreparations: new Map(), DIRECTORY_READ_CONCURRENCY: 80,
    directoryPreparation: () => undefined,
    pendingDirectoryMetadata: () => [], resumeDirectoryMetadata: async () => {},
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    documentLoading: { cancel() {} },
    activeDocument: {}, documentReady: true, refreshRequest: 0, explorerGeneration: 0, explorerSource: null,
    document: { hidden, addEventListener: (name, listener) => listeners.set(name, listener) },
    window: {
      addEventListener: (name, listener) => listeners.set(name, listener),
      setInterval(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id },
      clearInterval(id) { timers.delete(id) },
    },
    settings: { refreshEnabled: true, refreshIntervalMs: 10000, directorySort: { mode: 'name', direction: 'asc' } },
    refreshInterval: {}, refreshTimer: undefined, refreshInFlight: false, initialBackgroundWorkComplete: true,
    pageActive: true, pageGeneration: 0, refreshGeneration: 0,
    extensionInvalidated: false, renderGeneration: 1, currentFileURL: 'file:///C:/docs/readme.md', currentRaw: '# 원문',
    rootDirectoryURL: 'file:///C:/docs/', fileTree: { isConnected: true, dataset: { loaded: 'true' }, querySelectorAll: () => [], closest: () => null }, readerLanguage: 'ko',
    readText: async (url) => { reads.push(url); return '# 원문' },
    loadDirectory: async (url) => { reads.push(url); return true },
    renderMarkdown: (...args) => effects.renders.push(args), updateActiveFile() {},
    setStatus: (...args) => effects.statuses.push(args),
    reportError: (...args) => effects.errors.push(args),
    t: (key) => key, clampRefreshInterval: (ms) => ms,
    scheduleDirectoryFilter() {},
    directoryVisibility: new Map(),
    documentTabsUI: { setConnectionError() {} },
    statusToast: { resolve() {}, show: (...args) => effects.statuses.push(args) },
    describeError: error => String(error),
    console: { error: (...args) => logs.push(args) },
  })
  const connectionSource = source.slice(source.indexOf('function connectionState('), source.indexOf('async function recoverConnection('))
  vm.runInContext(ts.transpileModule(connectionSource + guardSource + refreshSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { context, reads, timers, listeners, effects, logs }
}

test('숨겨진 탭에서는 타이머와 이미 대기 중인 자동 읽기 모두 시작하지 않는다', async () => {
  const { context, reads, timers } = reader(true)
  context.restartRefreshTimer()
  await context.refreshNow()
  assert.equal(timers.size, 0)
  assert.deepEqual(reads, [])
})

test('탭 복귀 시 즉시 한 번 갱신하고 저장된 10초 주기를 유지한다', async () => {
  const { context, reads, timers, listeners } = reader()
  context.restartRefreshTimer()
  assert.equal(timers.size, 1)
  context.document.hidden = true
  listeners.get('visibilitychange')()
  assert.equal(timers.size, 0)
  context.document.hidden = false
  listeners.get('visibilitychange')()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(reads, ['file:///C:/docs/readme.md', 'file:///C:/docs/'])
  assert.equal(timers.size, 1)
  assert.equal([...timers.values()][0].ms, 10000)
  assert.equal(context.settings.refreshIntervalMs, 10000)
})

test('자동 갱신 OFF와 초기 표시 중에는 복귀 이벤트가 읽기를 시작하지 않는다', async () => {
  for (const state of [{ refreshEnabled: false }, { initialBackgroundWorkComplete: false }]) {
    const { context, reads, timers, listeners } = reader(true)
    if ('refreshEnabled' in state) context.settings.refreshEnabled = state.refreshEnabled
    if ('initialBackgroundWorkComplete' in state) context.initialBackgroundWorkComplete = state.initialBackgroundWorkComplete
    context.document.hidden = false
    listeners.get('visibilitychange')()
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(reads, [])
    assert.equal(timers.size, 0)
  }
})

test('문서 읽기 중 숨겨지면 뒤이은 폴더 읽기를 시작하지 않는다', async () => {
  const { context, reads } = reader()
  context.readText = async (url) => { reads.push(url); context.document.hidden = true; return '# 원문' }
  await context.refreshNow()
  assert.deepEqual(reads, ['file:///C:/docs/readme.md'])
  assert.equal(context.refreshInFlight, false)
})

test('자동 폴더 갱신 중 숨겨지면 펼쳐진 하위 폴더도 추가로 읽지 않는다', async () => {
  const { context, reads } = reader()
  const child = { name: 'nested', url: 'file:///C:/docs/nested/', type: 'directory' }
  const target = { isConnected: true, dataset: {}, children: [{ dataset: { url: child.url }, classList: { add() {} }, querySelector: () => ({ hidden: false }) }] }
  Object.assign(context, {
    directoryCache: new Map(), expandedDirectories: new Set([child.url]),
    readText: async (url) => { reads.push(url); context.document.hidden = true; return '' },
    parseDirectoryListing: () => [child], directorySignature: () => 'same', shouldReplaceDirectory: () => false,
    decorateSearchTree() {},
  })
  const directorySource = source.slice(source.indexOf('async function loadDirectory('), source.indexOf('\nfunction updateActiveFile'))
  vm.runInContext(ts.transpileModule(directorySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  assert.equal(await context.loadDirectory('file:///C:/docs/', target, false, true, context.captureReadTarget(true)), false)
  assert.deepEqual(reads, ['file:///C:/docs/'])
})

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

function hideAndReturn({ context, listeners }) {
  context.document.hidden = true
  listeners.get('visibilitychange')()
  context.document.hidden = false
  listeners.get('visibilitychange')()
}

function pageHideAndShow({ listeners }) {
  listeners.get('pagehide')({ persisted: true })
  listeners.get('pageshow')({ persisted: true })
}

function disableAndEnable({ context }) {
  context.settings.refreshEnabled = false
  context.restartRefreshTimer()
  context.settings.refreshEnabled = true
  context.restartRefreshTimer()
}

for (const [name, invalidate] of [
  ['숨김 후 복귀', hideAndReturn],
  ['페이지 종료 후 BFCache 복귀', pageHideAndShow],
  ['자동 갱신 OFF 후 ON', disableAndEnable],
  ['문서 전환', ({ context }) => { context.renderGeneration++ }],
]) {
  for (const failure of [false, true]) {
    test(`${name}: 이전 자동 읽기의 ${failure ? '실패' : '성공'} 결과는 무시하고 다음 갱신은 재개한다`, async () => {
      const fixture = reader()
      const { context, reads, effects } = fixture
      const pending = deferred()
      context.readText = (url) => { reads.push(url); return pending.promise }
      const running = context.refreshNow()
      invalidate(fixture)
      await context.refreshNow()
      assert.equal(reads.length, 1, '이전 응답이 끝나기 전에는 읽기를 중복하지 않는다')
      if (failure) pending.reject(new Error('late read failed'))
      else pending.resolve('# 지난 응답')
      await running
      assert.deepEqual(effects, { renders: [], statuses: [], errors: [] })
      assert.equal(context.currentRaw, '# 원문')
      assert.equal(reads.length, 1, '무효 응답에서 폴더 읽기로 이어지지 않는다')
      assert.equal(context.refreshInFlight, false)
      context.readText = async (url) => { reads.push(url); return '# 새 문서' }
      await context.refreshNow()
      assert.equal(effects.renders.length, 1)
      assert.equal(reads.length, 3)
    })
  }
}

test('현재 유효한 자동 읽기 실패는 계속 표시한다', async () => {
  const { context, effects } = reader()
  context.readText = async () => { throw new Error('current failure') }
  await context.refreshNow()
  assert.equal(effects.errors.length, 1)
  assert.equal(effects.errors[0][2].message, 'current failure')
  assert.equal(context.refreshInFlight, false)
})

function directoryReader(hidden = false) {
  const fixture = reader(hidden)
  const { context, reads } = fixture
  const child = { name: 'nested', url: 'file:///C:/docs/nested/', type: 'directory' }
  const nested = { isConnected: true, hidden: false }
  const target = {
    isConnected: true, dataset: {}, childElementCount: 1, closest: () => null,
    children: [{ dataset: { url: child.url }, classList: { add() {} }, querySelector: () => nested }],
    replaceChildren() { throw new Error('unexpected replacement') },
  }
  Object.assign(context, {
    directoryCache: new Map(), expandedDirectories: new Set([child.url]),
    parseDirectoryListing: () => [child], directorySignature: () => 'same', shouldReplaceDirectory: () => false,
    decorateSearchTree() {}, escapeHtml: (value) => value,
    readText: async (url) => { reads.push(url); return '' },
  })
  const directorySource = source.slice(source.indexOf('async function loadDirectory('), source.indexOf('\nfunction updateActiveFile'))
  vm.runInContext(ts.transpileModule(directorySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...fixture, target, child }
}

for (const [name, invalidate] of [
  ['숨김 후 복귀', hideAndReturn],
  ['페이지 종료 후 복귀', pageHideAndShow],
  ['자동 갱신 OFF 후 ON', disableAndEnable],
  ['문서 전환', ({ context }) => { context.renderGeneration++ }],
  ['트리 대상 제거', ({ target }) => { target.isConnected = false }],
]) {
  for (const failure of [false, true]) {
    test(`자동 폴더 읽기 중 ${name}: 늦은 ${failure ? '실패' : '성공'} 결과는 트리·캐시·상태를 변경하지 않는다`, async () => {
      const fixture = directoryReader()
      const { context, target, effects, reads } = fixture
      const pending = deferred()
      context.readText = (url) => { reads.push(url); return pending.promise }
      const running = context.loadDirectory('file:///C:/docs/', target, false, true, context.captureReadTarget(true))
      // 복귀 이벤트의 새 갱신 요청은 이 폴더 읽기와 별개이므로 차단한다.
      context.refreshInFlight = true
      invalidate(fixture)
      if (failure) pending.reject(new Error('late directory failed'))
      else pending.resolve('')
      assert.equal(await running, false)
      assert.equal(context.directoryCache.size, 0)
      assert.deepEqual(target.dataset, {})
      assert.deepEqual(effects, { renders: [], statuses: [], errors: [] })
      assert.deepEqual(reads, ['file:///C:/docs/'])
    })
  }
}

test('현재 폴더 실패는 표시하고 숨겨진 탭의 초기·수동 폴더 읽기는 유지한다', async () => {
  const { context, target, effects } = directoryReader(true)
  context.expandedDirectories.clear()
  assert.equal(await context.loadDirectory('file:///C:/docs/', target), true)
  assert.equal(target.dataset.loaded, 'true')
  context.readText = async () => { throw new Error('valid directory failed') }
  assert.equal(await context.loadDirectory('file:///C:/docs/', target), false)
  assert.equal(target.dataset.error, 'true')
  assert.equal(effects.errors.length, 1)
})

test('하위 폴더 병렬 읽기 중 문서를 전환하면 늦은 결과를 적용하지 않는다', async () => {
  const { context, target, child, reads } = directoryReader()
  const siblings = Array.from({ length: 5 }, (_, index) => ({ name: `sibling${index}`, url: `file:///C:/docs/sibling${index}/`, type: 'directory' }))
  for (const sibling of siblings) {
    target.children.push({ dataset: { url: sibling.url }, classList: { add() {} }, querySelector: () => ({ isConnected: true, dataset: {} }) })
    context.expandedDirectories.add(sibling.url)
  }
  context.parseDirectoryListing = () => [child, ...siblings]
  const pending = deferred()
  context.readText = async (url) => { reads.push(url); return reads.length === 1 ? '' : pending.promise }
  const running = context.loadDirectory('file:///C:/docs/', target, false, true, context.captureReadTarget(true))
  await settle()
  context.renderGeneration++
  pending.resolve('')
  assert.equal(await running, false)
  assert.deepEqual(reads, ['file:///C:/docs/', child.url, ...siblings.map(sibling => sibling.url)])
  assert.equal(context.directoryCache.size, 1)
})

test('페이지 종료는 타이머를 멈추고 복귀는 정상 주기를 복원한다', async () => {
  const { context, listeners, timers, reads } = reader()
  context.restartRefreshTimer()
  listeners.get('pagehide')({ persisted: true })
  assert.equal(timers.size, 0)
  await context.refreshNow()
  assert.deepEqual(reads, [])
  listeners.get('pageshow')({ persisted: true })
  await settle()
  assert.equal(timers.size, 1)
  assert.equal(reads.length, 2)
})

function enableOpenFile(context) {
  Object.assign(context, {
    URL, normalizeFileURL: (url) => url, searchQuery: '', updateActiveFile() {}, updateNavigation() {}, scheduleEnhancements() {},
    openDocuments: new Map(), documentsByURL: new Map(), documentsByName: new Map(), sourceReferences: new Map(), documentSequence: 0, documentOpenRequest: 0,
    handleSource: null, searchMode: null, restoringDocumentScroll: false, enhancementGeneration: 0, pendingTextPaint: undefined,
    readingPageResets: [], resetReadingPages(restore) { context.readingPageResets.push(restore) },
    getFileName: url => url.split('/').pop(), documentTabsUI: { add() {}, select() {}, remove() {}, setConnectionError() {} },
    documentLoading: { begin() {}, finish() {}, cancel() {} },
    content: { getBoundingClientRect: () => ({ height: 300 }), dataset: {}, replaceChildren() {}, setAttribute() {}, removeAttribute() {} }, toc: { replaceChildren() {} }, tocEntries: [],
    captureScroll: () => ({ top: 100 }), restoreScroll(_scroll, done) { done?.() }, positionDocumentSearch() {}, app: { querySelector: () => ({ hidden: false, focus() {} }) },
    rootName: {}, showWelcome() {}, closeSearch() {},

  })
  context.window.scrollTo = () => {}
  const openSource = source.slice(source.indexOf('function retainSource('), source.indexOf('async function adoptHandle(')) + source.slice(source.indexOf('async function openFile('), source.indexOf('async function refreshNow()'))
  vm.runInContext(ts.transpileModule(openSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

for (const failure of [false, true]) {
  test(`같은 트리를 다시 읽으면 이전 요청의 늦은 ${failure ? '실패' : '성공'} 응답이 최신 결과를 덮어쓰지 않는다`, async () => {
    const { context, target, effects } = directoryReader()
    context.expandedDirectories.clear()
    const pending = deferred()
    context.readText = () => pending.promise
    const oldLoad = context.loadDirectory('file:///C:/docs/', target)
    context.readText = async () => 'new'
    context.parseDirectoryListing = html => [{ name: html, url: `file:///C:/docs/${html}.md`, type: 'file' }]
    context.directorySignature = entries => entries[0].name
    assert.equal(await context.loadDirectory('file:///C:/docs/', target), true)
    if (failure) pending.reject(Error('old failure'))
    else pending.resolve('old')
    assert.equal(await oldLoad, false)
    await settle()
    assert.equal(target.dataset.signature, 'new')
    assert.equal(target.dataset.error, 'false')
    assert.equal(context.directoryCache.get('file:///C:/docs/').entries[0].name, 'new')
    assert.equal(effects.errors.length, 0)
  })
}

test('이름순 첫 표시 뒤 프레임을 양보한 후 수정일을 미리 읽고 캐시에 반영한다', async () => {
  const { context, target } = directoryReader()
  context.expandedDirectories.clear()
  const frames = [], events = []
  context.requestAnimationFrame = callback => frames.push(callback)
  context.applyDirectorySort = () => events.push('sorted')
  context.parseDirectoryListing = html => [{ name: 'file.md', url: target.children[0].dataset.url, type: 'file', ...(html === 'dates' ? { modifiedAt: 123 } : {}) }]
  context.explorerSource = {
    prepareDirectory: async () => {
      events.push('names')
      return { text: 'names', withMetadata: async () => { events.push('dates'); return 'dates' } }
    },
  }
  assert.equal(await context.loadDirectory('file:///C:/docs/', target), true)
  assert.equal(target.dataset.loaded, 'true')
  assert.deepEqual(events, ['names'])
  frames.shift()()
  assert.deepEqual(events, ['names'])
  frames.shift()()
  await settle()
  assert.deepEqual(events, ['names', 'dates', 'sorted'])
  assert.equal(context.directoryCache.get('file:///C:/docs/').entries[0].modifiedAt, 123)
  assert.equal(target.children[0].dataset.modifiedAt, '123')
  assert.equal(context.directoryMetadata.size, 0)
})

test('수정일순 첫 표시는 수정일을 기다리고 이름순용 추가 읽기를 예약하지 않는다', async () => {
  const { context, target } = directoryReader()
  context.expandedDirectories.clear()
  context.settings.directorySort.mode = 'modified'
  const pending = deferred(), events = []
  context.requestAnimationFrame = () => { throw Error('unexpected background read') }
  context.explorerSource = {
    prepareDirectory: async () => ({ text: 'names', withMetadata: () => { events.push('dates'); return pending.promise } }),
  }
  const loading = context.loadDirectory('file:///C:/docs/', target)
  await settle()
  assert.deepEqual(events, ['dates'])
  assert.equal(target.dataset.loaded, undefined)
  pending.resolve('dates')
  assert.equal(await loading, true)
  assert.equal(target.dataset.loaded, 'true')
  assert.equal(context.directoryMetadata.size, 0)
})

test('이전 수정일 미리 읽기가 늦게 끝나도 새 목록의 캐시와 노드를 덮어쓰지 않는다', async () => {
  const { context, target } = directoryReader()
  context.expandedDirectories.clear()
  const pending = deferred(), frames = []
  context.requestAnimationFrame = callback => frames.push(callback)
  let sorted = 0
  context.applyDirectorySort = () => sorted++
  context.parseDirectoryListing = html => [{ name: html, url: target.children[0].dataset.url, type: 'file', modifiedAt: html === 'old' ? 1 : 2 }]
  let generation = 0
  context.explorerSource = {
    prepareDirectory: async () => {
      const old = generation++ === 0
      return { text: old ? 'old' : 'new', withMetadata: () => old ? pending.promise : Promise.resolve('new') }
    },
  }
  await context.loadDirectory('file:///C:/docs/', target)
  const oldMetadata = context.directoryMetadata.get(target)()
  await settle()
  await context.loadDirectory('file:///C:/docs/', target)
  await context.directoryMetadata.get(target)()
  pending.resolve('old')
  await oldMetadata
  assert.equal(context.directoryCache.get('file:///C:/docs/').entries[0].modifiedAt, 2)
  assert.equal(target.children[0].dataset.modifiedAt, '2')
  assert.equal(sorted, 1)
})

test('수정일 준비 중에는 정렬 설정을 유지하고 이후 이름순 선택이 이전 요청보다 우선한다', async () => {
  const { context } = reader()
  const pending = deferred(), clicks = new Map(), saved = []
  Object.assign(context, {
    selectDirectorySort, directorySortRequest: 0,
    app: { querySelectorAll: () => ['name', 'modified'].map(sort => ({ dataset: { sort }, addEventListener: (_event, click) => clicks.set(sort, click) })) },
    saveSetting: (_key, value) => { context.settings.directorySort = value; saved.push(value.mode) },
    applyDirectorySort() {},
  })
  context.directoryMetadata.set({ closest: () => null }, () => pending.promise)
  const start = source.indexOf("app.querySelectorAll<HTMLButtonElement>('[data-sort]')")
  const end = source.indexOf("app.querySelector('[data-search-toggle]')", start)
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const sorting = clicks.get('modified')()
  assert.deepEqual(saved, [])
  assert.equal(context.settings.directorySort.mode, 'name')
  await clicks.get('name')()
  pending.resolve()
  await sorting
  assert.deepEqual(saved, ['name'])
  assert.equal(context.settings.directorySort.mode, 'name')
})

test('자동 갱신을 끄고 타이머를 재설정해도 이름순 목록의 수정일 준비는 완료한다', async () => {
  const { context, target } = directoryReader()
  context.expandedDirectories.clear()
  context.requestAnimationFrame = () => {}
  context.applyDirectorySort = () => {}
  const pending = deferred()
  context.explorerSource = {
    prepareDirectory: async () => ({ text: 'names', withMetadata: () => pending.promise }),
  }
  await context.loadDirectory('file:///C:/docs/', target)
  const metadata = context.directoryMetadata.get(target)()
  await settle()
  context.settings.refreshEnabled = false
  context.restartRefreshTimer()
  pending.resolve('dates')
  await metadata
  assert.equal(target.dataset.metadataReady, 'true')
  assert.equal(context.directoryMetadata.size, 0)
})

test('숨김으로 취소된 수정일은 자동 갱신 OFF에서도 복귀와 정렬 전환 시 새로 읽는다', async () => {
  const { context, target, listeners } = directoryReader()
  context.expandedDirectories.clear()
  target.querySelectorAll = () => []
  context.fileTree = target
  context.settings.refreshEnabled = false
  context.requestAnimationFrame = () => {}
  context.applyDirectorySort = () => {}
  const pending = deferred(), clicks = new Map()
  let preparations = 0, metadataReads = 0
  context.parseDirectoryListing = html => [{ name: html, url: target.children[0].dataset.url, type: 'file', modifiedAt: html === 'fresh' ? 200 : 100 }]
  context.explorerSource = {
    prepareDirectory: async () => {
      const old = ++preparations === 1
      return { text: 'names', withMetadata: () => { metadataReads++; return old ? pending.promise : Promise.resolve('fresh') } }
    },
  }
  await context.loadDirectory('file:///C:/docs/', target)
  const oldMetadata = context.directoryMetadata.get(target)()
  await settle()
  context.document.hidden = true
  listeners.get('visibilitychange')()
  pending.resolve('old')
  await oldMetadata
  assert.equal(target.dataset.metadataReady, 'false')
  context.document.hidden = false
  listeners.get('visibilitychange')()
  await settle()
  assert.equal(preparations, 2, '복귀는 취소된 캐시 대신 새 폴더 목록을 읽는다')
  Object.assign(context, {
    selectDirectorySort, directorySortRequest: 0,
    app: { querySelectorAll: () => [{ dataset: { sort: 'modified' }, addEventListener: (_event, click) => clicks.set('modified', click) }] },
    saveSetting: (_key, value) => { context.settings.directorySort = value },
  })
  const start = source.indexOf("app.querySelectorAll<HTMLButtonElement>('[data-sort]')")
  const end = source.indexOf("app.querySelector('[data-search-toggle]')", start)
  vm.runInContext(ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const collapsed = { dataset: { metadataReady: 'false' }, closest: () => ({ hidden: true }) }
  target.querySelectorAll = () => [collapsed]
  context.directoryMetadata.set(collapsed, () => { throw Error('collapsed folder must not block sorting') })
  await clicks.get('modified')()
  assert.equal(metadataReads, 2)
  assert.equal(context.settings.directorySort.mode, 'modified')
  assert.equal(target.dataset.metadataReady, 'true')
  assert.equal(target.children[0].dataset.modifiedAt, '200')
  assert.equal(context.directoryCache.get('file:///C:/docs/').entries[0].modifiedAt, 200)
})

test('수정일순 최초 읽기가 숨김으로 취소되면 복귀 시 표시되지 않은 루트를 다시 읽는다', async () => {
  const { context, target, listeners } = directoryReader()
  context.expandedDirectories.clear()
  context.fileTree = target
  target.querySelectorAll = () => []
  context.settings.refreshEnabled = false
  context.settings.directorySort.mode = 'modified'
  const pending = deferred()
  let preparations = 0
  context.explorerSource = {
    prepareDirectory: async () => {
      const old = ++preparations === 1
      return { text: 'names', withMetadata: () => old ? pending.promise : Promise.resolve('new') }
    },
  }
  const first = context.loadDirectory('file:///C:/docs/', target)
  await settle()
  context.document.hidden = true
  listeners.get('visibilitychange')()
  pending.resolve('old')
  assert.equal(await first, false)
  assert.equal(target.dataset.loaded, undefined)
  context.document.hidden = false
  listeners.get('visibilitychange')()
  await settle()
  assert.equal(preparations, 2)
  assert.equal(target.dataset.loaded, 'true')
  assert.equal(target.dataset.metadataReady, 'true')
})

test('루트 표시 뒤 취소된 수정일순 하위 폴더는 복귀 시 미완료 목록으로 다시 읽는다', async () => {
  const { context, target, child, listeners } = directoryReader()
  const nested = { isConnected: true, hidden: false, dataset: {}, children: [], closest: () => null }
  target.children[0].querySelector = () => nested
  target.querySelectorAll = () => [nested]
  context.fileTree = target
  context.settings.refreshEnabled = false
  context.settings.directorySort.mode = 'modified'
  context.parseDirectoryListing = (_html, url) => url === child.url ? [] : [child]
  const pending = deferred()
  let childReads = 0
  context.explorerSource = {
    prepareDirectory: async url => {
      const old = url === child.url && ++childReads === 1
      return { text: 'names', withMetadata: () => old ? pending.promise : Promise.resolve('dates') }
    },
  }
  const first = context.loadDirectory('file:///C:/docs/', target)
  await settle()
  assert.equal(target.dataset.loaded, 'true')
  assert.equal(nested.dataset.loaded, undefined)
  context.document.hidden = true
  listeners.get('visibilitychange')()
  pending.resolve('old')
  assert.equal(await first, false)
  assert.equal(nested.dataset.metadataReady, undefined)
  context.document.hidden = false
  listeners.get('visibilitychange')()
  await settle()
  assert.equal(childReads, 2)
  assert.equal(nested.dataset.loaded, 'true')
  assert.equal(nested.dataset.metadataReady, 'true')
})

test('새 문서 읽기 전에는 이전 A4 페이지 원본을 복원하지 않고 폐기한다', async () => {
  const { context } = reader()
  enableOpenFile(context)
  const pending = deferred()
  context.readText = () => pending.promise
  const opening = context.openFile('file:///C:/docs/other.md')
  assert.deepEqual(context.readingPageResets, [false])
  assert.equal(context.currentRaw, '')
  pending.resolve('# 새 문서')
  await opening
  assert.equal(context.currentRaw, '# 새 문서')
})

test('문서 전환 완료는 진행 중인 폴더 사전 조사를 유지한다', async () => {
  const { context } = reader()
  enableOpenFile(context)
  const previousReader = { read: () => { throw Error('obsolete directory reader') } }
  context.directoryFilterReader = previousReader
  const scheduled = []
  context.scheduleDirectoryFilter = () => scheduled.push(context.directoryFilterReader)
  const pending = deferred()
  context.readText = () => pending.promise
  const opening = context.openFile('file:///C:/docs/other.md')
  assert.deepEqual(scheduled, [])
  pending.resolve('# 새 문서')
  await opening
  assert.deepEqual(scheduled, [])
  assert.equal(context.directoryFilterReader, previousReader)
  assert.equal(context.currentRaw, '# 새 문서')
})

test('사라진 문서는 자동 새로고침을 중지하고 사용자 안내와 개발자 진단을 분리한다', async () => {
  const { context, reads, timers, effects, logs } = reader()
  context.t = key => ({
    readerConnectionMissingRefresh: '파일을 찾을 수 없어 자동 새로고침을 중지했습니다. 마지막으로 읽은 내용을 유지합니다.',
    readerReconnectAction: '다시 연결',
  })[key] || key
  context.activeDocument = { id: 'missing', url: 'file:///__markdown_leader__/fixture/crossword_PRD.md', name: 'crossword_PRD.md', source: {}, connectionError: false }
  context.restartRefreshTimer()
  const error = Object.assign(new Error('A requested file or directory could not be found at the time an operation was processed.'), { name: 'NotFoundError' })
  context.readText = async url => { reads.push(url); throw error }

  await context.refreshNow()

  assert.equal(context.activeDocument.connectionError, true)
  assert.equal(context.activeDocument.refreshSuspended, true)
  assert.equal(context.currentRaw, '# 원문')
  assert.equal(timers.size, 0)
  assert.equal(reads.length, 1)
  const userMessage = effects.statuses.at(-1)[0]
  assert.match(userMessage, /자동 새로고침을 중지/)
  assert.doesNotMatch(userMessage, /__markdown_leader__|NotFoundError|requested file|directory/)
  const developerMessage = logs.at(-1)[0]
  assert.match(developerMessage, /ML_CONNECTION_NOT_FOUND/)
  assert.match(developerMessage, /phase=automatic-refresh/)
  assert.match(developerMessage, /source=file-system-handle/)
  assert.match(developerMessage, /NotFoundError/)
  assert.match(developerMessage, /__markdown_leader__/)

  await context.refreshNow()
  assert.equal(reads.length, 1)
  context.connectionState(context.activeDocument, true)
  context.restartRefreshTimer()
  assert.equal(timers.size, 0)
})

for (const failure of [false, true]) {
  test(`수동 문서 열기 중 페이지 종료: 늦은 ${failure ? '실패' : '성공'} 결과를 적용하지 않는다`, async () => {
    const fixture = reader()
    const { context, effects } = fixture
    enableOpenFile(context)
    const pending = deferred()
    context.readText = () => pending.promise
    const running = context.openFile('file:///C:/docs/other.md')
    context.refreshInFlight = true
    pageHideAndShow(fixture)
    effects.statuses.length = 0
    if (failure) pending.reject(new Error('late manual failed'))
    else pending.resolve('# 지난 문서')
    await running
    assert.deepEqual(effects, { renders: [], statuses: [], errors: [] })
    assert.equal(context.currentRaw, '', '새 탭은 이전 본문을 보관하지 않는다')
  })
}

test('숨겨진 탭의 수동 문서 열기는 유지하고 전환한 문서의 렌더 실패도 표시한다', async () => {
  const { context, effects } = reader(true)
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/other.md')
  assert.equal(context.currentFileURL, 'file:///C:/docs/other.md')
  assert.equal(effects.renders.length, 1)
  context.renderMarkdown = () => { throw new Error('render failed') }
  await context.openFile('file:///C:/docs/third.md')
  assert.equal(effects.errors.length, 1)
  assert.equal(effects.errors[0][0], 'readerDocumentDisplayFailed')
})

test('자동 폴더 응답이 무효화되면 더 최근 상태를 지우지 않는다', async () => {
  const { context, effects } = reader()
  const pending = deferred()
  context.loadDirectory = () => pending.promise
  const running = context.refreshNow()
  await settle()
  context.renderGeneration++
  context.setStatus('새 문서 상태')
  pending.resolve(true)
  await running
  assert.deepEqual(effects.statuses, [['새 문서 상태']])
  assert.equal(context.refreshInFlight, false)
})


test('문서 탭 전환은 이전 타이머를 제거하고 읽기 완료 후 전체 주기를 새로 시작한다', async () => {
  const { context, timers, reads } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  const firstTimer = [...timers.keys()][0]
  const pending = deferred()
  context.readText = url => { reads.push(url); return pending.promise }
  const switching = context.openFile('file:///C:/docs/b.md')
  assert.equal(timers.size, 0)
  assert.equal(context.currentRaw, '')
  pending.resolve('# B')
  await switching
  assert.equal(timers.size, 1)
  assert.equal(timers.has(firstTimer), false)
  assert.equal([...timers.values()][0].ms, 10000)
  const a = context.documentsByURL.get('file:///C:/docs/a.md')
  assert.deepEqual({ ...a.scroll }, { top: 100 })
  const restored = []
  context.restoreScroll = (scroll, done) => { restored.push(scroll.top); done?.() }
  context.readText = async url => { reads.push(url); return '# A 최신' }
  await context.activateDocument(a)
  assert.deepEqual(restored, [100])
  assert.equal(context.currentRaw, '# A 최신')
  assert.equal(timers.size, 1)
})

for (const failure of [false, true]) {
  test(`A → B → A 빠른 전환에서 첫 A의 늦은 ${failure ? '실패' : '성공'} 응답을 무시한다`, async () => {
    const { context, effects } = reader()
    enableOpenFile(context)
    const first = deferred()
    context.readText = () => first.promise
    const opening = context.openFile('file:///C:/docs/a.md')
    context.readText = async url => url.endsWith('b.md') ? '# B' : '# A 최신'
    await context.openFile('file:///C:/docs/b.md')
    await context.openFile('file:///C:/docs/a.md')
    if (failure) first.reject(Error('지난 A 실패'))
    else first.resolve('# A 오래된 내용')
    await opening
    assert.equal(context.currentRaw, '# A 최신')
    assert.deepEqual(effects.renders.map(args => args[0]), ['# B', '# A 최신'])
    assert.equal(effects.errors.length, 0)
    assert.equal(context.openDocuments.size, 2)
  })
}

test('이전 자동 읽기의 finally는 새 활성 탭의 진행 중 읽기 잠금을 해제하지 않는다', async () => {
  const { context, reads } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  const oldRead = deferred(), newRead = deferred()
  context.readText = () => oldRead.promise
  const oldRefresh = context.refreshNow()
  context.readText = async () => '# B'
  await context.openFile('file:///C:/docs/b.md')
  context.readText = url => { reads.push(url); return newRead.promise }
  const newRefresh = context.refreshNow()
  oldRead.resolve('# A 늦은 갱신')
  await oldRefresh
  assert.equal(context.refreshInFlight, true)
  const count = reads.length
  await context.refreshNow()
  assert.equal(reads.length, count)
  newRead.resolve('# B 최신')
  await newRefresh
  assert.equal(context.refreshInFlight, false)
  assert.equal(context.currentRaw, '# B 최신')
})

test('많은 비활성 탭은 읽기·타이머를 만들지 않고 활성 문서만 갱신한다', async () => {
  const { context, reads, timers } = reader()
  enableOpenFile(context)
  for (let index = 0; index < 100; index++) context.registerDocument(`file:///C:/docs/${index}.md`, null)
  assert.equal(reads.length, 0)
  assert.equal(timers.size, 0)
  await context.activateDocument(context.openDocuments.get('50'))
  assert.deepEqual(reads, ['file:///C:/docs/49.md'])
  assert.equal(timers.size, 1)
  await context.refreshNow()
  assert.deepEqual(reads, ['file:///C:/docs/49.md', 'file:///C:/docs/49.md', 'file:///C:/docs/'])
})

test('공유 소스는 마지막 참조까지 유지하며 마지막 탭 닫기는 이미지와 타이머를 정리한다', async () => {
  const { context, timers } = reader()
  enableOpenFile(context)
  let disposed = 0, released = 0, welcomed = 0
  const shared = { name: 'docs', rootURL: 'file:///C:/docs/', releaseImages: () => released++, dispose: () => disposed++ }
  const a = context.registerDocument('file:///C:/docs/a.md', shared)
  const b = context.registerDocument('file:///C:/docs/b.md', shared)
  context.showWelcome = () => welcomed++
  await context.activateDocument(a)
  await context.closeDocument(b.id)
  assert.equal(disposed, 0)
  assert.equal(released, 0, '비활성 탭 닫기는 활성 이미지에 영향을 주지 않는다')
  await context.closeDocument(a.id)
  assert.equal(disposed, 1)
  assert.equal(released, 1)
  assert.equal(timers.size, 0)
  assert.equal(context.activeDocument, null)
  assert.equal(context.currentRaw, '')
  assert.equal(context.openDocuments.size, 0)
  assert.equal(context.documentsByURL.size, 0)
  assert.equal(context.documentsByName.size, 0)
  assert.equal(context.sourceReferences.size, 0)
  assert.equal(welcomed, 1)
})

test('새 탐색 소스를 선택하면 이전 폴더 응답은 캐시와 트리를 변경하지 않는다', async () => {
  const { context, target } = directoryReader()
  const pending = deferred()
  context.readText = () => pending.promise
  const loading = context.loadDirectory('file:///C:/docs/', target)
  context.explorerGeneration++
  context.explorerSource = { name: '새 폴더' }
  pending.resolve('')
  assert.equal(await loading, false)
  assert.equal(context.directoryCache.size, 0)
  assert.deepEqual(target.dataset, {})
})


test('자동 갱신 OFF 상태에서도 재선택은 최신 문서를 한 번 읽고 타이머를 만들지 않는다', async () => {
  const { context, reads, timers } = reader()
  enableOpenFile(context)
  context.settings.refreshEnabled = false
  await context.openFile('file:///C:/docs/a.md')
  await context.openFile('file:///C:/docs/b.md')
  await context.openFile('file:///C:/docs/a.md')
  assert.deepEqual(reads, ['file:///C:/docs/a.md', 'file:///C:/docs/b.md', 'file:///C:/docs/a.md'])
  assert.equal(timers.size, 0)
  assert.equal(context.settings.refreshEnabled, false)
})

test('새 탭 읽기 실패 후 기존 탭을 다시 선택하면 본문과 스크롤을 복구한다', async () => {
  const { context, effects, timers } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  const restored = []
  context.restoreScroll = (scroll, done) => { restored.push(scroll.top); done?.() }
  context.readText = async () => { throw Error('파일 없음') }
  await context.openFile('file:///C:/docs/missing.md')
  assert.equal(context.currentRaw, '')
  assert.equal(context.documentReady, false)
  assert.equal(timers.size, 0)
  assert.equal(effects.errors.length, 1)
  context.readText = async () => '# 복구된 A'
  await context.openFile('file:///C:/docs/a.md')
  assert.equal(context.currentRaw, '# 복구된 A')
  assert.deepEqual(restored, [100])
  assert.equal(timers.size, 1)
})


test('수동 폴더 읽기는 문서 탭 전환 뒤에도 현재 탐색기의 결과를 적용한다', async () => {
  const { context, target } = directoryReader()
  context.expandedDirectories.clear()
  const pending = deferred()
  context.readText = () => pending.promise
  const loading = context.loadDirectory('file:///C:/docs/', target)
  context.renderGeneration++
  context.currentFileURL = 'file:///C:/elsewhere/other.md'
  pending.resolve('')
  assert.equal(await loading, true)
  assert.equal(context.directoryCache.size, 1)
  assert.equal(target.dataset.loaded, 'true')
})

test('스크롤 복원 프레임 전에 다른 탭으로 이동해도 저장된 위치를 덮어쓰지 않는다', async () => {
  const { context } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  await context.openFile('file:///C:/docs/b.md')
  const a = context.documentsByURL.get('file:///C:/docs/a.md')
  const b = context.documentsByURL.get('file:///C:/docs/b.md')
  const frames = [], scrolls = []
  context.requestAnimationFrame = callback => frames.push(callback)
  context.document.documentElement = { scrollHeight: 5000 }
  context.window.innerHeight = 800
  context.window.scrollTo = options => scrolls.push({ ...options })
  context.restoredScrollTop = snapshot => snapshot.top
  const restoreSource = source.slice(source.indexOf('function restoreScroll('), source.indexOf('function renderMarkdown('))
  vm.runInContext(ts.transpileModule(restoreSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.activateDocument(a)
  assert.equal(context.restoringDocumentScroll, true)
  context.captureScroll = () => ({ top: 999 })
  await context.activateDocument(b)
  assert.equal(a.scroll.top, 100, 'A 복원 전의 B 화면 위치로 A 저장값을 바꾸지 않는다')
  frames.shift()()
  assert.equal(scrolls.length, 0, '이전 탭의 복원 프레임은 현재 탭을 스크롤하지 않는다')
  assert.equal(context.restoringDocumentScroll, true)
  frames.shift()()
  assert.deepEqual(scrolls, [{ top: 100, behavior: 'instant' }])
  assert.equal(context.restoringDocumentScroll, false)
})

test('활성 탭을 닫으면 이전 파일 동일성 조회가 완료되어도 문서를 다시 열지 않는다', async () => {
  const { context } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  const pending = deferred()
  const pendingSource = { fileHandle: () => pending.promise }
  const opening = context.openFile('file:///C:/other/a.md', pendingSource)
  await context.closeDocument(context.activeDocument.id)
  pending.resolve({ name: 'a.md' })
  await opening
  assert.equal(context.openDocuments.size, 0)
  assert.equal(context.activeDocument, null)
  assert.equal(context.currentFileURL, '')
})


test('전환 전에 대기열에 들어간 타이머는 같은 문서 재선택 후에도 읽기를 시작하지 않는다', async () => {
  const { context, reads, timers } = reader()
  enableOpenFile(context)
  await context.openFile('file:///C:/docs/a.md')
  const obsoleteCallback = [...timers.values()][0].callback
  await context.openFile('file:///C:/docs/b.md')
  await context.openFile('file:///C:/docs/a.md')
  const currentTimer = [...timers.keys()][0]
  const completedReads = [...reads]
  obsoleteCallback()
  await settle()
  assert.deepEqual(reads, completedReads, '이전 A 타이머는 새 A의 갱신 주기를 앞당기지 않는다')
  assert.equal(timers.size, 1)
  assert.equal(timers.has(currentTimer), true)
  assert.equal(timers.get(currentTimer).ms, 10000)
  timers.get(currentTimer).callback()
  await settle()
  assert.deepEqual(reads.slice(completedReads.length), ['file:///C:/docs/a.md', 'file:///C:/docs/'])
})

test('페이지를 떠나면 문서 로딩 표시와 예약을 취소한다', () => {
  const { context, listeners } = reader()
  let cancelled = 0
  context.documentLoading.cancel = () => { cancelled++ }
  listeners.get('pagehide')()
  assert.equal(cancelled, 1)
})

test('확장 컨텍스트 오류 보고가 요청을 무효화하기 전에 로딩 표시를 정리한다', async () => {
  const { context } = reader()
  enableOpenFile(context)
  const events = []
  context.documentLoading.finish = () => events.push('finish')
  context.readText = async () => { throw Error('Extension context invalidated.') }
  context.reportError = () => { events.push('error'); context.extensionInvalidated = true }
  await context.activateDocument(context.registerDocument('file:///broken.md', null))
  assert.deepEqual(events, ['finish', 'error'])
})

test('자동 읽기 도중 원본을 저장해도 다음 자동 갱신이 재개된다', async () => {
  const { context, reads } = reader()
  enableOpenFile(context)
  const tab = context.registerDocument('file:///review.md', null)
  tab.fileHandle = {}
  context.activeDocument = tab
  context.currentFileURL = tab.url
  context.currentRaw = '# before'
  context.documentReady = true
  context.refreshInFlight = true
  context.writeFileRevision = async (_handle, _before, after) => after
  context.reviewError = error => error
  context.bindingSyncRequested = false
  const save = source.slice(source.indexOf('async function saveDocumentRevision('), source.indexOf("app.querySelector('[data-sidebar-toggle]')"))
  vm.runInContext(ts.transpileModule(save, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.saveDocumentRevision(tab.id, '# before', '# after')
  assert.equal(context.refreshInFlight, false)
  assert.equal(context.writingDocumentId, null)
  await context.refreshNow()
  assert.ok(reads.includes(tab.url))
})
