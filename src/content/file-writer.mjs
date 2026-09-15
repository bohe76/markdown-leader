const pending = new Set()
function failure(code) { return Object.assign(new Error(code), { code }) }
const withoutBOM = raw => raw.replace(/^\uFEFF/, '')

async function read(handle) {
  const file = await handle.getFile()
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
}

/**
 * @param {FileSystemFileHandle} handle
 * @param {string} expectedRaw
 * @param {string} nextRaw
 * @param {{ isCurrent?: () => boolean }} options
 */
export async function writeFileRevision(handle, expectedRaw, nextRaw, options = {}) {
  const { isCurrent = () => true } = options
  const check = () => { if (!isCurrent()) throw failure('file-stale') }
  check()
  const permissionOptions = { mode: 'readwrite' }
  if (await handle.queryPermission(permissionOptions) !== 'granted' && await handle.requestPermission(permissionOptions) !== 'granted') {
    throw failure('file-permission')
  }
  let release
  const entry = { handle, done: new Promise(resolve => { release = resolve }) }
  const earlier = [...pending]
  pending.add(entry)
  let writable
  try {
    for (const previous of earlier) {
      if (previous.handle === handle || await handle.isSameEntry(previous.handle)) await previous.done
    }
    check()
    const original = await read(handle)
    if (withoutBOM(original) !== withoutBOM(expectedRaw)) throw failure('file-conflict')
    check()
    writable = await handle.createWritable({ mode: 'exclusive' })
    if (await read(handle) !== original) throw failure('file-conflict')
    check()
    const result = (original.startsWith('\uFEFF') ? '\uFEFF' : '') + withoutBOM(nextRaw)
    await writable.write(new TextEncoder().encode(result))
    if (await read(handle) !== original) throw failure('file-conflict')
    check()
    await writable.close()
    writable = null
    return result
  } catch (error) {
    if (writable) await writable.abort().catch(() => {})
    throw error
  } finally {
    pending.delete(entry)
    release()
  }
}
