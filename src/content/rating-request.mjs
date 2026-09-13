export const RATING_REVIEW_URL = 'https://chromewebstore.google.com/detail/markdown-leader/mglmfpabbmcifhimdlembgchpaofbogm/reviews'

export const RATING_KEYS = {
  installedAt: 'ratingInstalledAt',
  successfulSessions: 'ratingSuccessfulSessions',
  promptCount: 'ratingPromptCount',
  nextPromptAt: 'ratingNextPromptAt',
  done: 'ratingPromptDone',
}

export const RATING_MIN_AGE_MS = 7 * 24 * 60 * 60 * 1000
export const RATING_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000
export const RATING_MIN_SESSIONS = 10
export const RATING_MAX_PROMPTS = 2

const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0

export function normalizeRatingState(value = {}) {
  return {
    installedAt: Math.max(0, finite(value[RATING_KEYS.installedAt])),
    successfulSessions: Math.max(0, Math.floor(finite(value[RATING_KEYS.successfulSessions]))),
    promptCount: Math.max(0, Math.floor(finite(value[RATING_KEYS.promptCount]))),
    nextPromptAt: Math.max(0, finite(value[RATING_KEYS.nextPromptAt])),
    done: value[RATING_KEYS.done] === true,
  }
}

export function ratingPromptDue(state, now = Date.now()) {
  return !state.done
    && state.installedAt > 0
    && now - state.installedAt >= RATING_MIN_AGE_MS
    && state.successfulSessions >= RATING_MIN_SESSIONS
    && state.promptCount < RATING_MAX_PROMPTS
    && now >= state.nextPromptAt
}

function savedState(state) {
  return {
    [RATING_KEYS.installedAt]: state.installedAt,
    [RATING_KEYS.successfulSessions]: state.successfulSessions,
    [RATING_KEYS.promptCount]: state.promptCount,
    [RATING_KEYS.nextPromptAt]: state.nextPromptAt,
    [RATING_KEYS.done]: state.done,
  }
}

/**
 * @param {any} storage
 * @param {{request: (name: string, action: () => Promise<any>) => Promise<any>}} lock
 * @param {(state: ReturnType<typeof normalizeRatingState>) => boolean | Promise<boolean>} action
 */
export function updateRatingState(storage, lock, action) {
  const run = async () => {
    const state = normalizeRatingState(await storage.get(Object.values(RATING_KEYS)))
    const changed = await action(state)
    if (changed) await storage.set(savedState(state))
    return { state, changed }
  }
  return lock.request('markdown-leader-library', run)
}

/**
 * @param {{
 *   document: Document,
 *   window: Window,
 *   storage: any,
 *   lock: {request: (name: string, action: () => Promise<any>) => Promise<any>},
 *   t: (key: string) => string,
 *   settingsLink: HTMLAnchorElement,
 *   canShow?: () => boolean,
 *   now?: () => number,
 *   onError?: (error: unknown) => void,
 * }} options
 */
export function createRatingRequest({ document, window, storage, lock, t, settingsLink, canShow = () => true, now = () => Date.now(), onError = () => {} }) {
  const element = document.createElement('dialog')
  element.className = 'ml-confirm-dialog ml-rating-dialog'
  element.setAttribute('aria-labelledby', 'ml-rating-title')
  const title = document.createElement('h2')
  title.id = 'ml-rating-title'
  title.textContent = t('ratingTitle')
  const header = document.createElement('div')
  header.className = 'ml-rating-header'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ml-rating-close'
  close.setAttribute('aria-label', t('ratingClose'))
  close.textContent = '×'
  header.append(title, close)
  const detail = document.createElement('p')
  detail.textContent = t('ratingMessage')
  const actions = document.createElement('div')
  const never = document.createElement('button')
  never.type = 'button'
  never.textContent = t('ratingNever')
  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = t('ratingLater')
  const rate = document.createElement('a')
  rate.className = 'ml-primary-action'
  rate.href = RATING_REVIEW_URL
  rate.target = '_blank'
  rate.rel = 'noopener noreferrer'
  rate.textContent = t('ratingLink')
  actions.append(never, later, rate)
  element.append(header, detail, actions)

  settingsLink.href = RATING_REVIEW_URL
  settingsLink.target = '_blank'
  settingsLink.rel = 'noopener noreferrer'
  let countedSession = false
  let timer

  const update = action => updateRatingState(storage, lock, action)
  function clearTimer() {
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }
  async function finish(decision) {
    clearTimer()
    await update(state => {
      if (decision === 'rate' || decision === 'never') state.done = true
      else state.nextPromptAt = now() + RATING_SNOOZE_MS
      return true
    })
    if (element.open) element.close()
  }
  async function showIfDue() {
    timer = undefined
    if (!canShow() || document.querySelector('dialog[open]')) {
      timer = window.setTimeout(() => void showIfDue().catch(onError), 30000)
      return
    }
    const { changed } = await update(state => {
      if (!ratingPromptDue(state, now())) return false
      state.promptCount += 1
      state.nextPromptAt = now() + RATING_SNOOZE_MS
      return true
    })
    if (!changed) return
    if (!canShow() || document.querySelector('dialog[open]')) return
    element.showModal()
    later.focus()
  }
  function schedule() {
    if (timer === undefined) timer = window.setTimeout(() => void showIfDue().catch(error => { timer = undefined; onError(error) }), 5000)
  }

  const safelyFinish = decision => void finish(decision).catch(error => { onError(error); if (element.open) element.close() })
  element.addEventListener('cancel', event => { event.preventDefault(); safelyFinish('later') })
  never.addEventListener('click', () => safelyFinish('never'))
  later.addEventListener('click', () => safelyFinish('later'))
  close.addEventListener('click', () => safelyFinish('later'))
  rate.addEventListener('click', () => safelyFinish('rate'))
  settingsLink.addEventListener('click', () => safelyFinish('rate'))

  return {
    element,
    async recordSuccessfulSession() {
      if (countedSession) return
      countedSession = true
      try {
        const timestamp = now()
        await update(state => {
          if (!state.installedAt) state.installedAt = timestamp
          state.successfulSessions += 1
          return true
        })
        schedule()
      } catch (error) { onError(error) }
    },
    destroy() { clearTimer() },
  }
}
