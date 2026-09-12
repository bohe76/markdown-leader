import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { renderMath } from '../src/content/markdown-math.mjs'

const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const scheduling = source.slice(source.indexOf('function scheduleEnhancements()'), source.indexOf('let tocEntries:'))

function fixture() {
  const frames = [], timers = [], listeners = new Map(), reads = []
  const context = vm.createContext({
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    content: { isConnected: true, firstChild: {}, dataset: {}, querySelector: () => ({}) }, enhancementGeneration: 0, pendingTextPaint: undefined, pageActive: false, extensionInvalidated: false,
    readingOriginal: undefined, resetReadingPages() {}, paginateReadingDocument: async () => {},
    pageGeneration: 1, renderGeneration: 1, settings: { colorMode: 'light' },
    document: { documentElement: {} }, t: key => key,
    window: { addEventListener(name, listener) { listeners.set(name, listener) }, setTimeout(callback) { timers.push(callback) } },
    requestAnimationFrame: callback => frames.push(callback),
    matchMedia: () => ({ addEventListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '#ffffff' }),
    renderMath: async () => {},
    scheduleDirectoryFilter() {},
    renderDiagrams: async (_content, options) => reads.push(options),
    highlightDocument() {}, scheduleTocUpdate() {}, reportError: error => { throw error },
  })
  vm.runInContext(ts.transpileModule(scheduling, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { context, frames, timers, listeners, reads }
}

test('페이지 복귀 리스너가 활성 상태 복원보다 먼저 실행돼도 다이어그램을 재개한다', async () => {
  const { context, frames, timers, listeners, reads } = fixture()
  listeners.get('pageshow')()
  context.pageActive = true
  while (frames.length) frames.shift()()
  while (timers.length) timers.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads.length, 1)
  assert.equal(reads[0].isCurrent(), true)
  context.pageGeneration++
  assert.equal(reads[0].isCurrent(), false)
})

test('예약한 다이어그램 작업 전에 문서나 확장 연결이 바뀌면 엔진을 호출하지 않는다', () => {
  for (const invalidate of [context => context.renderGeneration++, context => { context.extensionInvalidated = true }]) {
    const { context, frames, timers, reads } = fixture()
    context.pageActive = true
    context.scheduleEnhancements()
    invalidate(context)
    while (frames.length) frames.shift()()
    while (timers.length) timers.shift()()
    assert.equal(reads.length, 0)
  }
})


test('본문을 그릴 두 프레임과 별도 작업 전에는 렌더러를 호출하지 않는다', async () => {
  const { context, frames, timers, reads } = fixture()
  context.pageActive = true
  context.scheduleEnhancements()
  assert.equal(reads.length, 0)
  frames.shift()()
  assert.equal(reads.length, 0)
  frames.shift()()
  assert.equal(reads.length, 0)
  timers.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads.length, 1)
})

test('수식과 다이어그램이 없는 문서는 별도 작업을 예약하지 않는다', () => {
  const { context, frames, timers, reads } = fixture()
  context.pageActive = true
  context.content.querySelector = () => null
  context.scheduleEnhancements()
  assert.deepEqual([frames.length, timers.length, reads.length], [0, 0, 0])
})

test('일반 문서도 A4 페이지 완성을 요청한다', async () => {
  const { context } = fixture()
  context.pageActive = true
  context.content.querySelector = () => null
  let pages = 0
  context.paginateReadingDocument = async isCurrent => { assert.equal(isCurrent(), true); pages++ }
  context.scheduleEnhancements()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pages, 1)
})

test('수식과 다이어그램이 완료된 후 A4 페이지를 만든다', async () => {
  const { context, frames, timers } = fixture()
  context.pageActive = true
  let finish, pages = 0
  context.renderDiagrams = () => new Promise(resolve => { finish = resolve })
  context.paginateReadingDocument = async () => { pages++ }
  context.scheduleEnhancements()
  while (frames.length) frames.shift()()
  while (timers.length) timers.shift()()
  assert.equal(pages, 0)
  finish()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(pages, 1)
})

test('paint API가 있으면 첫 콘텐츠 표시 전에는 렌더러를 불러오지 않는다', async () => {
  const { context, frames, timers, reads } = fixture()
  let notify, disconnected = false
  context.pageActive = true
  context.performance = { getEntriesByType: () => [] }
  context.PerformanceObserver = class {
    static supportedEntryTypes = ['paint']
    constructor(callback) { notify = callback }
    observe() {}
    disconnect() { disconnected = true }
  }
  context.scheduleEnhancements()
  while (frames.length) frames.shift()()
  while (timers.length) timers.shift()()
  assert.equal(reads.length, 0)
  notify({ getEntries: () => [{ name: 'first-paint' }] })
  assert.equal(timers.length, 0)
  notify({ getEntries: () => [{ name: 'first-contentful-paint' }] })
  assert.equal(disconnected, true)
  assert.equal(reads.length, 0)
  while (timers.length) timers.shift()()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(reads.length, 1)
})

