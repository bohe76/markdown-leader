import test from 'node:test'
import assert from 'node:assert/strict'
import { createReaderLibrary } from '../src/content/reader-library.mjs'

function setup() {
  let saved = {}
  let failure = false
  let databaseFailure
  let failingDeleteId
  const storage = {
    async get() { if (failure) throw new Error('storage failed'); return structuredClone(saved) },
    async set(values) { if (failure) throw new Error('storage failed'); Object.assign(saved, structuredClone(values)) },
    async remove(keys) { if (failure) throw new Error('storage failed'); for (const key of [keys].flat()) delete saved[key] }
  }
  const objects = new Map()
  const indexedDB = {
    open() {
      const request = {}
      queueMicrotask(() => {
        if (databaseFailure === 'open' || databaseFailure === 'blocked') {
          request.error = new Error('database open denied')
          if (databaseFailure === 'blocked') request.onblocked()
          else request.onerror()
          return
        }
        request.result = {
          transaction() {
            const transaction = {
              objectStore() {
                return {
                  get(id) { return complete('get', () => objects.get(id)) },
                  put(handle, id) { return complete('put', () => { objects.set(id, handle); return id }) },
                  delete(id) { return complete('delete', () => { objects.delete(id) }, id) }
                }
              }
            }
            function complete(operation, action, id) {
              const request = {}
              queueMicrotask(() => {
                if (databaseFailure === operation || (operation === 'delete' && id === failingDeleteId)) {
                  transaction.error = new Error(`database ${operation} denied`)
                  transaction.onabort()
                } else {
                  request.result = action()
                  transaction.oncomplete()
                }
              })
              return request
            }
            return transaction
          }
        }
        request.onsuccess()
      })
      return request
    }
  }
  let pending = Promise.resolve()
  const locks = { request(_name, action) { const result = pending.then(action); pending = result.catch(() => {}); return result } }
  return { storage, indexedDB, locks, fail(value) { failure = value }, failDatabase(value) { databaseFailure = value }, failDelete(id) { failingDeleteId = id }, saved: () => saved, handles: objects }
}
const file = number => ({ url: `file:///C:/docs/${number}.md`, name: `${number}.md`, kind: 'file' })

test('another reader refresh replaces cached handle and context after reconnect with the same name', async () => {
  const env = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary(env)
  const old = { name: 'same.md', kind: 'file' }
  const original = await a.remember({ handle: old, name: old.name, kind: old.kind,
    context: { rootHandle: { kind: 'directory' }, relativePath: 'same.md' } })
  await b.refresh()
  assert.equal(await b.getHandle(original.id), old)
  assert.ok(await b.getContext(original.id))
  const moved = { name: 'same.md', kind: 'file', isSameEntry: async () => false }
  const rebound = await a.reconnect(original.id, { handle: moved })
  await b.refresh()
  assert.notEqual(rebound.bindingRevision, original.bindingRevision)
  assert.equal(await b.getHandle(original.id), moved)
  assert.equal(await b.getContext(original.id), null)
  const reopened = await a.remember({ id: original.id, name: moved.name, kind: moved.kind })
  assert.equal(reopened.bindingRevision, rebound.bindingRevision)
})

test('another reader unstar queued during reconnect is not overwritten by the reconnect snapshot', async () => {
  const env = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary(env)
  const original = await a.remember(file('old'))
  await a.setFavorite(original.id, true)
  let entered, resume
  const paused = new Promise(resolve => { entered = resolve })
  const released = new Promise(resolve => { resume = resolve })
  const set = env.storage.set
  env.storage.set = async values => {
    if (values['readerLibrary:recent:' + original.id]?.name === 'new.md') { entered(); await released }
    return set(values)
  }
  const reconnecting = a.reconnect(original.id, { handle: { name: 'new.md', kind: 'file' } })
  await paused
  const unstarring = b.setFavorite(original.id, false)
  await new Promise(resolve => setImmediate(resolve))
  resume()
  await Promise.all([reconnecting, unstarring])
  await a.refresh()
  assert.equal(a.get(original.id).favorite, false)
})

