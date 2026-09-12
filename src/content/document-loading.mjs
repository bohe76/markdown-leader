export function createDocumentLoading({ content, document, window, onShow }) {
  let generation = 0
  let timer = null
  let skeleton = null

  function cancel() {
    generation++
    if (timer !== null) window.clearTimeout(timer)
    timer = null
    skeleton?.remove()
    skeleton = null
    content.style.removeProperty('min-height')
    content.removeAttribute('aria-busy')
  }

  function begin(height, isCurrent) {
    cancel()
    const currentGeneration = generation
    content.style.minHeight = `${height > 0 ? height : 240}px`
    content.setAttribute('aria-busy', 'true')
    timer = window.setTimeout(() => {
      if (currentGeneration !== generation || !isCurrent()) return
      timer = null
      skeleton = document.createElement('div')
      skeleton.className = 'ml-document-skeleton'
      skeleton.setAttribute('aria-hidden', 'true')
      for (let index = 0; index < 5; index++) {
        const line = document.createElement('span')
        line.className = index === 0 ? 'ml-skeleton-title' : 'ml-skeleton-line'
        skeleton.append(line)
      }
      content.append(skeleton)
      onShow()
    }, 150)
  }

  return { begin, finish: cancel, cancel }
}
