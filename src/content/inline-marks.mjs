// 선택한 글자에 하이라이트(==)와 밑줄(<ins>)을 원본 Markdown에 직접 넣거나 뺀다.
// 모든 편집은 문서 전체를 다시 파싱해 글자와 표시 범위가 의도와 정확히 같을 때만 반환한다.
export const MARK_KINDS = {
  mark: { open: '==', close: '==', markups: ['=='] },
  ins: { open: '<ins>', close: '</ins>', markups: ['<ins>', '</ins>', '++'] },
}
export const ATOM_CHAR = '￼'
const ATOM_TYPES = new Set(['math_inline', 'image', 'footnote_ref'])
const OPAQUE_TYPES = new Set(['code_inline', 'emoji', 'softbreak', 'hardbreak'])
const TYPOGRAPHER = { '“': ['"'], '”': ['"'], '„': ['"'], '‘': ["'"], '’': ["'"], '–': ['--'], '—': ['---'], '…': ['...'], '©': ['(c)', '(C)'], '®': ['(r)', '(R)'], '™': ['(tm)', '(TM)'], '±': ['+-'] }

export function unsupportedMark() {
  return Object.assign(new Error('ML_MARK_UNSUPPORTED'), { code: 'mark-unsupported' })
}

const range = (token, start, end) => { token.meta = { ...token.meta, mlSrc: [start, end] } }
const srcOf = token => token.meta?.mlSrc

function unionTokens(previous, next) {
  const a = srcOf(previous), b = srcOf(next)
  if (a && b) range(next, Math.min(a[0], b[0]), Math.max(a[1], b[1]))
  else if (next.meta) delete next.meta.mlSrc
}

function joinText(tokens) {
  let last = 0
  for (let curr = 0; curr < tokens.length; curr++) {
    if (tokens[curr].type === 'text' && tokens[curr + 1]?.type === 'text') {
      tokens[curr + 1].content = tokens[curr].content + tokens[curr + 1].content
      unionTokens(tokens[curr], tokens[curr + 1])
    } else tokens[last++] = tokens[curr]
  }
  tokens.length = last
}

// 인라인 토큰마다 원본 위치를 기록하는 별도 파서 설정이다. 화면 렌더링 파서에는 넣지 않는다.
export function markdownSourcePositions(md) {
  md.inline.tokenize = function tokenize(state) {
    if (!state.mlTracked) {
      state.mlTracked = true
      const pushPending = state.pushPending
      state.pushPending = function () {
        const token = pushPending.call(this)
        range(token, this.mlPendingStart, this.mlPendingEnd)
        return token
      }
    }
    const rules = this.ruler.getRules('')
    const end = state.posMax
    const maxNesting = state.md.options.maxNesting
    while (state.pos < end) {
      const prevPos = state.pos
      if (state.pending) state.mlPendingEnd = prevPos
      else state.mlPendingStart = prevPos
      const before = state.tokens.length
      let ok = false
      if (state.level < maxNesting) {
        for (const rule of rules) {
          ok = rule(state, false)
          if (ok) {
            if (prevPos >= state.pos) throw new Error("inline rule didn't increment state.pos")
            break
          }
        }
      }
      if (ok) {
        for (let i = before; i < state.tokens.length; i++) if (!srcOf(state.tokens[i])) range(state.tokens[i], prevPos, state.pos)
        if (state.pos >= end) break
        continue
      }
      state.pending += state.src[state.pos++]
    }
    if (state.pending) {
      state.mlPendingEnd = state.pos
      state.pushPending()
    }
  }
  md.inline.ruler2.at('fragments_join', state => {
    let level = 0
    for (const token of state.tokens) {
      if (token.nesting < 0) level--
      token.level = level
      if (token.nesting > 0) level++
    }
    joinText(state.tokens)
  })
  // 작업 목록 플러그인이 내용을 바꾸기 전의 인라인 원문을 보존한다.
  md.core.ruler.after('inline', 'ml_inline_source', state => {
    for (const token of state.tokens) if (token.type === 'inline') token.meta = { ...token.meta, mlContent: token.content }
  })
  md.core.ruler.at('text_join', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline') continue
      for (const token of block.children) {
        if (token.type === 'text_special') token.type = 'text'
        if (token.children) {
          for (const child of token.children) if (child.type === 'text_special') child.type = 'text'
          joinText(token.children)
        }
      }
      joinText(block.children)
    }
  })
  return md
}