test('folder reconnect persists the newly selected context and rejects invalid context before writes', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const original = await library.remember(file('old'))
  const handle = { name: 'new.md', kind: 'file' }
  const context = { rootHandle: { kind: 'directory', name: 'moved' }, relativePath: 'nested/new.md' }
  await library.reconnect(original.id, { handle, context })
  assert.equal(await library.getContext(original.id), context)
  const before = structuredClone(env.saved())
  await assert.rejects(library.reconnect(original.id, { handle, context: { rootHandle: { kind: 'file' }, relativePath: 'new.md' } }), /INVALID_CONTEXT/)
  assert.deepEqual(env.saved(), before)
  assert.equal(await library.getContext(original.id), context)
})

test('a different origin cannot use its old handle or context after a binding revision changes', async () => {
  const env = setup()
  const otherOrigin = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary({ ...otherOrigin, storage: env.storage })
  const original = await a.remember(file('old'))
  const oldHandle = { name: 'old.md', kind: 'file' }
  const context = { rootHandle: { kind: 'directory' }, relativePath: 'old.md' }
  await b.remember({ id: original.id, name: oldHandle.name, kind: oldHandle.kind, handle: oldHandle, context })
  assert.equal(await b.getHandle(original.id), oldHandle)
  const rebound = await a.reconnect(original.id, { handle: { name: 'new.md', kind: 'file' } })
  await b.refresh()
  assert.equal(b.get(original.id).bindingRevision, rebound.bindingRevision)
  assert.equal(await b.getHandle(original.id), null)
  assert.equal(await b.getContext(original.id), null)
  const before = structuredClone(env.saved())
  await assert.rejects(b.remember({ id: original.id, name: oldHandle.name, kind: oldHandle.kind,
    handle: oldHandle, expectedBindingRevision: original.bindingRevision }), /STALE_BINDING/)
  assert.deepEqual(env.saved(), before)
})

test('two reconnects with the same expected revision cannot overwrite the first replacement', async () => {
  const env = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary(env)
  const original = await a.remember(file('old'))
  const first = { name: 'first.md', kind: 'file' }
  const results = await Promise.allSettled([
    a.reconnect(original.id, { handle: first, expectedBindingRevision: original.bindingRevision }),
    b.reconnect(original.id, { handle: { name: 'second.md', kind: 'file' }, expectedBindingRevision: original.bindingRevision })
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].status, 'rejected')
  assert.match(results[1].reason.message, /STALE_BINDING/)
  assert.equal(await b.getHandle(original.id), first)
})

test('failed reconnect rollback finishes before another reader removes the favorite', async () => {
  const env = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary(env)
  const original = await a.remember(file('old'))
  await a.setFavorite(original.id, true)
  let entered, resume
  const paused = new Promise(resolve => { entered = resolve })
  const released = new Promise(resolve => { resume = resolve })
  const set = env.storage.set
  env.storage.set = async values => {
    if (values['readerLibrary:recent:' + original.id]?.name === 'new.md') { entered(); await released; throw new Error('save denied') }
    return set(values)
  }
  const reconnecting = a.reconnect(original.id, { handle: { name: 'new.md', kind: 'file' } })
  const rejected = assert.rejects(reconnecting, /save denied/)
  await paused
  const unstarring = b.setFavorite(original.id, false)
  await new Promise(resolve => setImmediate(resolve))
  resume()
  await Promise.all([rejected, unstarring])
  await a.refresh()
  assert.equal(a.get(original.id).name, 'old.md')
  assert.equal(a.get(original.id).favorite, false)
})

test('failed second reconnect restores matching versioned handle and context', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const original = await library.remember(file('old'))
  const first = { name: 'first.md', kind: 'file' }
  const context = { rootHandle: { kind: 'directory' }, relativePath: 'first.md' }
  const rebound = await library.reconnect(original.id, { handle: first, context })
  const set = env.storage.set
  let fail = true
  env.storage.set = async values => { if (fail) { fail = false; throw new Error('save denied') }; return set(values) }
  await assert.rejects(library.reconnect(original.id, { handle: { name: 'second.md', kind: 'file' } }), /save denied/)
  assert.equal(library.get(original.id).bindingRevision, rebound.bindingRevision)
  assert.equal(await library.getHandle(original.id), first)
  assert.equal(await library.getContext(original.id), context)
})

