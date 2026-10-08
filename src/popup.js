const language = chrome.i18n.getUILanguage()
document.documentElement.lang = /^ko(?:[-_]|$)/i.test(language) ? 'ko' : 'en'
const labels = Object.fromEntries([
  'popupCheckingFileAccess', 'popupDescription', 'popupOpenSettings', 'popupFileAccessHint',
  'popupFileAccessAllowed', 'popupFileAccessDenied', 'popupOpenReader', 'popupWriteHint',
].map((name) => [name, chrome.i18n.getMessage(name)]))
document.querySelectorAll('[data-i18n]').forEach((element) => {
  element.textContent = labels[element.dataset.i18n]
})

const status = document.querySelector('[data-file-access]')
chrome.extension.isAllowedFileSchemeAccess((allowed) => {
  status.textContent = allowed
    ? labels.popupFileAccessAllowed
    : labels.popupFileAccessDenied
})

// 팝업은 밝은 화면이므로 리더 설정의 밝은 테마 강조색을 주요 버튼에 쓴다.
Promise.resolve(chrome.storage?.local.get(['accentColor', 'accentCustom'])).then(async (stored) => {
  if (!stored) return
  const { colorVariables } = await import('./reader-colors.mjs')
  const values = colorVariables(stored)
  document.documentElement.style.setProperty('--ml-accent-strong', values['--ml-user-accent-strong-light'])
  document.documentElement.style.setProperty('--ml-on-accent', values['--ml-user-on-accent-light'])
}).catch(() => {})

document.querySelector('[data-open-settings]').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
})

document.querySelector('[data-open-reader]').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') })
})
