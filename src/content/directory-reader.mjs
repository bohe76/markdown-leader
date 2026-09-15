// 한 번의 트리 갱신 안에서 목록을 공유하고, 디렉터리 읽기를 지정한 상한 안에서 실행한다.
export function createDirectoryReader({ prepare, isCurrent, maxConcurrent = 3 }) {
  const listings = new Map()
  const queue = []
  const concurrency = Math.max(1, Math.min(100, Math.trunc(maxConcurrent) || 3))
  let active = 0
  function drain() {
    while (active < concurrency && queue.length) {
      const { work, resolve, reject } = queue.shift()
      if (!isCurrent()) {
        reject(new DOMException('Directory read cancelled', 'AbortError'))
        continue
      }
      active++
      void (async () => {
        try { resolve(await work()) } catch (error) { reject(error) }
        finally { active--; drain() }
      })()
    }
  }
  function schedule(work) {
    return new Promise((resolve, reject) => { queue.push({ work, resolve, reject }); drain() })
  }
  return {
    async read(url, metadata = false) {
      if (!isCurrent()) throw new DOMException('Directory read cancelled', 'AbortError')
      if (!listings.has(url)) listings.set(url, schedule(() => prepare(url)))
      const listing = await listings.get(url)
      if (!isCurrent()) throw new DOMException('Directory read cancelled', 'AbortError')
      if (!metadata) return listing.text
      if (!listing.metadata) listing.metadata = schedule(() => listing.withMetadata())
      const text = await listing.metadata
      if (!isCurrent()) throw new DOMException('Directory read cancelled', 'AbortError')
      return text
    },
  }
}
