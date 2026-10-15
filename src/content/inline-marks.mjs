// 선택한 글자에 하이라이트(==)와 밑줄(<ins>)을 원본 Markdown에 직접 넣거나 뺀다.
// 모든 편집은 문서 전체를 다시 파싱해 글자와 표시 범위가 의도와 정확히 같을 때만 반환한다.
// 하이라이트는 `==`가 기본이고, `==`가 Markdown 규칙상 성립하지 않는 자리에서만 <mark> 태그를 쓴다.
export const MARK_KINDS = {
  mark: { open: '==', close: '==', tags: { open: '<mark>', close: '</mark>' }, markups: ['==', '<mark>', '</mark>'] },
  ins: { open: '<ins>', close: '</ins>', markups: ['<ins>', '</ins>', '++'] },
}
export const ATOM_CHAR = '￼'
const ATOM_TYPES = new Set(['math_inline', 'image', 'footnote_ref'])
const OPAQUE_TYPES = new Set(['code_inline', 'emoji', 'softbreak', 'hardbreak'])
// typographer가 한 글자를 한 글자로 바꾸는 유일한 경우인 따옴표다. 나머지 치환은 원문 길이가 줄어든다.
const QUOTES = { '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'" }
// typographer가 여러 글자를 한 글자로 바꾸는 입력이다. 긴 것부터 맞추고 괄호 약어는 대소문자를 가리지 않는다.
const REPLACEMENTS = { '…': ['...', '..'], '—': ['---'], '–': ['--'], '©': ['(c)'], '®': ['(r)'], '™': ['(tm)'], '±': ['+-'] }
// 치환 글자가 다시 맞는 자리를 찾을 때 원문에서 내다보는 최대 길이다.
const RESYNC_WINDOW = 32
// 작업 목록 플러그인이 인라인 내용 앞에서 잘라 내는 표식이다.
const TASK_MARKER_RE = /^\[[ xX]\]$/
const TASK_HTML_RE = /^(?:<input class="task-list-item-checkbox"|<label\b|<\/label>)/

export function unsupportedMark() {
  return Object.assign(new Error('ML_MARK_UNSUPPORTED'), { code: 'mark-unsupported' })
}

const range = (token, start, end) => { token.meta = { ...token.meta, mlSrc: [start, end] } }
const srcOf = token => token.meta?.mlSrc

function unionTokens(previous, next) {
  const a = srcOf(previous), b = srcOf(next)
  const maps = [previous.meta?.mlMap, next.meta?.mlMap]
  if (a && b) range(next, Math.min(a[0], b[0]), Math.max(a[1], b[1]))
  else if (next.meta) delete next.meta.mlSrc
  // 앞 토큰은 버려지므로 그 배열에 덧붙여 긴 줄에서 복사가 누적되지 않게 한다.
  if (maps[0] && maps[1]) { for (const item of maps[1]) maps[0].push(item); next.meta.mlMap = maps[0] }
  else if (next.meta) delete next.meta.mlMap
}

// 한 규칙이 토큰 여러 개를 넣으면(`====`의 `==` 둘처럼) 길이 합이 소비한 원문과 같을 때 차례로 나눠 준다.
function assignRuleRanges(tokens, from, start, end) {
  const pushed = tokens.slice(from).filter(token => !srcOf(token))
  const lengths = pushed.map(token => (token.markup || token.content || '').length)
  if (pushed.length > 1 && lengths.reduce((sum, length) => sum + length, 0) === end - start) {
    let at = start
    pushed.forEach((token, i) => { range(token, at, at + lengths[i]); at += lengths[i] })
    return
  }
  // 링크처럼 안쪽 토큰이 이미 위치를 가지면 여닫는 토큰은 안쪽 바깥의 양 끝(`[`와 `](url)`)만 차지한다. 이 규칙이 넣은 토큰만 본다.
  const inner = pushed.length === 2 && pushed[1] === tokens.at(-1) ? tokens.slice(tokens.indexOf(pushed[0], from) + 1, -1).map(srcOf) : []
  if (inner.length && inner.every(Boolean)) {
    range(pushed[0], start, Math.min(...inner.map(span => span[0])))
    range(pushed[1], Math.max(...inner.map(span => span[1])), end)
    return
  }
  for (const token of pushed) range(token, start, end)
}

// 원문 위치 없이 core 규칙이 만든 토큰이 차지하는 원문 길이다. 알 수 없는 종류는 null이다.
function rawLength(token) {
  if (token.type === 'text') return token.content.length
  if (token.type === 'emoji') return token.markup.length + 2
  if (token.type === 'link_open' || token.type === 'link_close') return token.markup === 'linkify' ? 0 : null
  if (token.type === 'html_inline' && TASK_HTML_RE.test(token.content)) return 0
  return null
}

// text 토큰의 글자마다 원문 범위를 적는다. entity·escape 같은 특수 글자는 표기 전체를 한 원자로 둔다.
// 이스케이프되지 않은 백슬래시(`\d`)처럼 원문 그대로인 특수 글자는 글자별로 두어 사이에서 넓히지 않는다.
function mapChars(token, source, special) {
  const span = srcOf(token)
  if (!span) return
  const [start, end] = span
  const literal = special && token.content === token.markup && token.content.length > 1
  const map = special ? null : alignText(token.content, source.slice(start, end))
  token.meta.mlMap = Array.from({ length: token.content.length }, (_, k) => {
    if (literal) return [start + k, start + k + 1, 'text']
    if (special) return [start, end, 'atom']
    if (!map) return [start, end, 'fallback']
    return [start + map[k][0], start + map[k][1], map[k][2] ? 'atom' : 'text']
  })
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
        const length = this.pending.length
        const token = pushPending.call(this)
        // linkify처럼 pending 끝을 잘라 낸 규칙은 잘린 길이만큼 자기 토큰 범위를 앞당긴다.
        const end = Math.min(this.mlPendingEnd, this.mlPendingStart + length)
        this.mlReclaimed = Math.max(0, this.mlPendingEnd - end)
        range(token, this.mlPendingStart, end)
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
        assignRuleRanges(state.tokens, before, prevPos - (state.mlReclaimed || 0), state.pos)
        state.mlReclaimed = 0
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
    const tokens = state.tokens
    // 강조 후처리는 `**`의 바깥 `*`를 내용 없는 text 토큰으로 남긴다. 그 범위를 이웃 굵게 구분자에 접어 넣어 뒤 글자의 범위가 넓어지지 않게 한다.
    let kept = 0
    for (let i = 0; i < tokens.length; i++) {
      const owner = tokens[i].type === 'text' && tokens[i].content === ''
        ? tokens[i + 1]?.type === 'strong_open' ? tokens[i + 1] : tokens[i - 1]?.type === 'strong_close' ? tokens[i - 1] : null
        : null
      if (owner) unionTokens(tokens[i], owner)
      else tokens[kept++] = tokens[i]
    }
    tokens.length = kept
    let level = 0
    for (const token of tokens) {
      if (token.nesting < 0) level--
      token.level = level
      if (token.nesting > 0) level++
    }
    joinText(tokens)
  })
  // 작업 목록 플러그인이 내용을 바꾸기 전의 인라인 원문을 보존한다.
  md.core.ruler.after('inline', 'ml_inline_source', state => {
    for (const token of state.tokens) if (token.type === 'inline') token.meta = { ...token.meta, mlContent: token.content }
  })
  // linkify·이모지 core 규칙은 text 토큰을 원문 위치 없이 쪼갠다. typographer 치환 전이라 내용 길이가 원문 길이와 같으므로 이웃 위치에서 차례로 복원한다.
  md.core.ruler.before('replacements', 'ml_inline_resync', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline') continue
      const source = block.meta?.mlContent ?? block.content
      const children = block.children
      // 작업 목록 플러그인은 첫 text 토큰의 내용에서 `[ ]` 표식만 잘라 내고 범위는 그대로 둔다. 범위를 표식 뒤로 좁힌다.
      const lead = children.find(child => child.type === 'text')
      const leadSpan = lead && srcOf(lead)
      if (leadSpan?.[0] === 0 && TASK_MARKER_RE.test(source.slice(0, 3)) && lead.content === source.slice(3, leadSpan[1])) range(lead, 3, leadSpan[1])
      for (let i = 0; i < children.length;) {
        if (srcOf(children[i])) { i++; continue }
        let j = i
        while (j < children.length && !srcOf(children[j])) j++
        const start = i > 0 ? srcOf(children[i - 1])[1] : 0
        const end = j < children.length ? srcOf(children[j])[0] : source.length
        const lengths = children.slice(i, j).map(rawLength)
        const extra = lengths.includes(null) ? -1 : end - start - lengths.reduce((sum, length) => sum + length, 0)
        // 작업 목록 플러그인이 잘라 낸 `[ ]` 표식만큼은 첫 구간 앞에 둔다.
        if (extra === 0 || (extra > 0 && start === 0 && TASK_MARKER_RE.test(source.slice(0, extra)))) {
          let at = start + extra
          children.slice(i, j).forEach((child, k) => { range(child, at, at + lengths[k]); at += lengths[k] })
        }
        i = j
      }
    }
  })
  md.core.ruler.at('text_join', state => {
    for (const block of state.tokens) {
      if (block.type !== 'inline') continue
      const source = block.meta?.mlContent ?? block.content
      for (const token of block.children) {
        if (token.type === 'text_special') { token.type = 'text'; mapChars(token, source, true) }
        else if (token.type === 'text') mapChars(token, source, false)
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

const sameChar = (sourceChar, contentChar) => sourceChar === contentChar || QUOTES[contentChar] === sourceChar

// 원문 j 위치에서 화면 글자가 차지하는 길이다. 같은 글자(따옴표 변형 포함)는 1, typographer 치환 입력이면 그 길이, 맞지 않으면 0이다.
function spanAt(source, j, char) {
  if (j >= source.length) return 0
  if (sameChar(source[j], char)) return 1
  const ahead = source.slice(j, j + 4).toLowerCase()
  return (REPLACEMENTS[char] || []).find(input => ahead.startsWith(input))?.length || 0
}

// 치환된 글자 다음의 화면 글자(최대 3개)가 원문에서 다시 맞는 자리를 찾는다. 남은 글자가 없으면 끝 공백 앞까지다.
function resyncAt(rest, source, from) {
  if (!rest) return Math.max(from, source.trimEnd().length)
  for (let probe = Math.min(3, rest.length); probe > 0; probe--) {
    for (let j = from; j <= Math.min(source.length - 1, from + RESYNC_WINDOW); j++) {
      let at = j
      let matched = 0
      while (matched < probe) {
        const span = spanAt(source, at, rest[matched])
        if (!span) break
        at += span
        matched++
      }
      if (matched === probe) return j
    }
  }
  return -1
}

// 화면 글자(code unit)마다 원문 [시작, 끝, 치환 여부]를 만든다. typographer가 바꾼 글자는 그 입력 전체를, 알 수 없는 치환은 다음 글자가 맞는 자리까지를 한 원자로 둔다.
function alignText(content, source) {
  if (content === source) return Array.from({ length: content.length }, (_, k) => [k, k + 1, false])
  const map = []
  let cursor = 0
  for (let i = 0; i < content.length; i++) {
    // 축약 치환(`????` → `???`)으로 버려진 반복 글자는 앞 글자의 꼬리로 보고 건너뛴다.
    while (cursor > 0 && cursor < source.length && source[cursor] === source[cursor - 1] && !spanAt(source, cursor, content[i])) cursor++
    const span = spanAt(source, cursor, content[i])
    if (span) { map.push([cursor, cursor + span, span > 1]); cursor += span; continue }
    const stop = resyncAt(content.slice(i + 1), source, cursor + 1)
    if (stop < 0) return null
    map.push([cursor, stop, true])
    cursor = stop
  }
  return map
}

// 화면 글자와 같은 순서의 투영 문자열·표시 상태·원본 위치를 만든다.
export function inlineProjection(token) {
  const source = token.meta?.mlContent ?? token.content
  const children = token.children || []
  // 위치가 없는 토큰은 위치가 있는 이웃 사이 범위를 받는다. 방금 채운 범위가 아니라 원래 있던 위치만 기준으로 삼는다.
  const known = children.map(child => srcOf(child))
  const spans = known.map((span, i) => {
    if (span) return span
    const start = known.slice(0, i).reverse().find(Boolean)?.[1] ?? 0
    const end = known.slice(i + 1).find(Boolean)?.[0] ?? source.length
    return [start, Math.max(start, end)]
  })
  const chars = []
  const delimiters = []
  const depth = { mark: 0, ins: 0 }
  const nesting = []
  let text = ''
  // fallback은 원문 위치를 맞추지 못해 토큰 전체를 한 묶음으로 둔 글자다. 그 안에서 선택을 넓히지 않는다.
  const push = (char, start, end, atom, fallback = false) => {
    text += char
    chars.push({ start, end, atom, fallback, mark: depth.mark > 0, ins: depth.ins > 0, scope: nesting.join('/') })
  }
  children.forEach((child, i) => {
    const [start, end] = spans[i]
    // 보간한 범위는 이웃과 겹칠 수 있으므로 그 글자로는 선택을 넓히지 않는다.
    const interpolated = !known[i]
    const kind = child.type.startsWith('mark_') ? 'mark' : child.type.startsWith('ins_') ? 'ins' : null
    if (kind) {
      if (child.nesting === 1) depth[kind]++
      else depth[kind]--
      delimiters.push({ kind, nesting: child.nesting, start, end, markup: child.markup })
      return
    }
    // 링크는 대상 주소까지 범위 이름에 넣어, 표기가 자동 링크를 끊고 나머지가 다른 링크로 읽히는 결과를 잡는다.
    if (child.nesting === 1) { nesting.push(child.type === 'link_open' ? `link_open(${child.attrGet('href') ?? ''})` : child.type); return }
    if (child.nesting === -1) { nesting.pop(); return }
    if (child.type === 'text') {
      const map = child.meta?.mlMap
        ?? alignText(child.content, source.slice(start, end))?.map(([from, to, atom]) => [start + from, start + to, atom ? 'atom' : 'text'])
      for (let k = 0; k < child.content.length; k++) {
        if (map) push(child.content[k], map[k][0], map[k][1], map[k][2] !== 'text', map[k][2] === 'fallback' || interpolated)
        else push(child.content[k], start, end, true, true)
      }
    } else if (ATOM_TYPES.has(child.type)) push(ATOM_CHAR, start, end, true, interpolated)
    else if (OPAQUE_TYPES.has(child.type)) {
      // 화면 선택은 UTF-16 code unit 단위이므로 보조 평면 글자도 code unit마다 한 칸씩 둔다.
      const value = child.type.endsWith('break') ? '\n' : child.content
      for (let k = 0; k < value.length; k++) push(value[k], start, end, true, interpolated)
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

// 파서는 `<ins>`·`<mark>`를 따로 여닫는 토큰으로 읽어 `==<ins>가== 나</ins>`나 `**굵게 <ins>글자** 뒤</ins>`처럼 엇갈린 표기도 통과시킨다.
// 브라우저는 엇갈린 태그를 고치며 뒤쪽 표시를 끊으므로, 쓴 결과(strict)는 굵게·링크를 포함한 모든 문법과 바르게 겹쳐야 한다.
// 바꿀 것이 없는 요청은 사용자가 엇갈리게 써 둔 블록도 그대로 두도록 두 표시끼리만 확인한다.
function nestedMarks(token, strict = false) {
  const stack = []
  for (const child of token.children || []) {
    if (!child.nesting) continue
    const name = child.type.replace(/_(?:open|close)$/, '')
    if (!strict && name !== 'mark' && name !== 'ins') continue
    if (child.nesting === 1) stack.push(name)
    else if (stack.pop() !== name) return false
  }
  return stack.length === 0
}

// 원자 안의 경계는 원자 전체를 포함하도록 넓힌다. 정렬에 실패한 글자 묶음은 상태가 바뀔 글자로 넓히지 않고 거부한다.
function snap(chars, start, end, kind, on) {
  const same = (a, b) => a && b && a.atom && b.atom && a.start === b.start && a.end === b.end
  const widen = char => { if (char.fallback && char[kind] !== on) throw unsupportedMark() }
  while (start > 0 && start < chars.length && same(chars[start - 1], chars[start])) { widen(chars[start - 1]); start-- }
  while (end > 0 && end < chars.length && same(chars[end - 1], chars[end])) { widen(chars[end]); end++ }
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

// 범위에 태그 표기 여부를 붙인다. 범위를 나눠도 원래 범위의 표기를 이어받는다.
const tagged = (run, tag) => Object.assign(run, { tag })

// 굵게·링크 같은 다른 문법의 경계에서 나눈다. 한 표기로 감싸면 그 문법과 엇갈릴 때 쓴다.
function splitByScope(chars, run) {
  const [start, end] = run
  const parts = []
  let from = start
  for (let i = start + 1; i <= end; i++) {
    if (i < end && chars[i].scope === chars[from].scope) continue
    parts.push(...runsOf(chars.map((_, k) => k >= from && k < i), chars).map(part => tagged(part, run.tag)))
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
function cutAt(chars, run, edges) {
  const [start, end] = run
  const cuts = [start, ...edges.filter(edge => edge > start && edge < end).sort((a, b) => a - b), end]
  return cuts.slice(1).flatMap((stop, i) => runsOf(chars.map((_, k) => k >= cuts[i] && k < stop), chars).map(part => tagged(part, run.tag)))
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
  const events = placed.flatMap(({ kind, run, outer }) => {
    const [a, b] = run
    const form = run.tag ? MARK_KINDS[kind].tags : MARK_KINDS[kind]
    const open = outward && a > 0 ? chars[a - 1].end : outward ? 0 : chars[a].start
    const close = outward && b < chars.length ? chars[b].start : outward ? content.length : chars[b - 1].end
    // 같은 자리에서는 안쪽 닫기, 바깥 닫기, 바깥 열기, 안쪽 열기 순서가 되도록 뒤에서부터 넣는다.
    return [{ at: open, rank: outer ? 2 : 3, text: form.open }, { at: close, rank: outer ? 1 : 0, text: form.close }]
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
  if (!nestedMarks(parsed.inlines[target].token, true)) return false
  return baseline.every((before, i) => {
    const projection = inlineProjection(parsed.inlines[i].token)
    if (projection.text !== before.text) return false
    // 표기를 넣고 빼면서 링크 같은 다른 문법이 생기거나 사라지면 안 된다.
    if (!projection.chars.every((char, k) => char.scope === before.chars[k].scope)) return false
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
  ;[start, end] = snap(projection.chars, Math.max(0, start), Math.min(projection.chars.length, end), kind, on)
  const flags = { mark: projection.chars.map(char => char.mark), ins: projection.chars.map(char => char.ins) }
  flags[kind] = flags[kind].map((flag, i) => (i >= start && i < end ? on : flag))
  if (flags[kind].every((flag, i) => flag === projection.chars[i][kind]) && nestedMarks(target.token)) return raw
  const segments = contentSegments(raw, initial.tokens, target.index)
  if (spliceContent(raw, segments, projection.source) !== raw) throw unsupportedMark()

  // 대상 블록의 하이라이트·밑줄 표기를 모두 걷어낸다.
  let content = projection.source
  for (const item of [...projection.delimiters].sort((a, b) => b.start - a.start)) {
    if (!MARK_KINDS[item.kind].markups.includes(content.slice(item.start, item.end).toLowerCase())) throw unsupportedMark()
    content = content.slice(0, item.start) + content.slice(item.end)
  }
  const bare = inlineTokens(md, spliceContent(raw, segments, content)).inlines[inline]
  if (!bare) throw unsupportedMark()
  const plain = inlineProjection(bare.token)
  if (plain.source !== content || plain.text !== projection.text) throw unsupportedMark()
  const chars = plain.chars.map((char, i) => ({ ...char, char: plain.text[i] }))

  // 기준 안팎을 먼저 쓰고, 성립하지 않으면 반대 안팎으로 바꾼다. 자리는 안쪽, 바깥쪽, 다른 문법 경계에서 나눈 안쪽 순서다.
  const attempt = (tagOf) => {
    for (const [outward, split, flip] of [false, true].flatMap(flip => [[false, false, flip], [true, false, flip], [false, true, flip]])) {
      const runs = Object.fromEntries(Object.keys(MARK_KINDS).map(name => {
        const list = joinRuns(runsOf(flags[name], chars), chars).map(run => tagged(run, name === 'mark' && tagOf(run)))
        return [name, split ? list.flatMap(run => splitByScope(chars, run)) : list]
      }))
      const working = spliceContent(raw, segments, writeMarks(content, chars, nestRuns(chars, runs, flip), outward))
      if (matchesMarks(md, working, baseline, inline, flags)) return working
    }
    return null
  }
  const written = attempt(() => false)
  if (written !== null) return written

  // `==`는 굵게 닫힘이나 괄호 같은 문장부호와 글자 사이에 끼면 표시로 읽히지 않는다.
  // 그 하이라이트 하나만 `==`로 써도 성립하지 않는 범위는 <mark> 태그로 쓰고, 그래도 안 되면 블록의 하이라이트를 모두 태그로 쓴다.
  const fits = run => [false, true].some(outward => {
    let block
    try { block = inlineTokens(md, spliceContent(raw, segments, writeMarks(content, chars, [{ kind: 'mark', run: tagged([...run], false), outer: true }], outward))).inlines[inline] } catch { return false }
    if (!block) return false
    const probe = inlineProjection(block.token)
    return probe.text === plain.text
      && probe.chars.every((char, i) => char.scope === chars[i].scope && (char.mark === (i >= run[0] && i < run[1]) || /\s/.test(plain.text[i])))
  })
  const markRuns = joinRuns(runsOf(flags.mark, chars), chars)
  const unfit = new Set(markRuns.filter(run => !fits(run)).map(String))
  const strategies = [...(unfit.size && unfit.size < markRuns.length ? [run => unfit.has(String(run))] : []), ...(markRuns.length ? [() => true] : [])]
  for (const tagOf of strategies) {
    const result = attempt(tagOf)
    if (result !== null) return result
  }
  throw unsupportedMark()
}
