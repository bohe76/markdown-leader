export function createReaderDialog({ document, t }) {
  const element = document.createElement('dialog')
  element.className = 'ml-confirm-dialog'
  element.setAttribute('aria-labelledby', 'ml-confirm-title')
  const title = document.createElement('h2')
  title.id = 'ml-confirm-title'
  const detail = document.createElement('p')
  const actions = document.createElement('div')
  const cancel = document.createElement('button')
  const accept = document.createElement('button')
  const alternate = document.createElement('button')
  alternate.type = 'button'
  alternate.hidden = true
  cancel.type = accept.type = 'button'
  cancel.textContent = t('reviewCancel')
  actions.append(cancel, alternate, accept)
  element.append(title, detail, actions)
  let resolve = null
  let previousFocus = null
  let choosing = false
  function finish(value) {
    if (!resolve) return
    const done = resolve
    resolve = null
    element.close()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    done(value)
  }
  cancel.addEventListener('click', () => finish(choosing ? 'cancel' : false))
  accept.addEventListener('click', () => finish(choosing ? 'reconnect' : true))
  alternate.addEventListener('click', () => finish('remove'))
  element.addEventListener('cancel', event => { event.preventDefault(); finish(choosing ? 'cancel' : false) })
  return {
    element,
    choose({ heading, message, action, remove }) {
      if (resolve) return Promise.resolve('cancel')
      choosing = true
      previousFocus = document.activeElement
      title.textContent = heading
      detail.textContent = message
      detail.hidden = false
      accept.textContent = action
      alternate.textContent = remove
      alternate.hidden = false
      return new Promise(done => { resolve = done; element.showModal(); cancel.focus() })
    },
    confirm({ heading, message = '', action }) {
      if (resolve) return Promise.resolve(false)
      choosing = false
      alternate.hidden = true
      previousFocus = document.activeElement
      title.textContent = heading
      detail.textContent = message
      detail.hidden = !message
      accept.textContent = action
      return new Promise(done => {
        resolve = done
        element.showModal()
        cancel.focus()
      })
    },
  }
}
