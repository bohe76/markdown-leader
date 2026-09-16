export const RELEASE_NOTES_KEYS = {
  pendingVersion: 'releaseNotesPendingVersion',
  viewedVersion: 'releaseNotesViewedVersion',
}

export const RELEASE_NOTES = {
  '1.3.0': {
    summary: 'releaseNotes130Summary',
    items: [
      'releaseNotes130Syntax',
      'releaseNotes130Tables',
      'releaseNotes130Spacing',
      'releaseNotes130Guide',
    ],
  },
  '1.2.0': {
    summary: 'releaseNotes120Summary',
    items: [
      'releaseNotes120LineSpacing',
      'releaseNotes120Math',
      'releaseNotes120Tabs',
      'releaseNotes120Tables',
    ],
  },
}

export function releaseNotesFor(version) {
  return RELEASE_NOTES[version] || null
}

export function releaseNotesPending(state, version) {
  return !!releaseNotesFor(version)
    && state?.[RELEASE_NOTES_KEYS.pendingVersion] === version
    && state?.[RELEASE_NOTES_KEYS.viewedVersion] !== version
}

export function releaseNotesBlocksRating({ checking = false, pending = false, shown = false } = {}) {
  return checking || pending || shown
}

export function initialReleaseNotesRatingBlock(version) {
  return !!releaseNotesFor(version)
}

export async function consumePendingReleaseNotes(storage, lock, version, show) {
  return lock.request('markdown-leader-library', async () => {
    const state = await storage.get(Object.values(RELEASE_NOTES_KEYS))
    if (!releaseNotesPending(state, version)) return false
    if (!show()) return false
    await storage.set({
      [RELEASE_NOTES_KEYS.pendingVersion]: '',
      [RELEASE_NOTES_KEYS.viewedVersion]: version,
    })
    return true
  })
}

/**
 * @param {{
 *   document: Document,
 *   window: Window,
 *   storage: any,
 *   lock: {request: (name: string, action: () => Promise<any>) => Promise<any>},
 *   t: (key: string, substitutions?: string | number | Array<string | number>) => string,
 *   version: string,
 *   settingsButton: HTMLButtonElement,
 *   canShow?: () => boolean,
 *   canRetry?: () => boolean,
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createReleaseNotes({ document, window, storage, lock, t, version, settingsButton, canShow = () => true, canRetry = () => true, onError = () => {} }) {
  const notes = releaseNotesFor(version)
  const element = document.createElement('dialog')
  element.className = 'ml-confirm-dialog ml-release-notes-dialog'
  element.setAttribute('aria-labelledby', 'ml-release-notes-title')

  const header = document.createElement('div')
  header.className = 'ml-release-notes-header'
  const title = document.createElement('h2')
  title.id = 'ml-release-notes-title'
  title.textContent = t('releaseNotesTitle', [version])
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ml-release-notes-close'
  close.setAttribute('aria-label', t('releaseNotesClose'))
  close.textContent = '×'
  header.append(title, close)

  const summary = document.createElement('p')
  summary.textContent = notes ? t(notes.summary) : ''
  const list = document.createElement('ul')
  list.className = 'ml-release-notes-list'
  for (const key of notes?.items || []) {
    const item = document.createElement('li')
    item.textContent = t(key)
    list.append(item)
  }
  const actions = document.createElement('div')
  const done = document.createElement('button')
  done.type = 'button'
  done.className = 'ml-primary-action'
  done.textContent = t('releaseNotesDone')
  actions.append(done)
  element.append(header, summary, list, actions)

  settingsButton.hidden = !notes
  let previousFocus = null
  let shownAutomatically = false
  let pendingForSession = initialReleaseNotesRatingBlock(version)
  let retryTimer
  let checking = false

  function hide() {
    if (!element.open) return
    element.close()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
  function show(automatic = false) {
    if (!notes || element.open || document.querySelector('dialog[open]')) return false
    previousFocus = document.activeElement
    shownAutomatically ||= automatic
    element.showModal()
    done.focus()
    return true
  }
  function scheduleRetry() {
    if (!canRetry() || retryTimer !== undefined) return
    retryTimer = window.setTimeout(() => {
      retryTimer = undefined
      void showIfPending().catch(error => { onError(error); scheduleRetry() })
    }, 5000)
  }
  async function showIfPending() {
    if (!notes || !canRetry() || checking) return false
    checking = true
    try {
      const consumed = await consumePendingReleaseNotes(storage, lock, version, () => {
        if (!canShow() || document.querySelector('dialog[open]')) return false
        return show(true)
      })
      if (!consumed) {
        const state = await storage.get(Object.values(RELEASE_NOTES_KEYS))
        pendingForSession = releaseNotesPending(state, version)
        if (pendingForSession) scheduleRetry()
      }
      return consumed
    } finally {
      checking = false
    }
  }

  element.addEventListener('cancel', event => { event.preventDefault(); hide() })
  close.addEventListener('click', hide)
  done.addEventListener('click', hide)
  settingsButton.addEventListener('click', () => show(false))

  return {
    element,
    showIfPending: () => showIfPending().catch(error => {
      pendingForSession = true
      onError(error)
      scheduleRetry()
      return false
    }),
    blocksRating: () => releaseNotesBlocksRating({ checking, pending: pendingForSession, shown: shownAutomatically }),
    isOpen: () => element.open,
    destroy() {
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      retryTimer = undefined
    },
  }
}
