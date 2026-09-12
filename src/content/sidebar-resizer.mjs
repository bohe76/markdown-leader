const MIN_WIDTH = 300
const MAX_WIDTH = 520
const MAX_VIEWPORT_RATIO = 0.45
const HANDLE_RADIUS = 18

export function clampSidebarWidth(value, viewportWidth) {
  const maximum = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(viewportWidth * MAX_VIEWPORT_RATIO)))
  return Math.min(maximum, Math.max(MIN_WIDTH, Math.round(Number(value) || MIN_WIDTH)))
}

export function createSidebarResizer({ document, window, initialWidth, onResize, onCommit }) {
  const element = document.createElement('div')
  element.className = 'ml-sidebar-resizer'
  element.hidden = true
  element.setAttribute('aria-hidden', 'true')
  const handle = document.createElement('span')
  handle.className = 'ml-sidebar-resizer-handle'
  handle.textContent = '‹ ›'
  element.append(handle)

  let enabled = false
  let pointerId = null
  let startWidth = clampSidebarWidth(initialWidth, window.innerWidth)
  let currentWidth = startWidth

  function setHandleY(clientY) {
    const y = Math.min(window.innerHeight - HANDLE_RADIUS, Math.max(HANDLE_RADIUS, clientY))
    element.style.setProperty('--ml-sidebar-handle-y', `${y}px`)
  }

  function finish(commit) {
    if (pointerId === null) return
    const activePointer = pointerId
    pointerId = null
    element.classList.remove('is-dragging')
    delete document.documentElement.dataset.mlSidebarResizing
    element.releasePointerCapture(activePointer)
    if (!commit) {
      if (currentWidth !== startWidth) onResize(startWidth)
      currentWidth = startWidth
      return
    }
    if (currentWidth !== startWidth) onCommit(currentWidth)
  }

  element.addEventListener('pointerenter', event => setHandleY(event.clientY))
  element.addEventListener('pointermove', event => {
    setHandleY(event.clientY)
    if (pointerId !== event.pointerId) return
    const width = clampSidebarWidth(event.clientX, window.innerWidth)
    if (width === currentWidth) return
    currentWidth = width
    onResize(width)
  })
  element.addEventListener('pointerdown', event => {
    if (!enabled || event.button !== 0 || pointerId !== null) return
    event.preventDefault()
    setHandleY(event.clientY)
    pointerId = event.pointerId
    startWidth = currentWidth
    element.setPointerCapture(pointerId)
    element.classList.add('is-dragging')
    document.documentElement.dataset.mlSidebarResizing = 'true'
  })
  element.addEventListener('pointerup', event => { if (pointerId === event.pointerId) finish(true) })
  element.addEventListener('pointercancel', event => { if (pointerId === event.pointerId) finish(false) })

  return {
    element,
    setEnabled(value) {
      enabled = Boolean(value)
      element.hidden = !enabled
      if (!enabled) finish(false)
    },
    setWidth(value) {
      const width = clampSidebarWidth(value, window.innerWidth)
      currentWidth = width
      if (pointerId === null) startWidth = width
    },
  }
}
