import { parseReview } from './review-source.mjs'

// 중복 인용문은 문맥이 유일하게 일치할 때만 연결한다.
export function locateReviewQuote(text, note) {
  if (!note.quote) return -1
  const matches = []
  let offset = text.indexOf(note.quote)
  while (offset !== -1) {
    matches.push(offset)
    offset = text.indexOf(note.quote, offset + 1)
  }
  if (matches.length === 1) return matches[0]
  const contextual = matches.filter(index =>
    (!note.prefix || text.slice(0, index).endsWith(note.prefix)) &&
    (!note.suffix || text.slice(index + note.quote.length).startsWith(note.suffix)))
  return contextual.length === 1 ? contextual[0] : -1
}

export function createReviewUI({ document, window, content, t, onSave }) {
  const element = document.createElement('div')
  element.className = 'ml-review-ui'
  const panel = document.createElement('aside')
  panel.className = 'ml-review-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', t('reviewTitle'))
  const header = document.createElement('header')
  const title = document.createElement('strong')
  title.textContent = t('reviewTitle')
  const close = button('reviewClose', () => { panel.hidden = true })
  header.append(title, close)
  const list = document.createElement('div')
  list.className = 'ml-review-list'
  panel.append(header, list)
  const add = button('reviewAdd', () => {
    if (!selection || !current?.ready) return
    if (disconnectedDrafts.has(drafts.get(current.id))) {
      add.hidden = true
      panel.hidden = false
      renderPanel()
      list.querySelector('textarea')?.focus()
      return
    }
    const draft = { ...selection, id: window.crypto.randomUUID(), text: '', createdAt: new Date().toISOString() }
    drafts.set(current.id, draft)
    draftOriginals.delete(current.id)
    add.hidden = true
    panel.hidden = false
    renderPanel()
    list.querySelector('textarea')?.focus()
  })
  add.className = 'ml-review-add'
  add.hidden = true
  // 포인터로 버튼을 눌러도 저장해 둔 선택 범위를 잃지 않는다.
  add.addEventListener('pointerdown', event => event.preventDefault())
  const markers = document.createElement('div')
  markers.className = 'ml-review-markers'
  element.append(markers, add, panel)
  let current = null
  let notes = []
  let selection = null
  let selectionPointer = null
  let selectedId = null
  let anchors = []
  let frame = null
  let error = ''
  const drafts = new Map()
  const draftOriginals = new Map()
  const disconnectedDrafts = new WeakSet()
  const noteVersion = note => JSON.stringify(['id', 'quote', 'prefix', 'suffix', 'heading', 'text', 'createdAt'].map(key => note[key]))
  const saving = new Set()

  function button(key, handler) {
    const node = document.createElement('button')
    node.type = 'button'
    node.textContent = t(key)
    node.addEventListener('click', handler)
    return node
  }

  function textIndex() {
    const walker = document.createTreeWalker(content, window.NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest('button, [aria-hidden="true"], details, script, style, .katex-mathml')
          ? window.NodeFilter.FILTER_REJECT : window.NodeFilter.FILTER_ACCEPT
      }
    })
    const nodes = []
    let text = ''
    let node
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length })
      text += node.textContent
    }
    return { nodes, text }
  }

  function rangeAt(index, start, length) {
    const first = index.nodes.find(item => item.start + item.node.length > start)
    const last = index.nodes.find(item => item.start + item.node.length >= start + length)
    if (!first || !last) return null
    const range = document.createRange()
    range.setStart(first.node, start - first.start)
    range.setEnd(last.node, start + length - last.start)
    return range
  }

  function textOffset(index, container, offset) {
    const direct = index.nodes.find(item => item.node === container)
    if (direct) return direct.start + offset
    const boundary = document.createRange()
    boundary.setStart(container, offset)
    boundary.collapse(true)
    let result = 0
    for (const item of index.nodes) {
      if (boundary.comparePoint(item.node, item.node.length) > 0) break
      result = item.start + item.node.length
    }
    return result
  }

  function updateSelection(point) {
    add.hidden = true
    selection = null
    const selected = window.getSelection()
    if (!current?.ready || !selected?.rangeCount || selected.isCollapsed) return
    const range = selected.getRangeAt(0)
    if (!content.contains(range.startContainer) || !content.contains(range.endContainer)) return
    const index = textIndex()
    const start = textOffset(index, range.startContainer, range.startOffset)
    const end = textOffset(index, range.endContainer, range.endOffset)
    const quote = index.text.slice(start, end)
    if (!quote.trim()) return
    let heading = ''
    for (const node of content.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
      if (node.contains(range.startContainer) || (node.compareDocumentPosition(range.startContainer) & window.Node.DOCUMENT_POSITION_FOLLOWING)) heading = node.textContent || ''
    }
    selection = { quote, prefix: index.text.slice(Math.max(0, start - 64), start), suffix: index.text.slice(end, end + 64), heading }
    add.hidden = false
    let rect = range.getBoundingClientRect()
    if (!point && selected.focusNode) {
      const focus = document.createRange()
      focus.setStart(selected.focusNode, selected.focusOffset)
      focus.collapse(true)
      rect = focus.getBoundingClientRect()
    }
    const x = point ? point.clientX : rect.left
    const y = point ? point.clientY : rect.bottom
    add.style.left = `${Math.max(44, Math.min(x - add.offsetWidth / 2, window.innerWidth - add.offsetWidth - 6))}px`
    add.style.top = `${Math.max(4, Math.min(y + 6, window.innerHeight - add.offsetHeight - 6))}px`
  }

  function rebuildAnchors() {
    markers.replaceChildren()
    anchors = []
    if (!current?.ready || !notes.length) return
    const index = textIndex()
    for (const note of notes) {
      const start = locateReviewQuote(index.text, note)
      const range = start < 0 ? null : rangeAt(index, start, note.quote.length)
      if (!range) continue
      const marker = button('reviewLocate', () => {
        selectNote(note.id)
        panel.hidden = false
        const card = [...list.querySelectorAll('[data-note-id]')].find(item => item.dataset.noteId === note.id)
        card?.scrollIntoView({ block: 'nearest' })
        card?.focus({ preventScroll: true })
        positionMarkers()
      })
      marker.className = 'ml-review-marker'
      marker.title = t('reviewLocate')
      const highlight = document.createElement('div')
      highlight.className = 'ml-review-highlight'
      highlight.setAttribute('aria-hidden', 'true')
      anchors.push({ note, start, range, marker, highlight })
    }
    anchors.sort((a, b) => a.start - b.start)
    anchors.forEach((anchor, index) => {
      anchor.number = index + 1
      anchor.marker.textContent = String(anchor.number)
      anchor.marker.setAttribute('aria-label', `${t('reviewLocate')} ${anchor.number}`)
      anchor.marker.title = `${t('reviewLocate')} ${anchor.number}`
    })
    markers.append(...anchors.flatMap(anchor => [anchor.highlight, anchor.marker]))
    if (!anchors.some(anchor => anchor.note.id === selectedId)) selectedId = null
    positionMarkers()
  }

  function selectNote(id, scroll = false) {
    const anchor = anchors.find(item => item.note.id === id)
    if (!anchor) return
    selectedId = selectedId === id ? null : id
    // 브라우저의 원래 텍스트 선택도 지워 토글 해제를 명확히 표시한다.
    window.getSelection?.()?.removeAllRanges?.()
    add.hidden = true
    if (selectedId && scroll) anchor.range.startContainer.parentElement?.scrollIntoView({ block: 'center', behavior: 'instant' })
    updateSelectedCards()
    positionMarkers()
  }

  function updateSelectedCards() {
    for (const card of list.querySelectorAll('[data-note-id]')) {
      const selected = card.dataset.noteId === selectedId
      card.classList.toggle('is-selected', selected)
      card.setAttribute('aria-current', String(selected))
    }
  }

  function positionMarkers() {
    frame = null
    for (const { note, range, marker, highlight } of anchors) {
      const rect = range.getBoundingClientRect()
      const fragments = [...range.getClientRects()].filter(fragment => fragment.width > 0 && fragment.height > 0)
      const end = fragments.at(-1)
      const visible = rect.bottom > 56 && rect.top < window.innerHeight && rect.width > 0
      marker.hidden = !end || end.bottom <= 56 || end.top >= window.innerHeight
      highlight.hidden = !visible || selectedId !== note.id
      marker.classList.toggle('is-selected', selectedId === note.id)
      marker.setAttribute('aria-pressed', String(selectedId === note.id))
      if (!visible) continue
      // 마지막 선택 줄의 글자 끝을 따른다. 패널에 가려져도 원래 위치를 유지한다.
      if (end) {
        marker.style.left = `${end.right + 2}px`
        marker.style.top = `${end.top - 11}px`
      }
      highlight.replaceChildren()
      if (selectedId === note.id) {
        for (const fragment of fragments) {
          const line = document.createElement('span')
          Object.assign(line.style, { left: `${fragment.left}px`, top: `${fragment.top}px`, width: `${fragment.width}px`, height: `${fragment.height}px` })
          highlight.append(line)
        }
      }
    }
  }

  function schedulePosition() {
    add.hidden = true
    if (anchors.length && frame === null) frame = window.requestAnimationFrame(positionMarkers)
  }

  function renderPanel() {
    const scrollTop = list.scrollTop
    list.replaceChildren()
    if (error) {
      const message = document.createElement('p')
      message.setAttribute('role', 'alert')
      message.textContent = error
      list.append(message)
    }
    if (!current?.ready) return
    const draft = drafts.get(current.id)
    if (!notes.length && !draft) {
      const empty = document.createElement('p')
      empty.textContent = `${t('reviewEmpty')} ${t('reviewSelectHint')}`
      list.append(empty)
    }
    const ordered = anchors.map(anchor => anchor.note)
    const missing = notes.filter(note => !anchors.some(anchor => anchor.note.id === note.id))
    if (draft && !notes.some(note => note.id === draft.id)) {
      const start = locateReviewQuote(textIndex().text, draft)
      if (start < 0) missing.push(draft)
      else {
        const position = anchors.findIndex(anchor => anchor.start > start)
        ordered.splice(position < 0 ? ordered.length : position, 0, draft)
      }
    }
    if (missing.length) {
      const heading = document.createElement('h3')
      heading.className = 'ml-review-unlocated-heading'
      heading.textContent = t('reviewUnlocated')
      ordered.push(null, ...missing)
      for (const note of ordered) {
        if (note === null) list.append(heading)
        else renderCard(note, draft)
      }
    } else {
      for (const note of ordered) renderCard(note, draft)
    }
    list.scrollTop = scrollTop
  }

  function renderCard(note, draft) {
      const editing = draft?.id === note.id
      const anchor = anchors.find(item => item.note.id === note.id)
      const card = document.createElement('section')
      card.className = 'ml-review-card'
      card.dataset.noteId = note.id
      card.tabIndex = anchor && !editing ? 0 : -1
      card.classList.toggle('is-selected', selectedId === note.id)
      card.setAttribute('aria-current', String(selectedId === note.id))
      card.addEventListener('click', event => {
        if (!editing && !event.target.closest('button, textarea')) selectNote(note.id, true)
      })
      card.addEventListener('keydown', event => {
        if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          selectNote(note.id, true)
        }
      })
      const label = document.createElement('div')
      label.className = 'ml-review-card-label'
      if (anchor) {
        const number = document.createElement('span')
        number.className = 'ml-review-number'
        number.textContent = String(anchor.number)
        label.append(number)
      }
      const quote = document.createElement('blockquote')
      quote.textContent = note.quote
      quote.title = note.quote
      label.append(quote)
      card.append(label)
      const actions = document.createElement('div')
      actions.className = 'ml-review-actions'
      if (editing) {
        const input = document.createElement('textarea')
        input.setAttribute('aria-label', t('reviewTextLabel'))
        input.value = draft.text
        input.rows = 5
        input.addEventListener('input', () => { draft.text = input.value; save.disabled = !input.value.trim() || saving.has(current.id) || disconnectedDrafts.has(draft) })
        const save = button('reviewSave', () => persist(notes.some(item => item.id === draft.id)
          ? notes.map(item => item.id === draft.id ? { ...draft, text: input.value } : item)
          : [...notes, { ...draft, text: input.value }], draft))
        save.disabled = !draft.text.trim() || saving.has(current.id) || disconnectedDrafts.has(draft)
        input.disabled = saving.has(current.id)
        const cancel = button('reviewCancel', () => { drafts.delete(current.id); draftOriginals.delete(current.id); renderPanel() })
        cancel.disabled = saving.has(current.id)
        actions.append(save, cancel)
        const storageHint = document.createElement('p')
        storageHint.textContent = t(disconnectedDrafts.has(draft) ? 'reviewDraftReconnected' : 'reviewOriginalHint')
        card.append(input, storageHint, actions)
        list.append(card)
        return
      }
      const text = document.createElement('p')
      text.textContent = note.text
      const locate = button('reviewLocate', () => selectNote(note.id, true))
      locate.dataset.reviewAction = 'locate'
      locate.disabled = !anchor
      const edit = button('reviewEdit', () => {
        if (disconnectedDrafts.has(drafts.get(current.id))) return
        drafts.set(current.id, { ...note }); draftOriginals.set(current.id, { id: note.id, version: noteVersion(note) }); renderPanel(); list.querySelector('textarea')?.focus()
      })
      const remove = button('reviewDelete', () => persist(notes.filter(item => item.id !== note.id)))
      remove.disabled = saving.has(current.id)
      edit.disabled = saving.has(current.id) || disconnectedDrafts.has(drafts.get(current.id))
      actions.append(locate, edit, remove)
      card.append(text, actions)
      list.append(card)
  }

  async function persist(nextNotes, draft) {
    if (!current?.ready || saving.has(current.id)) return
    if (draft && disconnectedDrafts.has(draft)) return
    const owner = current.id
    const original = draftOriginals.get(owner)
    if (draft && original?.id === draft.id) {
      const latest = notes.find(note => note.id === draft.id)
      if (!latest || noteVersion(latest) !== original.version) {
        error = `${t('reviewSaveFailed')} ${t('reviewNoteChanged')}`
        renderPanel()
        return
      }
    }
    const expectedRaw = current.raw
    saving.add(owner)
    error = ''
    renderPanel()
    try {
      const raw = await onSave({ documentId: owner, expectedRaw, notes: nextNotes })
      if (draft && drafts.get(owner) === draft && !disconnectedDrafts.has(draft)) {
        drafts.delete(owner)
        draftOriginals.delete(owner)
      }
      if ((!draft || !disconnectedDrafts.has(draft)) && current?.id === owner && (current.raw === expectedRaw || current.raw === raw)) {
        current.raw = raw
        notes = parseReview(raw).notes
        rebuildAnchors()
      }
    } catch (failure) {
      if (current?.id === owner) error = `${t('reviewSaveFailed')} ${failure.message || ''}`
    } finally {
      saving.delete(owner)
      if (current?.id === owner) renderPanel()
    }
  }

  function clear() {
    current = null
    notes = []
    anchors = []
    selection = null
    selectionPointer = null
    selectedId = null
    error = ''
    add.hidden = true
    markers.replaceChildren()
    list.replaceChildren()
    if (frame !== null) window.cancelAnimationFrame(frame)
    frame = null
  }

  function refreshAnchors() {
    const order = anchors.map(anchor => anchor.note.id).join('\n')
    rebuildAnchors()
    if (order !== anchors.map(anchor => anchor.note.id).join('\n')) renderPanel()
    else updateSelectedCards()
  }

  function forget(id) {
    drafts.delete(id)
    draftOriginals.delete(id)
    // 진행 중 저장의 잠금은 해당 Promise의 finally에서 해제한다.
    if (current?.id === id) clear()
  }

  function invalidateDraft(id) {
    const draft = drafts.get(id)
    if (!draft) return
    // 탭은 유지해도 다른 파일로 연결된 초안을 자동으로 이어 저장하지 않는다.
    disconnectedDrafts.add(draft)
    if (current?.id === id) renderPanel()
  }

  function setDocument(value) {
    if (current?.id === value.id && current.raw === value.raw && current.ready === value.ready) {
      refreshAnchors()
      return
    }
    current = { ...value }
    error = ''
    try { notes = parseReview(value.raw).notes } catch (failure) { notes = []; current.ready = false; error = `${t('reviewSaveFailed')} ${failure.message || ''}` }
    rebuildAnchors()
    renderPanel()
  }

  document.addEventListener('pointerdown', event => {
    if (add.contains(event.target)) return
    add.hidden = true
    selectionPointer = event.button === 0 && content.contains(event.target) ? event.pointerId : null
  })
  document.addEventListener('pointerup', event => {
    if (selectionPointer === null || event.pointerId !== selectionPointer) return
    selectionPointer = null
    updateSelection(event)
  })
  const dismissSelection = () => { selectionPointer = null; add.hidden = true }
  document.addEventListener('pointercancel', dismissSelection)
  window.addEventListener('blur', dismissSelection)
  window.addEventListener('wheel', dismissSelection, { passive: true, capture: true })
  document.addEventListener('selectionchange', () => {
    if (window.getSelection()?.isCollapsed) { add.hidden = true; selection = null }
  })
  document.addEventListener('keyup', event => {
    if (selectionPointer === null && (event.key === 'Shift' || event.shiftKey || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a'))) updateSelection()
  })
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return
    add.hidden = true
    if (panel.contains(document.activeElement)) { panel.hidden = true; content.focus?.() }
  })
  window.addEventListener('scroll', schedulePosition, { passive: true })
  window.addEventListener('resize', schedulePosition, { passive: true })
  const layoutObserver = window.ResizeObserver ? new window.ResizeObserver(schedulePosition) : null
  layoutObserver?.observe(content)
  return { element, clear, forget, invalidateDraft, setDocument, refreshAnchors, isOpen: () => !panel.hidden, toggle() { panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel() } }
}
