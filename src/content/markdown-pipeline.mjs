import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import definitions from 'markdown-it-deflist'
import { markdownComments } from './markdown-comments.mjs'
import { markdownInline } from './markdown-inline.mjs'
import { markdownConvertedTables } from './markdown-converted-tables.mjs'
import { markdownStructure } from './markdown-structure.mjs'
import { markdownAlerts } from './markdown-alerts.mjs'
import { markdownFootnotes } from './markdown-footnotes.mjs'
import { markdownMath } from './markdown-math.mjs'
import { markdownDiagrams } from './markdown-diagrams.mjs'
import { markdownReviewSource } from './review-source.mjs'
import { markdownHtml } from './markdown-html.mjs'

// 화면 렌더링과 원본 표시 편집이 같은 문법 해석을 쓰도록 한 곳에서 구성한다.
/**
 * @param {{ t?: (key: string) => string, highlight?: (code: string, language: string) => string, getBaseURL?: () => string, getLocalImages?: () => boolean }} [options]
 * @returns {import('markdown-it').MarkdownIt}
 */
export function createMarkdown({ t = key => key, highlight, getBaseURL, getLocalImages } = {}) {
  return new MarkdownIt({ html: true, linkify: true, typographer: true, highlight })
    .use(markdownComments).use(taskLists, { enabled: false, label: true })
    .use(markdownInline)
    .use(markdownConvertedTables)
    .use(markdownStructure, { tocLabel: t('readerOutline') })
    .use(markdownAlerts, { t })
    .use(markdownFootnotes, { t })
    .use(definitions)
    .use(markdownMath)
    .use(markdownDiagrams)
    .use(markdownReviewSource)
    .use(markdownHtml, { getBaseURL, getLocalImages })
}
