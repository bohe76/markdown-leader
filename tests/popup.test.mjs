import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createTranslator } from '../src/i18n.mjs'

const source = readFileSync(new URL('../src/popup.js', import.meta.url), 'utf8')
const html = readFileSync(new URL('../src/popup.html', import.meta.url), 'utf8')

for (const [language, expectedLanguage, expectedButton, expectedStatus] of [
  ['ko-KR', 'ko', '확장 프로그램 설정 열기', '파일 URL 접근이 허용되어 있습니다.'],
  ['en-US', 'en', 'Open extension settings', 'File URL access is allowed.'],
]) {
  test(`팝업은 ${language} 문구를 먼저 채우고 비동기 권한 결과에도 유지한다`, () => {
    const elements = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((match) => ({
      dataset: { i18n: match[1] }, textContent: '',
      addEventListener(_event, listener) { this.click = listener },
    }))
    const status = elements.find((element) => element.dataset.i18n === 'popupCheckingFileAccess')
    const button = elements.find((element) => element.dataset.i18n === 'popupOpenSettings')
    const readerButton = elements.find((element) => element.dataset.i18n === 'popupOpenReader')
    let permissionCallback
    let messageReads = 0
    const opened = []
    const context = vm.createContext({
      document: {
        documentElement: {},
        querySelectorAll: () => elements,
        querySelector: (selector) => ({
          '[data-file-access]': status,
          '[data-open-settings]': button,
          '[data-open-reader]': readerButton,
        })[selector],
      },
      chrome: {
        i18n: {
          getUILanguage: () => language,
          getMessage: (key) => { messageReads++; return createTranslator(language)(key) },
        },
        extension: { isAllowedFileSchemeAccess: (callback) => { permissionCallback = callback } },
        runtime: { id: 'fixture-extension', getURL: (path) => `chrome-extension://fixture-extension/${path}` },
        tabs: { create: (options) => opened.push(options.url) },
      },
    })
    vm.runInContext(source, context)
    assert.equal(context.document.documentElement.lang, expectedLanguage)
    assert.equal(button.textContent, expectedButton)
    assert.equal(readerButton.textContent, createTranslator(language)('popupOpenReader'))
    for (const element of elements) assert.ok(element.textContent, element.dataset.i18n)
    const initialReads = messageReads
    context.chrome.i18n.getMessage = () => assert.fail('권한 콜백은 준비한 문구를 사용해야 합니다.')
    permissionCallback(true)
    assert.equal(status.textContent, expectedStatus)
    permissionCallback(false)
    assert.equal(status.textContent, createTranslator(language)('popupFileAccessDenied'))
    assert.equal(messageReads, initialReads)
    button.click()
    assert.deepEqual(opened, ['chrome://extensions/?id=fixture-extension'])
    readerButton.click()
    assert.deepEqual(opened, ['chrome://extensions/?id=fixture-extension', 'chrome-extension://fixture-extension/reader.html'])
  })
}
