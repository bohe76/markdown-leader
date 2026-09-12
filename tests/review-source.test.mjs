import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import { parseReview, writeReview, patchTask, markdownReviewSource } from '../src/content/review-source.mjs'

const note = { id: 'n1', quote: '본문', prefix: '', suffix: '', heading: '제목', text: '검토 --> <script>&', createdAt: '2026-09-09' }
test('메모 저장과 삭제는 BOM, CRLF, 마지막 개행을 정확히 복원한다', () => {
  for (const raw of ['\uFEFF# 제목\r\n\r\n본문\r\n', '본문', '본문\n\n', '']) {
    const result = writeReview(raw, [note])
    assert.deepEqual(parseReview(result), { body: raw, notes: [note] })
    assert.equal(writeReview(result, []), raw)
    assert.equal(writeReview(result, [note]), result)
    assert.ok(!result.includes('<script>'))
    assert.equal(result.match(/-->/g).length, 1)
  }
})
test('예약 주석 손상과 중복은 덮어쓰지 않는다', () => {
  for (const raw of ['<!-- MARKDOWN-LEADER:NOTES:START\n{}', '<!-- MARKDOWN-LEADER:NOTES:START -->', writeReview('본문', [note]) + '\n본문']) {
    assert.throws(() => writeReview(raw, [note]), { code: 'review-invalid' })
  }
  assert.throws(() => writeReview('', [note, note]), { code: 'review-invalid' })
})
test('외부 에디터가 메모 뒤에 넣은 개행은 허용하고 갱신과 삭제 때 보존한다', () => {
  const raw = writeReview('본문\r\n', [note]) + '\r\n'
  assert.equal(parseReview(raw).body, '본문\r\n')
  assert.equal(parseReview(raw).notes[0].id, note.id)
  assert.equal(writeReview(raw, [note]), raw)
  assert.equal(writeReview(raw, []), '본문\r\n\r\n')
})
test('코드 속 예약 마커는 메모로 읽지 않으며 닫히지 않은 펜스에는 저장하지 않는다', () => {
  const raw = '```html\n<!-- MARKDOWN-LEADER:NOTES:START -->\n```'
  assert.deepEqual(parseReview(raw), { body: raw, notes: [] })
  assert.equal(parseReview(writeReview(raw, [note])).body, raw)
  assert.throws(() => writeReview('```\n본문', [note]), { code: 'review-invalid' })
})
test('체크박스는 실제 리스트 행 한 글자만 변경하고 코드와 표는 거부한다', () => {
  const raw = '\uFEFF- [ ] 첫째\r\n  - [X] 둘째\r\n\r\n```\r\n- [ ] 코드\r\n```\r\n\r\n| 값 |\r\n| --- |\r\n| [ ] 표 |'
  assert.equal(patchTask(raw, 0, true), raw.replace('[ ] 첫째', '[x] 첫째'))
  assert.equal(patchTask(raw, 1, false), raw.replace('[X] 둘째', '[ ] 둘째'))
  assert.throws(() => patchTask(raw, 4, true), { code: 'review-invalid' })
  assert.throws(() => patchTask(raw, 9, true), { code: 'review-invalid' })
  assert.equal(patchTask('> - [ ] 인용', 0, true), '> - [x] 인용')
})
test('렌더링 체크박스는 실제 소스 행과 블록 범위를 전달한다', () => {
  const md = new MarkdownIt().use(taskLists, { enabled: true, label: true }).use(markdownReviewSource)
  const html = md.render('# 제목\n\n- [ ] 일\n  - [x] 이')
  assert.match(html, /data-source-start="0" data-source-end="1"/)
  assert.match(html, /data-task-line="2"/)
  assert.match(html, /data-task-line="3"/)
})
