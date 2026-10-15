import { tex } from '@mdit/plugin-tex'
import { createTranslator } from '../i18n.mjs'

const bridgeLoads = new WeakMap()
const generations = new WeakMap()

export function markdownMath(md) {
  // MathJax는 \eqref 같은 본문 참조를 위해 문서 글자 전체를 다시 훑는다. 이스케이프로 글자가 된 \( \) \[ \]가
  // 수식 구분자로 오인되지 않도록 백슬래시를 MathJax 기본 제외 클래스로 감싼다. 보이는 글자는 그대로다.
  const renderText = md.renderer.rules.text || ((tokens, index) => md.utils.escapeHtml(tokens[index].content))
  md.renderer.rules.text = (tokens, index, options, env, self) =>
    renderText(tokens, index, options, env, self).replace(/\\(?=[()[\]])/g, '<span class="mathjax_ignore">\\</span>')
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
  // 플러그인 블록 규칙은 `\[`로 시작해 `\]`로 끝나는 줄을 통째로 수식으로 잡는다. `- \[경제\] 제목 \[태그\]`처럼
  // 내용 안에 닫는 `\]`가 먼저 나오면 수식이 아니라 이스케이프한 괄호이므로 거부하고 일반 문단으로 넘긴다.
  // 조용한 검사(문단 끊기 판정)도 같은 기준을 쓰도록 실제로 해석해 본 뒤 되돌린다.
  const bracketRule = md.block.ruler.__rules__.find(rule => rule.name === 'math_block_bracket')
  if (!bracketRule) throw new Error('math_block_bracket rule is missing')
  const bracketBlock = bracketRule.fn
  md.block.ruler.at('math_block_bracket', (state, startLine, endLine, silent) => {
    const tokenCount = state.tokens.length
    const line = state.line
    if (!bracketBlock(state, startLine, endLine, false)) return false
    const valid = !/(?:^|[^\\])(?:\\\\)*\\\]/.test(state.tokens[tokenCount].content)
    if (silent || !valid) {
      state.tokens.length = tokenCount
      state.line = line
    }
    return valid
  }, { alt: bracketRule.alt })
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