function alignText(content, source) {
  if (content === source || content.length === source.length) return [...content].map((_, i) => i)
  const map = []
  let cursor = 0
  for (let i = 0; i < content.length; i++) {
    const char = content[i]
    const options = [char, ...(TYPOGRAPHER[char] || [])]
    let found = -1
    for (let j = cursor; j < Math.min(source.length, cursor + 12) && found < 0; j++) {
      const option = options.find(value => source.startsWith(value, j))
      if (option) { found = j; map.push(j); cursor = j + option.length }
    }
    if (found < 0) return null
  }
  return map
}

// 화면 글자와 같은 순서의 투영 문자열·표시 상태·원본 위치를 만든다.
export function inlineProjection(token) {
  const source = token.meta?.mlContent ?? token.content
  const children = token.children || []
  const spans = children.map(child => srcOf(child))
  for (let i = 0; i < children.length; i++) {
    if (spans[i]) continue
    const start = spans.slice(0, i).reverse().find(Boolean)?.[1] ?? 0
    const end = spans.slice(i + 1).find(Boolean)?.[0] ?? source.length
    spans[i] = [start, Math.max(start, end)]
  }
  const chars = []
  const delimiters = []
  const depth = { mark: 0, ins: 0 }
  const nesting = []
  let text = ''
  const push = (char, start, end, atom) => {
    text += char
    chars.push({ start, end, atom, mark: depth.mark > 0, ins: depth.ins > 0, scope: nesting.join('/') })
  }
  children.forEach((child, i) => {
    const [start, end] = spans[i]
    const kind = child.type.startsWith('mark_') ? 'mark' : child.type.startsWith('ins_') ? 'ins' : null
    if (kind) {
      if (child.nesting === 1) depth[kind]++
      else depth[kind]--
      delimiters.push({ kind, nesting: child.nesting, start, end, markup: child.markup })
      return
    }
    if (child.nesting === 1) { nesting.push(child.type); return }
    if (child.nesting === -1) { nesting.pop(); return }
    if (child.type === 'text') {
      const map = alignText(child.content, source.slice(start, end))
      for (let k = 0; k < child.content.length; k++) {
        if (map) push(child.content[k], start + map[k], start + map[k] + 1, false)
        else push(child.content[k], start, end, true)
      }
    } else if (ATOM_TYPES.has(child.type)) push(ATOM_CHAR, start, end, true)
    else if (OPAQUE_TYPES.has(child.type)) {
      const value = child.type.endsWith('break') ? '\n' : child.content
      for (const char of value) push(char, start, end, true)
    }
  })
  return { source, text, chars, delimiters }
}

function lineTable(raw) {
  const lines = raw.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean)
  let offset = 0
  return lines.map(line => {
    const body = line.replace(/\r\n|\r|\n$/, '')
    const item = { start: offset, body }
    offset += line.length
    return item
  })
}

function tableCells(body) {
  const cells = []
  let start = 0
  for (let i = 0; i <= body.length; i++) {
    if (i < body.length && (body[i] !== '|' || body[i - 1] === '\\')) continue
    cells.push([start, i])
    start = i + 1
  }
  if (/^\s*$/.test(body.slice(...cells[0]))) cells.shift()
  if (cells.length && /^\s*$/.test(body.slice(...cells.at(-1)))) cells.pop()
  return cells
}

