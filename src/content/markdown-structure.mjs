function frontMatterRule(state, startLine) {
  if (state.parentType !== 'root' || startLine !== 0 || state.blkIndent !== 0) return false

  const opening = state.src.slice(state.bMarks[startLine], state.eMarks[startLine])
  if (!/^\uFEFF?---[ \t]*$/.test(opening)) return false

  let closingLine = -1
  let firstContent = ''
  for (let line = startLine + 1; line < state.lineMax; line += 1) {
    const value = state.src.slice(state.bMarks[line], state.eMarks[line])
    if (/^(?:---|\.\.\.)[ \t]*$/.test(value)) {
      closingLine = line
      break
    }
    const trimmed = value.trim()
    if (!firstContent && trimmed && !trimmed.startsWith('#')) firstContent = trimmed
  }

  if (closingLine < 0 || !/^[^#\s][^:]*:(?:[ \t]|$)/u.test(firstContent)) return false

  if (state.env && typeof state.env === 'object') {
    const contentStart = state.bMarks[startLine + 1]
    state.env.frontMatter = state.src.slice(contentStart, state.bMarks[closingLine])
  }
  state.line = closingLine + 1
  return true
}

function documentTocRule(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false

  const start = state.bMarks[startLine] + state.tShift[startLine]
  const line = state.src.slice(start, state.eMarks[startLine])
  if (!/^\[\[toc\]\][ \t]*$/i.test(line)) return false
  if (silent) return true

  const token = state.push('document_toc', 'nav', 0)
  token.block = true
  token.map = [startLine, startLine + 1]
  state.line = startLine + 1
  return true
}

export function markdownStructure(md, options = {}) {
  const tocLabel = typeof options.tocLabel === 'string' ? options.tocLabel : ''

  md.block.ruler.before('hr', 'front_matter', frontMatterRule)
  md.block.ruler.before('paragraph', 'document_toc', documentTocRule, {
    alt: ['paragraph', 'reference', 'blockquote'],
  })
  md.renderer.rules.document_toc = () => {
    const label = tocLabel ? ` aria-label="${md.utils.escapeHtml(tocLabel)}"` : ''
    return `<nav class="ml-document-toc"${label}></nav>\n`
  }
}

function headingTree(headings) {
  const roots = []
  const ancestors = []

  for (const heading of headings) {
    const level = Number(heading.tagName.slice(1))
    const node = { heading, level, children: [] }
    while (ancestors.length && ancestors.at(-1).level >= level) ancestors.pop()
    if (ancestors.length) ancestors.at(-1).children.push(node)
    else roots.push(node)
    ancestors.push(node)
  }

  return roots
}

function createTocList(document, nodes) {
  const list = document.createElement('ul')
  for (const node of nodes) {
    const item = document.createElement('li')
    const link = document.createElement('a')
    link.setAttribute('href', `#${encodeURIComponent(node.heading.id)}`)
    link.textContent = node.heading.textContent || ''
    item.append(link)
    if (node.children.length) item.append(createTocList(document, node.children))
    list.append(item)
  }
  return list
}

export function populateDocumentToc(content) {
  const placeholders = [...content.querySelectorAll('nav.ml-document-toc')]
  if (!placeholders.length) return

  const headings = [...content.querySelectorAll('h1,h2,h3,h4,h5,h6')]
  const tree = headingTree(headings)
  for (const placeholder of placeholders) {
    placeholder.replaceChildren()
    if (tree.length) placeholder.append(createTocList(content.ownerDocument, tree))
  }
}