test('remember preserves a matching handle revision and favorite metadata retains a replacement after recent eviction', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const originalHandle = { name: 'same.md', kind: 'file' }
  const original = await library.remember({ handle: originalHandle, name: originalHandle.name, kind: originalHandle.kind })
  await library.setFavorite(original.id, true)
  const reopened = await library.remember({ id: original.id, handle: originalHandle, name: originalHandle.name, kind: originalHandle.kind })
  assert.equal(reopened.bindingRevision, original.bindingRevision)
  const replacement = { name: 'same.md', kind: 'file', isSameEntry: async () => false }
  const rebound = await library.remember({ id: original.id, handle: replacement, name: replacement.name, kind: replacement.kind,
    expectedBindingRevision: original.bindingRevision })
  assert.notEqual(rebound.bindingRevision, original.bindingRevision)
  await library.removeRecent(original.id)
  assert.equal(library.get(original.id).bindingRevision, rebound.bindingRevision)
  assert.equal(await library.getHandle(original.id), replacement)
})

test('failed explicit remember rebind restores the original handle for a new reader', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const handle = { name: 'same.md', kind: 'file' }
  const original = await library.remember({ handle, name: handle.name, kind: handle.kind })
  const set = env.storage.set
  env.storage.set = async () => { throw new Error('save denied') }
  await assert.rejects(library.remember({ id: original.id, handle: { ...handle }, name: handle.name, kind: handle.kind }), /save denied/)
  env.storage.set = set
  const restored = createReaderLibrary(env)
  await restored.ready()
  assert.equal(await restored.getHandle(original.id), handle)
})

test('reconnect keeps identity and favorite while removing stale URL and directory context', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const old = { name: 'old.md', kind: 'file', isSameEntry: async () => false }
  const first = await library.remember({ ...file('old'), handle: old, context: { rootHandle: { kind: 'directory' }, relativePath: 'old.md' } })
  await library.setFavorite(first.id, true)
  const moved = { name: 'renamed.md', kind: 'file', isSameEntry: async () => false }
  const result = await library.reconnect(first.id, { handle: moved })
  assert.equal(result.id, first.id)
  assert.equal(result.favorite, true)
  assert.equal(result.name, moved.name)
  assert.equal(result.url, undefined)
  assert.equal(await library.getContext(first.id), null)
  assert.equal(await library.getHandle(first.id), moved)
  assert.equal(library.listRecent().length, 1)
  assert.equal(library.listFavorites()[0].name, moved.name)
})

test('removing recent preserves favorite and its handle; removing favorite preserves recent', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const handle = { name: 'old.md', kind: 'file' }
  const entry = await library.remember({ handle, name: handle.name, kind: handle.kind })
  await library.setFavorite(entry.id, true)
  await library.removeRecent(entry.id)
  assert.equal(library.listRecent().length, 0)
  assert.equal(library.listFavorites().length, 1)
  assert.equal(await library.getHandle(entry.id), handle)
  await library.remember({ id: entry.id, name: handle.name, kind: handle.kind })
  await library.setFavorite(entry.id, false)
  assert.equal(library.listFavorites().length, 0)
  assert.equal(library.listRecent().length, 1)
})

test('failed reconnect metadata write restores old handle and context', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const old = { name: 'old.md', kind: 'file' }
  const entry = await library.remember({ handle: old, name: old.name, kind: old.kind })
  const before = structuredClone(env.saved())
  const originalSet = env.storage.set
  env.storage.set = async () => { throw new Error('save denied') }
  await assert.rejects(library.reconnect(entry.id, { handle: { name: 'new.md', kind: 'file' } }), /save denied/)
  env.storage.set = originalSet
  assert.deepEqual(env.saved(), before)
  assert.equal(await library.getHandle(entry.id), old)
  assert.equal(env.handles.get(entry.id).handle, old)
})