// 인라인 원문의 각 줄이 원본 문서의 어느 위치에 있는지 찾는다.
function contentSegments(raw, tokens, index) {
  const token = tokens[index]
  const source = token.meta?.mlContent ?? token.content
  const lines = lineTable(raw)
  const parts = source.split('\n')
  if (!token.map) {
    let row = null
    let cell = 0
    for (let i = index - 1; i >= 0; i--) {
      if (tokens[i].type === 'tr_open') { row = tokens[i]; break }
      if (tokens[i].type === 'td_open' || tokens[i].type === 'th_open') cell++
    }
    if (!row?.map || parts.length !== 1) throw unsupportedMark()
    const line = lines[row.map[0]]
    const span = tableCells(line.body)[cell - 1]
    if (!span) throw unsupportedMark()
    const segment = line.body.slice(...span)
    const offset = segment.indexOf(source)
    if (offset < 0 || segment.trim() !== source) throw unsupportedMark()
    return [{ start: line.start + span[0] + offset, length: source.length }]
  }
  // 경고 제목 줄처럼 내용에서 빠진 원본 줄은 건너뛰며 순서대로 맞춘다. 정의 용어는 빈 줄 범위를 가진다.
  const limit = Math.max(token.map[1], token.map[0] + parts.length)
  let cursor = token.map[0]
  return parts.map((part, i) => {
    for (; cursor < limit && lines[cursor]; cursor++) {
      const line = lines[cursor]
      const body = i === parts.length - 1 ? line.body.trimEnd() : line.body
      let offset = body.length - part.length
      if (offset < 0 || body.slice(offset) !== part) offset = part ? line.body.indexOf(part) : -1
      if (offset < 0) continue
      cursor++
      return { start: line.start + offset, length: part.length }
    }
    throw unsupportedMark()
  })
}

function spliceContent(raw, segments, next) {
  const parts = next.split('\n')
  if (parts.length !== segments.length) throw unsupportedMark()
  let result = raw
  for (let i = segments.length - 1; i >= 0; i--) {
    result = result.slice(0, segments[i].start) + parts[i] + result.slice(segments[i].start + segments[i].length)
  }
  return result
}

function inlineTokens(md, raw) {
  const tokens = md.parse(raw, {})
  return { tokens, inlines: tokens.map((token, index) => ({ token, index })).filter(item => item.token.type === 'inline') }
}

const sameFlags = (projection, kind, expected) => projection.chars.every((char, i) => char[kind] === expected[i])

// 파서는 `<ins>`를 따로 여닫는 토큰으로 읽어 `==<ins>가== 나</ins>`처럼 엇갈린 표기도 통과시킨다.
// 브라우저는 엇갈린 태그를 고치며 밑줄을 하이라이트 안에서 끊으므로 두 표시가 안팎으로 바르게 겹치는지 확인한다.
function nestedMarks(token) {
  const stack = []
  for (const child of token.children || []) {
    const match = /^(mark|ins)_(open|close)$/.exec(child.type)
    if (!match) continue
    if (match[2] === 'open') stack.push(match[1])
    else if (stack.pop() !== match[1]) return false
  }
  return stack.length === 0
}

function snap(chars, start, end) {
  const same = (a, b) => a && b && a.atom && b.atom && a.start === b.start && a.end === b.end
  while (start > 0 && start < chars.length && same(chars[start - 1], chars[start])) start--
  while (end > 0 && end < chars.length && same(chars[end - 1], chars[end])) end++
  return [start, end]
}

function runsOf(flags, chars) {
  const runs = []
  for (let i = 0; i < flags.length; i++) {
    if (!flags[i] || flags[i - 1]) continue
    let end = i
    while (flags[end]) end++
    let start = i
    let stop = end
    while (start < stop && /\s/.test(chars[start].char)) start++
    while (stop > start && /\s/.test(chars[stop - 1].char)) stop--
    if (start < stop) runs.push([start, stop])
  }
  return runs
}

// 굵게·링크 같은 다른 문법의 경계에서 나눈다. 한 표기로 감싸면 그 문법과 엇갈릴 때 쓴다.
function splitByScope(chars, [start, end]) {
  const parts = []
  let from = start
  for (let i = start + 1; i <= end; i++) {
    if (i < end && chars[i].scope === chars[from].scope) continue
    parts.push(...runsOf(chars.map((_, k) => k >= from && k < i), chars))
    from = i
  }
  return parts
}

