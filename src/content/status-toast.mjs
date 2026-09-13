/** 일반 안내는 한 곳에 표시하고, 복구가 끝날 때까지 같은 오류를 반복하지 않는다. */
export function createStatusToast({ document, window, container, t }) {
  const seen = new Map()
  let timer
  let remaining = 5000
  let started = 0
  let hovering = false
  let focused = false
  let visible = false
  let destroyed = false
  let currentKey
  let action
  container.classList.add('ml-toast')
  container.hidden = true
  const popover = typeof container.showPopover === 'function'
  if (popover) container.setAttribute('popover', 'manual')

  const message = document.createElement('span')
  message.className = 'ml-toast-message'
  message.setAttribute('role', 'status')
  message.setAttribute('aria-live', 'polite')
  message.setAttribute('aria-atomic', 'true')
  const actionButton = document.createElement('button')
  actionButton.type = 'button'
  actionButton.className = 'ml-toast-action'
  actionButton.hidden = true
  const dismiss = document.createElement('button')
  dismiss.type = 'button'
  dismiss.className = 'ml-toast-dismiss'
  dismiss.textContent = '×'
  dismiss.setAttribute('aria-label', t('toastDismiss'))
  dismiss.title = t('toastDismiss')
  container.replaceChildren(message, actionButton, dismiss)

  const stop = () => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
      remaining = Math.max(0, remaining - (window.performance.now() - started))
    }
  }
  const clear = () => {
    stop()
    if (visible && popover) container.hidePopover()
    visible = false
    container.hidden = true
    message.textContent = ''
    action = undefined
    currentKey = undefined
  }
  const resume = () => {
    if (!visible || hovering || focused || timer !== undefined) return
    started = window.performance.now()
    timer = window.setTimeout(clear, remaining)
  }
  const enter = () => { hovering = true; stop() }
  const leave = () => { hovering = false; resume() }
  const focusIn = () => { focused = true; stop() }
  const focusOut = event => {
    if (container.contains(event.relatedTarget)) return
    focused = false
    resume()
  }
  const invoke = () => {
    const callback = action
    clear()
    callback?.()
  }
  container.addEventListener('mouseenter', enter)
  container.addEventListener('mouseleave', leave)
  container.addEventListener('focusin', focusIn)
  container.addEventListener('focusout', focusOut)
  dismiss.addEventListener('click', clear)
  actionButton.addEventListener('click', invoke)

  return {
    /**
     * @param {string} text
     * @param {{error?: boolean, key?: string, actionLabel?: string, onAction?: () => unknown}} [options]
     */
    show(text, { error = false, key, actionLabel, onAction } = {}) {
      if (destroyed) return
      if (!text) { clear(); return }
      if (key !== undefined && seen.get(key) === text) return
      if (key !== undefined) seen.set(key, text)
      stop()
      currentKey = key
      remaining = 5000
      action = typeof onAction === 'function' ? onAction : undefined
      actionButton.hidden = !action || !actionLabel
      actionButton.textContent = actionLabel || ''
      container.classList.toggle('error', error)
      message.textContent = text
      container.hidden = false
      if (!visible && popover) container.showPopover()
      visible = true
      hovering = container.matches(':hover')
      focused = container.contains(document.activeElement)
      resume()
    },
    clear,
    resolve(key) {
      seen.delete(key)
      if (visible && currentKey === key) clear()
    },
    destroy() {
      clear()
      destroyed = true
      seen.clear()
      container.removeEventListener('mouseenter', enter)
      container.removeEventListener('mouseleave', leave)
      container.removeEventListener('focusin', focusIn)
      container.removeEventListener('focusout', focusOut)
      dismiss.removeEventListener('click', clear)
      actionButton.removeEventListener('click', invoke)
    },
  }
}
