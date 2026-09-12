import test from 'node:test'
import assert from 'node:assert/strict'
import { createHandleSource } from '../src/content/handle-source.mjs'
import { parseDirectoryListing } from '../src/core.mjs'

function file(name, contents = '# 문서') {
  return { kind: 'file', name, contents, reads: 0, async getFile() { this.reads++; return new Blob([this.contents]) } }
}

function directory(name, children = []) {
  const entries = new Map(children.map(child => [child.name, child]))
  return {
    kind: 'directory', name, children: entries,
    async *entries() { yield* entries },
    async getDirectoryHandle(name, options) {
      assert.equal(options, undefined, '생성 옵션을 전달하지 않는다')
      const child = entries.get(name)
      if (child?.kind !== 'directory') throw new Error('NotFoundError')
      return child
    },
    async getFileHandle(name, options) {
      assert.equal(options, undefined, '생성 옵션을 전달하지 않는다')
      const child = entries.get(name)
      if (child?.kind !== 'file') throw new Error('NotFoundError')
      return child
    },
  }
}

test('폴더 이름을 먼저 반환하고 수정일은 같은 핸들에서 요청할 때 한 번만 읽는다', async () => {
  const document = file('doc.md')
  document.getFile = async () => { document.reads++; return { lastModified: 1234567 } }
  const image = file('image.png')
  const root = directory('root', [document, image, directory('nested')])
  let enumerations = 0
  const entries = root.entries.bind(root)
  root.entries = async function* () { enumerations++; yield* entries() }
  const source = createHandleSource(root)
  const prepared = await source.prepareDirectory(source.rootURL)
  assert.equal(document.reads, 0)
  assert.equal(parseDirectoryListing(prepared.text, source.rootURL).find(entry => entry.name === 'doc.md').modifiedAt, undefined)
  root.children.set('doc.md', { kind: 'file', name: 'doc.md', getFile() { assert.fail('목록을 읽을 때 확보한 핸들을 사용해야 한다') } })
  const first = prepared.withMetadata()
  assert.equal(prepared.withMetadata(), first)
  const enriched = parseDirectoryListing(await first, source.rootURL)
  assert.equal(enriched.find(entry => entry.name === 'doc.md').modifiedAt, 1234567)
  assert.equal(await prepared.withMetadata(), await first)
  assert.equal(enumerations, 1)
  assert.equal(document.reads, 1)
  assert.equal(image.reads, 0)
  assert.equal(parseDirectoryListing(prepared.text, source.rootURL).find(entry => entry.name === 'doc.md').modifiedAt, undefined)
})

test('수정일 조회는 최대 네 파일을 동시에 읽으며 모든 문서에 최신 정보를 반영한다', async () => {
  let active = 0
  let maximum = 0
  const documents = Array.from({ length: 13 }, (_, index) => ({
    kind: 'file', name: `${index}.md`,
    async getFile() {
      active++
      maximum = Math.max(maximum, active)
      await new Promise(resolve => setImmediate(resolve))
      active--
      return { lastModified: (index + 1) * 1000 }
    },
  }))
  const source = createHandleSource(directory('root', documents))
  const parsed = parseDirectoryListing(await source.readText(source.rootURL), source.rootURL)
  assert.equal(maximum, 4)
  assert.equal(active, 0)
  assert.equal(parsed.length, 13)
  for (const entry of parsed) assert.equal(entry.modifiedAt, (Number.parseInt(entry.name) + 1) * 1000)
})

test('취소되거나 해제된 수정일 조회는 대기 파일을 더 읽지 않고 늦은 결과를 거부한다', async () => {
  for (const dispose of [false, true]) {
    let current = true
    const pendingReads = []
    const documents = Array.from({ length: 9 }, (_, index) => ({
      kind: 'file', name: `${index}.md`,
      getFile() { return new Promise(resolve => pendingReads.push(resolve)) },
    }))
    const source = createHandleSource(directory('root', documents))
    const prepared = await source.prepareDirectory(source.rootURL, { isCurrent: () => current })
    const pending = prepared.withMetadata()
    assert.equal(pendingReads.length, 4)
    const rejected = assert.rejects(pending, dispose ? /ML_HANDLE_DISPOSED/ : { name: 'AbortError', message: 'ML_HANDLE_DIRECTORY_STALE' })
    if (dispose) source.dispose()
    else current = false
    for (const finish of pendingReads) finish({ lastModified: 1000 })
    await rejected
    assert.equal(pendingReads.length, 4)
  }
})

