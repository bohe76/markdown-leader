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

document.querySelector('[data-open-settings]').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
})

document.querySelector('[data-open-reader]').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('reader.html') })
})
