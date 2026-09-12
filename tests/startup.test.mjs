import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const bootstrapSource = readFileSync(new URL('../src/content/startup.js', import.meta.url), 'utf8')
const contentSource = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const englishMessages = JSON.parse(readFileSync(new URL('../src/_locales/en/messages.json', import.meta.url), 'utf8'))
const koreanMessages = JSON.parse(readFileSync(new URL('../src/_locales/ko/messages.json', import.meta.url), 'utf8'))

function deferred() {
  let resolve
  let reject
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

test('document_start bootstrap은 지원 문서만 숨기고 저장 설정을 공유한다', async () => {
  const requested = deferred()
  const documentElement = { dataset: {} }
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    URL,
    location: { href: 'file:///C:/docs/readme.md' },
    document: { documentElement },
    chrome: { storage: { local: { get: () => requested.promise } } },
  })

  vm.runInContext(bootstrapSource, context)
  assert.equal(documentElement.dataset.markdownLeaderStartup, 'pending')
  assert.equal(typeof context.markdownLeaderSettingsReady?.then, 'function')

  requested.resolve({ colorMode: 'dark', fontSizePx: 21, contentWidthPx: 1040 })
  assert.deepEqual(
    { ...await context.markdownLeaderSettingsReady },
    { colorMode: 'dark', fontSizePx: 21, contentWidthPx: 1040 },
  )

  for (const [href, supported] of [
    ['file:///C:/docs/UPPER.MD', true],
    ['file:///C:/docs/component.mdc', true],
    ...['mdown', 'mdwn', 'mkdn', 'mkdown'].map((extension) => [`file:///C:/docs/legacy.${extension}`, true]),
    ['file:///C:/docs/page.html', false],
  ]) {
    const candidate = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
      URL, location: { href }, document: { documentElement: { dataset: {} } },
      chrome: { storage: { local: { get: async () => ({}) } } },
    })
    vm.runInContext(bootstrapSource, candidate)
    assert.equal(candidate.document.documentElement.dataset.markdownLeaderStartup === 'pending', supported, href)
  }

  let observed
  let disconnected = false
  let storageReads = 0
  const lateDocument = { documentElement: null }
  const missingRoot = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    URL,
    location: { href: 'file:///C:/docs/readme.md' },
    document: lateDocument,
    chrome: { storage: { local: { get: async () => { storageReads++; return { colorMode: 'dark' } } } } },
    MutationObserver: class {
      constructor(callback) { observed = callback }
      observe(target, options) { assert.equal(target, lateDocument); assert.deepEqual({ ...options }, { childList: true }) }
      disconnect() { disconnected = true }
    },
  })
  assert.doesNotThrow(() => vm.runInContext(bootstrapSource, missingRoot))
  assert.equal(typeof missingRoot.markdownLeaderSettingsReady?.then, 'function')
  assert.equal(storageReads, 1)
  const lateRoot = { dataset: {} }
  lateDocument.documentElement = lateRoot
  observed()
  assert.equal(lateRoot.dataset.markdownLeaderStartup, 'pending')
  assert.equal(disconnected, true)
})

test('manifest는 bootstrap 가드 CSS를 document_start에 먼저 주입한다', () => {
  const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ['file:///*'],
      js: ['content/startup.js'],
      css: ['content/startup.css'],
      run_at: 'document_start',
    },
    {
      matches: ['file:///*'],
      js: ['content/index.js'],
      run_at: 'document_idle',
    },
  ])
})

test('reader가 참조하는 번역 키는 영문과 한글 catalog에 모두 존재한다', () => {
  const readerKeys = [...contentSource.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1])
  assert.ok(readerKeys.length > 0)
  assert.deepEqual(contentSource.match(/getUILanguage/g)?.length, 1)
  for (const key of new Set(readerKeys)) {
    assert.ok(englishMessages[key]?.message, `영문 번역 누락: ${key}`)
    assert.ok(koreanMessages[key]?.message, `한글 번역 누락: ${key}`)
  }
  assert.equal(englishMessages.readerCopy.message, 'Copy')
  assert.equal(englishMessages.readerCopied.message, 'Copied')
  assert.equal(koreanMessages.readerCopy.message, '복사')
  assert.equal(koreanMessages.readerCopied.message, '복사됨')
})

