(() => {
  if (window.__markdownLeaderMathJaxBridge) return
  window.__markdownLeaderMathJaxBridge = true
  const targetId = 'ml-document-panel'
  let running = false
  let requested = ''

  function target() { return document.getElementById(targetId) }

  function markStyles() {
    document.querySelectorAll('style[id^="MJX-"]').forEach((style) => {
      style.dataset.markdownLeader = 'math-styles'
    })
  }

  function removeExternalResources(root) {
    root.querySelectorAll('a[href]').forEach((link) => {
      const generatedMathLink = link.closest('.ml-math') || link.querySelector('mjx-container')
      if (generatedMathLink && !link.getAttribute('href')?.startsWith('#mjx-eqn')) link.replaceWith(...link.childNodes)
    })
    root.querySelectorAll('.ml-math img, mjx-container img').forEach((image) => image.remove())
  }

  async function drain() {
    if (running) return
    running = true
    try {
      await MathJax.startup.promise
      while (requested) {
        const generation = requested
        requested = ''
        const root = target()
        if (!root || root.dataset.mlMathRequest !== generation) continue
        try {
          MathJax.typesetClear([root])
          MathJax.texReset()
          await MathJax.typesetPromise([root])
          if (root.dataset.mlMathRequest !== generation) continue
          removeExternalResources(root)
          markStyles()
          root.dataset.mlMathComplete = generation
          root.dispatchEvent(new Event('markdown-leader:math-complete'))
        } catch (error) {
          if (root.dataset.mlMathRequest !== generation) continue
          root.dataset.mlMathError = String(error?.message || error)
          root.dataset.mlMathFailed = generation
          root.dispatchEvent(new Event('markdown-leader:math-failed'))
        }
      }
    } finally {
      running = false
      if (requested) void drain()
    }
  }

  document.addEventListener('markdown-leader:math-clear', () => {
    const root = target()
    if (running || !root || !window.MathJax?.typesetClear) return
    MathJax.typesetClear([root])
    MathJax.texReset()
  })
  document.addEventListener('markdown-leader:math-render', () => {
    const root = target()
    if (!root?.dataset.mlMathRequest) return
    requested = root.dataset.mlMathRequest
    void drain()
  })
})()