test('수정일 조회 시작 전에 취소하거나 해제하면 파일을 읽지 않는다', async () => {
  for (const dispose of [false, true]) {
    let current = true
    const document = file('doc.md')
    const source = createHandleSource(directory('root', [document]))
    const prepared = await source.prepareDirectory(source.rootURL, { isCurrent: () => current })
    if (dispose) source.dispose()
    else current = false
    await assert.rejects(prepared.withMetadata(), dispose ? /ML_HANDLE_DISPOSED/ : { name: 'AbortError' })
    assert.equal(document.reads, 0)
  }
})

test('수정일 조회 실패와 잘못된 수정일은 문서를 숨기지 않고 미확인으로 유지한다', async () => {
  const source = createHandleSource(directory('root', [
    { kind: 'file', name: 'deleted.md', async getFile() { throw new Error('NotFoundError') } },
    { kind: 'file', name: 'invalid.md', async getFile() { return { lastModified: NaN } } },
    { kind: 'file', name: 'valid.md', async getFile() { return { lastModified: 5000 } } },
  ]))
  const parsed = parseDirectoryListing(await source.readText(source.rootURL), source.rootURL)
  assert.equal(parsed.length, 3)
  assert.equal(parsed.find(entry => entry.name === 'deleted.md').modifiedAt, undefined)
  assert.equal(parsed.find(entry => entry.name === 'invalid.md').modifiedAt, undefined)
  assert.equal(parsed.find(entry => entry.name === 'valid.md').modifiedAt, 5000)
})

test('폴더 목록은 기존 필터와 연결되고 특수문자 이름과 경로를 보존한다', async () => {
  const names = ['한글 #100%.md', '<img onerror="bad"> & \'문서\'.md', 'literal%2F.md']
  const root = directory('선택 폴더', [...names.map(name => file(name, name)), file('image.png'), directory('하위 # %')])
  const source = createHandleSource(root)
  assert.equal(source.name, root.name)
  assert.equal(source.initialURL, null)
  const listing = await source.readText(source.rootURL)
  assert.equal(listing.includes('<img'), false)
  assert.ok(listing.includes('image.png'), '어댑터는 비 Markdown 항목도 파서에 넘긴다')
  const parsed = parseDirectoryListing(listing, source.rootURL)
  assert.equal(parsed.length, 4)
  assert.equal(parsed[0].type, 'directory')
  for (const name of names) {
    const entry = parsed.find(entry => entry.name === name)
    assert.ok(entry, name)
    assert.equal(await source.readText(entry.url), name)
  }
  source.dispose()
})

test('파일은 매번 다시 읽고 하위 폴더 추가와 삭제도 새로 반영한다', async () => {
  const document = file('readme.md', 'before')
  const nested = directory('nested', [document])
  const source = createHandleSource(directory('root', [nested]))
  const target = `${source.rootURL}nested/readme.md`
  assert.equal(await source.readText(target), 'before')
  document.contents = 'after'
  assert.equal(await source.readText(`${target}#section`), 'after')
  assert.equal(document.reads, 2)
  nested.children.set('new.mdx', file('new.mdx'))
  assert.equal(parseDirectoryListing(await source.readText(`${source.rootURL}nested/`), `${source.rootURL}nested/`).length, 2)
  nested.children.delete('readme.md')
  await assert.rejects(source.readText(target), /NotFoundError/)
})

test('선택 범위 밖 URL과 인코딩된 경로 구분자를 거부한다', async () => {
  const source = createHandleSource(directory('root', [file('safe.md')]))
  const foreign = createHandleSource(directory('other'))
  for (const url of [
    'file:///C:/secret.md', 'https://example.com/safe.md', foreign.rootURL,
    `${source.rootURL}../secret.md`, `${source.rootURL}%2e%2e/secret.md`,
    `${source.rootURL}%2fsecret.md`, `${source.rootURL}%5csecret.md`,
    `${source.rootURL}%00.md`, `${source.rootURL}bad%.md`,
  ]) await assert.rejects(source.readText(url), /ML_HANDLE_OUTSIDE_SCOPE/, url)
})

