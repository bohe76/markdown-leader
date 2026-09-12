import alerts from 'markdown-it-github-alerts'

export function markdownAlerts(md, { t } = {}) {
  md.use(alerts, {
    titles: Object.fromEntries(['note', 'tip', 'important', 'warning', 'caution'].map((type) => [type, t(`alert${type[0].toUpperCase()}${type.slice(1)}`)])),
  })
  // 사용자 지정 제목도 원문 HTML을 실행하지 않도록 텍스트로 출력한다.
  md.renderer.rules.alert_open = (tokens, index) => {
    const { title, type } = tokens[index].meta
    return `<div class="markdown-alert markdown-alert-${md.utils.escapeHtml(type)}"><p class="markdown-alert-title">${md.utils.escapeHtml(title)}</p>`
  }
}
