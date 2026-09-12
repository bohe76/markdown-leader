import { readFileSync } from 'node:fs'

try {
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'))
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    throw new Error('버전은 접미사와 앞자리 0이 없는 MAJOR.MINOR.PATCH 형식이어야 합니다.')
  }
  const parts = version.split('.').map(Number)
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0)) {
    throw new Error('Chrome 버전의 각 숫자는 0~65535이고, 모두 0일 수 없습니다.')
  }
  const changelog = readFileSync('CHANGELOG.md', 'utf8')
  const latest = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\r?$/m.exec(changelog)
  if (latest?.[1] !== version) {
    throw new Error(`CHANGELOG.md의 최신 버전 항목을 ## [${version}] - YYYY-MM-DD 형식으로 작성하세요.`)
  }
  if (process.argv.includes('--built')) {
    const manifest = JSON.parse(readFileSync('dist/manifest.json', 'utf8'))
    if (manifest.version !== version) throw new Error('빌드 manifest와 package.json 버전이 다릅니다.')
  }
  console.log(`버전 확인 통과: ${version}`)
} catch (error) {
  console.error(`버전 확인 실패: ${error.message}`)
  process.exitCode = 1
}