test('reconnect merges a library-only duplicate into original identity and preserves its favorite', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const original = await library.remember(file('old'))
  const target = { name: 'new.md', kind: 'file', isSameEntry: async other => other === target }
  const duplicate = await library.remember({ handle: target, name: target.name, kind: target.kind })
  await library.setFavorite(duplicate.id, true)
  const result = await library.reconnect(original.id, { handle: target })
  assert.equal(result.id, original.id)
  assert.equal(result.favorite, true)
  assert.equal(library.get(duplicate.id), null)
  assert.deepEqual(library.listRecent().map(entry => entry.id), [original.id])
  assert.deepEqual(library.listFavorites().map(entry => entry.id), [original.id])
})

test('failed duplicate removal restores original records and handles', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const old = { name: 'old.md', kind: 'file' }
  const original = await library.remember({ handle: old, name: old.name, kind: old.kind })
  const target = { name: 'new.md', kind: 'file', isSameEntry: async other => other === target }
  const duplicate = await library.remember({ handle: target, name: target.name, kind: target.kind })
  await library.setFavorite(duplicate.id, true)
  const before = structuredClone(env.saved())
  const remove = env.storage.remove
  let fail = true
  env.storage.remove = async keys => { if (fail) { fail = false; throw new Error('remove denied') }; return remove(keys) }
  await assert.rejects(library.reconnect(original.id, { handle: target }), /remove denied/)
  assert.deepEqual(env.saved(), before)
  assert.equal(await library.getHandle(original.id), old)
  assert.equal(await library.getHandle(duplicate.id), target)
})

test('rollback failure is explicit and refreshes the snapshot to actual storage', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const original = await library.remember(file('old'))
  const target = { name: 'new.md', kind: 'file', isSameEntry: async other => other === target }
  const duplicate = await library.remember({ handle: target, name: target.name, kind: target.kind })
  const set = env.storage.set
  let writes = 0
  env.storage.set = async value => { if (++writes > 1) throw new Error('restore denied'); return set(value) }
  env.storage.remove = async () => { throw new Error('remove denied') }
  await assert.rejects(library.reconnect(original.id, { handle: target }), error =>
    error instanceof AggregateError && error.code === 'ML_LIBRARY_ROLLBACK_FAILED' && error.errors.some(value => value.message === 'restore denied'))
  assert.equal(library.get(original.id).name, env.saved()['readerLibrary:recent:' + original.id].name)
  assert.equal(library.get(duplicate.id).name, target.name)
})

test('duplicate context cleanup failure rolls back metadata and both handle contexts', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const old = { name: 'old.md', kind: 'file' }
  const originalContext = { rootHandle: { kind: 'directory' }, relativePath: 'old.md' }
  const original = await library.remember({ handle: old, name: old.name, kind: old.kind, context: originalContext })
  const target = { name: 'new.md', kind: 'file', isSameEntry: async other => other === target }
  const targetContext = { rootHandle: { kind: 'directory' }, relativePath: 'new.md' }
  const duplicate = await library.remember({ handle: target, name: target.name, kind: target.kind, context: targetContext })
  const before = structuredClone(env.saved())
  env.failDelete(duplicate.id + ':context')
  await assert.rejects(library.reconnect(original.id, { handle: target }), /database delete denied/)
  assert.deepEqual(env.saved(), before)
  assert.equal(await library.getHandle(original.id), old)
  assert.equal(await library.getHandle(duplicate.id), target)
  assert.equal(await library.getContext(original.id), originalContext)
  assert.equal(await library.getContext(duplicate.id), targetContext)
})

for (const failure of ['open', 'blocked', 'put']) {
  test(`IndexedDB ${failure} failure rejects remember, preserves existing metadata and can retry`, async () => {
    const env = setup()
    let changes = 0
    const library = createReaderLibrary({ ...env, onChange: () => changes++ })
    const first = await library.remember(file(1))
    await library.setFavorite(first.id, true)
    const before = structuredClone(env.saved())
    const beforeChanges = changes
    const handle = { name: '1.md', kind: 'file' }
    env.failDatabase(failure)
    await assert.rejects(library.remember({ handle: { name: 'new.md', kind: 'file' }, name: 'new.md', kind: 'file' }), /database .* denied|ML_LIBRARY_DATABASE_BLOCKED/)
    await assert.rejects(library.remember({ ...file(1), handle }), /database .* denied|ML_LIBRARY_DATABASE_BLOCKED/)
    assert.deepEqual(env.saved(), before)
    assert.equal(changes, beforeChanges)
    assert.equal(env.handles.size, 0)
    env.failDatabase(undefined)
    const result = await library.remember({ ...file(1), handle })
    assert.equal(result.id, first.id)
    assert.equal(result.favorite, true)
    assert.equal(await library.getHandle(first.id), handle)
  })
}

