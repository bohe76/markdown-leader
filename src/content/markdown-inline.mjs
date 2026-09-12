import { full as emoji } from 'markdown-it-emoji'
import superscript from 'markdown-it-sup'
import subscript from 'markdown-it-sub'
import inserted from 'markdown-it-ins'
import marked from 'markdown-it-mark'

export function markdownInline(md) {
  md.use(emoji, { shortcuts: {} })
    .use(superscript)
    .use(subscript)
    .use(inserted)
    .use(marked)
}
