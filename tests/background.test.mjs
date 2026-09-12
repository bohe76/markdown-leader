import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createTranslator } from '../src/i18n.mjs'

const source = readFileSync(new URL('../src/background.js', import.meta.url), 'utf8')

for (const [command, key, value, action] of [
  ['toggleRefresh', 'refreshEnabled', false, 'refreshChanged'],
  ['togglePageTheme', 'colorMode', 'dark', 'themeChanged'],
]) {
  for (const standalone of [false, true]) {
    test(`${command}: ${standalone ? '독립 리더는 대상 탭 ID를 포함한 확장 메시지로 전달한다' : 'content script 수신 성공 시 확장 메시지를 중복 전송하지 않는다'}`, async () => {
      let onCommand
      const saved = []
      const tabMessages = []
      const runtimeMessages = []
      const context = vm.createContext({
        chrome: {
          runtime: {
            onInstalled: { addListener() {} }, onMessage: { addListener() {} }, onConnect: { addListener() {} },
            sendMessage: async (message) => runtimeMessages.push({ ...message }),
          },
          commands: { onCommand: { addListener(listener) { onCommand = listener } } },
          storage: { local: {
            get(defaults, callback) { callback({ ...defaults }) },
            set(settings, callback) { saved.push({ ...settings }); callback() },
          } },
          tabs: {
            query(options, callback) {
              assert.deepEqual({ ...options }, { active: true, currentWindow: true })
              callback([{ id: 42 }])
            },
            async sendMessage(tabId, message) {
              tabMessages.push({ tabId, ...message })
              if (standalone) throw new Error('Receiving end does not exist.')
            },
          },
        },
      })
      vm.runInContext(source, context)
      onCommand(command)
      await new Promise((resolve) => setImmediate(resolve))
      assert.deepEqual(saved, [{ [key]: value }])
      assert.deepEqual(tabMessages, [{ tabId: 42, action, value }])
      assert.deepEqual(runtimeMessages, standalone ? [{ action, value, targetTabId: 42 }] : [])
    })
  }
}

test('설치 시 기본 주기와 글꼴을 채우고 저장된 사용자 설정을 유지한다', () => {
  for (const stored of [{}, { refreshIntervalMs: 7000, refreshEnabled: false, fontFamily: 'system' }, { fontFamily: 'pretendard' }]) {
    let onInstalled
    let saved
    const context = vm.createContext({
      chrome: {
        i18n: { getMessage: createTranslator('ko') },
        runtime: {
          onInstalled: { addListener(listener) { onInstalled = listener } },
          onMessage: { addListener() {} },
          onConnect: { addListener() {} },
        },
        storage: { local: {
          get(defaults, callback) { callback({ ...defaults, ...stored }) },
          set(values) { saved = values },
        } },
        commands: { onCommand: { addListener() {} } },
      },
    })
    vm.runInContext(source, context)
    onInstalled({ reason: 'install' })
    assert.equal(saved.refreshIntervalMs, stored.refreshIntervalMs ?? 10000)
    assert.equal(saved.refreshEnabled, stored.refreshEnabled ?? true)
    assert.equal(saved.fontFamily, stored.fontFamily ?? 'system')
  }
})

function requestFile(fetch, language = 'ko', fileAccess = true) {
  let listener
  const timers = new Map()
  const timerDelays = new Map()
  const context = vm.createContext({
    URL, AbortController, fetch,
    setTimeout(callback, delay) { timers.set(1, callback); timerDelays.set(1, delay); return 1 },
    clearTimeout(id) { timers.delete(id) },
    chrome: {
      i18n: { getMessage: createTranslator(language) },
      extension: { isAllowedFileSchemeAccess: async () => fileAccess },
      runtime: {
        id: 'test-extension',
        onInstalled: { addListener() {} },
        onMessage: { addListener(value) { listener = value } },
        onConnect: { addListener() {} },
      },
      commands: { onCommand: { addListener() {} } },
    },
  })
  vm.runInContext(source, context)
  let respond
  const response = new Promise((resolve) => { respond = resolve })
  const keepAlive = listener(
    { action: 'readText', url: 'file:///C:/fixture/readme.md' },
    { id: 'test-extension', tab: { url: 'file:///C:/fixture/index.md' } },
    respond,
  )
  assert.equal(keepAlive, true)
  return { response, timers, advanceTime(ms) {
    for (const [id, callback] of timers) if (timerDelays.get(id) <= ms) callback()
  } }
}

