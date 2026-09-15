export function normalizeDirectorySort(value = {}) {
  return {
    mode: value?.mode === 'modified' ? 'modified' : 'name',
    name: value?.name === 'Z' ? 'Z' : 'A',
    modified: value?.modified === 'O' ? 'O' : 'N',
  }
}

export function selectDirectorySort(value, mode) {
  const next = normalizeDirectorySort(value)
  if (next.mode === mode) next[mode] = mode === 'name'
    ? (next.name === 'A' ? 'Z' : 'A') : (next.modified === 'N' ? 'O' : 'N')
  next.mode = mode
  return next
}

export function sortDirectoryEntries(entries, value) {
  const state = normalizeDirectorySort(value)
  const nameOrder = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    || (a.url < b.url ? -1 : a.url > b.url ? 1 : 0)
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    if (state.mode === 'name') return nameOrder(a, b) * (state.name === 'A' ? 1 : -1)
    const aKnown = Number.isFinite(a.modifiedAt)
    const bKnown = Number.isFinite(b.modifiedAt)
    if (aKnown !== bKnown) return aKnown ? -1 : 1
    if (aKnown && a.modifiedAt !== b.modifiedAt) {
      return (a.modifiedAt - b.modifiedAt) * (state.modified === 'O' ? 1 : -1)
    }
    return nameOrder(a, b)
  })
}
