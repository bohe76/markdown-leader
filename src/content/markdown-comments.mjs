function commentInline(state, silent) {
  if (!state.src.startsWith('<!--', state.pos)) return false
  const end = state.src.indexOf('-->', state.pos + 4)
  if (end < 0 || end + 3 > state.posMax) return false
  if (!silent) {
    const token = state.push('markdown_comment', '', 0)
    token.content = state.src.slice(state.pos, end + 3)
    token.hidden = true
  }
  state.pos = end + 3
  return true
}

function commentBlock(state, startLine, endLine, silent) {
  if (state.sCount[startLine] - state.blkIndent >= 4) return false
  const start = state.bMarks[startLine] + state.tShift[startLine]
  if (!state.src.startsWith('<!--', start)) return false
  if (silent) return true

  let nextLine = startLine
  let trailing = ''
  for (; nextLine < endLine; nextLine++) {
    if (nextLine > startLine && state.sCount[nextLine] < state.blkIndent && !state.isEmpty(nextLine)) break
    const lineStart = state.bMarks[nextLine] + state.tShift[nextLine]
    const lineEnd = state.eMarks[nextLine]
    const line = state.src.slice(nextLine === startLine ? start + 4 : lineStart, lineEnd)
    const close = line.indexOf('-->')
    if (close >= 0) {
      trailing = line.slice(close + 3).trimStart()
      nextLine++
      break
    }
  }

  state.line = nextLine
  const comment = state.push('markdown_comment', '', 0)
  comment.block = true
  comment.hidden = true
  comment.map = [startLine, nextLine]
  comment.content = state.getLines(startLine, nextLine, state.blkIndent, true)

  // 닫는 주석 뒤의 본문은 HTML을 허용하지 않고 기존 인라인 파서로 읽는다.
  if (trailing) {
    state.push('paragraph_open', 'p', 1)
    const inline = state.push('inline', '', 0)
    inline.content = trailing
    inline.children = []
    state.push('paragraph_close', 'p', -1)
  }
  return true
}

export function markdownComments(md) {
  md.block.ruler.before('html_block', 'markdown_comment', commentBlock, {
    alt: ['paragraph', 'reference', 'blockquote'],
  })
  md.inline.ruler.before('html_inline', 'markdown_comment', commentInline)
  md.renderer.rules.markdown_comment = () => ''
}
