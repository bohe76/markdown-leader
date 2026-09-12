import test from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { markdownStructure, populateDocumentToc } from '../src/content/markdown-structure.mjs'

test('기본 Markdown과 달리 독립된 [[TOC]]만 문서 목차 placeholder로 렌더링한다', () => {
  const plain = new MarkdownIt()
  assert.match(plain.render('[[TOC]]'), /<p>\[\[TOC\]\]<\/p>/)

  const md = new MarkdownIt().use(markdownStructure, { tocLabel: '목차 <전체> & "링크"' })
  const html = md.render('앞 문단\n\n[[toc]]\n\n중간\n\n[[TOC]]')
  assert.equal((html.match(/class="ml-document-toc"/g) || []).length, 2)
  assert.match(html, /aria-label="목차 &lt;전체&gt; &amp; &quot;링크&quot;"/)
  assert.doesNotMatch(html, /<p>\[\[(?:toc|TOC)\]\]<\/p>/)
})

test('코드 안이나 다른 텍스트와 같은 줄의 [[TOC]]는 해석하지 않는다', () => {
  const md = new MarkdownIt().use(markdownStructure, { tocLabel: 'Outline' })
  const html = md.render('```md\n[[TOC]]\n```\n\n`[[TOC]]`\n\n앞 [[TOC]] 뒤\n\n[[TOC]] extra')
  assert.doesNotMatch(html, /ml-document-toc/)
  assert.match(html, /<code class="language-md">\[\[TOC\]\]/)
  assert.match(html, /<code>\[\[TOC\]\]<\/code>/)
  assert.match(html, /앞 \[\[TOC\]\] 뒤/)
})

test('문서 시작 Front Matter를 숨기고 정규화된 원문을 env에 보존한다', () => {
  const md = new MarkdownIt().use(markdownStructure)
  const env = { settings: { theme: 'dark' } }
  const html = md.render('\uFEFF---\r\ntitle: 문서\r\ntags: [a, b]\r\n...\r\n# 제목', env)

  assert.equal(html, '<h1>제목</h1>\n')
  assert.equal(env.frontMatter, 'title: 문서\ntags: [a, b]\n')
  assert.deepEqual(env.settings, { theme: 'dark' })
})

test('Front Matter가 아니거나 닫히지 않은 구분자는 원문을 보이게 유지한다', () => {
  const md = new MarkdownIt().use(markdownStructure)

  const unterminated = md.render('---\ntitle: 문서\n# 제목')
  assert.match(unterminated, /<hr>/)
  assert.match(unterminated, /title: 문서/)
  assert.match(unterminated, /<h1>제목<\/h1>/)

  const thematicBreaks = md.render('---\n\n---\n\n본문')
  assert.equal((thematicBreaks.match(/<hr>/g) || []).length, 2)
  assert.match(thematicBreaks, /<p>본문<\/p>/)

  const notAtStart = md.render('\n---\ntitle: 문서\n---\n본문')
  assert.match(notAtStart, /title: 문서/)
  assert.doesNotMatch(notAtStart, /frontMatter/)
})

test('인용문과 목록 안의 구분자는 Front Matter로 소비하지 않는다', () => {
  const md = new MarkdownIt().use(markdownStructure)
  const quoteEnv = {}
  const quote = md.render('> ---\n> title: Quote\n> ---', quoteEnv)
  assert.match(quote, /<blockquote>/)
  assert.match(quote, /title: Quote/)
  assert.equal(quoteEnv.frontMatter, undefined)

  const listEnv = {}
  const list = md.render('- item\n\n  ---\n  title: List\n  ---', listEnv)
  assert.match(list, /<ul>/)
  assert.match(list, /title: List/)
  assert.equal(listEnv.frontMatter, undefined)
})

test('구분자 사이의 URL은 YAML 매핑 키로 오인하지 않는다', () => {
  const md = new MarkdownIt().use(markdownStructure)
  for (const text of ['https://example.com', 'foo:bar']) {
    const env = {}
    assert.ok(md.render(`---\n${text}\n---`, env).includes(text))
    assert.equal(env.frontMatter, undefined)
  }
})

class TestElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase()
    this.ownerDocument = ownerDocument
    this.children = []
    this.attributes = new Map()
    this.className = ''
    this.id = ''
    this.textContent = ''
  }

  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = [...children] }
  setAttribute(name, value) { this.attributes.set(name, String(value)) }
  getAttribute(name) { return this.attributes.get(name) ?? null }

  querySelectorAll(selector) {
    const tags = selector.split(',').map((part) => part.trim().toUpperCase())
    const matches = (element) => selector === 'nav.ml-document-toc'
      ? element.tagName === 'NAV' && element.className.split(/\s+/).includes('ml-document-toc')
      : tags.includes(element.tagName)
    const found = []
    const visit = (element) => {
      for (const child of element.children) {
        if (matches(child)) found.push(child)
        visit(child)
      }
    }
    visit(this)
    return found
  }
}

class TestDocument {
  createElement(tagName) { return new TestElement(tagName, this) }
}

function addElement(parent, tagName, properties = {}) {
  const element = parent.ownerDocument.createElement(tagName)
  Object.assign(element, properties)
  parent.append(element)
  return element
}

test('각 placeholder에 기존 heading ID를 재사용한 계층형 목차를 만든다', () => {
  const document = new TestDocument()
  const content = new TestElement('main', document)
  addElement(content, 'h2', { id: '개요', textContent: '개요 <시작>' })
  addElement(content, 'h4', { id: '세부-항목', textContent: '세부 & 항목' })
  addElement(content, 'h3', { id: '개요-2', textContent: '개요 <시작>' })
  const first = addElement(content, 'nav', { className: 'ml-document-toc' })
  const second = addElement(content, 'nav', { className: 'ml-document-toc' })

  populateDocumentToc(content)

  for (const placeholder of [first, second]) {
    assert.equal(placeholder.children.length, 1)
    const rootList = placeholder.children[0]
    assert.equal(rootList.tagName, 'UL')
    assert.equal(rootList.children.length, 1)
    const topItem = rootList.children[0]
    assert.equal(topItem.children[0].textContent, '개요 <시작>')
    assert.equal(topItem.children[0].getAttribute('href'), '#%EA%B0%9C%EC%9A%94')
    const nestedList = topItem.children[1]
    assert.equal(nestedList.children.length, 2)
    assert.equal(nestedList.children[0].children[0].getAttribute('href'), '#%EC%84%B8%EB%B6%80-%ED%95%AD%EB%AA%A9')
    assert.equal(nestedList.children[1].children[0].getAttribute('href'), '#%EA%B0%9C%EC%9A%94-2')
    assert.equal(nestedList.children[0].children[0].textContent, '세부 & 항목')
  }
  assert.equal(content.querySelectorAll('h1,h2,h3,h4,h5,h6').length, 3)
})

test('제목이 없으면 placeholder를 빈 상태로 유지한다', () => {
  const document = new TestDocument()
  const content = new TestElement('main', document)
  const placeholder = addElement(content, 'nav', { className: 'ml-document-toc' })
  populateDocumentToc(content)
  assert.deepEqual(placeholder.children, [])
})
