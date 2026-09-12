import footnote from 'markdown-it-footnote'

export function markdownFootnotes(md, { t } = {}) {
  md.use(footnote)
  const backref = md.renderer.rules.footnote_anchor
  md.renderer.rules.footnote_anchor = (...args) => backref(...args).replace('class="footnote-backref"', `class="footnote-backref" aria-label="${md.utils.escapeHtml(t('footnoteReturn'))}"`)
}
