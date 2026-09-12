import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildInfo } from '../scripts/build-info.mjs'

test('빌드 식별자는 Git 없음, 커밋, 미커밋 변경과 제출 모드를 구분한다', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ml-build-info-'))
  const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  try {
    assert.equal(buildInfo('1.0.0', false, cwd).displayVersion, '1.0.0-dev.unknown')
    assert.throws(() => buildInfo('1.0.0', true, cwd))
    git('init')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'test')
    const clean = buildInfo('1.0.0', false, cwd)
    assert.match(clean.displayVersion, /^1\.0\.0-dev\.[a-f0-9]{7}$/)
    assert.equal(clean.dirty, false)
    assert.equal(buildInfo('1.0.0', true, cwd).displayVersion, '1.0.0')
    writeFileSync(join(cwd, 'new.txt'), 'new')
    assert.equal(buildInfo('1.0.0', false, cwd).displayVersion, `${clean.displayVersion}-dirty`)
    assert.throws(() => buildInfo('1.0.0', true, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
