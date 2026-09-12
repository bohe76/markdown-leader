import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createTranslator } from '../src/i18n.mjs'
import {
  captureScrollSnapshot,
  clampRefreshInterval,
  describeError as describeLocalizedError,
  getParentDirectoryURL,
  isSupportedDocument,
  isMarkdownDocument,
  normalizeFileURL,
  parseDirectoryListing,
  resolveSafeURL,
  restoredScrollTop,
  shouldReplaceDirectory,
} from '../src/core.mjs'

const t = createTranslator('ko')
const describeError = (error, translate = t) => describeLocalizedError(error, translate)

// VM 밖의 DOM 알림 경계만 대체하고 오류 분류·무효화 로직은 실제 소스를 실행한다.
function installNoticeBoundary(context, source) {
  context.documentsByURL = new Map()
  context.normalizeFileURL = normalizeFileURL
  context.documentTabsUI = { setConnectionError() {} }
  context.statusToast = {
    resolve() {},
    clear() { context.status.textContent = '' },
    show(message, { error = false } = {}) {
      context.status.textContent = message
      context.status.classList.toggle('error', error)
    },
  }
  const connection = source.slice(source.indexOf('function connectionState('), source.indexOf('async function recoverConnection('))
  vm.runInContext(ts.transpileModule(connection, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
}

test('오류 안내는 알려진 원인을 구분하고 원문을 보존한다', () => {
  for (const [message, expected] of [
    ['Extension context invalidated.', 'F5'],
    ['Could not establish connection. Receiving end does not exist.', 'F5'],
    ['The message port closed before a response was received.', '응답 연결'],
    ['파일 읽기 시간 초과 (4초)', '드라이브 상태'],
    ['Failed to fetch', '파일 이동·삭제'],
  ]) {
    const result = describeError(new Error(message))
    assert.ok(result.includes(expected))
    assert.ok(result.includes(message))
  }
  assert.equal(describeError(new Error('예상하지 못한 렌더링 오류')), '예상하지 못한 렌더링 오류')
  assert.equal(describeError(null), '알 수 없는 오류')
})

test('영어 오류 안내도 원본 오류를 보존하고 부트스트랩 저장소 오류를 번역한다', () => {
  const translate = createTranslator('en')
  assert.match(describeError(new Error('Extension context invalidated.'), translate), /F5/)
  assert.match(describeError(new Error('File read timeout (4s)'), translate), /drive/)
  assert.ok(describeError(new Error('Failed to fetch'), translate).endsWith('(Failed to fetch)'))
  assert.equal(describeError(new Error('ML_STORAGE_UNAVAILABLE'), translate), translate('errorStorageUnavailable'))
  assert.equal(describeError(new Error('원본 상세'), translate), '원본 상세')
})

test('자동 갱신 실패는 단계를 보고하고 다음 주기에 복구한다', async () => {
  const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
  const guard = source.slice(source.indexOf('function captureReadTarget('), source.indexOf('async function loadDirectory('))
  const refresh = source.slice(source.indexOf('async function refreshNow()'), source.indexOf('function restartRefreshTimer()'))
  const reports = []
  let failRead = true
  let failRender = false
  const context = vm.createContext({
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    activeDocument: {}, documentReady: true, refreshRequest: 0, explorerGeneration: 0, explorerSource: null,
    t, readerLanguage: 'ko', extensionInvalidated: false, refreshInFlight: false, renderGeneration: 1, currentFileURL: 'file:///test.md',
    document: { hidden: false }, settings: { refreshEnabled: true },
    pageActive: true, pageGeneration: 0, refreshGeneration: 0, fileTree: { isConnected: true },
    currentRaw: 'old', rootDirectoryURL: null,
    readText: async () => { if (failRead) throw new Error('read failed'); return 'new' },
    renderMarkdown: () => { if (failRender) throw new Error('render failed') },
    setStatus: () => {}, reportError: (...args) => reports.push(args),
  })
  context.status = { textContent: '', classList: { toggle() {} } }
  installNoticeBoundary(context, source)
  vm.runInContext(ts.transpileModule(guard + refresh, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.refreshNow()
  assert.match(reports[0][0], /문서 읽기 실패/)
  assert.equal(reports[0][2].message, 'read failed')
  assert.equal(context.refreshInFlight, false)
  failRead = false
  failRender = true
  await context.refreshNow()
  assert.match(reports[1][0], /문서 표시 실패/)
  assert.equal(context.currentRaw, 'old')
  failRender = false
  await context.refreshNow()
  assert.equal(context.currentRaw, 'new')
  assert.equal(context.refreshInFlight, false)
  assert.equal(reports.length, 2)
})

test('연결 무효화는 오류 기록 없이 자동 갱신을 중지하고 안내를 유지한다', async () => {
  const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
  const errors = []
  const notices = []
  const cleared = []
  const errorStates = []
  const context = vm.createContext({
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    activeDocument: {}, documentReady: true, refreshRequest: 0, explorerGeneration: 0, explorerSource: null,
    t, handleSource: null, console: { error: (...args) => errors.push(args), info: (...args) => notices.push(args) },
    status: { textContent: '', classList: { toggle: (_, value) => errorStates.push(value) } },
    refreshTimer: 42, settings: { refreshEnabled: true }, document: { hidden: false }, currentFileURL: 'file:///test.md',
    chrome: { runtime: {}, storage: undefined },
    pageActive: true, pageGeneration: 0, refreshGeneration: 0, fileTree: { isConnected: true },
    window: { clearInterval: (id) => cleared.push(id) }, describeError,
    refreshInFlight: false, renderGeneration: 1, currentRaw: '# 기존 본문', rootDirectoryURL: null,
    renderMarkdown: () => assert.fail('연결 무효화는 기존 본문을 변경하면 안 됩니다.'),
  })
  const helpers = source.slice(source.indexOf('let extensionInvalidated ='), source.indexOf('function makeHeadingId'))
  installNoticeBoundary(context, source)
  const saveStart = source.indexOf('function saveSetting<')
  const save = source.slice(saveStart, source.indexOf("app.querySelectorAll<HTMLButtonElement>('[data-tab]')", saveStart))
  const guard = source.slice(source.indexOf('function captureReadTarget('), source.indexOf('async function loadDirectory('))
  const refresh = source.slice(source.indexOf('async function refreshNow()'), source.indexOf('function restartRefreshTimer()'))
  vm.runInContext(ts.transpileModule(helpers + save + guard + refresh, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await context.refreshNow()
  await assert.rejects(context.readText('file:///test.md'), /Extension context invalidated/)
  context.saveSetting('fontSizePx', 18)
  assert.match(context.status.textContent, /F5/)
  assert.doesNotMatch(context.status.textContent, /다음 주기|실패/)
  assert.deepEqual(cleared, [42])
  assert.equal(context.refreshTimer, undefined)
  assert.equal(context.refreshInFlight, false)
  assert.equal(context.currentRaw, '# 기존 본문')
  assert.deepEqual(errorStates, [false])
  assert.equal(errors.length, 0)
  assert.equal(notices.length, 1)
  assert.match(notices[0][0], /Extension context invalidated/)
  context.setStatus('')
  context.reportError('폴더 갱신 실패', 'file:///', new Error('Failed to fetch'))
  await context.refreshNow()
  assert.match(context.status.textContent, /F5/)
  assert.equal(errors.length, 0)
  assert.equal(notices.length, 1)
})

test('실제 읽기·메시지·렌더링 오류는 오류 로그와 재시도 안내를 유지한다', () => {
  const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
  const errors = []
  const context = vm.createContext({
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    activeDocument: {}, documentReady: true, refreshRequest: 0, explorerGeneration: 0, explorerSource: null,
    t, console: { error: (...args) => errors.push(args), info: () => assert.fail('실제 오류를 연결 변경으로 분류하면 안 됩니다.') },
    status: { textContent: '', classList: { toggle: () => {} } }, describeError,
    window: { clearInterval: () => assert.fail('재시도 가능한 오류에서 갱신을 중단하면 안 됩니다.') },
    refreshTimer: 42,
  })
  const helpers = source.slice(source.indexOf('let extensionInvalidated ='), source.indexOf('function requireExtension'))
  installNoticeBoundary(context, source)
  vm.runInContext(ts.transpileModule(helpers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  for (const message of ['Failed to fetch', 'Receiving end does not exist.', 'The message port closed.', 'render failed']) {
    context.reportError('자동 새로고침 실패', 'file:///test.md', new Error(message), true)
    assert.ok(errors.at(-1)[0].includes(message))
    assert.match(errors.at(-1)[0], /URL: file:\/\/\/test.md/)
    assert.match(context.status.textContent, /다음 주기/)
  }
  assert.equal(errors.length, 4)
  assert.equal(context.refreshTimer, 42)
})

test('메시지 응답 도중 연결이 무효화되어도 예외를 밖으로 던지지 않고 요청을 종료한다', async () => {
  const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
  let reply
  const context = vm.createContext({
    writingDocumentId: null, reviewUI: { forget() {}, clear() {}, refreshAnchors() {}, setDocument() {} }, rememberDocument() {},
    activeDocument: {}, documentReady: true, refreshRequest: 0, explorerGeneration: 0, explorerSource: null,
    t, handleSource: null, requireExtension: () => {}, documentsByURL: new Map(), normalizeFileURL,
    chrome: { runtime: {
      sendMessage: (_, callback) => { reply = callback },
      get lastError() { throw new Error('Extension context invalidated.') },
    } },
  })
  const read = source.slice(source.indexOf('function readText('), source.indexOf('function makeHeadingId'))
  vm.runInContext(ts.transpileModule(read, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  const rejected = assert.rejects(context.readText('file:///test.md'), /Extension context invalidated/)
  assert.doesNotThrow(() => reply(undefined))
  await rejected
})

test('refresh interval uses the documented default and boundaries', () => {
  assert.equal(clampRefreshInterval('bad'), 10000)
  assert.equal(clampRefreshInterval(10), 500)
  assert.equal(clampRefreshInterval(750.4), 750)
  assert.equal(clampRefreshInterval(900000), 600000)
})

test('Chrome directory listing keeps folders and supported files in stable order', () => {
  const html = `
    <script>addRow("zeta.md","zeta.md",0,1,"1 kB");
    addRow("notes","notes/",1,0,"");
    addRow("image.png","image.png",0,1,"2 kB");
    addRow("Alpha.MDX","Alpha.MDX",0,1,"1 kB");</script>`
  const entries = parseDirectoryListing(html, 'file:///C:/docs/')
  assert.deepEqual(entries.map((entry) => [entry.type, entry.name]), [
    ['directory', 'notes'], ['file', 'Alpha.MDX'], ['file', 'zeta.md'],
  ])
  assert.equal(entries[0].url, 'file:///C:/docs/notes/')
})

test('anchor listing supports a second directory level', () => {
  const entries = parseDirectoryListing('<a href="../">..</a><a href="nested/">nested/</a><a href="readme.markdown">readme.markdown</a>', 'file:///C:/docs/notes/')
  assert.equal(entries[0].url, 'file:///C:/docs/notes/nested/')
  assert.equal(entries[1].url, 'file:///C:/docs/notes/readme.markdown')
})

test('supported extensions and parent directory work for Windows file URLs', () => {
  assert.equal(isSupportedDocument('file:///C:/docs/README.md'), true)
  assert.equal(isSupportedDocument('file:///C:/docs/image.png'), false)
  assert.equal(getParentDirectoryURL('file:///C:/docs/README.md'), 'file:///C:/docs/')
})

test('Markdown 확장자는 모두 탐색하고 일반 텍스트는 목록에서 제외한다', () => {
  const extensions = ['md', 'markdown', 'mdown', 'mdwn', 'mkd', 'mkdn', 'mkdown', 'mdx', 'mdc']
  const html = [...extensions, 'txt', 'png', 'js'].map((extension) => `<a href="note.${extension.toUpperCase()}">note.${extension.toUpperCase()}</a>`).join('')
  assert.equal(parseDirectoryListing(html, 'file:///C:/docs/').length, extensions.length)
  for (const extension of extensions) {
    const url = `file:///C:/docs/note.${extension.toUpperCase()}?v=1#heading`
    assert.equal(isMarkdownDocument(url), true)
    assert.equal(isSupportedDocument(url), true)
  }
  assert.equal(isMarkdownDocument('file:///C:/docs/plain.txt'), false)
  assert.equal(isSupportedDocument('file:///C:/docs/plain.txt'), true)
  assert.equal(isMarkdownDocument('file:///C:/docs/not.md.png'), false)
})

test('relative URLs resolve from the current document and unsafe schemes are rejected', () => {
  const base = 'file:///C:/docs/guide/page.md'
  assert.equal(resolveSafeURL('../assets/a.png', base, 'image'), 'file:///C:/docs/assets/a.png')
  assert.equal(resolveSafeURL('./other.md', base, 'link'), 'file:///C:/docs/guide/other.md')
  assert.equal(resolveSafeURL('javascript:alert(1)', base, 'link'), null)
  assert.equal(resolveSafeURL('data:text/html;base64,QQ==', base, 'image'), null)
  assert.equal(resolveSafeURL('data:image/png;base64,QQ==', base, 'image'), 'data:image/png;base64,QQ==')
})

test('scroll restoration prefers matching heading and falls back to ratio', () => {
  const snapshot = captureScrollSnapshot(550, 2000, 500, [
    { id: 'one', top: 100 }, { id: 'two', top: 500 }, { id: 'three', top: 900 },
  ])
  assert.deepEqual(snapshot, { headingId: 'two', headingOffset: 50, ratio: 550 / 1500 })
  assert.equal(restoredScrollTop(snapshot, 620, 2200, 500), 670)
  assert.equal(restoredScrollTop(snapshot, undefined, 2000, 500), 550)
})

test('an empty directory stays stable and replaces a previous error state', () => {
  assert.equal(shouldReplaceDirectory('', '', true, false), false)
  assert.equal(shouldReplaceDirectory('', '', true, true), true)
  assert.equal(shouldReplaceDirectory('', '', false, false), true)
})