// 공백만 사이에 둔 같은 종류 표시는 한 번에 고른 것처럼 하나로 잇는다.
function joinRuns(runs, chars) {
  const joined = []
  for (const run of runs) {
    const last = joined.at(-1)
    if (last && chars.slice(last[1], run[0]).every(char => /\s/.test(char.char))) last[1] = run[1]
    else joined.push([...run])
  }
  return joined
}

// 안쪽 표시를 바깥 표시의 경계에서 잘라 바깥 안에 온전히 들어가거나 밖에 놓이게 한다.
function cutAt(chars, [start, end], edges) {
  const cuts = [start, ...edges.filter(edge => edge > start && edge < end).sort((a, b) => a - b), end]
  return cuts.slice(1).flatMap((stop, i) => runsOf(chars.map((_, k) => k >= cuts[i] && k < stop), chars))
}

// 서로 겹치는 표시끼리 묶어 묶음마다 안팎을 정한다.
// 표기 쌍이 적은 쪽을 고르고, 같으면 먼저 시작한 표시, 시작도 같으면 긴 표시, 길이도 같으면 밑줄을 바깥에 둔다.
// 단어 안에서 `==`가 태그와 글자 사이에 끼면 표시로 읽히지 않으므로, 그때는 flip으로 반대 안팎을 쓴다.
function nestRuns(chars, runs, flip) {
  const items = [...runs.mark.map(run => ({ kind: 'mark', run })), ...runs.ins.map(run => ({ kind: 'ins', run }))]
    .sort((a, b) => a.run[0] - b.run[0] || b.run[1] - a.run[1])
  const groups = []
  for (const item of items) {
    const group = groups.at(-1)
    if (group && item.run[0] < group.end) { group.items.push(item); group.end = Math.max(group.end, item.run[1]) }
    else groups.push({ items: [item], end: item.run[1] })
  }
  return groups.flatMap(({ items }) => {
    const option = (outer) => {
      const outers = items.filter(item => item.kind === outer).map(item => item.run)
      const inners = items.filter(item => item.kind !== outer).flatMap(item => cutAt(chars, item.run, outers.flat()).map(run => ({ kind: item.kind, run })))
      return [...outers.map(run => ({ kind: outer, run, outer: true })), ...inners.map(item => ({ ...item, outer: false }))]
    }
    const [byMark, byIns] = [option('mark'), option('ins')]
    const pick = (markFirst) => (markFirst !== Boolean(flip) ? byMark : byIns)
    if (byMark.length !== byIns.length) return pick(byMark.length < byIns.length)
    const first = kind => items.find(item => item.kind === kind)?.run
    const [mark, ins] = [first('mark'), first('ins')]
    if (!mark || !ins) return byIns
    if (mark[0] !== ins[0]) return pick(mark[0] < ins[0])
    return pick(mark[1] - mark[0] > ins[1] - ins[0])
  })
}

// 표기를 넣을 자리는 글자 사이 원문 틈의 안쪽(inward) 또는 바깥쪽(outward) 끝이다.
// `**굵게**`를 통째로 감쌀 때는 바깥쪽, `**굵게**뒤`의 뒤만 감쌀 때는 안쪽이 맞다.
function writeMarks(content, chars, placed, outward) {
  const events = placed.flatMap(({ kind, run: [a, b], outer }) => {
    const open = outward && a > 0 ? chars[a - 1].end : outward ? 0 : chars[a].start
    const close = outward && b < chars.length ? chars[b].start : outward ? content.length : chars[b - 1].end
    // 같은 자리에서는 안쪽 닫기, 바깥 닫기, 바깥 열기, 안쪽 열기 순서가 되도록 뒤에서부터 넣는다.
    return [{ at: open, rank: outer ? 2 : 3, text: MARK_KINDS[kind].open }, { at: close, rank: outer ? 1 : 0, text: MARK_KINDS[kind].close }]
  }).sort((x, y) => y.at - x.at || y.rank - x.rank)
  let built = content
  for (const event of events) built = built.slice(0, event.at) + event.text + built.slice(event.at)
  return built
}

