import { createTranslator } from './i18n.mjs'

export const MARKDOWN_EXTENSION_RE = /\.(?:md|markdown|mdown|mdwn|mkd|mkdn|mkdown|mdx|mdc)$/i
export const SUPPORTED_EXTENSION_RE = /\.(?:md|markdown|mdown|mdwn|mkd|mkdn|mkdown|mdx|mdc|txt)$/i
export const SAFE_LINK_PROTOCOLS = new Set(['http:', 'https:', 'file:', 'mailto:'])
export const SAFE_IMAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:'])

export function clampRefreshInterval(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 10000
  return Math.min(600000, Math.max(500, Math.round(number)))
}

export function normalizeFileURL(value) {
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return value
  }
}

export function getParentDirectoryURL(fileURL) {
  try {
    const url = new URL(fileURL)
    if (url.protocol !== 'file:') return null
    const pathname = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
    const slash = pathname.lastIndexOf('/')
    url.pathname = pathname.slice(0, slash + 1)
    url.search = ''
    url.hash = ''
    return url.href
  } catch {
    return null
  }
}

export function getFileName(fileURL) {
  try {
    const pathname = decodeURIComponent(new URL(fileURL).pathname.replace(/\/$/, ''))
    return pathname.slice(pathname.lastIndexOf('/') + 1)
  } catch {
    return fileURL
  }
}

export function isSupportedDocument(url) {
  try {
    return SUPPORTED_EXTENSION_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

export function isMarkdownDocument(url) {
  try {
    return MARKDOWN_EXTENSION_RE.test(new URL(url).pathname)
  } catch {
    return false
  }
}

function decodeJavaScriptString(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value
  }
}

export function parseDirectoryListing(html, directoryURL) {
  const found = new Map()
  const addEntry = (rawName, rawHref, directory, modifiedAt) => {
    const name = rawName.replace(/\/$/, '').trim()
    if (!name || name === '..' || !rawHref) return
    let url
    try {
      url = new URL(rawHref, directoryURL)
    } catch {
      return
    }
    if (url.protocol !== 'file:') return
    if (directory && !url.pathname.endsWith('/')) url.pathname += '/'
    if (!directory && !isMarkdownDocument(url.href)) return
    const entry = { name, url: url.href, type: directory ? 'directory' : 'file' }
    if (Number.isFinite(modifiedAt)) entry.modifiedAt = modifiedAt
    if (!found.has(url.href) || Number.isFinite(modifiedAt)) found.set(url.href, entry)
  }

  for (const match of html.matchAll(/addRow\("((?:\\.|[^"\\])*)",\s*"((?:\\.|[^"\\])*)",\s*([01])\b(?:\s*,\s*-?\d+\s*,\s*"(?:\\.|[^"\\])*"\s*,\s*(-?\d+(?:\.\d+)?))?/g)) {
    // Chromium은 로컬 디렉터리 수정 시각을 Unix 초로 전달하며 0은 미확인이다.
    const seconds = Number(match[4])
    addEntry(decodeJavaScriptString(match[1]), decodeJavaScriptString(match[2]), match[3] === '1', Number.isFinite(seconds) && seconds !== 0 ? seconds * 1000 : undefined)
  }
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = match[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim()
    addEntry(label, match[1], /\/$/.test(match[1]))
  }
  return [...found.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

export function resolveSafeURL(raw, baseURL, kind = 'link') {
  const value = String(raw || '').trim()
  if (!value) return null
  if (kind === 'link' && value.startsWith('#')) return value
  if (kind === 'image' && /^data:image\/(?:png|gif|jpe?g|webp|avif);base64,/i.test(value)) return value
  try {
    const url = new URL(value, baseURL)
    const allowed = kind === 'image' ? SAFE_IMAGE_PROTOCOLS : SAFE_LINK_PROTOCOLS
    return allowed.has(url.protocol) ? url.href : null
  } catch {
    return null
  }
}

export function describeError(error, translate = createTranslator('en')) {
  const detail = String(error?.message || error || translate('unknownError'))
  if (detail === 'ML_STORAGE_UNAVAILABLE') return translate('errorStorageUnavailable')
  if (/extension context invalidated|receiving end does not exist/i.test(detail)) {
    return translate('errorConnectionInvalidated', detail)
  }
  if (/message port closed|message channel closed/i.test(detail)) {
    return translate('errorMessageChannelClosed', detail)
  }
  if (/AbortError|aborted|timeout|timed out|시간 초과/i.test(detail)) {
    return translate('errorReadTimeoutAdvice', detail)
  }
  if (/Failed to fetch|NetworkError|ERR_FILE_NOT_FOUND/i.test(detail)) {
    return translate('errorFileReadAdvice', detail)
  }
  return detail
}

export function directorySignature(entries) {
  return entries.map((entry) => `${entry.type}:${entry.url}:${entry.modifiedAt ?? ''}`).join('|')
}

export function shouldReplaceDirectory(previousSignature, nextSignature, loaded, failed, force = false) {
  return force || !loaded || failed || previousSignature !== nextSignature
}

export function captureScrollSnapshot(scrollY, scrollHeight, viewportHeight, headings) {
  const closest = [...headings].reverse().find((heading) => heading.top <= scrollY + 8)
  const maximum = Math.max(1, scrollHeight - viewportHeight)
  return {
    headingId: closest?.id || null,
    headingOffset: closest ? scrollY - closest.top : 0,
    ratio: Math.min(1, Math.max(0, scrollY / maximum)),
  }
}

export function restoredScrollTop(snapshot, headingTop, scrollHeight, viewportHeight) {
  if (typeof headingTop === 'number') return Math.max(0, headingTop + snapshot.headingOffset)
  return snapshot.ratio * Math.max(0, scrollHeight - viewportHeight)
}