test('failed handle read rejects instead of reporting a missing handle', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  await library.ready()
  env.failDatabase('get')
  await assert.rejects(library.getHandle('one'), /database get denied/)
  env.failDatabase(undefined)
  assert.equal(await library.getHandle('one'), null)
})

test('failed handle cleanup rejects refresh and retries deletion before publishing the new snapshot', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const handle = { name: 'one.md', kind: 'file' }
  const first = await library.remember({ handle, name: handle.name, kind: handle.kind })
  await env.storage.remove('readerLibrary:recent:' + first.id)
  env.failDatabase('delete')
  await assert.rejects(library.refresh(), /database delete denied/)
  assert.equal(library.get(first.id).id, first.id)
  assert.equal(env.handles.has(first.id), true)
  env.failDatabase(undefined)
  await library.refresh()
  assert.equal(library.get(first.id), null)
  assert.equal(env.handles.has(first.id), false)
  assert.equal(await library.getHandle(first.id), null)
})

test('recent combines files and directories, caps persisted metadata at 30 and deduplicates', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  await library.ready()
  for (let n = 0; n < 35; n++) await library.remember(n % 2 ? file(n) : { url: `file:///C:/folder${n}/`, name: `folder${n}`, kind: 'directory' })
  assert.equal(library.listRecent().length, 30)
  assert.equal(Object.keys(env.saved()).length, 30)
  const again = await library.remember(file(7))
  assert.equal(library.listRecent()[0].id, again.id)
  assert.equal(library.listRecent().length, 30)
})

test('favorites survive recent eviction and reload; unstar removes an evicted entry', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const first = await library.remember(file(0))
  await library.setFavorite(first.id, true)
  for (let n = 1; n <= 31; n++) await library.remember(file(n))
  const restored = createReaderLibrary(env)
  await restored.ready()
  assert.equal(restored.listFavorites()[0].id, first.id)
  assert.equal(restored.listRecent().some(entry => entry.id === first.id), false)
  await restored.setFavorite(first.id, false)
  assert.deepEqual(restored.listFavorites(), [])
  assert.equal(restored.get(first.id), null)
})

test('own concurrent mutations are serialized without losing history or favorites', async () => {
  const library = createReaderLibrary(setup())
  const entries = await Promise.all(Array.from({ length: 20 }, (_, n) => library.remember(file(n))))
  await Promise.all(entries.map(entry => library.setFavorite(entry.id, true)))
  assert.equal(library.listRecent().length, 20)
  assert.equal(library.listFavorites().length, 20)
})

test('separate library instances preserve unrelated mutations and can refresh snapshots', async () => {
  const env = setup()
  const a = createReaderLibrary(env)
  const b = createReaderLibrary(env)
  const first = await a.remember(file(1))
  await b.setFavorite(first.id, true)
  await a.remember(file(2))
  await a.refresh()
  assert.equal(a.get(first.id).favorite, true)
  assert.equal(a.listRecent().length, 2)
})

test('handles are stored outside JSON, deduplicated by identity and restored without reading files', async () => {
  const env = setup()
  const handle = { name: 'one.md', kind: 'file', isSameEntry: async other => other.name === 'one.md' }
  const library = createReaderLibrary(env)
  const first = await library.remember({ name: handle.name, kind: handle.kind, handle, url: 'file:///__markdown_leader__/session/one.md' })
  assert.equal(first.url, undefined)
  assert.equal(JSON.stringify(env.saved()).includes('isSameEntry'), false)
  const restored = createReaderLibrary(env)
  await restored.ready()
  assert.equal(await restored.getHandle(first.id), handle)
  const again = await restored.remember({ name: handle.name, kind: handle.kind, handle: { ...handle } })
  assert.equal(again.id, first.id)
  assert.equal(restored.listRecent().length, 1)
})

