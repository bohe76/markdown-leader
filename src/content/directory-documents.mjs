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

export async function probeDirectoryDocuments(url, { readEntries, isCurrent, budget, exhaustive = false, onResult, visited = new Set() }) {
  const root = directoryTarget(url)
  if (!root || !isCurrent()) return 'unknown'
  const results = new Map()

  function publish(target, result) {
    if (isCurrent()) onResult?.(target.url, result)
    return result
  }

  function visit(target, depth) {
    if (!isCurrent()) return 'unknown'
    const key = `${target.host}${target.path}`
    if (results.has(key)) return results.get(key)
    if (depth >= 64) return publish(target, 'unknown')
    if (!visited.has(key)) {
      if (!Number.isFinite(budget.remaining) || budget.remaining < 1) return publish(target, 'unknown')
      budget.remaining--
      visited.add(key)
    }
    const result = (async () => {
      let entries
      try {
        entries = await readEntries(target.url)
      } catch {
        return publish(target, 'unknown')
      }
      if (!isCurrent() || !Array.isArray(entries)) return 'unknown'
      let state = 'empty'
      const directories = []
      for (const entry of entries) {
        const child = directoryTarget(entry?.url)
        if (!child || child.host !== target.host || !child.path.startsWith(target.path) || child.path === target.path) {
          state = 'unknown'
          continue
        }
        if (entry.type === 'file') state = 'present'
        else if (entry.type === 'directory') directories.push(child)
        else state = 'unknown'
      }
      if (state === 'present' && !exhaustive) return publish(target, state)
      const childResults = exhaustive
        ? await Promise.all(directories.map(child => visit(child, depth + 1)))
        : []
      if (!exhaustive) {
        for (const child of directories) {
          if (!isCurrent()) return 'unknown'
          const childResult = await visit(child, depth + 1)
          if (!isCurrent()) return 'unknown'
          if (childResult === 'present') return publish(target, 'present')
          if (childResult === 'unknown') state = 'unknown'
        }
      } else if (childResults.includes('present')) state = 'present'
      else if (state !== 'present' && childResults.includes('unknown')) state = 'unknown'
      if (!isCurrent()) return 'unknown'
      return publish(target, state)
    })()
    results.set(key, result)
    return result
  }

  return visit(root, 0)
}
