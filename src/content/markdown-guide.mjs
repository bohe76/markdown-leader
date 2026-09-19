const githubRules = [
  ['markdownGuideStrikeDoubleSyntax', 'markdownGuideStrikeResult', 'strike'],
  ['markdownGuideSubscriptSyntax', 'markdownGuideSubscriptResult', 'subscript'],
  ['markdownGuideSuperscriptSyntax', 'markdownGuideSuperscriptResult', 'superscript'],
  ['markdownGuideUnderlineSyntax', 'markdownGuideUnderlineResult', 'underline'],
  ['markdownGuideBreakSyntax', 'markdownGuideBreakResult', 'break'],
]

const extensionRules = [
  ['markdownGuideInsertSyntax', 'markdownGuideInsertResult', 'insert'],
  ['markdownGuideMarkSyntax', 'markdownGuideMarkResult', 'mark'],
  ['markdownGuideEmojiSyntax', 'markdownGuideEmojiResult', 'emoji'],
]

function createRenderedPreview(document, t, syntaxKey, kind) {
  const preview = document.createElement('span')
  preview.dataset.markdownGuidePreview = kind
  const source = t(syntaxKey)
  const pair = (tag) => source.match(new RegExp(`^(.*)<${tag}>(.*?)</${tag}>(.*)$`, 'i'))
  const wrapped = (tag, value) => {
    const element = document.createElement(tag)
    element.textContent = value
    return element
  }
  if (kind === 'strike') preview.append(wrapped('s', source.replace(/^~+|~+$/g, '')))
  else if (kind === 'subscript' || kind === 'superscript' || kind === 'underline') {
    const tag = kind === 'subscript' ? 'sub' : kind === 'superscript' ? 'sup' : 'ins'
    const match = pair(tag)
    if (match) preview.append(document.createTextNode(match[1]), wrapped(tag, match[2]), document.createTextNode(match[3]))
    else preview.textContent = source
  } else if (kind === 'break') {
    source.split(/<br\s*\/?>/i).forEach((part, index) => {
      if (index) preview.append(document.createElement('br'))
      preview.append(document.createTextNode(part))
    })
  } else if (kind === 'insert') preview.append(wrapped('ins', source.slice(2, -2)))
  else if (kind === 'mark') preview.append(wrapped('mark', source.slice(2, -2)))
  else if (kind === 'emoji') preview.textContent = '✨'
  else if (kind === 'html-safety') preview.textContent = source
  else if (kind === 'code-safety') preview.append(wrapped('code', source.slice(1, -1)))
  else preview.textContent = source
  return preview
}

function ruleSection(document, t, headingKey, rules, id) {
  const section = document.createElement('section')
  section.className = 'ml-markdown-guide-section'
  section.setAttribute('aria-labelledby', id)
  const heading = document.createElement('h3')
  heading.id = id
  heading.textContent = t(headingKey)
  const list = document.createElement('ul')
  list.className = 'ml-markdown-guide-list'
  for (const [syntaxKey, resultKey, kind] of rules) {
    const item = document.createElement('li')
    const label = document.createElement('span')
    label.className = 'ml-markdown-guide-label'
    label.textContent = t(resultKey)
    const syntax = document.createElement('code')
    syntax.textContent = t(syntaxKey)
    const rendered = document.createElement('span')
    rendered.className = 'ml-markdown-guide-rendered'
    rendered.dataset.markdownGuideRendered = ''
    rendered.append(createRenderedPreview(document, t, syntaxKey, kind))
    item.append(label, syntax, rendered)
    list.append(item)
  }
  section.append(heading, list)
  return section
}

function createGuideLegend(document, t) {
  const legend = document.createElement('div')
  legend.className = 'ml-markdown-guide-legend'
  legend.dataset.markdownGuideLegend = ''
  for (const key of ['markdownGuideFeatureLabel', 'markdownGuideSourceLabel', 'markdownGuideRenderedLabel']) {
    const label = document.createElement('span')
    label.textContent = t(key)
    legend.append(label)
  }
  return legend
}

