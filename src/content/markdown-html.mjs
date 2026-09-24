import DOMPurify from 'dompurify'
import { resolveSafeURL } from '../core.mjs'

const allowedTags = [
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup',
  'dd', 'del', 'div', 'dl', 'dt', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'hr', 'i', 'img', 'ins', 'li', 'mark', 'ol', 'p', 'pre', 's', 'small',
  'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
  'thead', 'tr', 'u', 'ul',
]
const allowedTagSet = new Set(allowedTags)
const voidTags = new Set(['br', 'col', 'hr', 'img'])
const allowedAttributes = ['alt', 'colspan', 'href', 'rowspan', 'scope', 'src', 'title']
const tagAttributes = {
  a: new Set(['href', 'title']),
  abbr: new Set(['title']),
  img: new Set(['alt', 'src', 'title']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan', 'scope']),
}
const allowedScopeValues = new Set(['col', 'colgroup', 'row', 'rowgroup'])
const allowedURI = /^(?:(?:(?:https?|file|mailto|data):)|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i

function purifier() {
  if (typeof DOMPurify.sanitize === 'function') return DOMPurify
  if (typeof DOMPurify === 'function' && typeof window !== 'undefined') return DOMPurify(window)
  throw new Error('DOMPurify requires a browser document.')
}

function sanitizeFragment(source) {
  return purifier().sanitize(String(source), {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOWED_URI_REGEXP: allowedURI,
    CUSTOM_ELEMENT_HANDLING: {
      tagNameCheck: null,
      attributeNameCheck: null,
      allowCustomizedBuiltInElements: false,
    },
    RETURN_DOM_FRAGMENT: true,
  })
}

function markTaskListHtml(state) {
  const listItems = []
  for (const token of state.tokens) {
    if (token.type === 'list_item_open') {
      listItems.push({
        level: token.level,
        task: token.attrGet('class')?.split(/\s+/).includes('task-list-item') || false,
      })
      continue
    }
    if (token.type === 'list_item_close') {
      const index = listItems.findLastIndex(item => item.level === token.level)
      if (index >= 0) listItems.length = index
      continue
    }
    if (token.type !== 'inline' || !listItems.some(item => item.task)) continue

    const children = token.children || []
    const labelOpen = children[0]
    const checkbox = children[1]
    const labelClose = children.at(-1)
    if (labelOpen?.type !== 'html_inline' || labelOpen.content !== '<label>'
      || checkbox?.type !== 'html_inline'
      || !/^<input (?:data-task-line="\d+" )?class="task-list-item-checkbox"(?: checked="")?(?: disabled="")? ?type="checkbox">$/.test(checkbox.content)
      || labelClose?.type !== 'html_inline' || labelClose.content !== '</label>') continue

    for (const generated of [labelOpen, checkbox, labelClose]) {
      generated.meta = { ...generated.meta, markdownLeaderInternal: 'task-list' }
    }
  }
}

function escapeAttribute(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function safeDimension(value, maximum) {
  if (!/^[1-9]\d{0,4}$/.test(value)) return null
  const dimension = Number(value)
  return dimension <= maximum ? String(dimension) : null
}

function normalizeElement(element, baseURL, localImages) {
  const tag = element.localName
  if (!allowedTagSet.has(tag)) return false
  const allowed = tagAttributes[tag] || new Set()
  for (const attribute of [...element.attributes]) {
    const name = attribute.name.toLowerCase()
    if (!allowed.has(name)) {
      element.removeAttribute(name)
      continue
    }

    let value = attribute.value
    if (name === 'href' || name === 'src') {
      const safe = resolveSafeURL(value, baseURL, name === 'href' ? 'link' : 'image')
      if (!safe) {
        element.removeAttribute(name)
        continue
      }
      value = safe
    } else if (name === 'scope') {
      if (!allowedScopeValues.has(value.toLowerCase())) {
        element.removeAttribute(name)
        continue
      }
      value = value.toLowerCase()
    } else if (name === 'colspan') {
      value = safeDimension(value, 1000)
      if (!value) {
        element.removeAttribute(name)
        continue
      }
    } else if (name === 'rowspan') {
      value = safeDimension(value, 65534)
      if (!value) {
        element.removeAttribute(name)
        continue
      }
    }

    element.setAttribute(name, value)
  }

  if (tag === 'img') {
    const safe = element.getAttribute('src')
    if (!safe) return false
    if (localImages && safe.startsWith('file:')) {
      element.removeAttribute('src')
      element.setAttribute('data-local-image', safe)
    }
    element.setAttribute('loading', 'lazy')
  }
  const href = element.getAttribute('href')
  if (tag === 'a' && href && /^https?:/i.test(href)) {
    element.setAttribute('target', '_blank')
    element.setAttribute('rel', 'noopener noreferrer')
  }
  return true
}

function normalizeFragment(fragment, baseURL, localImages) {
  for (const element of [...fragment.querySelectorAll('*')]) {
    if (!normalizeElement(element, baseURL, localImages)) {
      element.remove()
    }
  }
  return fragment
}

function serializeOpenTag(element) {
  const attributes = [...element.attributes]
    .map(attribute => `${attribute.name}="${escapeAttribute(attribute.value)}"`)
  return `<${element.localName}${attributes.length ? ` ${attributes.join(' ')}` : ''}>`
}

export function sanitizeRawHtml(source, baseURL, localImages = false) {
  const fragment = normalizeFragment(sanitizeFragment(source), baseURL, localImages)
  const container = document.createElement('div')
  container.append(fragment)
  return container.innerHTML
}

export function sanitizeRawInlineTag(source, baseURL, localImages = false) {
  const closing = /^<\/([a-z][a-z0-9-]*)\s*>$/i.exec(source)
  if (closing) {
    const tag = closing[1].toLowerCase()
    return allowedTagSet.has(tag) && !voidTags.has(tag) ? `</${tag}>` : ''
  }

  const fragment = sanitizeFragment(source)
  const element = fragment.firstElementChild
  if (!element || !normalizeElement(element, baseURL, localImages)) return ''
  const openTag = serializeOpenTag(element)
  const selfClosing = /\/\s*>$/.test(source)
  return selfClosing && !voidTags.has(element.localName) ? `${openTag}</${element.localName}>` : openTag
}

export function markdownHtml(md, options = {}) {
  const getBaseURL = options.getBaseURL || (() => '')
  const getLocalImages = options.getLocalImages || (() => false)
  const sanitizeBlock = options.sanitizeBlock || sanitizeRawHtml
  const sanitizeInline = options.sanitizeInline || sanitizeRawInlineTag

  md.core.ruler.push('markdown_leader_mark_task_list_html', markTaskListHtml)
  md.renderer.rules.html_block = (tokens, index) => `${sanitizeBlock(tokens[index].content, getBaseURL(), getLocalImages())}\n`
  md.renderer.rules.html_inline = (tokens, index) => {
    const token = tokens[index]
    if (token.meta?.markdownLeaderInternal === 'task-list') return token.content
    return sanitizeInline(token.content, getBaseURL(), getLocalImages())
  }
}
