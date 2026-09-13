import { execFileSync } from 'node:child_process'

export function buildInfo(version, release = false, cwd = process.cwd()) {
  let commit = null
  let dirty = null
  try {
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    commit = git('rev-parse', '--verify', 'HEAD')
    dirty = git('status', '--porcelain', '--untracked-files=normal') !== ''
  } catch {
    // 소스 ZIP에는 Git 정보가 없을 수 있다. 제출본으로 오인하지 않도록 표시한다.
  }
  if (release && (!commit || dirty !== false)) throw new Error('제출 빌드는 Git 정보와 커밋된 깨끗한 작업 트리가 필요합니다.')
  const displayVersion = release ? version : `${version}-dev.${commit?.slice(0, 7) ?? 'unknown'}${dirty ? '-dirty' : ''}`
  return { version, displayVersion, channel: release ? 'release' : 'development', commit, dirty }
}
