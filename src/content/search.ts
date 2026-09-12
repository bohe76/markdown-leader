const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT',
  'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3',
  'H4', 'H5', 'H6', 'HEADER', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE',
  'SECTION', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

const EXCLUDED_TAGS = new Set(['BUTTON', 'SCRIPT', 'STYLE'])

interface TextSegment {
  nodes: Text[]
  text: string
}

function clearMatches(root: HTMLElement): void {
  const parents = new Set<Node>()

  root.querySelectorAll<HTMLElement>('mark.ml-match').forEach((mark) => {
    const parent = mark.parentNode
    if (!parent) return
    parents.add(parent)
    mark.replaceWith(mark.ownerDocument.createTextNode(mark.textContent || ''))
  })

  parents.forEach((parent) => parent.normalize())
}

function isExcluded(node: Text, root: HTMLElement): boolean {
  for (let element = node.parentElement; element && element !== root; element = element.parentElement) {
    if (EXCLUDED_TAGS.has(element.tagName) || element.matches('.katex, .ml-math[data-math-state="pending"], .ml-diagram-output, .ml-diagram-stage, .ml-pdf-repeat')) return true
  }
  return EXCLUDED_TAGS.has(root.tagName)
}

function blockFor(node: Text, root: HTMLElement): HTMLElement {
  for (let element = node.parentElement; element && element !== root; element = element.parentElement) {
    if (BLOCK_TAGS.has(element.tagName)) return element
  }
  return root
}

function textSegments(root: HTMLElement): TextSegment[] {
  const segments: TextSegment[] = []
  const walker = root.ownerDocument.createTreeWalker(root, 4)
  let currentBlock: HTMLElement | null = null
  let current: TextSegment | null = null

  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    if (isExcluded(text, root)) {
      currentBlock = null
      current = null
      continue
    }

    const block = blockFor(text, root)
    if (block !== currentBlock || !current) {
      currentBlock = block
      current = { nodes: [], text: '' }
      segments.push(current)
    }
    current.nodes.push(text)
    current.text += text.data
  }

  return segments
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wrapRange(node: Text, start: number, end: number): HTMLElement {
  let matched = node
  if (start > 0) matched = node.splitText(start)
  if (end - start < matched.data.length) matched.splitText(end - start)

  const mark = node.ownerDocument.createElement('mark')
  mark.className = 'ml-match'
  matched.replaceWith(mark)
  mark.append(matched)
  return mark
}

export function highlightMatches(root: HTMLElement, query: string): HTMLElement[][] {
  clearMatches(root)
  if (!query) return []

  const pattern = new RegExp(escapeRegExp(query), 'giu')
  const groups: HTMLElement[][] = []

  for (const segment of textSegments(root)) {
    const offsets: number[] = []
    let offset = 0
    for (const node of segment.nodes) {
      offsets.push(offset)
      offset += node.data.length
    }

    const matches = [...segment.text.matchAll(pattern)]
    const segmentGroups: HTMLElement[][] = new Array(matches.length)

    for (let matchIndex = matches.length - 1; matchIndex >= 0; matchIndex -= 1) {
      const match = matches[matchIndex]
      const start = match.index
      const end = start + match[0].length
      const marks: HTMLElement[] = []

      for (let nodeIndex = 0; nodeIndex < segment.nodes.length; nodeIndex += 1) {
        const node = segment.nodes[nodeIndex]
        const nodeStart = offsets[nodeIndex]
        const nodeEnd = nodeStart + node.data.length
        const intersectionStart = Math.max(start, nodeStart)
        const intersectionEnd = Math.min(end, nodeEnd)
        if (intersectionStart >= intersectionEnd) continue

        marks.push(wrapRange(
          node,
          intersectionStart - nodeStart,
          intersectionEnd - nodeStart,
        ))
      }

      segmentGroups[matchIndex] = marks
    }

    groups.push(...segmentGroups)
  }

  return groups
}

export function searchableText(root: HTMLElement): string {
  return textSegments(root).map((segment) => segment.text).join('\n')
}