// 다른 블록은 글자·표시가 그대로이고, 대상 블록은 두 표시가 바르게 겹치며 의도한 상태와 같은지 확인한다.
function matchesMarks(md, raw, baseline, target, flags) {
  let parsed
  try { parsed = inlineTokens(md, raw) } catch { return false }
  if (parsed.inlines.length !== baseline.length) return false
  if (!nestedMarks(parsed.inlines[target].token)) return false
  return baseline.every((before, i) => {
    const projection = inlineProjection(parsed.inlines[i].token)
    if (projection.text !== before.text) return false
    return Object.keys(MARK_KINDS).every(kind => (i === target
      ? projection.chars.every((char, k) => char[kind] === flags[kind][k] || /\s/.test(before.text[k]))
      : sameFlags(projection, kind, before.chars.map(char => char[kind]))))
  })
}

/**
 * 인라인 블록 하나의 [start, end) 투영 범위를 켜거나 끈 원본을 돌려준다.
 * 덧대지 않고, 바뀐 뒤의 표시 상태에서 그 블록의 하이라이트·밑줄 표기를 처음부터 다시 쓴다.
 * 그래서 어떤 순서로 작업했든 같은 표시 상태는 같은 원문이 된다. 다른 블록의 원문은 바꾸지 않는다.
 * @param {{ md: any, raw: string, inline: number, start: number, end: number, kind: 'mark' | 'ins', on: boolean }} options
 */
export function toggleInlineMark({ md, raw, inline, start, end, kind, on }) {
  if (!MARK_KINDS[kind]) throw unsupportedMark()
  const initial = inlineTokens(md, raw)
  const target = initial.inlines[inline]
  if (!target) throw unsupportedMark()
  const baseline = initial.inlines.map(item => inlineProjection(item.token))
  const projection = baseline[inline]
  ;[start, end] = snap(projection.chars, Math.max(0, start), Math.min(projection.chars.length, end))
  const flags = { mark: projection.chars.map(char => char.mark), ins: projection.chars.map(char => char.ins) }
  flags[kind] = flags[kind].map((flag, i) => (i >= start && i < end ? on : flag))
  if (flags[kind].every((flag, i) => flag === projection.chars[i][kind]) && nestedMarks(target.token)) return raw
  const segments = contentSegments(raw, initial.tokens, target.index)
  if (spliceContent(raw, segments, projection.source) !== raw) throw unsupportedMark()

  // 대상 블록의 하이라이트·밑줄 표기를 모두 걷어낸다.
  let content = projection.source
  for (const item of [...projection.delimiters].sort((a, b) => b.start - a.start)) {
    if (!MARK_KINDS[item.kind].markups.includes(content.slice(item.start, item.end))) throw unsupportedMark()
    content = content.slice(0, item.start) + content.slice(item.end)
  }
  const bare = inlineTokens(md, spliceContent(raw, segments, content)).inlines[inline]
  if (!bare) throw unsupportedMark()
  const plain = inlineProjection(bare.token)
  if (plain.source !== content || plain.text !== projection.text) throw unsupportedMark()
  const chars = plain.chars.map((char, i) => ({ ...char, char: plain.text[i] }))

  // 기준 안팎을 먼저 쓰고, 성립하지 않으면 반대 안팎으로 바꾼다. 자리는 안쪽, 바깥쪽, 다른 문법 경계에서 나눈 안쪽 순서다.
  for (const [outward, split, flip] of [false, true].flatMap(flip => [[false, false, flip], [true, false, flip], [false, true, flip]])) {
    const runs = Object.fromEntries(Object.keys(MARK_KINDS).map(name => {
      const list = joinRuns(runsOf(flags[name], chars), chars)
      return [name, split ? list.flatMap(run => splitByScope(chars, run)) : list]
    }))
    const working = spliceContent(raw, segments, writeMarks(content, chars, nestRuns(chars, runs, flip), outward))
    if (matchesMarks(md, working, baseline, inline, flags)) return working
  }
  throw unsupportedMark()
}
