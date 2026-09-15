// 화면과 인쇄에서 같은 페이지 DOM을 사용한다. 전체 페이지를 이미지로 변환하지 않는다.
export const PDF_CONTENT_STYLE = `
.ml-pdf-page { box-sizing: border-box; width: 210mm; height: 297mm; padding: 20mm;
  margin: 16px auto; background: var(--ml-surface); color: var(--ml-text);
  box-shadow: 0 0 0 1px var(--ml-border); break-inside: avoid; break-after: page; }
.ml-pdf-page:last-child { break-after: auto; }
.ml-pdf-page > .ml-document { display: flow-root; box-sizing: border-box; width: 170mm; max-width: none;
  min-height: 0; height: auto; padding: 0; margin: 0; border: 0; border-radius: 0; box-shadow: none;
  overflow: visible; background: transparent; }
.ml-pdf-content > :first-child { margin-top: 0; }
.ml-pdf-content > :last-child { margin-bottom: 0; }
.ml-pdf-content table { display: table; width: auto; max-width: 100%; table-layout: auto; overflow: visible; }
.ml-pdf-content { widows: 1; orphans: 1; }
.ml-pdf-content :is(th, td) { overflow-wrap: anywhere; }
.ml-pdf-content pre { white-space: pre-wrap; overflow-wrap: anywhere; overflow: visible; }
.ml-pdf-content pre code { white-space: inherit; overflow-wrap: inherit; }
.ml-pdf-content img { max-height: 257mm; object-fit: contain; }
.ml-pdf-content .ml-diagram-output { overflow: visible; }
.ml-pdf-content .ml-diagram-output > svg { max-height: none; }
.ml-pdf-content .ml-math-block { overflow: visible; }
.ml-pdf-content .ml-math-block > .katex-display { overflow: visible; }
.ml-pdf-content .ml-pdf-continuation { margin-top: 0; }
.ml-pdf-content li.ml-pdf-continuation { list-style: none; }
.ml-pdf-pages input[type=checkbox] { pointer-events: none; }
`

export const PDF_PAGE_STYLE = `
@page { size: A4; margin: 0; }
html { color-scheme: normal; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { margin: 0; padding: 0; min-width: 210mm; }
body { background: var(--ml-bg); }
${PDF_CONTENT_STYLE}
@media print {
  html, body { width: 210mm; min-width: 0; background: var(--ml-surface); }
  .ml-pdf-page { margin: 0; box-shadow: none; }
}
`

function deadline(promise, ms, message, view, signal) {
  let timer, cancel
  return Promise.race([promise, new Promise((_, reject) => {
    timer = view.setTimeout(() => reject(new Error(message)), ms)
    cancel = () => reject(new DOMException('Cancelled', 'AbortError'))
    if (signal?.aborted) cancel()
    else signal?.addEventListener('abort', cancel, { once: true })
  })]).finally(() => { view.clearTimeout(timer); signal?.removeEventListener('abort', cancel) })
}

function breakPositions(element, granularity = 'word') {
  const positions = []
  const doc = element.ownerDocument
  const atomic = 'svg,img,input,.ml-math,.katex,br'
  const segmenter = new Intl.Segmenter(undefined, { granularity })
  function visit(node) {
    if (node.nodeType === 3) {
      for (const part of segmenter.segment(node.data)) positions.push([node, part.index + part.segment.length])
    } else if (node.nodeType === 1 && node.matches(atomic)) {
      const index = [...node.parentNode.childNodes].indexOf(node)
      positions.push([node.parentNode, index + 1])
    } else {
      for (const child of node.childNodes) visit(child)
    }
  }
  visit(element)
  return positions
}

function sliceElement(element, position, tail) {
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  if (tail) range.setStart(...position)
  else range.setEnd(...position)
  const clone = element.cloneNode(false)
  clone.append(range.cloneContents())
  if (tail) {
    clone.removeAttribute('id')
    clone.classList.add('ml-pdf-continuation')
  }
  return clone
}

