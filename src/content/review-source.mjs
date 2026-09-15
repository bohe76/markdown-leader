import MarkdownIt from 'markdown-it'
import { markdownComments } from './markdown-comments.mjs'

const parser = new MarkdownIt().use(markdownComments)
const start = '<!-- MARKDOWN-LEADER:NOTES:START'
const end = 'MARKDOWN-LEADER:NOTES:END -->'
const fields = ['id', 'quote', 'prefix', 'suffix', 'heading', 'text', 'createdAt']
function invalid() { return Object.assign(new Error('Invalid review source'), { code: 'review-invalid' }) }
function lines(raw) { return raw.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean) }
function validate(notes) {
  if (!Array.isArray(notes)) throw invalid()
  const ids = new Set()
  for (const note of notes) {
    if (!note || fields.some(key => typeof note[key] !== 'string') || !note.id || ids.has(note.id)) throw invalid()
    ids.add(note.id)
  }
}

export function parseReview(raw) {
  const tokens = parser.parse(raw.replace(/^\uFEFF/, ''), {})
  const reserved = tokens.filter(token => token.type === 'markdown_comment' && token.content.includes('MARKDOWN-LEADER:NOTES:'))
  const inlineReserved = tokens.some(token => token.children?.some(child => child.type === 'markdown_comment' && child.content.includes('MARKDOWN-LEADER:NOTES:')))
  if (inlineReserved || reserved.length > 1) throw invalid()
  if (!reserved.length) return { body: raw, notes: [] }
  const token = reserved[0]
  const offset = lines(raw).slice(0, token.map[0]).join('').length
  const tail = raw.slice(offset)
  const close = tail.indexOf(end)
  const region = close < 0 ? tail : tail.slice(0, close + end.length)
  const trailing = tail.slice(region.length)
  if (!region.startsWith(start) || !region.endsWith(end) || token.level !== 0 || /\S/.test(trailing)) throw invalid()
  let data
  try { data = JSON.parse(region.slice(start.length, -end.length)) } catch { throw invalid() }
  if (data.version !== 1 || !['\n\n', '\r\n\r\n', '\r\r'].includes(data.separator)) throw invalid()
  validate(data.notes)
  const before = raw.slice(0, offset)
  if (!before.endsWith(data.separator)) throw invalid()
  return { body: before.slice(0, -data.separator.length), notes: data.notes, ...(trailing ? { trailing } : {}) }
}

export function writeReview(raw, notes) {
  const { body, trailing = '' } = parseReview(raw)
  validate(notes)
  if (!notes.length) return body + trailing
  const newline = body.match(/\r\n|\r|\n/)?.[0] || '\n'
  const separator = newline + newline
  const json = JSON.stringify({ version: 1, separator, notes }, null, 2)
    .replace(/[<>&]/g, value => ({ '<': '\\u003c', '>': '\\u003e', '&': '\\u0026' })[value])
    .replace(/\n/g, newline)
  const result = body + separator + start + newline + json + newline + end + trailing
  if (parseReview(result).notes.length !== notes.length) throw invalid()
  return result
}

function taskLines(raw) {
  const tokens = parser.parse(parseReview(raw).body.replace(/^\uFEFF/, ''), {})
  return new Set(tokens.filter((token, i) => token.type === 'inline' &&
    tokens[i - 1]?.type === 'paragraph_open' && tokens[i - 2]?.type === 'list_item_open' &&
    /^\[[ xX]\] /.test(token.content)).map(token => token.map[0]))
}

export function patchTask(raw, line, checked) {
  if (!Number.isInteger(line) || !taskLines(raw).has(line)) throw invalid()
  const source = lines(raw)
  const match = /^(?:\uFEFF)?[ \t]*(?:>[ \t]*)*(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\]/.exec(source[line])
  if (!match) throw invalid()
  const index = match[0].length - 2
  source[line] = source[line].slice(0, index) + (checked ? 'x' : ' ') + source[line].slice(index + 1)
  return source.join('')
}

export function markdownReviewSource(md) {
  md.core.ruler.push('review-source', state => {
    for (const token of state.tokens) {
      if (token.map && (token.nesting === 1 || token.type === 'fence')) {
        token.attrSet('data-source-start', String(token.map[0]))
        token.attrSet('data-source-end', String(token.map[1]))
      }
      if (token.type === 'inline' && token.map) {
        for (const child of token.children || []) {
          if (child.type === 'html_inline' && child.content.startsWith('<input class="task-list-item-checkbox"')) {
            child.content = child.content.replace('<input ', `<input data-task-line="${token.map[0]}" `)
          }
        }
      }
    }
  })
}
