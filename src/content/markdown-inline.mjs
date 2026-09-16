import { full as emoji } from 'markdown-it-emoji'
import inserted from 'markdown-it-ins'
import marked from 'markdown-it-mark'

function githubStrikethrough(state, silent) {
  if (silent || state.src.charCodeAt(state.pos) !== 0x7e) return false
  const scanned = state.scanDelims(state.pos, true)
  const markup = '~'.repeat(scanned.length)
  const token = state.push('text', '', 0)
  token.content = markup
  // GFM은 같은 길이의 한 개 또는 두 개 구분자만 짝지으며 세 개 이상은 문자다.
  if (scanned.length <= 2) {
    state.delimiters.push({
      marker: scanned.length === 1 ? 0x7e : 0x7e7e,
      length: 0,
      token: state.tokens.length - 1,
      end: -1,
      open: scanned.can_open,
      close: scanned.can_close,
    })
  }
  state.pos += scanned.length
  return true
}

function finishStrikethrough(state) {
  const groups = [state.delimiters, ...state.tokens_meta.map(meta => meta?.delimiters).filter(Boolean)]
  for (const delimiters of groups) {
    for (const delimiter of delimiters) {
      if (![0x7e, 0x7e7e].includes(delimiter.marker) || delimiter.end === -1) continue
      const open = state.tokens[delimiter.token]
      const close = state.tokens[delimiters[delimiter.end].token]
      for (const [token, nesting] of [[open, 1], [close, -1]]) {
        token.type = nesting === 1 ? 's_open' : 's_close'
        token.tag = 's'
        token.nesting = nesting
        token.markup = token.content
        token.content = ''
      }
    }
  }
}

function safeInlineTag(state, silent) {
  if (state.src.charCodeAt(state.pos) !== 0x3c) return false
  const match = /^(<br(?: ?\/)?>|<(\/?)(sub|sup|ins)>)/i.exec(state.src.slice(state.pos))
  if (!match) return false
  if (!silent) {
    if (!match[3]) {
      state.push('hardbreak', 'br', 0)
    } else {
      const token = state.push('text', '', 0)
      token.content = match[0]
      token.meta = { safeTag: match[3].toLowerCase(), closing: Boolean(match[2]) }
    }
  }
  state.pos += match[0].length
  return true
}

function finishSafeTags(state) {
  const stack = []
  for (const token of state.tokens) {
    if (!token.meta?.safeTag) continue
    if (!token.meta.closing) {
      stack.push(token)
      continue
    }
    const open = stack.at(-1)
    if (open?.meta.safeTag !== token.meta.safeTag) continue
    stack.pop()
    for (const [item, nesting] of [[open, 1], [token, -1]]) {
      item.tag = item.meta.safeTag
      item.type = `${item.tag}_${nesting === 1 ? 'open' : 'close'}`
      item.nesting = nesting
      item.markup = item.content
      item.content = ''
    }
  }
}

export function markdownInline(md) {
  md.use(emoji, { shortcuts: {} })
    .use(inserted)
    .use(marked)
  md.inline.ruler.at('strikethrough', githubStrikethrough)
  md.inline.ruler2.at('strikethrough', finishStrikethrough)
  md.inline.ruler.before('html_inline', 'safe_inline_tag', safeInlineTag)
  md.inline.ruler2.before('fragments_join', 'safe_inline_tag', finishSafeTags)
}
