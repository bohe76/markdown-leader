const defaults = {
  refreshEnabled: true,
  refreshIntervalMs: 10000,
  colorMode: 'system',
  fontFamily: 'system',
  fontSizePx: 17,
  contentWidthPx: 920,
  widthMode: 'custom',
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(defaults, (values) => chrome.storage.local.set(values))
})

function isReaderSender(sender) {
  const readerURL = `chrome-extension://${chrome.runtime.id}/reader.html`
  return sender?.id === chrome.runtime.id && (sender.tab?.url?.startsWith('file:') || sender.url === readerURL)
}

const libraryLockQueue = []
let libraryLockOwner
function grantLibraryLock() {
  if (libraryLockOwner) return
  while (libraryLockQueue.length) {
    const port = libraryLockQueue.shift()
    try {
      port.postMessage({ action: 'granted' })
      libraryLockOwner = port
      return
    } catch { /* 이미 닫힌 탭은 건너뛴다. */ }
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'markdown-leader-library') return
  if (!isReaderSender(port.sender)) { port.disconnect(); return }
  let requested = false
  function release() {
    const index = libraryLockQueue.indexOf(port)
    if (index >= 0) libraryLockQueue.splice(index, 1)
    if (libraryLockOwner === port) libraryLockOwner = undefined
    grantLibraryLock()
  }
  port.onDisconnect.addListener(release)
  port.onMessage.addListener(message => {
    if (message?.action === 'acquire' && !requested) {
      requested = true
      libraryLockQueue.push(port)
      grantLibraryLock()
    } else if (message?.action === 'release') {
      release()
      port.disconnect()
    }
    // 짧은 저장 작업이 지연된 동안의 heartbeat도 service worker 유휴 시간을 갱신한다.
  })
})

async function fetchText(url) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'file:') throw new Error(chrome.i18n.getMessage('errorFileUrlOnly'))
  if (!await chrome.extension.isAllowedFileSchemeAccess()) {
    const error = new Error('ML_FILE_SCHEME_ACCESS_DENIED')
    error.name = 'NotAllowedError'
    error.code = 'ML_FILE_SCHEME_ACCESS_DENIED'
    throw error
  }
  const controller = new AbortController()
  // 파일 응답을 처리하는 실행 지연도 포함하므로 짧은 갱신 주기와 분리한다.
  const readTimeoutMs = 15000
  const timeout = setTimeout(() => controller.abort(), readTimeoutMs)
  try {
    const response = await fetch(parsed.href, { cache: 'no-store', signal: controller.signal })
    // file:// responses use status 0 in Chromium even when the body is readable.
    if (!response.ok && response.status !== 0) throw new Error(`HTTP ${response.status}`)
    return await response.text()
  } catch (error) {
    if (controller.signal.aborted && error?.name === 'AbortError') throw new Error(chrome.i18n.getMessage('errorReadTimeout', [String(readTimeoutMs / 1000)]))
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action !== 'readText' || typeof message.url !== 'string') return
  if (!isReaderSender(sender)) {
    sendResponse({ ok: false, error: chrome.i18n.getMessage('errorRequestDenied') })
    return
  }
  fetchText(message.url)
    .then((text) => sendResponse({ ok: true, text }))
    .catch((error) => sendResponse({
      ok: false,
      error: String(error?.message || error),
      errorName: String(error?.name || 'Error'),
      errorCode: typeof error?.code === 'string' ? error.code : /Failed to fetch|NetworkError/i.test(String(error?.message || error)) ? 'ML_FILE_FETCH_FAILED' : undefined,
    }))
  return true
})

function notifyActiveTab(action, value) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id
    if (tabId) chrome.tabs.sendMessage(tabId, { action, value }).catch(() => {
      // 독립 리더 탭은 content script가 아니므로 확장 메시지로 전달한다.
      void chrome.runtime.sendMessage({ action, value, targetTabId: tabId }).catch(() => undefined)
    })
  })
}

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggleRefresh') {
    chrome.storage.local.get(defaults, (settings) => {
      const value = !settings.refreshEnabled
      chrome.storage.local.set({ refreshEnabled: value }, () => notifyActiveTab('refreshChanged', value))
    })
  }
  if (command === 'togglePageTheme') {
    chrome.storage.local.get(defaults, (settings) => {
      const value = settings.colorMode === 'dark' ? 'light' : 'dark'
      chrome.storage.local.set({ colorMode: value }, () => notifyActiveTab('themeChanged', value))
    })
  }
})
