import test from 'node:test'
import assert from 'node:assert/strict'
import { readablePDFScale } from '../src/content/pdf-output.mjs'

test('PDF 축소 85%와 본문 12px 경계는 둘 다 충족해야 한다', () => {
  for (const [scale, expected] of [[0.849, false], [0.85, true], [0.851, true]]) {
    assert.equal(readablePDFScale(scale, 20), expected, String(scale))
  }
  for (const [effective, expected] of [[11.9, false], [12, true], [12.1, true]]) {
    assert.equal(readablePDFScale(0.9, effective / 0.9), expected, String(effective))
  }
  assert.equal(readablePDFScale(0.84, 30), false)
  assert.equal(readablePDFScale(0.9, 12), false)
})