test('초기 문서는 저장 설정 적용 후 기존 pre로 렌더하고 후속 작업을 예약한다', async () => {
  const settingsReady = deferred()
  const events = []
  const originalPre = { textContent: '' }
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    standaloneReader: false,
    registerDocument: () => ({ id: "1" }), documentTabsUI: { select() {} }, content: { setAttribute() {} }, activeDocument: null, documentReady: false,
    app: { querySelector: () => ({ open: false, addEventListener: () => {} }) },
    markdownLeaderSettingsReady: settingsReady.promise,
    defaults: { refreshIntervalMs: 10000, colorMode: 'system', fontSizePx: 17, contentWidthPx: 920, widthMode: 'custom', refreshEnabled: true },
    settings: {}, originalPre, currentRaw: 'not-set', currentFileURL: 'file:///C:/docs/empty.md',
    rootDirectoryURL: 'file:///C:/docs/', rootName: { textContent: '', title: '' }, renderGeneration: 0,
    t: (key) => ({ readerLocalFile: 'Local file' })[key] || key,
    requireExtension: () => {}, clampRefreshInterval: (value) => value,
    applySettings: () => events.push(['settings', context.settings.colorMode, context.settings.fontFamily, context.settings.fontSizePx, context.settings.contentWidthPx]),
    getFileName: () => 'docs', readText: async (url) => { events.push(['read', url]); return 'unexpected' },
    renderMarkdown: (raw) => events.push(['render', raw]), mountViewer: () => events.push(['mount']),
    updateNavigation: () => events.push(['navigation']),
    scheduleInitialBackgroundWork: () => events.push(['background']),
  })
  const startSource = contentSource.slice(contentSource.indexOf('async function start()'), contentSource.indexOf('\nvoid start()'))
  vm.runInContext(ts.transpileModule(startSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)

  const started = context.start()
  await Promise.resolve()
  assert.deepEqual(events, [])

  settingsReady.resolve({ colorMode: 'dark', fontFamily: 'system', fontSizePx: 21, contentWidthPx: 1040 })
  await started
  assert.deepEqual(events, [
    ['settings', 'dark', 'system', 21, 1040],
    ['navigation'],
    ['render', ''],
    ['mount'],
    ['background'],
  ])
  assert.equal(context.currentRaw, '')
})

test('원문 pre가 없을 때만 초기 파일을 읽는다', async () => {
  const reads = []
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    standaloneReader: false,
    registerDocument: () => ({ id: "1" }), documentTabsUI: { select() {} }, content: { setAttribute() {} }, activeDocument: null, documentReady: false,
    app: { querySelector: () => ({ open: false, addEventListener: () => {} }) },
    markdownLeaderSettingsReady: Promise.resolve({ colorMode: 'light' }),
    defaults: { refreshIntervalMs: 10000, fontFamily: 'system' }, settings: {}, originalPre: null,
    currentRaw: '', currentFileURL: 'file:///C:/docs/readme.md', rootDirectoryURL: null,
    rootName: { textContent: '', title: '' }, renderGeneration: 0,
    t: (key) => ({ readerLocalFile: 'Local file' })[key] || key,
    requireExtension: () => {}, clampRefreshInterval: (value) => value, applySettings: () => {}, getFileName: () => '',
    readText: async (url) => { reads.push(url); return '# fallback' }, renderMarkdown: () => {}, mountViewer: () => {},
    updateNavigation: () => {}, scheduleInitialBackgroundWork: () => {},
  })
  const startSource = contentSource.slice(contentSource.indexOf('async function start()'), contentSource.indexOf('\nvoid start()'))
  vm.runInContext(ts.transpileModule(startSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.start()
  assert.deepEqual(reads, ['file:///C:/docs/readme.md'])
})

