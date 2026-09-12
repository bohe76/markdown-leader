import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const script = fileURLToPath(new URL('../scripts/check-version.mjs', import.meta.url))

function check(version, changelogVersion = version, builtVersion) {
  const directory = mkdtempSync(join(tmpdir(), 'markdown-leader-version-'))
  try {
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ version }))
    writeFileSync(join(directory, 'CHANGELOG.md'), `# 변경 이력\n\n## [Unreleased]\n\n## [${changelogVersion}] - 2026-09-07\n`)
    const args = [script]
    if (builtVersion !== undefined) {
      mkdirSync(join(directory, 'dist'))
      writeFileSync(join(directory, 'dist/manifest.json'), JSON.stringify({ version: builtVersion }))
      args.push('--built')
    }
    return spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8' })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('SemVer 및 Chrome 호환 버전이 빌드와 일치하면 통과한다', () => {
  for (const version of ['0.1.0', '1.0.0', '2.12.34', '65535.65535.65535']) {
    const result = check(version, version, version)
    assert.equal(result.status, 0, result.stderr)
  }
})

test('잘못된 형식, 접미사 및 Chrome 범위 초과를 거부한다', () => {
  for (const version of ['01.2.3', '1.2', '1.2.3.4', '1.0.0-beta.1', '1.0.0+build', '0.0.0', '65536.0.0']) {
    assert.equal(check(version).status, 1, version)
  }
})

test('변경 이력이나 빌드 버전 불일치는 실패한다', () => {
  assert.equal(check('0.2.0', '0.1.0').status, 1)
  assert.equal(check('0.2.0', '0.2.0', '0.1.0').status, 1)
})
