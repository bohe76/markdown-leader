import { readerIcon } from './reader-icons.mjs'

export function renderLibraryList(container, entries, { t, favorites, onOpen, onRemove, attachTooltip }) {
  const fragment = container.ownerDocument.createDocumentFragment()
  const document = container.ownerDocument
  if (!entries.length) {
    const empty = document.createElement('p')
    empty.className = 'ml-empty'
    empty.textContent = t(favorites ? 'readerFavoritesEmpty' : 'readerRecentEmpty')
    fragment.append(empty)
  }
  for (const entry of entries) {
    const row = document.createElement('div')
    row.className = 'ml-library-row'
    row.dataset.entryId = entry.id
    const open = document.createElement('button')
    open.type = 'button'
    open.className = 'ml-library-open'
    open.innerHTML = readerIcon(entry.kind === 'directory' ? 'folder' : 'file')
    const text = document.createElement('span')
    const name = document.createElement('span')
    const path = document.createElement('small')
    name.textContent = entry.name
    path.textContent = entry.path || entry.url || ''
    text.append(name, path)
    open.append(text)
    attachTooltip?.(open, [name, path], `${entry.name}\n${path.textContent}`.trim(), row)
    open.addEventListener('click', () => onOpen(entry))
    row.append(open)
    if (favorites) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'ml-library-remove'
      remove.innerHTML = readerIcon('star')
      remove.setAttribute('aria-label', t('readerUnfavoriteTab', entry.name))
      remove.title = t('readerUnfavoriteTab', entry.name)
      remove.addEventListener('click', () => onRemove(entry))
      row.append(remove)
    }
    fragment.append(row)
  }
  container.replaceChildren(fragment)
}
