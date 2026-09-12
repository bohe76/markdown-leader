import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFileRevision } from '../src/content/file-writer.mjs'

function fixture(raw = '원문') {
  const state = { raw, opens: 0, aborts: 0, closes: 0, permission: 'granted' }
  const handle = {
    queryPermission: async () => state.permission,
    requestPermission: async () => state.permission,
    isSameEntry: async other => other === handle || other.identity === state,
    identity: state,
    getFile: async () => new Blob([state.raw]),
    createWritable: async options => {
      assert.deepEqual(options, { mode: 'exclusive' })
      state.opens++
      await state.onOpen?.()
      let buffer
      return {
        write: async data => { buffer = new TextDecoder('utf-8', { ignoreBOM: true }).decode(data); await state.onWrite?.() },
        close: async () => { state.raw = buffer; state.closes++ },
        abort: async () => { state.aborts++ },
      }
    },
  }
  return { handle, state }
}
test('UTF8 BOM과 CRLF를 보존하며 close 시에만 저장한다', async () => {
  const { handle, state } = fixture('\uFEFF원문\r\n')
  const result = await writeFileRevision(handle, '원문\r\n', '변경\r\n')
  assert.equal(result, '\uFEFF변경\r\n')
  assert.equal(state.raw, result)
  assert.equal(state.closes, 1)
})
test('권한 거부와 이미 바뀐 원본은 writer를 열지 않는다', async () => {
  const { handle, state } = fixture()
  await assert.rejects(writeFileRevision(handle, '다름', '변경'), { code: 'file-conflict' })
  state.permission = 'denied'
  await assert.rejects(writeFileRevision(handle, '원문', '변경'), { code: 'file-permission' })
  assert.equal(state.opens, 0)
})
test('writer 획득 중 외부 변경, 저장 중 실패와 stale은 abort한다', async () => {
  for (const mode of ['conflict', 'write-error', 'stale']) {
    const { handle, state } = fixture()
    let current = true
    if (mode === 'conflict') state.onOpen = () => { state.raw = '외부 변경' }
    if (mode === 'write-error') state.onWrite = () => { throw new Error('disk') }
    if (mode === 'stale') state.onWrite = () => { current = false }
    await assert.rejects(writeFileRevision(handle, '원문', '변경', { isCurrent: () => current }))
    assert.equal(state.aborts, 1)
    assert.equal(state.closes, 0)
    assert.equal(state.raw, mode === 'conflict' ? '외부 변경' : '원문')
  }
})
test('같은 엔트리의 서로 다른 핸들 저장은 직렬화하고 이전 원본 저장은 충돌 처리한다', async () => {
  const { handle, state } = fixture()
  const alias = { ...handle }
  const results = await Promise.allSettled([
    writeFileRevision(handle, '원문', '첫째'),
    writeFileRevision(alias, '원문', '둘째'),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].reason.code, 'file-conflict')
  assert.equal(state.raw, '첫째')
  assert.equal(state.opens, 1)
})

test('쓰기 중 외부 변경을 다시 검사하며 UTF8 아닌 원본은 저장하지 않는다', async () => {
  const { handle, state } = fixture()
  state.onWrite = () => { state.raw = '외부 저장' }
  await assert.rejects(writeFileRevision(handle, '원문', '변경'), { code: 'file-conflict' })
  assert.equal(state.raw, '외부 저장')
  assert.equal(state.aborts, 1)
  const invalid = fixture()
  invalid.handle.getFile = async () => new Blob([new Uint8Array([0xff, 0xfe, 0])])
  await assert.rejects(writeFileRevision(invalid.handle, '', '변경'), TypeError)
  assert.equal(invalid.state.opens, 0)
})
