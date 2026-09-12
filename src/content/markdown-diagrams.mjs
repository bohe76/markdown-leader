const generations = new WeakMap()
const MAX_SOURCE_LENGTH = 50_000

export function markdownDiagrams(md) {
  const fence = md.renderer.rules.fence
  md.renderer.rules.fence = (tokens, index, options, env, self) => {
    if (tokens[index].info.trim().toLowerCase() !== 'mermaid') return fence(tokens, index, options, env, self)
    return `<div class="ml-diagram"><pre><code class="language-mermaid">${md.utils.escapeHtml(tokens[index].content)}</code></pre></div>\n`
  }
}

export function isDiagramSourceAllowed(source) {
  // 노드 메타데이터는 YAML의 따옴표·이스케이프 키로 외부 이미지를 요청할 수 있다.
  // Mermaid가 임시 DOM을 만들기 전에 메타데이터 전체를 원문 표시로 제한한다.
  return source.length <= MAX_SOURCE_LENGTH && !/^\s*---(?:\r?\n|$)/.test(source)
    && !/%%\s*\{|@\s*\{|(?:https?|file|data|javascript):|url\s*\(|@import|\b(?:img|icon)\s*:/i.test(source)
}

function loadRenderer() {
  return import(/* @vite-ignore */ chrome.runtime.getURL('renderers/mermaid.js'))
}

export async function renderDiagrams(content, { isCurrent, t, colors, loadRenderer: load = loadRenderer }) {
  const generation = (generations.get(content) || 0) + 1
  generations.set(content, generation)
  const current = () => content.isConnected && generations.get(content) === generation && isCurrent()
  const blocks = [...content.querySelectorAll('.ml-diagram')]
  if (!blocks.length || !current()) return
  const renderKey = JSON.stringify(colors || {})
  let renderer
  for (const [index, block] of blocks.entries()) {
    if (index) {
      if (globalThis.scheduler?.yield) await globalThis.scheduler.yield()
      else await new Promise((resolve) => setTimeout(resolve, 0))
    }
    if (!current()) return
    if (!block.isConnected || block.dataset.diagramState === 'fallback'
      || (block.dataset.diagramState === 'rendered' && block.dataset.diagramRenderKey === renderKey)) continue
    const pre = block.querySelector('pre')
    const source = pre?.querySelector('code')?.textContent || ''
    const doc = content.ownerDocument
    let stage
    try {
      if (!isDiagramSourceAllowed(source)) throw new Error('unsupported diagram source')
      renderer ||= await load()
      if (!current() || !block.isConnected) return
      stage = doc.createElement('div')
      stage.className = 'ml-diagram-stage'
      stage.setAttribute('aria-hidden', 'true')
      stage.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;'
      content.append(stage)
      const svg = await renderer.renderDiagram(source, stage, { colors, isCurrent: () => current() && block.isConnected })
      if (!current() || !block.isConnected || !svg) return
      const output = doc.createElement('div')
      output.className = 'ml-diagram-output'
      output.innerHTML = svg
      let details = block.querySelector('details')
      if (!details) {
        details = doc.createElement('details')
        const summary = doc.createElement('summary')
        summary.textContent = t('diagramSource')
        details.append(summary, pre)
      }
      block.replaceChildren(output, details)
      block.dataset.diagramState = 'rendered'
      block.dataset.diagramRenderKey = renderKey
    } catch {
      if (!current() || !block.isConnected) return
      const message = doc.createElement('p')
      message.className = 'ml-diagram-error'
      message.textContent = t('diagramUnavailable')
      block.prepend(message)
      block.dataset.diagramState = 'fallback'
    } finally {
      stage?.remove()
    }
  }
}
