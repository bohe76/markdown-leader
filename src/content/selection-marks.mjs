import { ATOM_CHAR, inlineProjection, toggleInlineMark } from './inline-marks.mjs'

// 화면 글자를 원본 인라인 투영과 같은 규칙으로 모은다. 수식·그림·각주 번호는 한 글자 원자다.
const ATOMS = '.ml-math, img, sup.footnote-ref'
const SKIPPED = 'button, input, [aria-hidden="true"], details, script, style, mjx-assistive-mml, .footnote-backref'

export function projectElement(element) {
  const units = []
  let text = ''
  let afterBreak = false
  const visit = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        // 강제 줄바꿈 뒤에 렌더러가 붙이는 줄바꿈 문자는 원본 투영에 없다.
        const offset = afterBreak && child.data.startsWith('\n') ? 1 : 0
        afterBreak = false
        const length = child.data.length - offset
        if (length) units.push({ node: child, offset, start: text.length, length })
        text += child.data.slice(offset)
      } else if (child.nodeType === 1 && !child.hasAttribute('data-ml-inline')) {
        if (child.matches(ATOMS)) {
          units.push({ node: child, start: text.length, length: 1, atom: true })
          text += ATOM_CHAR
          afterBreak = false
        } else if (child.localName === 'br') {
          units.push({ node: child, start: text.length, length: 1, atom: true })
          text += '\n'
          afterBreak = true
        } else if (!child.matches(SKIPPED)) visit(child)
      }
    }
  }
  visit(element)
  // 원본 인라인은 앞뒤 공백이 없다. 하위 목록 앞 줄바꿈이나 각주 복귀 링크 앞 공백처럼 렌더러가 블록 경계에 넣은 공백을 뺀다.
  const lead = text.match(/^[ \n]*/)[0].length
  const stop = text.length - text.match(/[ \n]*$/)[0].length
  if (lead === 0 && stop === text.length) return { text, units }
  const trimmed = []
  for (const unit of units) {
    const from = Math.max(unit.start, lead)
    const to = Math.min(unit.start + unit.length, stop)
    if (from >= to) continue
    trimmed.push(unit.atom ? { ...unit, start: unit.start - lead } : { ...unit, offset: unit.offset + from - unit.start, start: from - lead, length: to - from })
  }
  return { text: text.slice(lead, Math.max(lead, stop)), units: trimmed }
}

// 선택 경계가 투영 문자열의 몇 번째 글자인지 구한다. 원자 안의 경계는 원자 전체를 포함하도록 넓힌다.
export function boundaryIndex(units, container, offset, document, isEnd) {
  const point = document.createRange()
  point.setStart(container, offset)
  point.collapse(true)
  let index = 0
  for (const unit of units) {
    const [startNode, startOffset, endNode, endOffset] = unit.atom
      ? [unit.node.parentNode, [...unit.node.parentNode.childNodes].indexOf(unit.node), unit.node.parentNode, [...unit.node.parentNode.childNodes].indexOf(unit.node) + 1]
      : [unit.node, unit.offset, unit.node, unit.offset + unit.length]
    if (point.comparePoint(endNode, endOffset) <= 0) { index = unit.start + unit.length; continue }
    if (point.comparePoint(startNode, startOffset) >= 0) return unit.start
    if (!unit.atom && container === unit.node) return unit.start + Math.max(0, Math.min(unit.length, offset - unit.offset))
    return isEnd ? unit.start + unit.length : unit.start
  }
  return index
}

// 선택 범위가 걸친 인라인 블록과 블록별 글자 범위를 구한다.
export function selectedBlocks(content, range, document) {
  const blocks = []
  for (const element of content.querySelectorAll('[data-ml-inline]')) {
    if (!range.intersectsNode(element)) continue
    const { text, units } = projectElement(element)
    const start = boundaryIndex(units, range.startContainer, range.startOffset, document, false)
    const end = boundaryIndex(units, range.endContainer, range.endOffset, document, true)
    if (end > start && text.slice(start, end).trim()) blocks.push({ inline: Number(element.dataset.mlInline), text, start, end })
  }
  return blocks
}

export function inlineProjections(md, body) {
  return md.parse(body, {}).filter(token => token.type === 'inline').map(inlineProjection)
}

// 공백을 뺀 선택 글자가 모두 표시면 all, 하나도 없으면 none, 섞여 있으면 some이다.
function markCoverage(projections, blocks, kind) {
  const flags = blocks.flatMap((block) => {
    const projection = projections[block.inline]
    return projection.chars.slice(block.start, block.end).filter((char, i) => !/\s/.test(projection.text[block.start + i])).map(char => Boolean(char[kind]))
  })
  if (flags.every(Boolean)) return 'all'
  return flags.some(Boolean) ? 'some' : 'none'
}

// 화면 투영은 앞뒤 공백을 잘라 내므로(체크박스 항목의 앞 공백, 제목 끝 공백 등) 원본 투영의 같은 글자 위치로 옮긴다.
function alignBlock(projection, block) {
  if (!projection) return null
  if (projection.text === block.text) return block
  const lead = projection.text.length - projection.text.trimStart().length
  if (projection.text.trim() !== block.text) return null
  return { ...block, text: projection.text, start: block.start + lead, end: block.end + lead }
}

// 화면과 원본 투영이 일치하는 블록만 대상으로 삼는다. 맞지 않는 블록은 건너뛰고, 남는 블록이 없으면 표시를 막는다.
export function describeMarks(projections, blocks) {
  const usable = blocks.map(block => alignBlock(projections[block.inline], block)).filter(Boolean)
  if (!usable.length) return null
  return { blocks: usable, mark: markCoverage(projections, usable, 'mark'), ins: markCoverage(projections, usable, 'ins') }
}

// Word 서식 단축키처럼 모두 표시돼 있으면 해제하고, 그 밖에는 선택 전체에 적용한다.
export const shortcutTurnsOn = (state, kind) => state[kind] !== 'all'

// 모든 블록에 같은 표시를 켜거나 끈다. 한 블록이라도 실패하면 예외를 던져 아무것도 쓰지 않는다.
export function applyMarks(md, body, state, kind, on) {
  let next = body
  for (const block of state.blocks) {
    next = toggleInlineMark({ md, raw: next, inline: block.inline, start: block.start, end: block.end, kind, on })
  }
  return next
}
