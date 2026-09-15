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

function handleStore(indexedDB) {
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
    const db = await database()
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

export function createReaderLibrary({ storage, indexedDB, onChange }) {
  const handles = handleStore(indexedDB)
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
    entries = next
    recentIds = recent.sort((a, b) => entries.get(b).lastOpened - entries.get(a).lastOpened).slice(0, 30)
  }
  /**
   * @template T
   * @param {() => Promise<T>} action
   * @returns {Promise<T>}
   */
  function serialize(action) {
    const result = queue.then(action)
    queue = result.catch(() => {})
    return result
  }
  async function getHandle(id) {
    if (liveHandles.has(id)) return liveHandles.get(id)
    const handle = await handles.get(id)
    if (handle) liveHandles.set(id, handle)
    return handle
  }
  async function getContext(id) {
    if (liveContexts.has(id)) return liveContexts.get(id)
    const context = await handles.get(id + ':context')
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
    getHandle,
    getContext,
    find: target => serialize(async () => { await refresh(); return snapshot(await findEntry(target)) }),
    remember: input => serialize(async () => {
      await refresh()
      if (!['file', 'directory'].includes(input.kind) || !input.name) throw new Error('ML_LIBRARY_INVALID_ENTRY')
      const url = nativeURL(input.url)
      if (!url && !input.handle && !input.id) throw new Error('ML_LIBRARY_MISSING_SOURCE')
      const existing = input.id ? entries.get(input.id) : await findEntry(input)
      if (input.id && !existing) throw new Error('ML_LIBRARY_ENTRY_MISSING')
      if (existing && existing.kind !== input.kind) throw new Error('ML_LIBRARY_INVALID_ENTRY')
      const id = existing?.id ?? (url ? `url:${url}` : crypto.randomUUID())
      const lastOpened = Math.max(Date.now(), ...[...entries.values()].map(entry => entry.lastOpened + 1))
      const entry = { id, name: input.name, kind: input.kind, lastOpened, favorite: existing?.favorite ?? false }
      if (url ?? existing?.url) entry.url = url ?? existing.url
      if (input.path ?? existing?.path) entry.path = input.path ?? existing.path
      if (input.handle) {
        if (input.handle.kind !== input.kind) throw new Error('ML_LIBRARY_INVALID_ENTRY')
        await handles.put(id, input.handle)
      }
      if (input.context) {
        if (input.context.rootHandle?.kind !== 'directory' || typeof input.context.relativePath !== 'string') {
          throw new Error('ML_LIBRARY_INVALID_CONTEXT')
        }
        await handles.put(id + ':context', input.context)
      }
      await storage.set({ [RECENT + id]: entry })
      if (input.handle) liveHandles.set(id, input.handle)
      if (input.context) liveContexts.set(id, input.context)
      await refresh()
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
