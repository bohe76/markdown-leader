import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('../src/content/index.ts', import.meta.url), 'utf8')
const binding = source.slice(source.indexOf('async function bindDocument('), source.indexOf('let bindingSync:'))

test('저장 중 다른 창의 연결 버전이 바뀌면 쓰기 완료 조건을 거부한다', async () => {
  const tab = { id: 'tab', libraryId: 'record', bindingRevision: 'old', fileHandle: {} }
  const record = { bindingRevision: 'old' }
  const context = vm.createContext({
    activeDocument: tab, openDocuments: new Map([[tab.id, tab]]), currentRaw: '# old', documentReady: true,
    pageActive: true, extensionInvalidated: false, writingDocumentId: null, refreshInFlight: false,
    refreshGeneration: 0, refreshRequest: 0, renderGeneration: 0, bindingSyncRequested: false,
    library: { get: () => record }, t: key => key, reviewError: error => error, restartRefreshTimer() {},
    writeFileRevision: async (_file, _before, _after, { isCurrent }) => {
      assert.equal(isCurrent(), true)
      record.bindingRevision = 'new'
      assert.equal(isCurrent(), false)
      throw new Error('file-stale')
    },
  })
  const save = source.slice(source.indexOf('async function saveDocumentRevision('), source.indexOf("app.querySelector('[data-sidebar-toggle]')"))
  vm.runInContext(ts.transpileModule(save, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  await assert.rejects(context.saveDocumentRevision('tab', '# old', '# new'), /file-stale/)
  assert.equal(context.currentRaw, '# old')
  assert.equal(context.writingDocumentId, null)
})

for (const change of ['tab', 'record']) {
  test(`동일성 확인을 기다리는 동안 ${change} 연결이 바뀌면 늦은 결과를 적용하지 않는다`, async () => {
    let finish
    const tab = { id: 'tab', source: {}, bindingRevision: 'old', fileHandle: {} }
    const entry = { id: 'record', bindingRevision: 'candidate' }
    let current = entry
    const context = vm.createContext({
      openDocuments: new Map([[tab.id, tab]]), library: { get: () => current },
      reviewUI: { invalidateDraft: () => assert.fail('늦은 복구가 초안을 건드렸다') },
    })
    vm.runInContext(ts.transpileModule(binding, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
    const pending = context.bindDocument(tab, {}, 'file:///candidate.md', {
      isSameEntry: () => new Promise(resolve => { finish = resolve }),
    }, entry, '# candidate')
    if (change === 'tab') { tab.source = { newer: true }; tab.bindingRevision = 'latest' }
    else current = { ...entry, bindingRevision: 'latest' }
    const expected = { ...tab }
    finish(false)
    assert.equal(await pending, false)
    assert.deepEqual(tab, expected)
  })
}