// 수식의 자연스러운 위·아래 첨자는 본문 가독성 하한에 포함하지 않는다.
function smallestMainText(node) {
  const doc = node.ownerDocument
  const walker = doc.createTreeWalker(node, 4)
  let text, minimum = Infinity
  while ((text = walker.nextNode())) {
    const parent = text.parentElement
    if (!text.data.replace(/[\s\p{Cf}]/gu, '') || parent.closest('.katex-mathml,.msupsub,.root,script,style,details,title,desc,defs')) continue
    const style = doc.defaultView.getComputedStyle(parent)
    // A4는 visibility:hidden인 측정 영역에서도 같은 가독성 판정을 해야 한다.
    const range = doc.createRange()
    range.selectNodeContents(text)
    if (![...range.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)) continue
    let scale = 1
    const svg = parent.closest('text,foreignObject')
    if (svg?.getScreenCTM) {
      const matrix = svg.getScreenCTM()
      if (matrix) scale = Math.hypot(matrix.c, matrix.d)
    } else {
      for (let ancestor = parent; ancestor; ancestor = ancestor.parentElement) {
        scale *= parseFloat(doc.defaultView.getComputedStyle(ancestor).zoom) || 1
      }
    }
    minimum = Math.min(minimum, parseFloat(style.fontSize) * scale)
  }
  return minimum
}

export function readablePDFScale(scale, fontSize) {
  return scale >= 0.85 - 1e-7 && fontSize * scale >= 12 - 1e-7
}

