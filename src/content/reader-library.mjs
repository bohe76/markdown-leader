const RECENT = 'readerLibrary:recent:'
const FAVORITE = 'readerLibrary:favorite:'

function nativeURL(value) {
  if (!value) return undefined
  const url = new URL(value)
  if (url.protocol !== 'file:' || url.pathname.startsWith('/__markdown_leader__/')) return undefined
  url.hash = ''
  url.search = ''
  return url.href
}

function handleStore(indexedDB, check) {
  let opening
  function database() {
    if (!indexedDB) return Promise.resolve(null)
    if (!opening) opening = new Promise((resolve, reject) => {
      let blocked = false
      try {
        const request = indexedDB.open('markdown-leader-library', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('handles')
        request.onsuccess = () => {
          if (blocked) { request.result.close(); return }
          request.result.onversionchange = () => request.result.close()
          resolve(request.result)
        }
        request.onerror = () => reject(request.error ?? new Error('ML_LIBRARY_DATABASE_OPEN_FAILED'))
        request.onblocked = () => {
          blocked = true
          reject(new Error('ML_LIBRARY_DATABASE_BLOCKED'))
        }
      } catch (error) { reject(error) }
    }).catch(error => { opening = undefined; throw error })
    return opening
  }
  async function operation(mode, action) {
    check()
    const db = await database()
    check()
    if (!db) return null
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction('handles', mode)
        const request = action(transaction.objectStore('handles'))
        transaction.oncomplete = () => resolve(request.result ?? null)
        transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error('ML_LIBRARY_TRANSACTION_FAILED'))
      } catch (error) { reject(error) }
    })
  }
  return {
    get: id => operation('readonly', store => store.get(id)),
    put: (id, handle) => operation('readwrite', store => store.put(handle, id)),
    remove: id => operation('readwrite', store => store.delete(id))
  }
}