test('실행이 5.5초 지연돼도 정상 로컬 응답을 4초 타이머로 중단하지 않는다', async () => {
  let finish
  const request = requestFile((_url, { signal }) => new Promise((resolve, reject) => {
    finish = () => resolve({ ok: true, status: 200, text: async () => '# 정상 문서' })
    signal.addEventListener('abort', () => reject(signal.reason))
  }))
  await new Promise((resolve) => setImmediate(resolve))
  request.advanceTime(5500)
  finish()
  const result = await request.response
  assert.equal(result.ok, true)
  assert.equal(result.text, '# 정상 문서')
  assert.equal(request.timers.size, 0)
})

test('실제 백그라운드 핸들러가 문서 본문을 응답하고 타이머를 정리한다', async () => {
  const request = requestFile(async () => ({ ok: true, status: 200, text: async () => '# 문서' }))
  const result = await request.response
  assert.equal(result.ok, true)
  assert.equal(result.text, '# 문서')
  assert.equal(request.timers.size, 0)
})

test('파일 읽기를 중단한 AbortError는 시간 초과로 안내한다', async () => {
  for (const [language, expected] of [['ko', '파일 읽기 시간 초과 (15초)'], ['en', 'File read timeout (15s)']]) {
    const request = requestFile((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason))
    }), language)
    await new Promise((resolve) => setImmediate(resolve))
    request.timers.get(1)()
    const result = await request.response
    assert.equal(result.ok, false)
    assert.equal(result.error, expected)
    assert.equal(request.timers.size, 0)
  }
})

test('시간 초과와 겹친 파일 접근 거부는 원본 오류를 보존한다', async () => {
  let rejectFetch
  const request = requestFile(() => new Promise((_resolve, reject) => { rejectFetch = reject }))
  await new Promise((resolve) => setImmediate(resolve))
  request.timers.get(1)()
  rejectFetch(new TypeError('Failed to fetch'))
  const result = await request.response
  assert.equal(result.ok, false)
  assert.equal(result.error, 'Failed to fetch')
  assert.equal(result.errorCode, 'ML_FILE_FETCH_FAILED')
  assert.equal(request.timers.size, 0)
})

test('파일 URL 접근이 꺼져 있으면 fetch 전에 안정적인 진단 코드를 반환한다', async () => {
  let fetched = false
  const request = requestFile(async () => { fetched = true }, 'ko', false)
  const result = await request.response
  assert.equal(fetched, false)
  assert.equal(result.ok, false)
  assert.equal(result.error, 'ML_FILE_SCHEME_ACCESS_DENIED')
  assert.equal(result.errorName, 'NotAllowedError')
  assert.equal(result.errorCode, 'ML_FILE_SCHEME_ACCESS_DENIED')
  assert.equal(request.timers.size, 0)
})

test('응답 본문 읽기 중 발생한 다른 오류도 시간 초과로 덮어쓰지 않는다', async () => {
  let rejectBody
  const request = requestFile(async () => ({
    ok: true, status: 200,
    text: () => new Promise((_resolve, reject) => { rejectBody = reject }),
  }))
  await new Promise((resolve) => setImmediate(resolve))
  request.timers.get(1)()
  rejectBody(new Error('본문 읽기 실패'))
  const result = await request.response
  assert.equal(result.ok, false)
  assert.equal(result.error, '본문 읽기 실패')
  assert.equal(request.timers.size, 0)
})