test('빈 독립 리더는 파일 읽기와 자동 갱신 없이 탐색 초기화 후 시작 안내를 표시한다', async () => {
  const events = []
  const readingSettings = { open: false, addEventListener() {} }
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    standaloneReader: true, readerTabId: undefined,
    chrome: { tabs: { getCurrent: async () => { events.push('tab'); return { id: 42 } } } },
    app: { querySelector: () => readingSettings },
    markdownLeaderSettingsReady: Promise.resolve({ readingSettingsOpen: false }),
    defaults: { refreshIntervalMs: 10000, fontFamily: 'system' }, settings: {},
    currentFileURL: '', currentRaw: '', rootDirectoryURL: null, rootName: {}, renderGeneration: 0,
    initialBackgroundWorkComplete: false,
    t: (key) => key, requireExtension() {}, clampRefreshInterval: (value) => value,
    applySettings: () => events.push('settings'), updateNavigation: () => events.push('navigation'),
    mountViewer: () => events.push('mount'), showWelcome: () => events.push('welcome'),
    readText: () => assert.fail('빈 리더는 파일 읽기를 요청하면 안 됩니다.'),
    renderMarkdown: () => assert.fail('빈 리더는 문서 렌더링을 시작하면 안 됩니다.'),
    scheduleInitialBackgroundWork: () => assert.fail('빈 리더는 자동 탐색과 갱신을 시작하면 안 됩니다.'),
  })
  const startSource = contentSource.slice(contentSource.indexOf('async function start()'), contentSource.indexOf('\nfunction showStartupFailure'))
  vm.runInContext(ts.transpileModule(startSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.start()
  assert.deepEqual(events, ['tab', 'settings', 'navigation', 'mount', 'welcome'])
  assert.equal(context.readerTabId, 42)
  assert.equal(readingSettings.open, false)
  assert.equal(context.currentFileURL, '')
  assert.equal(context.currentRaw, '')
  assert.equal(context.renderGeneration, 0)
  assert.equal(context.initialBackgroundWorkComplete, true)
})

test('저장된 글꼴 선택은 viewer mount 전에 CSS 변수와 설정 UI에 적용된다', () => {
  const properties = new Map()
  const fontFamily = { value: '' }
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    document: { documentElement: { dataset: {}, style: { setProperty: (name, value) => properties.set(name, value) } } },
    settings: {
      refreshEnabled: true, refreshIntervalMs: 10000, colorMode: 'dark', fontFamily: 'system',
      fontSizePx: 18, contentWidthPx: 960, widthMode: 'custom',
    },
    content: { dataset: {} }, refreshEnabled: {}, refreshInterval: {}, themeButtons: [], fontFamily,
    fontSize: {}, fontSizeValue: {}, widthModeButtons: [], contentWidth: {}, contentWidthValue: {}, a4Note: {},
    restartRefreshTimer: () => { throw new Error('타이머를 시작하면 안 됩니다.') },
  })
  const applySource = contentSource.slice(contentSource.indexOf('function applySettings'), contentSource.indexOf('\nfunction saveSetting'))
  vm.runInContext(ts.transpileModule(applySource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)

  context.applySettings(false)
  assert.equal(context.document.documentElement.dataset.mlFontFamily, 'system')
  assert.equal(fontFamily.value, 'system')
})

