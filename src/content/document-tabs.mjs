export function createDocumentTabStrip({ document, t, onSelect, onClose, onAdd, onPin = (_id) => {}, onFavorite = (_id) => {}, onRecover = (_id) => {}, onReorder = (_ids) => {} }) {
  const items = new Map()
  let order = []
  let drag = null
  let scrollTimer = null
  let scrollDirection = 0
  const view = document.defaultView
  let selectedId = null
  let rovingId = null
  let boundsLeft = null
  let boundsWidth = null
  const element = document.createElement('div')
  element.className = 'ml-document-tabs'
  element.hidden = true
  const list = document.createElement('div')
  list.className = 'ml-document-tab-list'
  list.setAttribute('role', 'tablist')
  list.setAttribute('aria-label', t('readerDocumentTabs'))

  function iconButton(label, path, className = '') {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `ml-document-tab-tool ${className}`.trim()
    button.setAttribute('aria-label', label)
    button.title = label
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const stroke = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    stroke.setAttribute('d', path)
    svg.append(stroke)
    button.append(svg)
    return button
  }

  const previous = iconButton(t('readerPreviousTabs'), 'm14 6-6 6 6 6')
  const next = iconButton(t('readerNextTabs'), 'm10 6 6 6-6 6')
  const addButton = iconButton(t('readerOpenFile'), 'M12 5v14M5 12h14', 'ml-document-tab-add')
  previous.hidden = next.hidden = true
  element.append(previous, list, next, addButton)

  function updateOverflow() {
    // 화살표를 숨긴 전체 가용 폭으로 판단해 경계 폭에서 깜박이지 않는다.
    const available = Math.max(0, element.clientWidth - addButton.offsetWidth + 7)
    const contentWidth = items.size * 180 + 14
    list.style.width = `${Math.min(contentWidth, available)}px`
    const overflow = contentWidth > available
    previous.hidden = next.hidden = !overflow
    previous.disabled = list.scrollLeft <= 1
    next.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 1
  }

  function reveal(item) {
    if (!item) return
    const left = item.wrapper.offsetLeft - 7
    const right = item.wrapper.offsetLeft + item.wrapper.offsetWidth + 7
    if (left < list.scrollLeft) list.scrollLeft = left
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth
    updateOverflow()
  }

  function setRoving(id) {
    const old = items.get(rovingId)
    if (old) old.tab.tabIndex = -1
    rovingId = id
    const current = items.get(id)
    if (current) current.tab.tabIndex = 0
  }

  function move(direction) {
    list.scrollLeft += direction * Math.max(112, list.clientWidth * 0.8)
    updateOverflow()
  }
  previous.addEventListener('click', () => move(-1))
  next.addEventListener('click', () => move(1))
  addButton.addEventListener('click', onAdd)
  list.addEventListener('scroll', updateOverflow, { passive: true })
  const observer = new document.defaultView.ResizeObserver(() => {
    updateOverflow()
    reveal(items.get(selectedId))
  })
  observer.observe(element)

  function stopDrag() {
    if (scrollTimer !== null) view.clearInterval(scrollTimer)
    scrollTimer = null
    scrollDirection = 0
    if (drag) {
      items.get(drag.id)?.wrapper.classList.remove('is-dragging')
      drag.marker?.classList.remove('drop-before', 'drop-after')
    }
    drag = null
  }

  function setOrder(ids) {
    stopDrag()
    const requested = [...new Set(ids)].filter((id) => items.has(id))
    for (const id of order) if (!requested.includes(id)) requested.push(id)
    const next = [...requested.filter((id) => items.get(id).pinned), ...requested.filter((id) => !items.get(id).pinned)]
    if (next.every((id, index) => order[index] === id)) return
    order = next
    for (let index = 0; index < order.length; index++) {
      const node = items.get(order[index]).wrapper
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null)
    }
    updateOverflow()
  }

  function setFlags(id, { pinned = false, favorite = false }) {
    const item = items.get(id)
    if (!item || (item.pinned === pinned && item.favorite === favorite)) return
    const pinChanged = item.pinned !== pinned
    item.pinned = pinned
    item.favorite = favorite
    item.wrapper.classList.toggle('is-pinned', pinned)
    for (const [button, enabled, key] of [[item.pin, pinned, pinned ? 'readerUnpinTab' : 'readerPinTab'],
      [item.favoriteButton, favorite, favorite ? 'readerUnfavoriteTab' : 'readerFavoriteTab']]) {
      button.setAttribute('aria-pressed', String(enabled))
      button.setAttribute('aria-label', t(key, item.tab.textContent))
      button.title = t(key, item.tab.textContent)
    }
    if (pinChanged) {
      const scrollLeft = list.scrollLeft
      const focused = list.contains(document.activeElement) ? document.activeElement : null
      // 새 고정 탭은 맨 앞, 해제한 탭은 고정 그룹 바로 뒤에 둔다.
      setOrder([id, ...order.filter((key) => key !== id)])
      if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true })
      list.scrollLeft = pinned ? 0 : scrollLeft
      updateOverflow()
    }
  }

  function dragOver(event) {
    if (!drag || event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const rect = list.getBoundingClientRect()
    const x = event.clientX - rect.left + list.scrollLeft
    const group = order.filter((id) => items.get(id).pinned === items.get(drag.id).pinned)
    let before = group.find((id) => {
      const node = items.get(id).wrapper
      return x < node.offsetLeft + node.offsetWidth / 2
    })
    drag.marker?.classList.remove('drop-before', 'drop-after')
    drag.before = before ?? null
    drag.marker = items.get(before ?? group.at(-1)).wrapper
    drag.marker.classList.add(before === undefined ? 'drop-after' : 'drop-before')
    scrollDirection = event.clientX < rect.left + 28 ? -1 : event.clientX > rect.right - 28 ? 1 : 0
    if (scrollDirection && scrollTimer === null) {
      scrollTimer = view.setInterval(() => {
        if (!drag) return
        list.scrollLeft += scrollDirection * 12
        updateOverflow()
      }, 30)
    } else if (!scrollDirection && scrollTimer !== null) {
      view.clearInterval(scrollTimer)
      scrollTimer = null
    }
  }
  list.addEventListener('dragover', dragOver)
  list.addEventListener('dragleave', (event) => {
    if (list.contains(event.relatedTarget)) return
    if (scrollTimer !== null) view.clearInterval(scrollTimer)
    scrollTimer = null
    if (drag) {
      drag.marker?.classList.remove('drop-before', 'drop-after')
      drag.marker = null
    }
  })
  list.addEventListener('drop', (event) => {
    if (!drag || event.dataTransfer?.types?.includes('Files')) return
    event.preventDefault()
    event.stopPropagation()
    const { id, before } = drag
    if (!drag.marker || before === id) { stopDrag(); return }
    const next = order.filter((key) => key !== id)
    const group = next.filter((key) => items.get(key).pinned === items.get(id).pinned)
    const index = before === null ? (group.length ? next.indexOf(group.at(-1)) + 1 : 0) : next.indexOf(before)
    next.splice(index, 0, id)
    const changed = next.some((key, position) => key !== order[position])
    setOrder(next)
    if (changed) onReorder([...order])
  })

  function add({ id, title, description }) {
    if (items.has(id)) return
    const wrapper = document.createElement('div')
    wrapper.className = 'ml-document-tab'
    wrapper.setAttribute('role', 'presentation')
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.className = 'ml-document-tab-select'
    tab.id = `ml-document-tab-${id}`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-selected', 'false')
    tab.setAttribute('aria-controls', 'ml-document-panel')
    tab.tabIndex = -1
    tab.textContent = title
    tab.title = description && description !== title ? `${title}\n${description}` : title
    const close = iconButton(t('readerCloseTab', title), 'm7 7 10 10M17 7 7 17', 'ml-document-tab-close')
    const warning = iconButton(t('readerConnectionCheck'), 'M12 3 2 21h20L12 3zm0 6v5m0 3v1', 'ml-document-tab-warning')
    warning.hidden = true
    warning.addEventListener('click', () => onRecover(id))
    close.tabIndex = -1
    const pin = iconButton(t('readerPinTab', title), 'm9 3 6 0-1 6 4 4v2H6v-2l4-4zM12 15v6', 'ml-document-tab-pin')
    const favoriteButton = iconButton(t('readerFavoriteTab', title), 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z', 'ml-document-tab-favorite')
    pin.tabIndex = favoriteButton.tabIndex = -1
    pin.setAttribute('aria-pressed', 'false')
    favoriteButton.setAttribute('aria-pressed', 'false')
    wrapper.append(tab, warning, pin, favoriteButton, close)
    items.set(id, { wrapper, tab, close, warning, pin, favoriteButton, pinned: false, favorite: false })
    order.push(id)
    tab.draggable = true
    tab.addEventListener('dragstart', (event) => {
      stopDrag()
      drag = { id, before: id, marker: null }
      event.dataTransfer.setData('application/x-markdown-leader-tab', String(id))
      event.dataTransfer.effectAllowed = 'move'
      wrapper.classList.add('is-dragging')
      event.stopPropagation()
    })
    tab.addEventListener('dragend', stopDrag)
    pin.addEventListener('click', () => onPin(id))
    favoriteButton.addEventListener('click', () => onFavorite(id))
    list.append(wrapper)
    element.hidden = false
    if (rovingId === null) setRoving(id)
    tab.addEventListener('click', () => onSelect(id))
    close.addEventListener('click', () => onClose(id))
    wrapper.addEventListener('focusin', () => { close.tabIndex = pin.tabIndex = favoriteButton.tabIndex = 0 })
    wrapper.addEventListener('focusout', (event) => {
      if (!wrapper.contains(event.relatedTarget) && selectedId !== id) close.tabIndex = pin.tabIndex = favoriteButton.tabIndex = -1
    })
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Delete') {
        event.preventDefault()
        onClose(id)
        return
      }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      let target
      if (event.key === 'Home') target = list.firstElementChild
      else if (event.key === 'End') target = list.lastElementChild
      else if (event.key === 'ArrowLeft') target = wrapper.previousElementSibling || list.lastElementChild
      else target = wrapper.nextElementSibling || list.firstElementChild
      const targetTab = target.firstElementChild
      const old = items.get(rovingId)
      if (old) old.tab.tabIndex = -1
      targetTab.tabIndex = 0
      // 키 이동은 선택과 분리해 문서를 불필요하게 읽지 않는다.
      targetTab.focus({ preventScroll: true })
      reveal({ wrapper: target })
    })
    tab.addEventListener('focus', () => setRoving(id))
    updateOverflow()
  }

  function select(id) {
    const old = items.get(selectedId)
    if (old) {
      old.tab.setAttribute('aria-selected', 'false')
      old.wrapper.classList.remove('is-active')
      old.close.tabIndex = old.pin.tabIndex = old.favoriteButton.tabIndex = old.wrapper.contains(document.activeElement) ? 0 : -1
    }
    selectedId = items.has(id) ? id : null
    const current = items.get(selectedId)
    if (current) {
      current.tab.setAttribute('aria-selected', 'true')
      current.wrapper.classList.add('is-active')
      current.close.tabIndex = current.pin.tabIndex = current.favoriteButton.tabIndex = 0
      setRoving(id)
      reveal(current)
    }
  }

  function remove(id) {
    const item = items.get(id)
    if (!item) return
    const focused = item.wrapper.contains(document.activeElement)
    const neighbor = item.wrapper.nextElementSibling || item.wrapper.previousElementSibling
    stopDrag()
    order = order.filter((key) => key !== id)
    items.delete(id)
    item.wrapper.remove()
    if (selectedId === id) selectedId = null
    if (rovingId === id) {
      rovingId = null
      if (neighbor) {
        neighbor.firstElementChild.tabIndex = 0
        if (!focused) {
          for (const [key, entry] of items) {
            if (entry.wrapper === neighbor) { rovingId = key; break }
          }
        }
      }
    }
    if (focused && neighbor) neighbor.firstElementChild.focus({ preventScroll: true })
    element.hidden = items.size === 0
    updateOverflow()
  }

  return {
    element, add, select, remove, setFlags, setOrder,
    getOrder: () => [...order],
    setConnectionError(id, enabled) {
      const item = items.get(id)
      if (!item) return
      item.warning.hidden = !enabled
      item.wrapper.classList.toggle('has-connection-error', enabled)
    },
    setTitle(id, title) {
      const item = items.get(id)
      if (!item) return
      item.tab.textContent = title
      item.tab.title = title
      item.close.setAttribute('aria-label', t('readerCloseTab', title))
      item.close.title = t('readerCloseTab', title)
      for (const [button, key] of [[item.pin, item.pinned ? 'readerUnpinTab' : 'readerPinTab'],
        [item.favoriteButton, item.favorite ? 'readerUnfavoriteTab' : 'readerFavoriteTab']]) {
        button.setAttribute('aria-label', t(key, title))
        button.title = t(key, title)
      }
    },
    setDescription(id, description) {
      const item = items.get(id)
      if (item) item.tab.title = `${item.tab.textContent}\n${description}`
    },
    setBounds(left, width) {
      const nextWidth = Math.max(0, width)
      if (boundsLeft === left && boundsWidth === nextWidth) return
      boundsLeft = left
      boundsWidth = nextWidth
      element.style.left = `${left}px`
      element.style.width = `${nextWidth}px`
      updateOverflow()
      reveal(items.get(selectedId))
    },
    dispose() {
      stopDrag()
      observer.disconnect()
      items.clear()
      element.remove()
    },
  }
}
