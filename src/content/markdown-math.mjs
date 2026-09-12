import { tex } from '@mdit/plugin-tex'
import { createTranslator } from '../i18n.mjs'

const generations = new WeakMap()
const stylesheets = new WeakMap()

export function markdownMath(md) {
  md.use(tex, {
    delimiters: 'dollars',
    allowInlineWithSpace: false,
    mathFence: false,
    render(source, displayMode) {
      const tag = displayMode ? 'div' : 'span'
      const className = displayMode ? 'ml-math ml-math-block' : 'ml-math'
      return `<${tag} class="${className}" data-math-state="pending" data-display-mode="${displayMode ? 'block' : 'inline'}"><code>${md.utils.escapeHtml(source)}</code></${tag}>`
    },
  })
}

function loadRenderer() {
  return import(/* @vite-ignore */ chrome.runtime.getURL('renderers/math.js'))
}

function loadStyles(doc) {
  if (stylesheets.has(doc)) return stylesheets.get(doc)
  const loading = new Promise((resolve, reject) => {
    const link = doc.createElement('link')
    link.rel = 'stylesheet'
    link.href = chrome.runtime.getURL('renderers/katex.css')
    link.dataset.markdownLeader = 'math-styles'
    link.onload = () => { link.onload = null; link.onerror = null; resolve() }
    link.onerror = () => {
      link.onload = null
      link.onerror = null
      link.remove()
      reject(new Error('Math stylesheet unavailable'))
    }
    doc.head.append(link)
  })
  stylesheets.set(doc, loading)
  loading.catch(() => stylesheets.delete(doc))
  return loading
}

function yieldToBrowser() {
  return globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0))
}

export async function renderMath(content, { isCurrent, t = createTranslator(), loadRenderer: load = loadRenderer, loadStyles: style = loadStyles }) {
  const generation = (generations.get(content) || 0) + 1
  generations.set(content, generation)
  const current = () => content.isConnected && generations.get(content) === generation && isCurrent()
  const blocks = [...content.querySelectorAll('.ml-math[data-math-state="pending"]')]
  if (!blocks.length || !current()) return
  let renderer
  try {
    const resources = await Promise.all([load(), style(content.ownerDocument)])
    renderer = resources[0]
  } catch {
    // 로딩 실패도 각 수식의 원문과 번역된 안내로 처리한다.
  }
  if (!current()) return
  for (const [index, block] of blocks.entries()) {
    if (index) await yieldToBrowser()
    if (!current()) return
    const valid = () => current() && block.isConnected && content.contains(block) && block.dataset.mathState === 'pending'
    if (!valid()) continue
    const source = block.querySelector('code')?.textContent || ''
    try {
      if (!renderer) throw new Error('Math renderer unavailable')
      const html = await renderer.renderMathSource(source, block.dataset.displayMode === 'block')
      if (!valid()) continue
      block.innerHTML = html
      block.dataset.mathState = 'rendered'
    } catch {
      if (!valid()) continue
      const label = content.ownerDocument.createElement('span')
      label.className = 'ml-math-error-label'
      label.textContent = t('mathRenderFailed')
      const code = content.ownerDocument.createElement('code')
      code.textContent = source
      block.replaceChildren(label, ' ', code)
      block.classList.add('ml-math-error')
      block.dataset.mathState = 'fallback'
    }
  }
}
