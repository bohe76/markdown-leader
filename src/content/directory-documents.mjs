function directoryTarget(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'file:') return null
    url.search = ''
    url.hash = ''
    if (!url.pathname.endsWith('/')) url.pathname += '/'
    const segments = url.pathname.split('/').map((segment) => decodeURIComponent(segment))
    if (segments.some((segment) => /[\\/\u0000]/.test(segment) || segment === '.' || segment === '..')) return null
    return { url: url.href, host: url.host, path: segments.join('/') }
  } catch {
    return null
  }
}

export async function probeDirectoryDocuments(url, { readEntries, isCurrent, budget }) {
  const root = directoryTarget(url)
  if (!root || !isCurrent()) return 'unknown'
  const results = new Map()

  async function visit(target, depth) {
    if (!isCurrent()) return 'unknown'
    const key = `${target.host}${target.path}`
    if (results.has(key)) return results.get(key)
    if (depth >= 64 || !Number.isFinite(budget.remaining) || budget.remaining < 1) return 'unknown'
    budget.remaining--
    results.set(key, 'unknown')
    let entries
    try {
      entries = await readEntries(target.url)
    } catch {
      return 'unknown'
    }
    if (!isCurrent() || !Array.isArray(entries)) return 'unknown'
    let result = 'empty'
    const directories = []
    for (const entry of entries) {
      const child = directoryTarget(entry?.url)
      if (!child || child.host !== target.host || !child.path.startsWith(target.path) || child.path === target.path) {
        result = 'unknown'
        continue
      }
      if (entry.type === 'file') {
        results.set(key, 'present')
        return 'present'
      }
      if (entry.type === 'directory') directories.push(child)
      else result = 'unknown'
    }
    for (const child of directories) {
      if (!isCurrent()) return 'unknown'
      const childResult = await visit(child, depth + 1)
      if (!isCurrent()) return 'unknown'
      if (childResult === 'present') {
        results.set(key, 'present')
        return 'present'
      }
      if (childResult === 'unknown') result = 'unknown'
    }
    results.set(key, result)
    return result
  }

  return visit(root, 0)
}