test('Pretendard 선택은 글꼴 준비 전 viewer를 노출하지 않고 시스템 글꼴은 대기하지 않는다', async () => {
  for (const selectedFont of ['pretendard', 'system', undefined, 'invalid-font']) {
    const fontReady = deferred()
    const events = []
    const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
      standaloneReader: false,
    registerDocument: () => ({ id: "1" }), documentTabsUI: { select() {} }, content: { setAttribute() {} }, activeDocument: null, documentReady: false,
      app: { querySelector: () => ({ open: false, addEventListener: () => {} }) },
      markdownLeaderSettingsReady: Promise.resolve({ fontFamily: selectedFont }),
      defaults: { refreshIntervalMs: 10000, fontFamily: 'system' }, settings: {}, originalPre: { textContent: '# 문서' },
      currentRaw: '', currentFileURL: 'file:///C:/docs/readme.md', rootDirectoryURL: null,
      rootName: { textContent: '', title: '' }, renderGeneration: 0,
      t: (key) => ({ readerLocalFile: 'Local file' })[key] || key,
      document: { fonts: { load: () => { events.push('font'); return fontReady.promise } } },
      requireExtension: () => {}, clampRefreshInterval: (value) => value, applySettings: () => events.push('settings'), getFileName: () => '',
      readText: async () => { throw new Error('기존 원문을 다시 읽으면 안 됩니다.') }, renderMarkdown: () => events.push('render'),
      updateNavigation: () => {}, mountViewer: () => events.push('mount'), scheduleInitialBackgroundWork: () => events.push('background'),
    })
    const startSource = contentSource.slice(contentSource.indexOf('async function start()'), contentSource.indexOf('\nfunction showStartupFailure'))
    vm.runInContext(ts.transpileModule(startSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    const started = context.start()
    await new Promise((resolve) => setImmediate(resolve))

    if (selectedFont === 'pretendard') {
      assert.deepEqual(events, ['settings', 'render', 'font'])
      fontReady.resolve([])
      await started
      assert.deepEqual(events, ['settings', 'render', 'font', 'mount', 'background'])
    } else {
      await started
      assert.deepEqual(events, ['settings', 'render', 'mount', 'background'])
      assert.equal(context.settings.fontFamily, 'system')
    }
  }
})

test('폴더 탐색과 자동 갱신은 첫 paint 다음 frame까지 시작하지 않는다', async () => {
  const frames = []
  const events = []
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    requestAnimationFrame: (callback) => frames.push(callback), rootDirectoryURL: 'file:///C:/docs/', fileTree: {},
    loadDirectory: async () => { events.push('folder'); return true }, setStatus: () => events.push('status'),
    restartRefreshTimer: () => events.push('timer'),
  })
  const scheduleSource = contentSource.slice(contentSource.indexOf('function scheduleInitialBackgroundWork'), contentSource.indexOf('\nasync function start()'))
  vm.runInContext(ts.transpileModule(scheduleSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)

  context.scheduleInitialBackgroundWork()
  assert.deepEqual(events, [])
  frames.shift()()
  assert.deepEqual(events, [])
  frames.shift()()
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(events, ['folder', 'status', 'timer'])
})

test('설정 초기화 실패는 원문 대신 명시적 오류만 표시하고 가드를 해제한다', () => {
  const documentElement = { dataset: { markdownLeaderStartup: 'pending' }, replaceChildren: () => {} }
  const body = { className: '', textContent: '# 원문' }
  const errors = []
  const context = vm.createContext({
    applySidebar() {}, rememberDocument() {}, updateLibraryPanels() {}, reportLibraryError() {}, library: { ready: async () => {} },
    initialBackgroundWorkComplete: false,
    document: { documentElement, head: {}, body },
    console: { error: (...args) => errors.push(args) },
    t: (key, detail) => key === 'readerInitializationFailedLog'
      ? 'Viewer initialization failed'
      : `Markdown Leader initialization failed: ${detail}`,
    describeError: (error, translate) => `${translate === context.t ? '' : 'wrong translator: '}${error.message}`,
  })
  const failureSource = contentSource.slice(contentSource.indexOf('function showStartupFailure'), contentSource.indexOf('\nvoid start().catch'))
  vm.runInContext(ts.transpileModule(failureSource, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)

  context.showStartupFailure(new Error('storage failed'))
  assert.equal(body.textContent, 'Markdown Leader initialization failed: storage failed')
  assert.equal(body.className, 'markdown-leader')
  assert.equal(errors.length, 1)
  assert.equal(documentElement.dataset.markdownLeaderStartup, undefined)
})
