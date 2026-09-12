import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createLibraryLock } from '../src/content/library-lock.mjs'

function fixture() {
  let connect
  const event = () => {
    const listeners = []
    return { addListener: listener => listeners.push(listener), emit: value => listeners.forEach(listener => listener(value)) }
  }
  const ports = []
  vm.runInNewContext(readFileSync(new URL('../src/background.js', import.meta.url), 'utf8'), {
    chrome: { runtime: { id: 'test', onInstalled: event(), onMessage: event(), onConnect: { addListener: listener => { connect = listener } } },
      commands: { onCommand: event() } }
  })
  function runtime(sender) {
    return { connect({ name }) {
      let disconnected = false
      const client = { name, onMessage: event(), onDisconnect: event() }
      const server = { name, sender, onMessage: event(), onDisconnect: event() }
      for (const [from, to] of [[client, server], [server, client]]) {
        from.postMessage = message => {
          if (disconnected) throw new Error('disconnected')
          queueMicrotask(() => { if (!disconnected) to.onMessage.emit(message) })
        }
        from.disconnect = () => {
          if (disconnected) return
          disconnected = true
          queueMicrotask(() => { client.onDisconnect.emit(); server.onDisconnect.emit() })
        }
      }
      ports.push(client)
      queueMicrotask(() => connect(server))
      return client
    } }
  }
  return { ports, reader: createLibraryLock(runtime({ id: 'test', url: 'chrome-extension://test/reader.html' })),
    file: createLibraryLock(runtime({ id: 'test', tab: { url: 'file:///C:/test.md' } })), runtime }
}

test('extension reader and file content script share a FIFO storage lock', async () => {
  const { reader, file } = fixture()
  const events = []
  let resume, entered
  const ready = new Promise(resolve => { entered = resolve })
  const wait = new Promise(resolve => { resume = resolve })
  const a = reader.request('markdown-leader-library', async () => { events.push('a'); entered(); await wait; events.push('a done') })
  await ready
  const b = file.request('markdown-leader-library', async () => { events.push('b') })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, ['a'])
  resume()
  await Promise.all([a, b])
  assert.deepEqual(events, ['a', 'a done', 'b'])
})

test('a failed action releases the lock for the next reader', async () => {
  const { reader, file } = fixture()
  await assert.rejects(reader.request('markdown-leader-library', async () => { throw new Error('write failed') }), /write failed/)
  assert.equal(await file.request('markdown-leader-library', async () => 42), 42)
})

test('disconnecting a waiting reader rejects without executing its action', async () => {
  const { reader, file, ports } = fixture()
  let resume, entered
  const ready = new Promise(resolve => { entered = resolve })
  const wait = new Promise(resolve => { resume = resolve })
  const a = reader.request('markdown-leader-library', async () => { entered(); await wait })
  await ready
  let ran = false
  const b = file.request('markdown-leader-library', async () => { ran = true })
  const rejected = assert.rejects(b, /LOCK_DISCONNECTED/)
  ports[1].disconnect()
  await rejected
  resume()
  await a
  assert.equal(ran, false)
})

test('disconnecting a granted lease blocks subsequent guarded writes and lets the queue recover', async () => {
  const { reader, file, ports } = fixture()
  let resume, entered
  const ready = new Promise(resolve => { entered = resolve })
  const wait = new Promise(resolve => { resume = resolve })
  let wrote = false
  const a = reader.request('markdown-leader-library', async lease => { entered(); await wait; lease.check(); wrote = true })
  const rejected = assert.rejects(a, /LOCK_DISCONNECTED/)
  await ready
  ports[0].disconnect()
  await new Promise(resolve => setImmediate(resolve))
  resume()
  await rejected
  assert.equal(wrote, false)
  assert.equal(await file.request('markdown-leader-library', async () => 'next'), 'next')
})

test('untrusted senders cannot acquire the library lock', async () => {
  const { runtime } = fixture()
  for (const sender of [{ id: 'other', tab: { url: 'file:///C:/test.md' } }, { id: 'test', url: 'https://example.com/' }]) {
    const lock = createLibraryLock(runtime(sender))
    await assert.rejects(lock.request('markdown-leader-library', async () => assert.fail('untrusted action ran')), /LOCK_DISCONNECTED/)
  }
})
