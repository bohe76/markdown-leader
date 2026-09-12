(() => {
  let pathname
  try {
    pathname = new URL(location.href).pathname
  } catch {
    return
  }
  if (!/\.(?:md|markdown|mdown|mdwn|mkd|mkdn|mkdown|mdx|mdc|txt)$/i.test(pathname)) return

  const settingsReady = (async () => {
    if (!chrome.storage?.local) throw new Error('ML_STORAGE_UNAVAILABLE')
    return chrome.storage.local.get([
      'refreshEnabled', 'refreshIntervalMs', 'colorMode', 'fontFamily', 'fontSizePx', 'contentWidthPx', 'widthMode', 'readingSettingsOpen', 'directorySort', 'sidebarWidthPx',
    ])
  })()
  void settingsReady.catch(() => {})
  // 같은 확장의 정적 content script는 ISOLATED world 전역을 공유한다.
  globalThis.markdownLeaderSettingsReady = settingsReady

  const markPending = () => {
    const root = document.documentElement
    if (!root) return false
    root.dataset.markdownLeaderStartup = 'pending'
    return true
  }
  if (!markPending()) {
    const observer = new MutationObserver(() => {
      if (!markPending()) return
      observer.disconnect()
    })
    observer.observe(document, { childList: true })
  }
})()
