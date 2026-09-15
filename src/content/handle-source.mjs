import { MARKDOWN_EXTENSION_RE } from '../core.mjs'

const IMAGE_TYPES = new Map([
  ['png', 'image/png'], ['jpg', 'image/jpeg'], ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'], ['webp', 'image/webp'], ['avif', 'image/avif'],
  ['bmp', 'image/bmp'], ['ico', 'image/x-icon'], ['svg', 'image/svg+xml'],
])

function safeName(name) {
  if (!name || name === '.' || name === '..' || /[\\/\u0000]/.test(name)) {
    throw new Error('ML_HANDLE_OUTSIDE_SCOPE')
  }
  return name
}

function listingString(value) {
  return JSON.stringify(value).replace(/[<>&]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}

export function createHandleSource(handle) {
  if (!handle || !['file', 'directory'].includes(handle.kind)) throw new Error('ML_HANDLE_INVALID')
  const name = safeName(handle.name)
  const baseURL = `file:///__markdown_leader__/${crypto.randomUUID()}/`
  const rootURL = handle.kind === 'directory' ? baseURL : null
  const initialURL = handle.kind === 'file' ? `${baseURL}${encodeURIComponent(name)}` : null
  const imageURLs = new Set()
  let disposed = false
  let imageGeneration = 0

  function releaseImages() {
    imageGeneration++
    for (const url of imageURLs) URL.revokeObjectURL(url)
    imageURLs.clear()
  }

  function assertActive() {
    if (disposed) throw new Error('ML_HANDLE_DISPOSED')
  }

  function target(value) {
    assertActive()
    let url, segments
    try {
      url = new URL(value)
      url.search = ''
      url.hash = ''
      if (!url.href.startsWith(baseURL)) throw new Error()
      const relative = url.href.slice(baseURL.length)
      segments = relative.replace(/\/$/, '').split('/').filter(Boolean).map(segment => safeName(decodeURIComponent(segment)))
      if (handle.kind === 'file' && url.href !== initialURL) throw new Error()
    } catch {
      throw new Error('ML_HANDLE_OUTSIDE_SCOPE')
    }
    return { url, segments, directory: url.pathname.endsWith('/') }
  }

  async function resolve({ segments, directory }) {
    let current = handle
    if (handle.kind === 'file') return current
    for (let index = 0; index < segments.length; index++) {
      assertActive()
      current = index === segments.length - 1 && !directory
        ? await current.getFileHandle(segments[index])
        : await current.getDirectoryHandle(segments[index])
    }
    assertActive()
    return current
  }

  /**
   * @param {string} value
   * @param {{ isCurrent?: () => boolean }} [options]
   */
  async function prepareDirectory(value, { isCurrent = () => true } = {}) {
    function assertCurrent() {
      assertActive()
      if (!isCurrent()) throw new DOMException('ML_HANDLE_DIRECTORY_STALE', 'AbortError')
    }
    assertCurrent()
    const current = await resolve(target(value))
    assertCurrent()
    if (current.kind !== 'directory') throw new Error('ML_HANDLE_DIRECTORY_TYPE')
    const entries = []
    for await (const [childName, child] of current.entries()) {
      assertCurrent()
      if (entries.length >= 2000) throw new Error('ML_HANDLE_DIRECTORY_LIMIT')
      safeName(childName)
      entries.push({ name: childName, child, modified: 0 })
    }
    assertCurrent()
    function listing() {
      // 기존 디렉터리 파서의 데이터 형식을 사용하며 스크립트로 실행하지 않는다.
      return entries.map(({ name, child, modified }) => {
        const directory = child.kind === 'directory'
        const href = `${encodeURIComponent(name)}${directory ? '/' : ''}`
        return `addRow(${listingString(name)}, ${listingString(href)}, ${directory ? 1 : 0},0,"",${modified},"");`
      }).join('\n')
    }
    let metadataPromise
    async function readMetadata() {
      assertCurrent()
      // 폴더와 비 Markdown 항목은 수정일을 읽지 않는다.
      const documents = entries.filter(entry => entry.child.kind === 'file' && MARKDOWN_EXTENSION_RE.test(entry.name))
      let next = 0
      async function worker() {
        while (next < documents.length) {
          assertCurrent()
          const entry = documents[next++]
          try {
            const file = await entry.child.getFile()
            if (Number.isFinite(file.lastModified)) entry.modified = file.lastModified / 1000
          } catch { /* 읽지 못한 파일도 목록에는 유지한다. */ }
          assertCurrent()
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, documents.length) }, worker))
      assertCurrent()
      return listing()
    }
    return {
      text: listing(),
      withMetadata() {
        metadataPromise ??= readMetadata()
        return metadataPromise
      },
    }
  }

  return {
    name, rootURL, initialURL, rootHandle: handle.kind === 'directory' ? handle : null,
    prepareDirectory,
    async fileHandle(value) {
      const parsed = target(value)
      if (parsed.directory) throw new Error('ML_HANDLE_FILE_TYPE')
      const current = await resolve(parsed)
      assertActive()
      if (current.kind !== 'file') throw new Error('ML_HANDLE_FILE_TYPE')
      return current
    },
    async isSameFile(value, otherHandle) {
      const parsed = target(value)
      if (otherHandle?.kind !== 'file') return false
      const current = await resolve(parsed)
      assertActive()
      if (current.kind !== 'file') return false
      const same = await current.isSameEntry(otherHandle)
      assertActive()
      return same
    },
    async readText(value) {
      const parsed = target(value)
      if (parsed.directory) return (await prepareDirectory(value)).withMetadata()
      const current = await resolve(parsed)
      if (current.kind === 'file') {
        const text = await (await current.getFile()).text()
        assertActive()
        return text
      }
      return (await prepareDirectory(value)).withMetadata()
    },
    async imageURL(value) {
      const parsed = target(value)
      const generation = imageGeneration
      const extension = parsed.segments.at(-1)?.split('.').at(-1)?.toLowerCase()
      const type = IMAGE_TYPES.get(extension)
      if (parsed.directory || !type) throw new Error('ML_HANDLE_IMAGE_TYPE')
      const current = await resolve(parsed)
      const file = await current.getFile()
      assertActive()
      if (generation !== imageGeneration) throw new Error('ML_HANDLE_IMAGE_STALE')
      // SVG도 img 전용 URL이다. 문서 링크나 iframe의 주소로 사용하지 않는다.
      const url = URL.createObjectURL(file.slice(0, file.size, type))
      imageURLs.add(url)
      return url
    },
    releaseImages,
    dispose() {
      disposed = true
      releaseImages()
    },
  }
}