test('반복 예약과 페이지 종료는 이전 paint 관찰자를 정리한다', () => {
  const { context, frames, timers, listeners } = fixture()
  let active = 0
  context.pageActive = true
  context.performance = { getEntriesByType: () => [] }
  context.PerformanceObserver = class {
    static supportedEntryTypes = ['paint']
    observing = false
    observe() { this.observing = true; active++ }
    disconnect() { if (this.observing) { active--; this.observing = false } }
  }
  for (let index = 0; index < 3; index++) {
    context.scheduleEnhancements()
    while (frames.length) frames.shift()()
    while (timers.length) timers.shift()()
    assert.equal(active, 1)
  }
  listeners.get('pagehide')()
  assert.equal(active, 0)
  assert.equal(context.pendingTextPaint, undefined)
})

test('새 탭 읽기가 실패해도 이전 탭의 지연 수식 처리는 중단한다', async () => {
  const { context, frames, timers } = fixture()
  const block = { isConnected: true, dataset: { mathState: 'pending', displayMode: 'inline' },
    querySelector: () => ({ textContent: 'x' }), innerHTML: '' }
  context.content.ownerDocument = {}
  context.content.querySelectorAll = () => block.dataset.mathState === 'pending' ? [block] : []
  context.content.contains = value => value === block
  let release
  const engine = new Promise(resolve => { release = resolve })
  const jobs = [], reports = []
  Object.assign(context, {
    pageActive: true, refreshGeneration: 0, currentFileURL: 'file:///old.md', currentRaw: '# 기존 문서',
    URL, normalizeFileURL: value => value, setStatus() {},
    restoringDocumentScroll: false, activeDocument: { scroll: null }, documentReady: true, refreshTimer: undefined, refreshRequest: 0, refreshInFlight: false,
    handleSource: null, searchMode: null, explorerSource: null, rootDirectoryURL: 'file:///', rootName: {},
    openDocuments: new Map(), documentsByURL: new Map(), documentsByName: new Map(), sourceReferences: new Map(), documentSequence: 0, documentOpenRequest: 0,
    getFileName: url => url.split('/').pop(), documentTabsUI: { add() {}, select() {}, setConnectionError() {} },
    statusToast: { resolve() {} },
    documentLoading: { begin() {}, finish() {}, cancel() {} },
    toc: { replaceChildren() {} }, tocEntries: [], captureScroll: () => ({ top: 100 }),
    app: { querySelector: () => ({ hidden: false }) }, positionDocumentSearch() {}, updateNavigation() {}, restartRefreshTimer() {},

    readText: async () => { throw Error('missing document') },
    reportError: (...args) => reports.push(args),
    renderMath(content, options) {
      const job = renderMath(content, { ...options, loadRenderer: () => engine, loadStyles: async () => {} })
      jobs.push(job)
      return job
    },
  })
  context.content.getBoundingClientRect = () => ({ height: 300 })
  context.content.dataset = {}
  context.content.setAttribute = () => {}
  context.content.replaceChildren = () => { block.isConnected = false; context.content.firstChild = null }
  const lifecycle = source.slice(source.indexOf('function retainSource('), source.indexOf('async function adoptHandle('))
  const guard = source.slice(source.indexOf('function captureReadTarget('), source.indexOf('async function loadDirectory('))
  const open = source.slice(source.indexOf('async function openFile('), source.indexOf('async function refreshNow()'))
  const connection = source.slice(source.indexOf('function connectionState('), source.indexOf('async function recoverConnection('))
  vm.runInContext(ts.transpileModule(connection + lifecycle + guard + open, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const flush = () => { while (frames.length) frames.shift()(); while (timers.length) timers.shift()() }
  context.scheduleEnhancements()
  flush()
  await context.openFile('file:///missing.md')
  flush()
  release({ renderMathSource: () => '<math>x</math>' })
  await Promise.all(jobs)
  assert.equal(block.dataset.mathState, 'pending')
  assert.equal(block.innerHTML, '')
  assert.equal(context.currentFileURL, 'file:///missing.md')
  assert.equal(context.currentRaw, '')
  assert.equal(context.documentReady, false)
  assert.equal(reports.length, 1)
  assert.equal(reports[0][0], 'readerDocumentReadFailed')
})
