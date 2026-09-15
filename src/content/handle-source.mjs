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

  return {
    name, rootURL, initialURL, rootHandle: handle.kind === 'directory' ? handle : null,
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
      const current = await resolve(parsed)
      if (current.kind === 'file') {
        const text = await (await current.getFile()).text()
        assertActive()
        return text
      }
      const rows = []
      for await (const [childName, child] of current.entries()) {
        assertActive()
        if (rows.length >= 2000) throw new Error('ML_HANDLE_DIRECTORY_LIMIT')
        safeName(childName)
        const directory = child.kind === 'directory'
        const href = `${encodeURIComponent(childName)}${directory ? '/' : ''}`
        // 기존 디렉터리 파서의 데이터 형식을 사용하며 스크립트로 실행하지 않는다.
        rows.push(`addRow(${listingString(childName)}, ${listingString(href)}, ${directory ? 1 : 0});`)
      }
      assertActive()
      return rows.join('\n')
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
