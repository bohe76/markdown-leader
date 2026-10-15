// 파일 URL 문서와 연결한 폴더(파일 URL 디렉터리 주소)를 대응시키는 순수 경로 계산이다.

// 경로를 인코딩된 조각과 디코딩한 이름으로 나눈다. UNC(호스트가 있는 주소), 빈 조각, 잘못된 인코딩은 연결하지 않는다.
function fileSegments(value) {
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'file:' || url.host) return null
  const raw = url.pathname.split('/').slice(1)
  if (raw.length < 2 || raw.some(segment => !segment)) return null
  try { return { raw, names: raw.map(segment => decodeURIComponent(segment)) } } catch { return null }
}

/**
 * 파일을 담은 상위 폴더 주소를 가까운 폴더부터 돌려준다. segments는 그 폴더에서 파일까지의 디코딩한 상대 경로다.
 * @param {string} fileURL
 * @returns {{ url: string, name: string, segments: string[] }[]}
 */
export function folderLinkCandidates(fileURL) {
  const path = fileSegments(fileURL)
  if (!path) return []
  const result = []
  for (let index = path.raw.length - 2; index >= 0; index--) {
    result.push({ url: `file:///${path.raw.slice(0, index + 1).join('/')}/`, name: path.names[index], segments: path.names.slice(index + 1) })
  }
  return result
}

/**
 * 선택 창에 붙여 넣을 운영체제 경로(파일과 그 파일을 담은 폴더)를 돌려준다. 드라이브 문자로 시작하면 Windows 표기를 쓴다.
 * 연결 후보를 만들 수 없는 주소(UNC 등)는 null이다.
 * @param {string} fileURL
 * @returns {{ file: string, folder: string } | null}
 */
export function localPaths(fileURL) {
  const path = fileSegments(fileURL)
  if (!path) return null
  const folder = path.names.slice(0, -1)
  if (/^[A-Za-z]:$/.test(path.names[0])) {
    return { file: path.names.join('\\'), folder: folder.length === 1 ? `${folder[0]}\\` : folder.join('\\') }
  }
  return { file: `/${path.names.join('/')}`, folder: `/${folder.join('/')}` }
}

/**
 * 고른 폴더 이름과 같은 상위 폴더 위치를 가까운 폴더부터 돌려준다. 내용 확인 전의 후보일 뿐이다.
 * @param {string} fileURL
 * @param {string} folderName
 */
export function matchingFolders(fileURL, folderName) {
  const name = String(folderName).normalize('NFC')
  return folderLinkCandidates(fileURL).filter(candidate => candidate.name.normalize('NFC') === name)
}