/** @param {{ storage: any, indexedDB?: any, onChange?: () => any, locks?: { request: (name: string, action: (lease?: { check: () => void }) => Promise<any>) => Promise<any> } | null }} options */
export function createReaderLibrary({ storage: persistedStorage, indexedDB, onChange, locks = null }) {
  let checkLease = () => {}
  const storage = {
    get: key => { checkLease(); return persistedStorage.get(key) },
    set: values => { checkLease(); return persistedStorage.set(values) },
    remove: keys => { checkLease(); return persistedStorage.remove(keys) }
  }
  const handles = handleStore(indexedDB, () => checkLease())
  const liveHandles = new Map()
  const liveContexts = new Map()
  let entries = new Map()
  let recentIds = []
  /** @type {Promise<any>} */
  let queue = Promise.resolve()

  function snapshot(entry) { return entry ? { ...entry } : null }
  function valid(entry) {
    return entry && typeof entry.id === 'string' && typeof entry.name === 'string'
      && ['file', 'directory'].includes(entry.kind) && Number.isFinite(entry.lastOpened)
  }
  async function refresh() {
    const saved = await storage.get(null)
    const next = new Map()
    const recent = []
    for (const [key, entry] of Object.entries(saved)) {
      if (!key.startsWith(RECENT) || !valid(entry) || key !== RECENT + entry.id) continue
      next.set(entry.id, { ...entry, favorite: false })
      recent.push(entry.id)
    }
    for (const [key, entry] of Object.entries(saved)) {
      if (!key.startsWith(FAVORITE) || !valid(entry) || key !== FAVORITE + entry.id) continue
      next.set(entry.id, { ...entry, ...next.get(entry.id), favorite: true })
    }
    const removedIds = [...entries.keys()].filter(id => !next.has(id))
    for (const id of removedIds) {
      await handles.remove(id)
      await handles.remove(id + ':context')
      liveHandles.delete(id)
      liveContexts.delete(id)
    }
    for (const [id, entry] of next) {
      if (entry.bindingRevision === entries.get(id)?.bindingRevision) continue
      liveHandles.delete(id)
      liveContexts.delete(id)
    }
    entries = next
    recentIds = recent.sort((a, b) => entries.get(b).lastOpened - entries.get(a).lastOpened).slice(0, 30)
  }
  /**
   * @template T
   * @param {() => Promise<T>} action
   * @returns {Promise<T>}
   */
  function serialize(action) {
    const result = queue.then(() => locks ? locks.request('markdown-leader-library', async lease => {
      checkLease = lease?.check ?? (() => {})
      try { return await action() } finally { checkLease = () => {} }
    }) : action())
    queue = result.catch(() => {})
    return result
  }
  async function getHandle(id) {
    if (liveHandles.has(id)) return liveHandles.get(id)
    const saved = await handles.get(id)
    const revision = entries.get(id)?.bindingRevision
    const handle = revision ? (saved?.bindingRevision === revision ? saved.handle : null) : saved
    if (handle) liveHandles.set(id, handle)
    return handle
  }
  async function getContext(id) {
    if (liveContexts.has(id)) return liveContexts.get(id)
    const saved = await handles.get(id + ':context')
    const revision = entries.get(id)?.bindingRevision
    const context = revision ? (saved?.bindingRevision === revision ? saved.context : null) : saved
    if (context) liveContexts.set(id, context)
    return context
  }
  async function findEntry({ url, handle }) {
    const normalized = nativeURL(url)
    if (normalized) {
      const entry = [...entries.values()].find(entry => entry.url === normalized)
      if (entry) return entry
    }
    if (handle) {
      for (const entry of entries.values()) {
        if (entry.kind !== handle.kind || entry.name !== handle.name) continue
        const previous = await getHandle(entry.id)
        try {
          if (previous && (previous === handle || await handle.isSameEntry(previous))) return entry
        } catch { /* 접근할 수 없는 핸들은 다시 선택할 수 있도록 목록에 유지한다. */ }
      }
    }
    return null
  }
  const ready = serialize(refresh)
  return {
    ready: () => ready,
    refresh: () => serialize(refresh),
    get: id => snapshot(entries.get(id)),
    listRecent: () => recentIds.map(id => snapshot(entries.get(id))),
    listFavorites: () => [...entries.values()].filter(entry => entry.favorite)
      .sort((a, b) => b.lastOpened - a.lastOpened).map(snapshot),
    getHandle: id => serialize(async () => { await refresh(); return getHandle(id) }),
    getContext: id => serialize(async () => { await refresh(); return getContext(id) }),
    find: target => serialize(async () => { await refresh(); return snapshot(await findEntry(target)) }),
    removeRecent: id => serialize(async () => {
      await storage.remove(RECENT + id)
      await refresh()
      onChange?.()
    }),
    reconnect: (id, input) => serialize(async () => {
      await refresh()
      const previous = entries.get(id)
      if (!previous || input.handle?.kind !== previous.kind) throw new Error('ML_LIBRARY_INVALID_ENTRY')
      if (Object.hasOwn(input, 'expectedBindingRevision') && input.expectedBindingRevision !== previous.bindingRevision) throw new Error('ML_LIBRARY_STALE_BINDING')
      if (input.context && (input.context.rootHandle?.kind !== 'directory' || typeof input.context.relativePath !== 'string')) throw new Error('ML_LIBRARY_INVALID_CONTEXT')
      const duplicate = await findEntry(input)
      const merged = duplicate && duplicate.id !== id ? duplicate : null
      const saved = await storage.get(null)
      const oldHandle = await handles.get(id)
      const oldContext = await handles.get(id + ':context')
      const mergedHandle = merged ? await handles.get(merged.id) : null
      const mergedContext = merged ? await handles.get(merged.id + ':context') : null
      const entry = { id, kind: previous.kind, name: input.handle.name, path: input.handle.name,
        bindingRevision: crypto.randomUUID(),
        lastOpened: Math.max(Date.now(), ...[...entries.values()].map(value => value.lastOpened + 1)), favorite: previous.favorite || Boolean(merged?.favorite) }
      try {
        await handles.put(id, { bindingRevision: entry.bindingRevision, handle: input.handle })
        if (input.context) await handles.put(id + ':context', { bindingRevision: entry.bindingRevision, context: input.context })
        else await handles.remove(id + ':context')
        await storage.set({ [RECENT + id]: entry, ...(entry.favorite ? { [FAVORITE + id]: entry } : {}) })
        if (merged) await storage.remove([RECENT + merged.id, FAVORITE + merged.id])
        await refresh()
        liveHandles.set(id, input.handle)
        if (input.context) liveContexts.set(id, input.context)
        else liveContexts.delete(id)
      } catch (error) {
        const keys = [RECENT + id, FAVORITE + id, ...(merged ? [RECENT + merged.id, FAVORITE + merged.id] : [])]
        const restored = await Promise.allSettled([
          oldHandle ? handles.put(id, oldHandle) : handles.remove(id),
          oldContext ? handles.put(id + ':context', oldContext) : handles.remove(id + ':context'),
          ...(merged ? [mergedHandle ? handles.put(merged.id, mergedHandle) : handles.remove(merged.id),
            mergedContext ? handles.put(merged.id + ':context', mergedContext) : handles.remove(merged.id + ':context')] : []),
          storage.set(Object.fromEntries(keys.filter(key => saved[key]).map(key => [key, saved[key]]))),
          storage.remove(keys.filter(key => !saved[key]))
        ])
        liveHandles.delete(id)
        liveContexts.delete(id)
        if (merged) { liveHandles.delete(merged.id); liveContexts.delete(merged.id) }
        const failures = restored.filter(result => result.status === 'rejected').map(result => result.reason)
        try { await refresh() } catch (failure) { failures.push(failure) }
        if (failures.length) throw Object.assign(new AggregateError([error, ...failures], `ML_LIBRARY_ROLLBACK_FAILED: ${error.message}`), { code: 'ML_LIBRARY_ROLLBACK_FAILED' })
        throw error
      }
      onChange?.()
      return snapshot(entries.get(id))
    }),
    remember: input => serialize(async () => {
      await refresh()
      if (!['file', 'directory'].includes(input.kind) || !input.name) throw new Error('ML_LIBRARY_INVALID_ENTRY')
      const url = nativeURL(input.url)
      if (!url && !input.handle && !input.id) throw new Error('ML_LIBRARY_MISSING_SOURCE')
      const existing = input.id ? entries.get(input.id) : await findEntry(input)
      if (input.id && !existing) throw new Error('ML_LIBRARY_ENTRY_MISSING')
      if (existing && existing.kind !== input.kind) throw new Error('ML_LIBRARY_INVALID_ENTRY')
      if (Object.hasOwn(input, 'expectedBindingRevision') && input.expectedBindingRevision !== existing?.bindingRevision) throw new Error('ML_LIBRARY_STALE_BINDING')
      if (input.context && (input.context.rootHandle?.kind !== 'directory' || typeof input.context.relativePath !== 'string')) throw new Error('ML_LIBRARY_INVALID_CONTEXT')
      const id = existing?.id ?? (url ? `url:${url}` : crypto.randomUUID())
      const lastOpened = Math.max(Date.now(), ...[...entries.values()].map(entry => entry.lastOpened + 1))
      const entry = { id, name: input.name, kind: input.kind, lastOpened, favorite: existing?.favorite ?? false }
      if (existing?.bindingRevision) entry.bindingRevision = existing.bindingRevision
      if (url ?? existing?.url) entry.url = url ?? existing.url
      if (input.path ?? existing?.path) entry.path = input.path ?? existing.path
      const oldHandle = input.handle ? await handles.get(id) : null
      const oldContext = input.context ? await handles.get(id + ':context') : null
      try {
        if (input.handle) {
          if (input.handle.kind !== input.kind) throw new Error('ML_LIBRARY_INVALID_ENTRY')
          const previousHandle = existing ? await getHandle(id) : null
          let same = previousHandle === input.handle
          try { if (!same && previousHandle) same = await input.handle.isSameEntry(previousHandle) } catch { /* 새로 고른 연결을 별도 revision으로 저장한다. */ }
          if (!same) entry.bindingRevision = crypto.randomUUID()
          await handles.put(id, entry.bindingRevision ? { bindingRevision: entry.bindingRevision, handle: input.handle } : input.handle)
        }
        if (input.context) {
          await handles.put(id + ':context', entry.bindingRevision ? { bindingRevision: entry.bindingRevision, context: input.context } : input.context)
        }
        await storage.set({ [RECENT + id]: entry, ...(entry.favorite ? { [FAVORITE + id]: entry } : {}) })
      } catch (error) {
        const restored = await Promise.allSettled([
          ...(input.handle ? [oldHandle ? handles.put(id, oldHandle) : handles.remove(id)] : []),
          ...(input.context ? [oldContext ? handles.put(id + ':context', oldContext) : handles.remove(id + ':context')] : [])
        ])
        const failures = restored.filter(result => result.status === 'rejected').map(result => result.reason)
        if (failures.length) throw Object.assign(new AggregateError([error, ...failures], `ML_LIBRARY_ROLLBACK_FAILED: ${error.message}`), { code: 'ML_LIBRARY_ROLLBACK_FAILED' })
        throw error
      }
      await refresh()
      if (input.handle) liveHandles.set(id, input.handle)
      if (input.context) liveContexts.set(id, input.context)
      const saved = await storage.get(null)
      const expired = Object.entries(saved).filter(([key, value]) => key.startsWith(RECENT) && valid(value))
        .sort((a, b) => b[1].lastOpened - a[1].lastOpened).slice(30).map(([key]) => key)
      if (expired.length) await storage.remove(expired)
      await refresh()
      onChange?.()
      return snapshot(entries.get(id))
    }),
    setFavorite: (id, enabled) => serialize(async () => {
      await refresh()
      const entry = entries.get(id)
      if (!entry) throw new Error('ML_LIBRARY_ENTRY_MISSING')
      if (enabled) await storage.set({ [FAVORITE + id]: { ...entry, favorite: true } })
      else await storage.remove(FAVORITE + id)
      await refresh()
      onChange?.()
      return snapshot(entries.get(id))
    })
  }
}