/** @param {{isCurrent?: () => boolean, errorMessage?: string}} [options] */
export async function paginateDocument(source, pages, { isCurrent = () => Boolean(true), errorMessage = 'Page layout failed' } = {}) {
  const doc = pages.ownerDocument
  let sheet, body, limit
  let steps = 0
  const pageBodies = []
  const widthFitted = new WeakSet()
  let containers = new WeakMap()
  function newPage() {
    containers = new WeakMap()
    sheet = doc.createElement('section')
    sheet.className = 'ml-pdf-page'
    body = doc.createElement('div')
    body.className = 'ml-document ml-pdf-content'
    sheet.append(body)
    pages.append(sheet)
    limit = sheet.getBoundingClientRect().height - 2 * parseFloat(doc.defaultView.getComputedStyle(sheet).paddingTop)
    pageBodies.push(body)
  }
  const fits = () => body.getBoundingClientRect().height <= limit + 0.2
  const hasContent = () => body.textContent.trim() || body.querySelector('img,svg,input,hr')
  function appendContainer(chain) {
    let target = body
    for (const template of chain) {
      let copy = containers.get(template)
      if (!copy || copy.parentElement !== target || target.lastElementChild !== copy) {
        copy = template.cloneNode(false)
        target.append(copy)
        containers.set(template, copy)
      }
      target = copy
    }
    return target
  }
  function removeEmpty(target) {
    while (target !== body && !target.childNodes.length) {
      const parent = target.parentElement
      target.remove()
      target = parent
    }
  }
  function moveToNextPage(previous, chain = []) {
    const heading = previous?.matches('h1,h2,h3,h4,h5,h6,.markdown-alert-title') ? previous : null
    const parent = heading?.parentElement
    heading?.remove()
    if (parent) removeEmpty(parent)
    if (!hasContent()) {
      if (heading) (chain.length ? appendContainer(chain) : body).append(heading)
      return false
    }
    newPage()
    if (heading) (chain.length ? appendContainer(chain) : body).append(heading)
    return true
  }
  function fitAtomicWidth(node) {
    if (widthFitted.has(node)) return
    widthFitted.add(node)
    const visual = node.matches('.ml-math') ? node.querySelector('.katex-display') || node : node
    const parent = visual.parentElement
    const parentStyle = doc.defaultView.getComputedStyle(parent)
    const available = parent.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight)
    const currentZoom = parseFloat(doc.defaultView.getComputedStyle(visual).zoom) || 1
    const width = Math.max(visual.getBoundingClientRect().width, visual.scrollWidth * currentZoom)
    if (width > available) {
      const zoom = parseFloat(visual.style.zoom) || 1
      visual.style.zoom = String(zoom * available / width)
    }
  }
  function tryRemainingAtomic(node, target, strict) {
    target.append(node)
    fitAtomicWidth(node)
    if (fits()) return true
    const baselineZoom = parseFloat(node.style.zoom) || 1
    const fontSize = smallestMainText(node)
    const withinPage = () => body.getBoundingClientRect().height <= limit + 0.005
    // 실제 배치 높이로 최대 비율을 구한다. 여백·SVG viewBox·중첩 zoom도 포함된다.
    let low = 0, high = 1
    for (let iteration = 0; iteration < 24; iteration++) {
      const scale = (low + high) / 2
      node.style.zoom = String(baselineZoom * scale)
      if (withinPage()) low = scale
      else high = scale
    }
    node.style.zoom = String(baselineZoom * low)
    if ((!strict || readablePDFScale(low, fontSize)) && withinPage()) return true
    node.style.zoom = String(baselineZoom)
    node.remove()
    removeEmpty(target)
    return false
  }
  async function place(node, chain = []) {
    if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError')
    if (++steps % 30 === 0) await new Promise(resolve => doc.defaultView.setTimeout(resolve, 0))
    let target = chain.length ? appendContainer(chain) : body
    const previous = target.lastElementChild
    target.append(node)
    if (node.nodeType === 1) {
      if (node.matches('.ml-diagram,.ml-math')) fitAtomicWidth(node)
      for (const atom of node.querySelectorAll('.ml-diagram,.ml-math-block')) fitAtomicWidth(atom)
    }
    if (fits()) return
    const nodeHeight = node.nodeType === 1 ? node.getBoundingClientRect().height : 0
    if (node.nodeType === 1 && node.tagName === 'TABLE' && !node.querySelector(':scope > colgroup')) {
      const row = node.rows[0]
      if (row && [...row.cells].every(cell => cell.colSpan === 1)) {
        const columns = doc.createElement('colgroup')
        for (const cell of row.cells) {
          const column = doc.createElement('col')
          column.style.width = `${cell.getBoundingClientRect().width}px`
          columns.append(column)
        }
        node.style.width = `${node.getBoundingClientRect().width}px`
        node.style.tableLayout = 'fixed'
        node.prepend(columns)
      }
    }
    node.remove()
    if (chain.length) { let empty = target; while (empty !== body && !empty.childNodes.length) { const parent = empty.parentElement; empty.remove(); empty = parent } }

    // 표는 머리글을 반복하며 행 경계에서 분할한다.
    if (node.nodeType === 1 && node.tagName === 'TABLE') {
      if (nodeHeight <= limit && hasContent()) moveToNextPage(previous, chain)
      await placeTable(node, chain)
      return
    }
    if (node.nodeType === 1 && node.matches('h1,h2,h3,h4,h5,h6,.markdown-alert-title') && moveToNextPage(previous, chain)) {
      await place(node, chain)
      return
    }
    if (node.nodeType === 1 && node.matches('img,svg,.ml-diagram,.ml-math')) {
      const strict = node.matches('svg,.ml-diagram,.ml-math')
      target = chain.length ? appendContainer(chain) : body
      if (strict && tryRemainingAtomic(node, target, true)) return
      if (!strict) removeEmpty(target)
      moveToNextPage(previous, chain)
      target = chain.length ? appendContainer(chain) : body
      if (tryRemainingAtomic(node, target, strict)) return
      throw new Error(errorMessage)
    }
    if (node.nodeType === 1 && node.matches('ul,ol,blockquote,div:not(.ml-diagram):not(.ml-math),section,dl')) {
      const children = [...node.childNodes]
      const start = Number(node.getAttribute('start') || 1)
      const template = node.cloneNode(false)
      let item = 0
      for (const child of children) {
        if (child.nodeType === 3 && !child.textContent.trim()) continue
        if (node.tagName === 'OL') template.setAttribute('start', String(start + item++))
        await place(child, [...chain, template])
      }
      return
    }
    if (node.nodeType !== 1) throw new Error(errorMessage)
    let positions = breakPositions(node)
    let best = -1
    target = chain.length ? appendContainer(chain) : body
    for (const granularity of ['word', 'grapheme']) {
      if (granularity === 'grapheme') positions = breakPositions(node, granularity)
      let low = 0, high = positions.length - 1
      while (low <= high) {
        const mid = (low + high) >> 1
        const prefix = sliceElement(node, positions[mid], false)
        target.append(prefix)
        const fit = fits()
        prefix.remove()
        if (fit) { best = mid; low = mid + 1 } else high = mid - 1
      }
      if (best >= 0) break
    }
    if (best < 0) {
      removeEmpty(target)
      if (moveToNextPage(previous, chain)) { await place(node, chain); return }
      throw new Error(errorMessage)
    }
    const first = sliceElement(node, positions[best], false)
    const rest = sliceElement(node, positions[best], true)
    if (!first.textContent.trim() && !first.querySelector('img,svg,input')) {
      removeEmpty(target)
      if (moveToNextPage(previous, chain)) { await place(node, chain); return }
      throw new Error(errorMessage)
    }
    target.append(first)
    if (rest.textContent.length || rest.querySelector('img,svg,input')) {
      newPage()
      await place(rest, chain)
    }
  }
  async function placeTable(table, chain) {
    const rows = [...table.querySelectorAll(':scope > tbody > tr, :scope > tr')]
    if (!rows.length) throw new Error(errorMessage)
    let output, tbody, part = 0
    function tablePart() {
      output = table.cloneNode(false)
      for (const child of table.children) {
        if (!child.matches('caption,colgroup,thead') || (part > 0 && child.tagName === 'CAPTION')) continue
        const copy = child.cloneNode(true)
        if (part > 0 && child.tagName === 'THEAD') { copy.classList.add('ml-pdf-repeat'); copy.setAttribute('aria-hidden', 'true') }
        output.append(copy)
      }
      part++
      tbody = doc.createElement('tbody')
      output.append(tbody)
      const target = chain.length ? appendContainer(chain) : body
      target.append(output)
    }
    tablePart()
    for (const [index, row] of rows.entries()) {
      if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError')
      if (index % 30 === 0) await new Promise(resolve => doc.defaultView.setTimeout(resolve, 0))
      tbody.append(row)
      // 분할 뒤에도 원래 행의 줄무늬 색을 유지한다.
      row.style.backgroundColor = index % 2 ? 'var(--ml-bg)' : 'var(--ml-surface)'
      if (fits()) continue
      row.remove()
      const emptyPart = !tbody.children.length
      if (emptyPart) { output.remove(); part-- }
      const heading = emptyPart && body.lastElementChild?.matches('h1,h2,h3,h4,h5,h6') ? body.lastElementChild : null
      heading?.remove()
      if (hasContent()) {
        newPage()
        if (heading) body.append(heading)
        tablePart()
      } else {
        if (heading) body.append(heading)
        if (!output.isConnected) tablePart()
      }
      tbody.append(row)
      if (!fits()) {
        const headerHeight = output.querySelector('thead')?.getBoundingClientRect().height || 0
        for (const cell of row.children) {
          for (const atomic of cell.querySelectorAll('img,svg,.ml-math')) {
            if (atomic.closest('.ml-math') !== atomic && atomic.closest('.ml-math')) continue
            const bounds = atomic.getBoundingClientRect()
            const widthScale = Math.min(1, Math.max(1, cell.clientWidth - 24) / Math.max(bounds.width, atomic.scrollWidth))
            if (widthScale < 1) atomic.style.zoom = String(widthScale)
            const scale = Math.min(1, (limit - headerHeight - 32) / atomic.getBoundingClientRect().height)
            if (scale > 0 && scale < 1) {
              if (atomic.matches('svg,.ml-math') && !readablePDFScale(scale, smallestMainText(atomic))) throw new Error(errorMessage)
              atomic.style.zoom = String(widthScale * scale)
            }
          }
        }
      }
      if (!fits()) {
        // 한 행이 페이지보다 길면 셀 내용을 보존한 채 다음 페이지로 이어간다.
        let remaining = row
        while (remaining) {
          if (!isCurrent()) throw new DOMException('Cancelled', 'AbortError')
          await new Promise(resolve => doc.defaultView.setTimeout(resolve, 0))
          const cells = [...remaining.children]
          const continuation = remaining.cloneNode(false)
          continuation.removeAttribute('id')
          remaining.replaceChildren(...cells.map(cell => cell.cloneNode(false)))
          let hasTail = false
          for (const [cellIndex, original] of cells.entries()) {
            let slot = remaining.children[cellIndex]
            slot.replaceWith(original)
            let tail = original.cloneNode(false)
            if (!fits()) {
              original.remove()
              let positions = breakPositions(original), best = -1
              for (const granularity of ['word', 'grapheme']) {
                if (granularity === 'grapheme') positions = breakPositions(original, granularity)
                let lo = 0, hi = positions.length - 1
                while (lo <= hi) {
                  const mid = (lo + hi) >> 1
                  const part = sliceElement(original, positions[mid], false)
                  remaining.insertBefore(part, remaining.children[cellIndex] || null)
                  const fit = fits()
                  part.remove()
                  if (fit) { best = mid; lo = mid + 1 } else hi = mid - 1
                }
                if (best >= 0) break
              }
              if (best < 0) throw new Error(errorMessage)
              slot = sliceElement(original, positions[best], false)
              tail = sliceElement(original, positions[best], true)
              remaining.insertBefore(slot, remaining.children[cellIndex] || null)
            }
            if (tail.textContent.length || tail.querySelector('img,svg,input')) hasTail = true
            continuation.append(tail)
          }
          if (!hasTail) { remaining = null; continue }
          newPage(); tablePart()
          tbody.append(continuation)
          remaining = continuation
        }
      }
    }
    const footer = table.querySelector(':scope > tfoot')
    if (footer) { output.append(footer); if (!fits()) { footer.remove(); newPage(); tablePart(); output.append(footer) } }
  }
  newPage()
  for (const node of [...source.childNodes]) {
    if (node.nodeType === 3 && !node.textContent.trim()) continue
    await place(node)
  }
  for (let index = pageBodies.length - 1; index >= 0 && pageBodies.length > 1; index--) {
    const page = pageBodies[index]
    if (!page.textContent.trim() && !page.querySelector('img,svg,input,hr')) { page.parentElement.remove(); pageBodies.splice(index, 1) }
  }
  const ids = new Set()
  for (const page of pageBodies) {
    for (const node of page.querySelectorAll('[id]')) {
      if (ids.has(node.id)) node.removeAttribute('id')
      else ids.add(node.id)
    }
  }
  return pageBodies.length
}

