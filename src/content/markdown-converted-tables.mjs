const MAX_TABLE_SOURCE_LENGTH = 200_000
const MAX_TABLE_COLUMNS = 24
const MAX_TABLE_ROWS = 500

function parseAttributes(source) {
  const attributes = new Map()
  let position = 0

  while (position < source.length) {
    while (/\s/.test(source[position] || '') && position < source.length) position++
    if (position === source.length) break
    const match = /^[a-z-]+="[^"]*"/.exec(source.slice(position))
    if (!match) return null
    const [name, value] = /^([a-z-]+)="([^"]*)"$/.exec(match[0]).slice(1)
    if (attributes.has(name)) return null
    attributes.set(name, value)
    position += match[0].length
  }

  return attributes
}

function parseColumns(source) {
  const columns = []
  const pattern = /<col\b([^>]*)>/g
  let position = 0
  let match

  while ((match = pattern.exec(source))) {
    if (source.slice(position, match.index).trim()) return null
    const attributes = parseAttributes(match[1].replace(/\/\s*$/, ''))
    if (!attributes || attributes.size > 1) return null
    const width = attributes.get('width')
    if (width !== undefined && (!/^[1-9]\d{0,3}$/.test(width) || Number(width) > 2000)) return null
    columns.push(width === undefined ? null : Number(width))
    if (columns.length > MAX_TABLE_COLUMNS) return null
    position = pattern.lastIndex
  }

  if (source.slice(position).trim() || columns.length === 0) return null
  return columns
}

function parseRows(source, columnCount) {
  const rows = []
  const rowPattern = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/g
  let position = 0
  let rowMatch

  while ((rowMatch = rowPattern.exec(source))) {
    if (source.slice(position, rowMatch.index).trim()) return null
    const attributes = parseAttributes(rowMatch[1])
    if (!attributes || attributes.size > 1 || (attributes.size && attributes.get('color') !== 'gray_bg')) return null

    const cells = []
    const cellPattern = /<td>([\s\S]*?)<\/td>/g
    let cellPosition = 0
    let cellMatch
    while ((cellMatch = cellPattern.exec(rowMatch[2]))) {
      if (rowMatch[2].slice(cellPosition, cellMatch.index).trim()) return null
      if (/<\/?(?:table|colgroup|col|thead|tbody|tr|td|th)\b/i.test(cellMatch[1])) return null
      cells.push(cellMatch[1])
      cellPosition = cellPattern.lastIndex
    }
    if (rowMatch[2].slice(cellPosition).trim() || cells.length !== columnCount) return null

    rows.push({ color: attributes.get('color') || null, cells })
    if (rows.length > MAX_TABLE_ROWS) return null
    position = rowPattern.lastIndex
  }

  if (source.slice(position).trim() || rows.length === 0 || rows.some((row, index) => row.color && index !== 0)) return null
  return rows
}

function parseConvertedTable(source) {
  if (source.length > MAX_TABLE_SOURCE_LENGTH) return null
  const match = /^<table\b([^>]*)>([\s\S]*)<\/table>$/.exec(source.trim())
  if (!match) return null

  const attributes = parseAttributes(match[1])
  if (!attributes || attributes.size !== 2 || attributes.get('fit-page-width') !== 'true' || attributes.get('header-row') !== 'true') return null

  const colgroup = /^<colgroup>([\s\S]*?)<\/colgroup>([\s\S]*)$/.exec(match[2].trim())
  if (!colgroup) return null
  const columns = parseColumns(colgroup[1])
  if (!columns) return null
  const rows = parseRows(colgroup[2], columns.length)
  if (!rows) return null
  return { columns, rows }
}

function pushToken(state, tokens, type, tag, nesting, level, map = null) {
  const token = new state.Token(type, tag, nesting)
  token.block = true
  token.level = level
  if (map) token.map = map
  tokens.push(token)
  return token
}

function appendRow(state, tokens, cells, cellTag, baseLevel, map) {
  pushToken(state, tokens, 'tr_open', 'tr', 1, baseLevel + 2)
  for (const content of cells) {
    const open = pushToken(state, tokens, `${cellTag}_open`, cellTag, 1, baseLevel + 3)
    if (cellTag === 'th') open.attrSet('scope', 'col')
    const inline = pushToken(state, tokens, 'inline', '', 0, baseLevel + 4, map)
    inline.content = content
    inline.children = []
    pushToken(state, tokens, `${cellTag}_close`, cellTag, -1, baseLevel + 3)
  }
  pushToken(state, tokens, 'tr_close', 'tr', -1, baseLevel + 2)
}

function createTableTokens(state, table, baseLevel, map) {
  const tokens = []
  const open = pushToken(state, tokens, 'table_open', 'table', 1, baseLevel, map)
  open.attrSet('width', '100%')
  pushToken(state, tokens, 'colgroup_open', 'colgroup', 1, baseLevel + 1)
  for (const width of table.columns) {
    const column = pushToken(state, tokens, 'col', 'col', 0, baseLevel + 2)
    if (width !== null) column.attrSet('width', String(width))
  }
  pushToken(state, tokens, 'colgroup_close', 'colgroup', -1, baseLevel + 1)

  pushToken(state, tokens, 'thead_open', 'thead', 1, baseLevel + 1)
  appendRow(state, tokens, table.rows[0].cells, 'th', baseLevel, map)
  pushToken(state, tokens, 'thead_close', 'thead', -1, baseLevel + 1)

  if (table.rows.length > 1) {
    pushToken(state, tokens, 'tbody_open', 'tbody', 1, baseLevel + 1)
    for (const row of table.rows.slice(1)) appendRow(state, tokens, row.cells, 'td', baseLevel, map)
    pushToken(state, tokens, 'tbody_close', 'tbody', -1, baseLevel + 1)
  }

  pushToken(state, tokens, 'table_close', 'table', -1, baseLevel)
  return tokens
}

function createEscapedBlockTokens(state, source, baseLevel, map) {
  const tokens = []
  pushToken(state, tokens, 'paragraph_open', 'p', 1, baseLevel, map)
  const inline = pushToken(state, tokens, 'inline', '', 0, baseLevel + 1, map)
  inline.content = source.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  inline.children = []
  pushToken(state, tokens, 'paragraph_close', 'p', -1, baseLevel)
  return tokens
}

export function markdownConvertedTables(md) {
  md.core.ruler.before('inline', 'markdown_leader_converted_tables', state => {
    const tokens = state.tokens
    for (let index = 0; index < tokens.length;) {
      const block = tokens[index]
      if (block.type === 'html_block' && /^<table\b/i.test(block.content.trim()) && /\b(?:fit-page-width|header-row)\s*=/i.test(block.content)) {
        const table = parseConvertedTable(block.content)
        const replacement = table
          ? createTableTokens(state, table, block.level, block.map)
          : createEscapedBlockTokens(state, block.content, block.level, block.map)
        tokens.splice(index, 1, ...replacement)
        index += replacement.length
        continue
      }

      if (index === 0 || index >= tokens.length - 1) {
        index++
        continue
      }
      const open = tokens[index - 1]
      const inline = tokens[index]
      const close = tokens[index + 1]
      if (open.type !== 'paragraph_open' || inline.type !== 'inline' || close.type !== 'paragraph_close') {
        index++
        continue
      }

      const table = parseConvertedTable(inline.content)
      if (!table) {
        index++
        continue
      }

      const replacement = createTableTokens(state, table, open.level, inline.map)
      tokens.splice(index - 1, 3, ...replacement)
      index = index - 1 + replacement.length
    }
  })
}