test('단일 파일은 그 파일만 읽고 주변 폴더와 다른 파일은 접근하지 않는다', async () => {
  const selected = file('한글 # %.md')
  const source = createHandleSource(selected)
  assert.equal(source.rootURL, null)
  assert.equal(await source.readText(source.initialURL), selected.contents)
  await assert.rejects(source.readText(new URL('.', source.initialURL).href), /ML_HANDLE_OUTSIDE_SCOPE/)
  await assert.rejects(source.readText(new URL('other.md', source.initialURL).href), /ML_HANDLE_OUTSIDE_SCOPE/)
})

test('폴더 항목 2000개까지 반환하고 초과 시 부분 목록 대신 오류를 반환한다', async () => {
  const root = directory('root', Array.from({ length: 2000 }, (_, index) => file(`${index}.md`)))
  const source = createHandleSource(root)
  assert.equal(parseDirectoryListing(await source.readText(source.rootURL), source.rootURL).length, 2000)
  root.children.set('overflow.md', file('overflow.md'))
  await assert.rejects(source.readText(source.rootURL), /ML_HANDLE_DIRECTORY_LIMIT/)
})

test('이미지는 최신 바이트와 고정 이미지 MIME으로 읽고 해제 시 모든 Blob URL을 폐기한다', async () => {
  const image = file('image.png', 'first')
  const source = createHandleSource(directory('root', [image, file('vector.svg', '<svg/>'), file('page.html')]))
  const first = await source.imageURL(`${source.rootURL}image.png`)
  image.contents = 'second'
  const second = await source.imageURL(`${source.rootURL}image.png`)
  assert.notEqual(first, second)
  assert.equal(await (await fetch(first)).text(), 'first')
  const response = await fetch(second)
  assert.equal(response.headers.get('content-type'), 'image/png')
  assert.equal(await response.text(), 'second')
  const svg = await source.imageURL(`${source.rootURL}vector.svg`)
  assert.equal((await fetch(svg)).headers.get('content-type'), 'image/svg+xml')
  await assert.rejects(source.imageURL(`${source.rootURL}page.html`), /ML_HANDLE_IMAGE_TYPE/)
  await assert.rejects(source.imageURL('file:///outside.png'), /ML_HANDLE_OUTSIDE_SCOPE/)
  source.dispose()
  source.dispose()
  for (const url of [first, second, svg]) await assert.rejects(fetch(url))
  await assert.rejects(source.readText(source.rootURL), /ML_HANDLE_DISPOSED/)
  await assert.rejects(source.imageURL(`${source.rootURL}image.png`), /ML_HANDLE_DISPOSED/)
})

test('읽는 중 해제된 소스는 늦은 결과나 새 Blob URL을 반환하지 않는다', async () => {
  for (const image of [false, true]) {
    let finish
    const selected = file(image ? 'image.png' : 'doc.md')
    selected.getFile = () => new Promise(resolve => { finish = resolve })
    const source = createHandleSource(selected)
    const pending = image ? source.imageURL(source.initialURL) : source.readText(source.initialURL)
    await new Promise(resolve => setImmediate(resolve))
    source.dispose()
    finish(new Blob(['late']))
    await assert.rejects(pending, /ML_HANDLE_DISPOSED/)
  }
})

test('이미지만 해제하면 해당 소스의 Blob만 폐기하고 다음 문서와 이미지는 계속 읽는다', async () => {
  const source = createHandleSource(directory('root', [file('image.png'), file('doc.md')]))
  const other = createHandleSource(file('other.png', 'other'))
  const oldURL = await source.imageURL(`${source.rootURL}image.png`)
  const otherURL = await other.imageURL(other.initialURL)
  source.releaseImages()
  source.releaseImages()
  await assert.rejects(fetch(oldURL))
  assert.equal(await (await fetch(otherURL)).text(), 'other')
  assert.equal(await source.readText(`${source.rootURL}doc.md`), '# 문서')
  const newURL = await source.imageURL(`${source.rootURL}image.png`)
  assert.equal(await (await fetch(newURL)).text(), '# 문서')
  source.dispose()
  other.dispose()
  await assert.rejects(fetch(newURL))
  await assert.rejects(fetch(otherURL))
})