export function createPDFPreview({ document, window, content, t, prepare, onClose = () => {} }) {
  const element = document.createElement('dialog')
  element.className = 'ml-pdf-dialog'
  element.setAttribute('aria-label', t('pdfPreview'))
  const toolbar = document.createElement('header')
  toolbar.className = 'ml-pdf-toolbar'
  const title = document.createElement('h2')
  title.textContent = t('pdfPreview')
  const print = document.createElement('button')
  print.type = 'button'; print.dataset.pdfPrint = ''; print.textContent = t('pdfSave')
  const close = document.createElement('button')
  close.type = 'button'; close.dataset.pdfClose = ''; close.textContent = t('readerClose')
  const hint = document.createElement('p')
  for (const [index, text] of t('pdfSettingsHint').split('**').entries()) {
    if (index % 2) {
      const value = document.createElement('strong')
      value.textContent = text
      hint.append(value)
    } else hint.append(document.createTextNode(text))
  }
  toolbar.append(title, print, close, hint)
  const status = document.createElement('div')
  status.className = 'ml-pdf-status'; status.setAttribute('role', 'status')
  const frame = document.createElement('iframe')
  frame.className = 'ml-pdf-frame'; frame.title = t('pdfPreview')
  element.append(toolbar, status, frame)
  let generation = 0
  let controller
  let snapshotURLs = new Set()
  let previousFocus
  function finish() {
    generation++
    controller?.abort()
    for (const url of snapshotURLs) URL.revokeObjectURL(url)
    snapshotURLs.clear()
    element.close()
    frame.removeAttribute('srcdoc')
    frame.src = 'about:blank'
    previousFocus?.focus({ preventScroll: true })
    onClose()
  }
  close.addEventListener('click', finish)
  element.addEventListener('cancel', event => { event.preventDefault(); finish() })
  print.addEventListener('click', () => {
    if (!print.disabled) { frame.contentWindow.focus(); frame.contentWindow.print() }
  })
  return {
    element,
    async open() {
      if (element.open) return
      previousFocus = document.activeElement
      const request = ++generation
      controller = new AbortController()
      snapshotURLs = new Set()
      const signal = controller.signal
      const current = () => request === generation && element.open
      print.disabled = true
      delete frame.dataset.ready
      status.textContent = t('pdfPreparing'); status.dataset.error = 'false'
      element.showModal()
      close.focus()
      try {
        const name = await prepare({ isCurrent: current, signal })
        if (!current()) return
        await deadline(new Promise(resolve => {
          frame.onload = () => { frame.onload = null; resolve() }
          frame.srcdoc = '<!doctype html><html><head></head><body></body></html>'
        }), 10000, t('pdfResourceFailed'), window, signal)
        if (!current()) return
        const doc = frame.contentDocument
        const root = document.documentElement
        doc.documentElement.lang = root.lang || document.body.lang || 'en'
        doc.documentElement.dataset.mlTheme = root.dataset.mlTheme || 'system'
        doc.documentElement.dataset.mlFontFamily = root.dataset.mlFontFamily || 'system'
        doc.documentElement.style.cssText = root.style.cssText
        const tokens = window.getComputedStyle(root)
        for (const property of tokens) if (property.startsWith('--ml-')) doc.documentElement.style.setProperty(property, tokens.getPropertyValue(property))
        doc.head.replaceChildren()
        doc.body.replaceChildren()
        doc.title = name.replace(/\.[^.]+$/, '')
        const loads = []
        for (const style of document.head.querySelectorAll('style[data-markdown-leader],link[data-markdown-leader]')) {
          const copy = style.cloneNode(true)
          if (copy.tagName === 'LINK') loads.push(new Promise((resolve, reject) => { copy.onload = resolve; copy.onerror = () => reject(new Error(t('pdfResourceFailed'))) }))
          doc.head.append(copy)
        }
        const printStyle = doc.createElement('style')
        printStyle.textContent = PDF_PAGE_STYLE
        doc.head.append(printStyle)
        const source = content.cloneNode(true)
        source.removeAttribute('id'); source.removeAttribute('role'); source.removeAttribute('data-testid'); source.removeAttribute('data-width-mode')
        source.querySelectorAll('.ml-copy,.ml-document-skeleton,.ml-diagram-stage').forEach(node => node.remove())
        source.querySelectorAll('.ml-match').forEach(node => node.replaceWith(...node.childNodes))
        source.querySelectorAll('.ml-diagram[data-diagram-state="rendered"] details:not([open])').forEach(node => { node.style.visibility = 'hidden' })
        source.querySelectorAll('input').forEach(node => { node.setAttribute('tabindex', '-1'); if (node.checked) node.setAttribute('checked', '') })
        // 원본 문서의 blob 해제와 독립적으로 미리보기 이미지를 보존한다.
        for (const image of source.querySelectorAll('img')) {
          if (!current()) return
          image.loading = 'eager'
          if (!image.src) throw new Error(t('pdfResourceFailed'))
          if (image.src.startsWith('blob:')) {
            const blob = await (await fetch(image.src, { signal })).blob()
            if (!current()) return
            image.src = URL.createObjectURL(blob)
            snapshotURLs.add(image.src)
          }
        }
        // 폰트를 실제 본문으로 요청한 뒤 완료를 기다려 페이지 측정이 흔들리지 않게 한다.
        source.style.cssText = 'position:absolute;visibility:hidden;left:0;top:0;width:170mm;padding:0;border:0;'
        doc.body.append(source)
        for (const image of source.querySelectorAll('img')) loads.push(image.decode().catch(() => { throw new Error(t('pdfResourceFailed')) }))
        await deadline(Promise.all(loads), 20000, t('pdfResourceFailed'), window, signal)
        await deadline(doc.fonts.ready, 20000, t('pdfResourceFailed'), window, signal)
        if (!current()) return
        source.remove()
        const pages = doc.createElement('main')
        pages.className = 'ml-pdf-pages'; doc.body.append(pages)
        let count
        if (source.dataset.pdfPaginated === 'true') {
          pages.replaceChildren(...source.childNodes)
          count = pages.querySelectorAll(':scope > .ml-pdf-page').length
        } else count = await paginateDocument(source, pages, { isCurrent: current, errorMessage: t('pdfLayoutFailed') })
        if (!current()) return
        print.disabled = false
        frame.dataset.ready = 'true'
        status.textContent = t('pdfPageCount', String(count))
      } catch (error) {
        if (!current()) return
        status.dataset.error = 'true'
        status.textContent = error?.message || t('pdfLayoutFailed')
      }
    },
  }
}