test('unavailable IndexedDB keeps metadata and allows explicit id rebind without dropping favorites', async () => {
  const env = setup()
  const library = createReaderLibrary({ storage: env.storage })
  const handle = { name: 'one.md', kind: 'file' }
  const first = await library.remember({ name: handle.name, kind: 'file', handle })
  await library.setFavorite(first.id, true)
  const restored = createReaderLibrary({ storage: env.storage })
  await restored.ready()
  assert.equal(await restored.getHandle(first.id), null)
  const rebound = await restored.remember({ id: first.id, name: handle.name, kind: 'file', handle })
  assert.equal(rebound.favorite, true)
  assert.equal(await restored.getHandle(first.id), handle)
  assert.equal(restored.listFavorites().length, 1)
})

test('storage errors propagate and do not falsely mutate local favorite state; later calls recover', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const first = await library.remember(file(1))
  env.fail(true)
  await assert.rejects(library.setFavorite(first.id, true), /storage failed/)
  assert.equal(library.get(first.id).favorite, false)
  env.fail(false)
  await library.setFavorite(first.id, true)
  assert.equal(library.get(first.id).favorite, true)
})

test('only actual native file URLs or handles can create entries; snapshots cannot mutate state', async () => {
  const library = createReaderLibrary(setup())
  await assert.rejects(library.remember({ name: 'bad', kind: 'file', url: 'https://example.com' }), /MISSING_SOURCE/)
  await assert.rejects(library.remember({ name: 'bad', kind: 'file', url: 'file:///__markdown_leader__/session/bad.md' }), /MISSING_SOURCE/)
  const entry = await library.remember({ ...file(1), url: file(1).url + '#heading' })
  entry.favorite = true
  assert.equal((await library.find(file(1))).favorite, false)
  assert.equal(library.listRecent()[0].url, file(1).url)
})

test('evicted handles are released from memory and IndexedDB while favorites remain until unstarred', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const handles = Array.from({ length: 32 }, (_, n) => ({ name: `${n}.md`, kind: 'file' }))
  const first = await library.remember({ handle: handles[0], name: handles[0].name, kind: 'file' })
  await library.setFavorite(first.id, true)
  const second = await library.remember({ handle: handles[1], name: handles[1].name, kind: 'file' })
  for (const handle of handles.slice(2)) await library.remember({ handle, name: handle.name, kind: 'file' })
  assert.equal(env.handles.size, 31)
  assert.equal(await library.getHandle(second.id), null)
  assert.equal(await library.getHandle(first.id), handles[0])
  await library.setFavorite(first.id, false)
  assert.equal(env.handles.size, 30)
  assert.equal(await library.getHandle(first.id), null)
})

test('folder context persists outside metadata and is released with its evicted entry', async () => {
  const env = setup()
  const library = createReaderLibrary(env)
  const handle = { name: 'one.md', kind: 'file' }
  const context = { rootHandle: { name: 'docs', kind: 'directory' }, relativePath: 'nested/one.md' }
  const first = await library.remember({ handle, context, name: handle.name, kind: 'file' })
  assert.equal(JSON.stringify(env.saved()).includes('rootHandle'), false)
  const restored = createReaderLibrary(env)
  await restored.ready()
  assert.equal(await restored.getContext(first.id), context)
  for (let n = 0; n < 30; n++) await restored.remember(file(n))
  assert.equal(await restored.getContext(first.id), null)
  assert.equal(env.handles.has(first.id + ':context'), false)
})

test('folder context has memory fallback when IndexedDB is unavailable', async () => {
  const env = setup()
  const library = createReaderLibrary({ storage: env.storage })
  const handle = { name: 'one.md', kind: 'file' }
  const context = { rootHandle: { name: 'docs', kind: 'directory' }, relativePath: 'one.md' }
  const first = await library.remember({ handle, context, name: handle.name, kind: 'file' })
  assert.equal(await library.getContext(first.id), context)
  const restored = createReaderLibrary({ storage: env.storage })
  await restored.ready()
  assert.equal(await restored.getContext(first.id), null)
})