test('이미지 해제 전에 시작한 비동기 읽기는 늦은 Blob을 만들지 않는다', async () => {
  let finish
  const selected = file('image.png')
  selected.getFile = () => new Promise(resolve => { finish = resolve })
  const source = createHandleSource(selected)
  const pending = source.imageURL(source.initialURL)
  await new Promise(resolve => setImmediate(resolve))
  source.releaseImages()
  finish({ slice() { assert.fail('이전 이미지 세대는 Blob 생성 전에 차단해야 한다') } })
  await assert.rejects(pending, /ML_HANDLE_IMAGE_STALE/)
  selected.getFile = async () => new Blob(['current'])
  const currentURL = await source.imageURL(source.initialURL)
  assert.equal(await (await fetch(currentURL)).text(), 'current')
  source.dispose()
})

test('파일 동일성은 파일명 대신 실제 핸들 항목으로 비교하고 본문은 읽지 않는다', async () => {
  const selected = file('doc.md')
  const sameEntry = file('doc.md')
  const differentEntry = file('doc.md')
  const compared = []
  selected.isSameEntry = async other => { compared.push(other); return other === sameEntry }
  for (const root of [selected, directory('root', [directory('nested', [selected])])]) {
    const source = createHandleSource(root)
    const target = source.initialURL || `${source.rootURL}nested/doc.md`
    assert.equal(await source.isSameFile(`${target}#section`, sameEntry), true)
    assert.equal(await source.isSameFile(target, differentEntry), false)
    source.dispose()
  }
  assert.deepEqual(compared, [sameEntry, differentEntry, sameEntry, differentEntry])
  assert.equal(selected.reads, 0)
})

test('파일 동일성 비교는 선택 범위를 지키고 파일이 아닌 항목은 false를 반환한다', async () => {
  const selected = file('doc.md')
  selected.isSameEntry = () => { assert.fail('유효하지 않은 항목은 비교하지 않는다') }
  const source = createHandleSource(directory('root', [selected]))
  const target = `${source.rootURL}doc.md`
  for (const other of [null, undefined, directory('other')]) {
    assert.equal(await source.isSameFile(target, other), false)
  }
  assert.equal(await source.isSameFile(source.rootURL, selected), false)
  await assert.rejects(source.isSameFile('file:///outside.md', selected), /ML_HANDLE_OUTSIDE_SCOPE/)
  source.dispose()
  await assert.rejects(source.isSameFile(target, selected), /ML_HANDLE_DISPOSED/)
  await assert.rejects(source.isSameFile(target, null), /ML_HANDLE_DISPOSED/)
})

test('동일성 비교 중 해제된 소스는 늦은 비교 결과를 반환하지 않는다', async () => {
  let finish
  const selected = file('doc.md')
  selected.isSameEntry = () => new Promise(resolve => { finish = resolve })
  const source = createHandleSource(selected)
  const pending = source.isSameFile(source.initialURL, selected)
  await new Promise(resolve => setImmediate(resolve))
  source.dispose()
  finish(true)
  await assert.rejects(pending, /ML_HANDLE_DISPOSED/)
})

test('파일 핸들은 단일 선택과 폴더 경로 모두 동일한 원본을 읽기 없이 반환한다', async () => {
  const selected = file('한글 # %.md')
  for (const root of [selected, directory('root', [directory('nested', [selected])])]) {
    const source = createHandleSource(root)
    const target = source.initialURL || `${source.rootURL}nested/${encodeURIComponent(selected.name)}`
    assert.equal(await source.fileHandle(`${target}#section`), selected)
    assert.equal(selected.reads, 0)
    await assert.rejects(source.fileHandle('file:///outside.md'), /ML_HANDLE_OUTSIDE_SCOPE/)
    source.dispose()
    await assert.rejects(source.fileHandle(target), /ML_HANDLE_DISPOSED/)
  }
})

test('파일 핸들 조회는 디렉터리와 조회 중 해제된 소스를 거부한다', async () => {
  let finish
  const selected = file('doc.md')
  const root = directory('root', [directory('nested')])
  const source = createHandleSource(root)
  await assert.rejects(source.fileHandle(source.rootURL), /ML_HANDLE_FILE_TYPE/)
  await assert.rejects(source.fileHandle(`${source.rootURL}nested/`), /ML_HANDLE_FILE_TYPE/)
  root.getFileHandle = () => new Promise(resolve => { finish = resolve })
  const pending = source.fileHandle(`${source.rootURL}doc.md`)
  await new Promise(resolve => setImmediate(resolve))
  source.dispose()
  finish(selected)
  await assert.rejects(pending, /ML_HANDLE_DISPOSED/)
})
