import { tex } from '@mdit/plugin-tex'
import { createTranslator } from '../i18n.mjs'

const bridgeLoads = new WeakMap()
const generations = new WeakMap()

export function markdownMath(md) {
  md.use(tex, {
    delimiters: 'all',
    allowInlineWithSpace: false,
    mathFence: false,
    render(source, displayMode) {
      const tag = displayMode ? 'div' : 'span'
      const className = displayMode ? 'ml-math ml-math-block' : 'ml-math'
      const [open, close] = displayMode ? ['\\[', '\\]'] : ['\\(', '\\)']
      return `<${tag} class="${className}" data-math-state="pending" data-display-mode="${displayMode ? 'block' : 'inline'}" data-math-source="${md.utils.escapeHtml(source)}"><span class="ml-math-source">${open}${md.utils.escapeHtml(source)}${close}</span></${tag}>`
    },
  })
}

function loadScript(doc, path) {
  return new Promise((resolve, reject) => {
    const script = doc.createElement('script')
    script.src = chrome.runtime.getURL(path)
    script.onload = () => { script.remove(); resolve() }
    script.onerror = () => { script.remove(); reject(new Error(`Math renderer failed to load: ${path}`)) }
    ;(doc.head || doc.documentElement).append(script)
  })
}

async function loadMathBridge(doc) {
  if (bridgeLoads.has(doc)) return bridgeLoads.get(doc)
  const loading = (async () => {
    await loadScript(doc, 'renderers/mathjax/config.js')
    await loadScript(doc, 'renderers/mathjax/tex-chtml.js')
    await loadScript(doc, 'renderers/mathjax/bridge.js')
  })().catch((error) => {
    bridgeLoads.delete(doc)
    throw error
  })
  bridgeLoads.set(doc, loading)
  return loading
}

function fallback(block, message, doc) {
  const label = doc.createElement('span')
  label.className = 'ml-math-error-label'
  label.textContent = message
  const code = doc.createElement('code')
  code.textContent = block.dataset.mathSource || ''
  block.replaceChildren(label, ' ', code)
  block.classList.add('ml-math-error')
  block.dataset.mathState = 'fallback'
}

function waitForResult(content, generation) {
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timeout)
      content.removeEventListener('markdown-leader:math-complete', complete)
      content.removeEventListener('markdown-leader:math-failed', failed)
      error ? reject(error) : resolve()
    }
    const complete = () => content.dataset.mlMathComplete === generation && finish()
    const failed = () => content.dataset.mlMathFailed === generation && finish(new Error(content.dataset.mlMathError || 'Math rendering failed'))
    const timeout = setTimeout(() => finish(new Error('Math renderer timed out')), 30000)
    content.addEventListener('markdown-leader:math-complete', complete)
    content.addEventListener('markdown-leader:math-failed', failed)
  })
}

export function clearMath(content) {
  if (content?.isConnected) content.dispatchEvent(new Event('markdown-leader:math-clear', { bubbles: true }))
}

export async function renderMath(content, { isCurrent, t = createTranslator(), loadBridge = loadMathBridge }) {
  const blocks = [...content.querySelectorAll('.ml-math[data-math-state="pending"]')]
  const hasReferences = /\\(?:eq)?ref\s*\{/.test(content.textContent || '')
  if ((!blocks.length && !hasReferences) || !content.isConnected || !isCurrent()) return
  const generation = (generations.get(content) || 0) + 1
  generations.set(content, generation)
  const current = () => content.isConnected && generations.get(content) === generation && isCurrent()
  try {
    await loadBridge(content.ownerDocument)
    if (!current()) return
    const request = String(generation)
    const result = waitForResult(content, request)
    content.dataset.mlMathRequest = request
    content.dispatchEvent(new Event('markdown-leader:math-render', { bubbles: true }))
    await result
    if (!current() || content.dataset.mlMathRequest !== request) return
    for (const block of blocks) {
      if (!block.isConnected || !content.contains(block)) continue
      if (block.querySelector('mjx-merror, mjx-mtext[style*="color: red"]')) fallback(block, t('mathRenderFailed'), content.ownerDocument)
      else block.dataset.mathState = 'rendered'
    }
  } catch {
    if (!current()) return
    for (const block of blocks) {
      if (block.isConnected && content.contains(block)) fallback(block, t('mathRenderFailed'), content.ownerDocument)
    }
  }
}
