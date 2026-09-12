import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const python = resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')
if (!existsSync(python)) {
  console.error('프로젝트 .venv가 없습니다. docs/operations/local_install.md의 개발 환경 준비를 먼저 실행하세요.')
  process.exitCode = 1
} else {
  const result = spawnSync(python, process.argv.slice(2), { cwd: root, stdio: 'inherit' })
  if (result.error) console.error(result.error.message)
  process.exitCode = result.status ?? 1
}
