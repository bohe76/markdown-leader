import mermaid from 'mermaid'
import { isDiagramSourceAllowed } from './markdown-diagrams.mjs'

let queue = Promise.resolve()
let sequence = 0

export function renderDiagram(source, container, { isCurrent, colors = {} }) {
  const job = queue.then(async () => {
    if (!isCurrent() || !container.isConnected) return null
    if (!isDiagramSourceAllowed(source)) throw new Error('unsupported diagram source')
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: 50_000,
      maxEdges: 500,
      htmlLabels: false,
      theme: 'base',
      fontFamily: colors.fontFamily || 'system-ui, sans-serif',
      themeVariables: {
        darkMode: Boolean(colors.dark),
        ...(colors.background ? { background: colors.background, primaryColor: colors.background } : {}),
        ...(colors.text ? { primaryTextColor: colors.text, textColor: colors.text, lineColor: colors.text } : {}),
        ...(colors.border ? { primaryBorderColor: colors.border } : {}),
        ...(colors.primary ? { secondaryColor: colors.primary } : {}),
      },
      flowchart: { htmlLabels: false },
      deterministicIds: true,
    })
    const id = `ml-mermaid-${++sequence}`
    try {
      const { svg } = await mermaid.render(id, source, container)
      if (!isCurrent() || !container.isConnected) return null
      const template = container.ownerDocument.createElement('template')
      template.innerHTML = svg
      template.content.querySelectorAll('script, foreignObject, image, a, iframe, object, embed').forEach((node) => {
        if (node.localName === 'a') node.replaceWith(...node.childNodes)
        else node.remove()
      })
      for (const node of template.content.querySelectorAll('*')) {
        for (const attr of [...node.attributes]) {
          if (/^on/i.test(attr.name) || /href$/i.test(attr.name) || /url\s*\(\s*['"]?(?!#)/i.test(attr.value)) node.removeAttribute(attr.name)
        }
      }
      return template.innerHTML
    } finally {
      container.replaceChildren()
    }
  })
  queue = job.catch(() => {})
  return job
}