export function createMarkdownGuide({ document, t, button }) {
  const element = document.createElement('dialog')
  element.className = 'ml-confirm-dialog ml-markdown-guide-dialog'
  element.setAttribute('aria-labelledby', 'ml-markdown-guide-title')

  const header = document.createElement('div')
  header.className = 'ml-markdown-guide-header'
  const title = document.createElement('h2')
  title.id = 'ml-markdown-guide-title'
  title.textContent = t('markdownGuideTitle')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ml-markdown-guide-close'
  close.setAttribute('aria-label', t('markdownGuideClose'))
  close.textContent = '×'
  header.append(title, close)

  const summary = document.createElement('p')
  summary.className = 'ml-markdown-guide-summary'
  summary.textContent = t('markdownGuideSummary')
  const safety = ruleSection(document, t, 'markdownGuideSafetyHeading', [
    ['markdownGuideHtmlSafety', 'markdownGuideHtmlSafetyResult', 'html-safety'],
    ['markdownGuideCodeSafety', 'markdownGuideCodeSafetyResult', 'code-safety'],
  ], 'ml-markdown-guide-safety-title')
  const syntaxPanel = document.createElement('div')
  syntaxPanel.id = 'ml-markdown-guide-syntax'
  syntaxPanel.setAttribute('role', 'tabpanel')
  syntaxPanel.append(createGuideLegend(document, t), ruleSection(document, t, 'markdownGuideGithubHeading', githubRules, 'ml-markdown-guide-github-title'), ruleSection(document, t, 'markdownGuideExtensionHeading', extensionRules, 'ml-markdown-guide-extension-title'), safety)
  const shortcutsPanel = document.createElement('div')
  shortcutsPanel.id = 'ml-markdown-guide-shortcuts'
  shortcutsPanel.setAttribute('role', 'tabpanel')
  shortcutsPanel.hidden = true
  const shortcutList = document.createElement('ul')
  shortcutList.className = 'ml-markdown-guide-shortcuts'
  for (const [key, label] of [['O', 'shortcutOpenFile'], ['K', 'shortcutOpenFolder'], ['S', 'shortcutSearch'], ['M', 'shortcutNotes'], ['P', 'shortcutPdf'], ['G', 'shortcutGuide'], ['R', 'shortcutRefresh'], ['T', 'shortcutTheme']]) {
    const item = document.createElement('li')
    item.innerHTML = `<kbd>Alt</kbd><kbd>${key}</kbd>`
    item.append(document.createTextNode(t(label)))
    shortcutList.append(item)
  }
  shortcutsPanel.append(shortcutList)
  const tabs = document.createElement('div')
  tabs.className = 'ml-markdown-guide-tabs'
  tabs.setAttribute('role', 'tablist')
  const tabButtons = [['syntax', 'markdownGuideSyntaxTab', syntaxPanel], ['shortcuts', 'markdownGuideShortcutsTab', shortcutsPanel]].map(([name, key, panel], index) => {
    const tab = document.createElement('button')
    tab.type = 'button'
    tab.id = `ml-markdown-guide-${name}-tab`
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', panel.id)
    tab.setAttribute('aria-selected', String(index === 0))
    tab.tabIndex = index === 0 ? 0 : -1
    tab.textContent = t(key)
    tabs.append(tab)
    return [tab, panel]
  })
  function selectTab(index) {
    tabButtons.forEach(([tab, panel], itemIndex) => {
      const selected = itemIndex === index
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      panel.hidden = !selected
    })
  }
  tabButtons.forEach(([tab], index) => tab.addEventListener('click', () => selectTab(index)))
  tabs.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = tabButtons.findIndex(([tab]) => tab === document.activeElement)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabButtons.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : tabButtons.length - 1)) % tabButtons.length
    selectTab(next)
    tabButtons[next][0].focus()
  })

  element.append(
    header,
    summary,
    tabs,
    syntaxPanel,
    shortcutsPanel,
  )

  let previousFocus = null
  function hide() {
    if (!element.open) return
    element.close()
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  }
  function show() {
    if (element.open || document.querySelector('dialog[open]')) return false
    previousFocus = document.activeElement
    selectTab(0)
    element.showModal()
    close.focus()
    return true
  }
  button.addEventListener('click', show)
  close.addEventListener('click', hide)
  element.addEventListener('cancel', event => { event.preventDefault(); hide() })

  return {
    element,
    show,
    hide,
    destroy() {
      button.removeEventListener('click', show)
      if (element.open) element.close()
    },
  }
}
