import { createReaderDialog } from './reader-dialog.mjs'
import { createReaderLibrary } from './reader-library.mjs'
import { renderLibraryList } from './reader-library-ui.mjs'
import { createReviewUI } from './review-ui.mjs'
import reviewStyle from './review-ui.css?inline'
import { parseReview, writeReview, patchTask, markdownReviewSource } from './review-source.mjs'
import { writeFileRevision } from './file-writer.mjs'
import { createDocumentLoading } from './document-loading.mjs'
import { createDocumentTabStrip } from './document-tabs.mjs'
import documentTabsStyle from './document-tabs.css?inline'
import { readerIcon } from './reader-icons.mjs'
import { createHandleSource } from './handle-source.mjs'
import { markdownComments } from './markdown-comments.mjs'
import { highlightMatches, searchableText } from './search'
import { markdownStructure, populateDocumentToc } from './markdown-structure.mjs'
import { markdownInline } from './markdown-inline.mjs'
import { markdownAlerts } from './markdown-alerts.mjs'
import { markdownFootnotes } from './markdown-footnotes.mjs'
import definitions from 'markdown-it-deflist'
import { markdownMath, renderMath } from './markdown-math.mjs'
import { markdownDiagrams, renderDiagrams } from './markdown-diagrams.mjs'
import { probeDirectoryDocuments } from './directory-documents.mjs'
import { createTranslator } from '../i18n.mjs'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import plaintext from 'highlight.js/lib/languages/plaintext'
import powershell from 'highlight.js/lib/languages/powershell'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'
import highlightStyle from 'highlight.js/styles/github-dark.css?inline'
import readerStyle from './style.css?inline'
import logo from '../assets/logo.svg?raw'
import {
  captureScrollSnapshot,
  clampRefreshInterval,
  directorySignature,
  describeError,
  getFileName,
  getParentDirectoryURL,
  isSupportedDocument,
  normalizeFileURL,
  parseDirectoryListing,
  resolveSafeURL,
  restoredScrollTop,
  shouldReplaceDirectory,
} from '../core.mjs'

const standaloneReader = location.protocol === 'chrome-extension:' && location.pathname === '/reader.html'
if (isSupportedDocument(location.href) || standaloneReader) {
const injectedStyle = document.createElement('style')
injectedStyle.dataset.markdownLeader = 'styles'
const fontURL = chrome.runtime.getURL('assets/fonts/PretendardVariable.woff2')
injectedStyle.textContent = `@font-face {
  font-family: 'Pretendard Variable';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url('${fontURL}') format('woff2');
}\n${highlightStyle}\n${readerStyle}\n${documentTabsStyle}\n${reviewStyle}`
document.head.appendChild(injectedStyle)

type Theme = 'light' | 'dark' | 'system'
type FontFamily = 'pretendard' | 'system'
type WidthMode = 'a4' | 'custom'
interface Settings {
  sidebarCollapsed: boolean
  readingSettingsOpen: boolean
  refreshEnabled: boolean
  refreshIntervalMs: number
  colorMode: Theme
  fontFamily: FontFamily
  fontSizePx: number
  contentWidthPx: number
  widthMode: WidthMode
}
interface Entry { name: string; url: string; type: 'directory' | 'file' }
interface ReadResult { ok: boolean; text?: string; error?: string }

const defaults: Settings = {
  sidebarCollapsed: false,
  readingSettingsOpen: true,
  refreshEnabled: true,
  refreshIntervalMs: 10000,
  colorMode: 'system',
  fontFamily: 'system',
  fontSizePx: 17,
  contentWidthPx: 920,
  widthMode: 'custom',
}

const uiLanguage = (() => {
  try {
    return chrome.i18n?.getUILanguage?.() || 'en'
  } catch {
    return 'en'
  }
})()
const readerLanguage = /^ko(?:[-_]|$)/i.test(uiLanguage) ? 'ko' : 'en'
const t = createTranslator(readerLanguage)

const originalPre = document.querySelector('pre')
let settings: Settings = { ...defaults }
let currentFileURL = standaloneReader ? '' : normalizeFileURL(location.href)
type DocumentSource = ReturnType<typeof createHandleSource>
interface OpenDocument { id: string; url: string; name: string; source: DocumentSource | null; scroll: ReturnType<typeof captureScroll> | null; pinned?: boolean; favorite?: boolean; libraryId?: string; fileHandle?: any }
const openDocuments = new Map<string, OpenDocument>()
const documentsByURL = new Map<string, OpenDocument>()
const documentsByName = new Map<string, Set<OpenDocument>>()
const sourceReferences = new Map<DocumentSource, number>()
let activeDocument: OpenDocument | null = null
let documentSequence = 0
let documentOpenRequest = 0
let documentReady = false
let restoringDocumentScroll = false
let explorerSource: DocumentSource | null = null
let explorerGeneration = 0
let handleSource: DocumentSource | null = null
let sourceSelection = 0
let choosingSource = false
let readerTabId: number | undefined
let activeNavigation: 'files' | 'toc' | null = standaloneReader ? null : 'files'
let activePanel: 'files' | 'toc' | 'settings' | 'recent' | 'favorites' | null = activeNavigation
let searchMode: 'files' | 'toc' | null = null
let rootDirectoryURL = getParentDirectoryURL(currentFileURL)
let currentRaw = ''
let writingDocumentId: string | null = null
let renderGeneration = 0
let refreshTimer: number | undefined
let refreshInFlight = false
let refreshRequest = 0
let refreshGeneration = 0
let pageGeneration = 0
let pageActive = true
let initialBackgroundWorkComplete = false
const expandedDirectories = new Set<string>()
const directoryCache = new Map<string, { entries: Entry[]; signature: string }>()
const directoryVisibility = new Map<string, string>()
let directoryFilterRunning = false
let directoryFilterPending = false

for (const [name, language] of Object.entries({
  bash, csharp, css, java, javascript, json, markdown, plaintext, powershell,
  python, sql, typescript, xml, yaml,
})) hljs.registerLanguage(name, language)

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  highlight(code: string, language: string): string {
    if (language && hljs.getLanguage(language)) {
      return `<pre class="hljs"><code>${hljs.highlight(code, { language }).value}</code></pre>`
    }
    return `<pre class="hljs"><code>${escapeHtml(code)}</code></pre>`
  },
}).use(markdownComments).use(taskLists, { enabled: false, label: true })
  .use(markdownInline)
  .use(markdownStructure, { tocLabel: t('readerOutline') })
  .use(markdownAlerts, { t })
  .use(markdownFootnotes, { t })
  .use(definitions)
  .use(markdownMath)
  .use(markdownDiagrams)
  .use(markdownReviewSource)

md.validateLink = (url: string) => resolveSafeURL(url, currentFileURL, 'link') !== null
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens: any[], index: number, options: any, _env: any, self: any) => self.renderToken(tokens, index, options))
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  const hrefIndex = tokens[index].attrIndex('href')
  if (hrefIndex >= 0) {
    const safe = resolveSafeURL(tokens[index].attrs![hrefIndex][1], currentFileURL, 'link')
    tokens[index].attrs![hrefIndex][1] = safe || '#'
    if (safe?.startsWith('http')) {
      tokens[index].attrSet('target', '_blank')
      tokens[index].attrSet('rel', 'noopener noreferrer')
    }
  }
  return defaultLinkOpen(tokens, index, options, env, self)
}
md.renderer.rules.image = (tokens: any[], index: number) => {
  const token = tokens[index]
  const safe = resolveSafeURL(token.attrGet('src'), currentFileURL, 'image')
  if (!safe) return ''
  const alt = md.utils.escapeHtml(token.content)
  const title = token.attrGet('title')
  return `<img ${handleSource && safe.startsWith('file:') ? 'data-local-image' : 'src'}="${md.utils.escapeHtml(safe)}" alt="${alt}"${title ? ` title="${md.utils.escapeHtml(title)}"` : ''} loading="lazy">`
}

const app = document.createElement('div')
app.id = 'markdown-leader-app'
app.innerHTML = `
  <aside class="ml-sidebar" data-testid="sidebar">
    <header class="ml-brand"><span class="ml-brand-name"><strong>Markdown Leader</strong><span class="ml-version">v${__APP_VERSION__}</span></span></header>
    <nav class="ml-ribbon" aria-label="${escapeHtml(t('readerSettings'))}">
      <span class="ml-logo" role="img" aria-label="Markdown Leader" tabindex="0" data-tooltip="Markdown Leader v${__APP_VERSION__}">${logo}</span>
      <button class="ml-icon-button" data-sidebar-toggle type="button" data-tooltip="${escapeHtml(t('readerCollapsePanel'))}" aria-label="${escapeHtml(t('readerCollapsePanel'))}" aria-expanded="true">${readerIcon('panel')}</button>
      <button class="ml-icon-button" data-open-folder type="button" data-tooltip="${escapeHtml(t('readerOpenFolder'))}" aria-label="${escapeHtml(t('readerOpenFolder'))}">${readerIcon('folder')}</button>
      <button class="ml-icon-button" data-open-file type="button" data-tooltip="${escapeHtml(t('readerOpenFile'))}" aria-label="${escapeHtml(t('readerOpenFile'))}">${readerIcon('file')}</button>
      <button class="ml-icon-button" data-tab="recent" type="button" data-tooltip="${escapeHtml(t('readerRecent'))}" aria-label="${escapeHtml(t('readerRecent'))}" aria-pressed="false">${readerIcon('recent')}</button>
      <button class="ml-icon-button" data-tab="favorites" type="button" data-tooltip="${escapeHtml(t('readerFavorites'))}" aria-label="${escapeHtml(t('readerFavorites'))}" aria-pressed="false">${readerIcon('star')}</button>
      <button class="ml-icon-button" data-review-toggle type="button" data-tooltip="${escapeHtml(t('reviewTitle'))}" aria-label="${escapeHtml(t('reviewTitle'))}" aria-expanded="false">${readerIcon('note')}</button>
      <button class="ml-icon-button" data-tab="settings" type="button" data-tooltip="${escapeHtml(t('readerSettings'))}" aria-label="${escapeHtml(t('readerSettings'))}" aria-pressed="false">${readerIcon('settings')}</button>
    </nav>
    <div class="ml-explorer">
    <div class="ml-tabs" role="toolbar" aria-label="${escapeHtml(t('readerFiles'))}">
      <button class="ml-icon-button" data-tab="files" type="button" data-tooltip="${escapeHtml(t('readerFiles'))}" aria-label="${escapeHtml(t('readerFiles'))}" aria-pressed="false">${readerIcon('files')}</button>
      <button class="ml-icon-button" data-tab="toc" type="button" data-tooltip="${escapeHtml(t('readerOutline'))}" aria-label="${escapeHtml(t('readerOutline'))}" aria-pressed="false">${readerIcon('toc')}</button>
      <button class="ml-icon-button" data-search-toggle type="button" data-tooltip="${escapeHtml(t('readerSearch'))}" aria-label="${escapeHtml(t('readerSearch'))}" aria-expanded="false">${readerIcon('search')}</button>
    </div>
    <div class="ml-search" hidden role="search" aria-label="${escapeHtml(t('readerDocumentSearch'))}"><div class="ml-search-field"><label><span>${escapeHtml(t('readerSearch'))}</span><input data-testid="document-search" type="search" placeholder="${escapeHtml(t('readerSearchPlaceholder'))}"></label>
      <div class="ml-search-controls"><output data-testid="search-count" aria-live="polite">0 / 0</output><button type="button" data-search-step="-1" aria-label="${escapeHtml(t('readerPreviousSearchResult'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 10 4-4 4 4"/></svg></button><button type="button" data-search-step="1" aria-label="${escapeHtml(t('readerNextSearchResult'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><button type="button" data-testid="search-clear" aria-label="${escapeHtml(t('readerCloseSearch'))}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8"/></svg></button></div></div>
      <output class="ml-search-files" data-testid="search-files" aria-live="polite"></output></div>
    <div class="ml-panel active" data-panel="files"><div class="ml-root-name"></div><p class="ml-tree-note" hidden></p><ul class="ml-tree" data-testid="file-tree"></ul></div>
    <div class="ml-panel" data-panel="toc"><ul class="ml-toc" data-testid="toc"></ul></div>
    <div class="ml-panel" data-panel="recent"><h2 class="ml-library-title">${escapeHtml(t('readerRecent'))}</h2><div class="ml-library-list"></div></div>
    <div class="ml-panel" data-panel="favorites"><h2 class="ml-library-title">${escapeHtml(t('readerFavorites'))}</h2><div class="ml-library-list"></div></div>
    <div class="ml-panel ml-settings-panel" data-panel="settings">
    <details class="ml-settings">
      <summary><span>${escapeHtml(t('readerReadingSettings'))}</span><svg class="ml-settings-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
      <label class="ml-setting-row"><span>${escapeHtml(t('readerAutomaticRefresh'))}</span><input class="ml-switch" data-testid="refresh-enabled" type="checkbox" role="switch"></label>
      <label class="ml-setting-row"><span>${escapeHtml(t('readerRefreshInterval'))}</span><span class="ml-number-unit"><input data-testid="refresh-interval" type="number" min="0.5" max="600" step="0.5"><span>${escapeHtml(t('readerSecondsUnit'))}</span></span></label>
      <fieldset class="ml-setting-group">
        <legend>${escapeHtml(t('readerTheme'))}</legend>
        <div class="ml-segmented" role="group" aria-label="${escapeHtml(t('readerTheme'))}">
          <button data-testid="theme-light" data-theme="light" type="button" aria-pressed="false">${escapeHtml(t('readerThemeLight'))}</button>
          <button data-testid="theme-dark" data-theme="dark" type="button" aria-pressed="false">${escapeHtml(t('readerThemeDark'))}</button>
          <button data-testid="theme-system" data-theme="system" type="button" aria-pressed="false">${escapeHtml(t('readerThemeSystem'))}</button>
        </div>
      </fieldset>
      <label class="ml-setting-row"><span>${escapeHtml(t('readerFont'))}</span><select data-testid="font-family"><option value="pretendard">Pretendard</option><option value="system">${escapeHtml(t('readerSystemFont'))}</option></select></label>
      <label class="ml-setting-slider"><span>${escapeHtml(t('readerFontSize'))} <output data-testid="font-size-value" for="ml-font-size">17px</output></span><input id="ml-font-size" data-testid="font-size" type="range" min="13" max="28" step="1"></label>
      <fieldset class="ml-setting-group">
        <legend>${escapeHtml(t('readerReadingWidth'))}</legend>
        <div class="ml-segmented ml-width-mode" role="group" aria-label="${escapeHtml(t('readerReadingWidthMode'))}">
          <button data-testid="width-custom" data-width-mode="custom" type="button" aria-pressed="false">${escapeHtml(t('readerCustomWidth'))}</button>
          <button data-testid="width-a4" data-width-mode="a4" type="button" aria-pressed="false">${escapeHtml(t('readerA4Width'))}</button>
        </div>
      </fieldset>
      <label class="ml-setting-slider"><span>${escapeHtml(t('readerCustomWidth'))} <output data-testid="content-width-value" for="ml-content-width">920px</output></span><input id="ml-content-width" data-testid="content-width" type="range" min="560" max="1400" step="20"></label>
      <p class="ml-a4-note" data-testid="a4-note" hidden>${escapeHtml(t('readerA4PreviewNote'))}</p>
      <div class="ml-shortcuts" aria-label="${escapeHtml(t('readerKeyboardShortcuts'))}">
        <span><kbd>Alt</kbd><kbd>R</kbd> ${escapeHtml(t('readerRefresh'))}</span>
        <span><kbd>Alt</kbd><kbd>T</kbd> ${escapeHtml(t('readerTheme'))}</span>
      </div>
    </details>
    </div>
    </div>
  </aside>
  <main class="ml-main">
    <div class="ml-status" role="status" aria-live="polite"></div>
    <div class="ml-welcome" hidden>
      <h1>${escapeHtml(t('readerWelcomeTitle'))}</h1>
      <p data-welcome-hint>${escapeHtml(t('readerWelcomeHint'))}</p>
      <div class="ml-open-actions"><button type="button" data-open-folder>${readerIcon('folder')}${escapeHtml(t('readerOpenFolder'))}</button><button type="button" data-open-file>${readerIcon('file')}${escapeHtml(t('readerOpenFile'))}</button></div>
      <p class="ml-welcome-note">${escapeHtml(t('readerFolderHint'))}</p>
    </div>
    <article class="ml-document" data-testid="markdown-content"></article>
    <div class="ml-drop-hint" hidden>${escapeHtml(t('readerDropFiles'))}</div>
    <div class="ml-tooltip" role="tooltip" hidden></div>
  </main>`
const content = app.querySelector<HTMLElement>('.ml-document')!
const status = app.querySelector<HTMLElement>('.ml-status')!
const fileTree = app.querySelector<HTMLElement>('.ml-tree')!
const toc = app.querySelector<HTMLElement>('.ml-toc')!
const rootName = app.querySelector<HTMLElement>('.ml-root-name')!
const searchInput = app.querySelector<HTMLInputElement>('[data-testid="document-search"]')!
const refreshEnabled = app.querySelector<HTMLInputElement>('[data-testid="refresh-enabled"]')!
const refreshInterval = app.querySelector<HTMLInputElement>('[data-testid="refresh-interval"]')!
const themeButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-theme]')]
const fontFamily = app.querySelector<HTMLSelectElement>('[data-testid="font-family"]')!
const fontSize = app.querySelector<HTMLInputElement>('[data-testid="font-size"]')!
const fontSizeValue = app.querySelector<HTMLOutputElement>('[data-testid="font-size-value"]')!
const widthModeButtons = [...app.querySelectorAll<HTMLButtonElement>('[data-width-mode]')]
const contentWidth = app.querySelector<HTMLInputElement>('[data-testid="content-width"]')!
const contentWidthValue = app.querySelector<HTMLOutputElement>('[data-testid="content-width-value"]')!
const a4Note = app.querySelector<HTMLElement>('[data-testid="a4-note"]')!
const documentTabsUI = createDocumentTabStrip({
  document, t,
  onSelect: (id: string) => { const tab = openDocuments.get(id); if (tab) void activateDocument(tab) },
  onClose: (id: string) => { void closeDocument(id) },
  onAdd: () => { void chooseSource(false) },
  onPin: (id: string) => togglePinned(id),
  onFavorite: (id: string) => { void toggleFavorite(id) },
  onReorder: (ids: string[]) => reorderDocuments(ids),
})
const confirmUI = createReaderDialog({ document, t })
app.append(confirmUI.element)
const library = createReaderLibrary({ storage: chrome.storage.local, indexedDB, onChange: () => updateLibraryPanels() })
const reviewUI = createReviewUI({ document, window, content, t, onSave: async ({ documentId, expectedRaw, notes }: any) => {
  return saveDocumentRevision(documentId, expectedRaw, writeReview(expectedRaw, notes))
} })
app.append(reviewUI.element)
const reviewToggle = app.querySelector<HTMLButtonElement>('[data-review-toggle]')!
new MutationObserver(() => reviewToggle.setAttribute('aria-expanded', String(reviewUI.isOpen()))).observe(reviewUI.element, { attributes: true, subtree: true, attributeFilter: ['hidden'] })
const documentLoading = createDocumentLoading({ content, document, window, onShow: () => setStatus(t('readerOpeningDocument')) })
content.id = 'ml-document-panel'
content.setAttribute('role', 'tabpanel')
app.querySelector('.ml-main')!.insertBefore(documentTabsUI.element, content)


function updateNavigation() {
  const available = !!(currentFileURL || rootDirectoryURL)
  app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
    const tab = button.dataset.tab
    button.disabled = tab === 'files' ? !available : tab === 'toc' ? !currentFileURL : false
    const selected = tab === 'files' || tab === 'toc' ? activeNavigation === tab && (activePanel === 'files' || activePanel === 'toc') : activePanel === tab
    button.classList.toggle('active', selected)
    button.setAttribute('aria-pressed', String(selected))
  })
  app.querySelectorAll<HTMLElement>('[data-panel]').forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === activePanel)
  })
  const search = app.querySelector<HTMLButtonElement>('[data-search-toggle]')!
  search.disabled = !activeNavigation || (activePanel !== 'files' && activePanel !== 'toc') || (activeNavigation === 'files' && !rootDirectoryURL)
  const label = t(activeNavigation === 'toc' ? 'readerDocumentSearch' : 'readerFolderSearch')
  search.setAttribute('aria-label', label)
  search.dataset.tooltip = label
  search.setAttribute('aria-expanded', String(searchMode !== null))
}

function showWelcome() {
  content.hidden = true
  const welcome = app.querySelector<HTMLElement>('.ml-welcome')!
  welcome.hidden = false
  welcome.querySelector<HTMLElement>('h1')!.textContent = t(rootDirectoryURL ? 'readerChooseDocument' : 'readerWelcomeTitle')
  welcome.querySelector<HTMLElement>('[data-welcome-hint]')!.textContent = t(rootDirectoryURL ? 'readerFolderHint' : 'readerWelcomeHint')
  updateNavigation()
}

function closeSearch() {
  const panel = app.querySelector<HTMLElement>('.ml-search')!
  panel.hidden = true
  panel.classList.remove('ml-document-search')
  panel.style.removeProperty('left')
  panel.style.removeProperty('width')
  app.querySelector('.ml-explorer')!.insertBefore(panel, app.querySelector('[data-panel="files"]'))
  searchMode = null
  searchQuery = ''
  searchInput.value = ''
  window.clearTimeout(searchDebounce)
  searchGeneration++
  matchedFiles.clear()
  matchedDirectories.clear()
  fileTree.dataset.searching = 'false'
  highlightDocument(false)
  void searchFiles()
  updateNavigation()
}

function positionDocumentSearch() {
  if (!content.isConnected || content.hidden) return
  const box = content.getBoundingClientRect()
  documentTabsUI.setBounds(box.left, box.width)
  reviewUI.refreshAnchors()
  if (searchMode !== 'toc') return
  const panel = app.querySelector<HTMLElement>('.ml-search')!
  panel.style.left = `${box.left}px`
  panel.style.width = `${Math.min(420, box.width)}px`
}

const documentLayoutObserver = new ResizeObserver(positionDocumentSearch)
documentLayoutObserver.observe(app.querySelector('.ml-main')!)
documentLayoutObserver.observe(content)

function toggleSearch() {
  if (searchMode) { closeSearch(); return }
  if (!activeNavigation || (activePanel !== 'files' && activePanel !== 'toc')) return
  searchMode = activeNavigation
  const panel = app.querySelector<HTMLElement>('.ml-search')!
  const documentSearch = searchMode === 'toc'
  panel.classList.toggle('ml-document-search', documentSearch)
  panel.dataset.mode = searchMode
  if (documentSearch) app.querySelector('.ml-main')!.append(panel)
  panel.hidden = false
  positionDocumentSearch()
  panel.setAttribute('aria-label', t(documentSearch ? 'readerDocumentSearch' : 'readerFolderSearch'))
  searchInput.setAttribute('aria-label', t(documentSearch ? 'readerDocumentSearch' : 'readerFolderSearch'))
  searchInput.placeholder = t(documentSearch ? 'readerSearchPlaceholder' : 'readerFolderSearch')
  searchInput.focus()
  updateNavigation()
}

function hydrateLocalImages() {
  const source = handleSource
  if (!source) return
  const generation = renderGeneration
  const nodes = [...content.querySelectorAll<HTMLImageElement>('img[data-local-image]')]
  for (const image of nodes) {
    void source.imageURL(image.dataset.localImage!).then((url: string) => {
      if (handleSource === source && generation === renderGeneration && content.contains(image)) image.src = url
    }).catch(() => {
      if (handleSource === source && generation === renderGeneration && content.contains(image)) {
        image.title = t('readerSingleFileHint')
      }
    })
  }
}

function applySidebar() {
  const collapsed = Boolean(settings.sidebarCollapsed)
  document.documentElement.dataset.mlSidebarCollapsed = String(collapsed)
  const button = app.querySelector<HTMLButtonElement>('[data-sidebar-toggle]')!
  const label = t(collapsed ? 'readerExpandPanel' : 'readerCollapsePanel')
  button.setAttribute('aria-label', label)
  button.dataset.tooltip = label
  button.setAttribute('aria-expanded', String(!collapsed))
  positionDocumentSearch()
}

function reorderDocuments(ids: string[]) {
  const requested = [...new Set([...ids, ...openDocuments.keys()])].map(id => openDocuments.get(id)).filter(Boolean) as OpenDocument[]
  const ordered = [...requested.filter(tab => tab.pinned), ...requested.filter(tab => !tab.pinned)]
  openDocuments.clear()
  for (const tab of ordered) openDocuments.set(tab.id, tab)
  documentTabsUI.setOrder(ordered.map(tab => tab.id))
}

function togglePinned(id: string) {
  const tab = openDocuments.get(id)
  if (!tab) return
  tab.pinned = !tab.pinned
  documentTabsUI.setFlags(id, { pinned: tab.pinned, favorite: Boolean(tab.favorite) })
  reorderDocuments(documentTabsUI.getOrder())
}

function reportLibraryError(error: unknown) {
  reportError(t('readerLibraryFailed'), '', error)
}

function updateLibraryPanels() {
  for (const mode of ['recent', 'favorites'] as const) {
    const target = app.querySelector<HTMLElement>(`[data-panel="${mode}"] .ml-library-list`)!
    renderLibraryList(target, mode === 'recent' ? library.listRecent() : library.listFavorites(), {
      t, favorites: mode === 'favorites', attachTooltip: attachOverflowTooltip,
      onOpen: (entry: any) => { void openLibraryEntry(entry).catch(reportLibraryError) },
      onRemove: (entry: any) => { void library.setFavorite(entry.id, false).catch(reportLibraryError) },
    })
  }
  for (const tab of openDocuments.values()) {
    if (!tab.libraryId) continue
    tab.favorite = Boolean(library.get(tab.libraryId)?.favorite)
    documentTabsUI.setFlags(tab.id, { pinned: Boolean(tab.pinned), favorite: tab.favorite })
  }
}

function documentPath(tab: OpenDocument) {
  if (!tab.source) return decodeURI(tab.url)
  return tab.source.rootURL ? `${tab.source.name} / ${decodeURIComponent(new URL(tab.url).pathname.split('/').slice(3).join('/'))}` : tab.name
}

async function rememberDocument(tab: OpenDocument) {
  try {
    const source = tab.source
    const url = tab.url
    const file = tab.fileHandle || (source ? await source.fileHandle(url) : null)
    if (!openDocuments.has(tab.id) || tab.url !== url) return null
    tab.fileHandle = file
    const entry = await library.remember({ ...(tab.libraryId && library.get(tab.libraryId) ? { id: tab.libraryId } : {}), handle: file,
      url: source ? undefined : url, name: tab.name, kind: 'file', path: documentPath(tab),
      ...(source?.rootHandle ? { context: { rootHandle: source.rootHandle, relativePath: url.slice(source.rootURL!.length) } } : {}) })
    if (openDocuments.has(tab.id)) {
      tab.libraryId = entry.id
      tab.favorite = entry.favorite
      documentTabsUI.setFlags(tab.id, { pinned: Boolean(tab.pinned), favorite: Boolean(tab.favorite) })
    }
    return entry
  } catch (error) {
    if (openDocuments.has(tab.id)) reportLibraryError(error)
    return null
  }
}

const favoriteRequests = new Set<string>()
async function toggleFavorite(id: string) {
  const tab = openDocuments.get(id)
  if (!tab || favoriteRequests.has(id)) return
  favoriteRequests.add(id)
  try {
    const entry = (tab.libraryId && library.get(tab.libraryId)) || await rememberDocument(tab)
    if (!entry) return
    await library.setFavorite(entry.id, !entry.favorite)
  } catch (error) { reportLibraryError(error) }
  finally { favoriteRequests.delete(id) }
}

async function pickOriginal(kind: string) {
  const picker = window as any
  return kind === 'directory' ? picker.showDirectoryPicker({ mode: 'read', id: 'markdown-folder' })
    : (await picker.showOpenFilePicker({ multiple: false, id: 'markdown-file', types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mdwn', '.mkd', '.mkdn', '.mkdown', '.mdx', '.mdc'] } }] }))[0]
}

async function openLibraryEntry(entry: any) {
  let file = await library.getHandle(entry.id)
  if (file) {
    try {
      if (await file.queryPermission({ mode: 'read' }) !== 'granted' && await file.requestPermission({ mode: 'read' }) !== 'granted') file = null
    } catch { file = null }
  }
  if (file) {
    const context = await library.getContext(entry.id)
    if (context?.rootHandle && entry.kind === 'file') {
      const root = context.rootHandle
      if (await root.queryPermission({ mode: 'read' }) === 'granted') {
        const source = createHandleSource(root)
        try { await openFile(source.rootURL! + context.relativePath, source) }
        finally { disposeUnusedSource(source) }
        return
      }
    }
    await adoptHandle(file)
    return
  }
  if (entry.url) {
    if (entry.kind === 'file') await openFile(entry.url, null)
    else {
      closeSearch()
      const previous = explorerSource
      explorerSource = null
      ++explorerGeneration
      disposeUnusedSource(previous)
      rootDirectoryURL = entry.url
      rootName.textContent = entry.name
      rootName.title = entry.url
      expandedDirectories.clear()
      directoryCache.clear()
      directoryVisibility.clear()
      fileTree.replaceChildren()
      delete fileTree.dataset.loaded
      delete fileTree.dataset.signature
      activeNavigation = 'files'
      activePanel = 'files'
      updateNavigation()
      await loadDirectory(entry.url, fileTree, true)
      await library.remember({ ...entry })
    }
    return
  }
  if (!await confirmUI.confirm({ heading: t('readerReconnectTitle'), message: `${t('readerReconnectDetails')}\n${entry.path || entry.name}`, action: t(entry.kind === 'directory' ? 'readerSelectFolder' : 'readerSelectFile') })) return
  try {
    const chosen = await pickOriginal(entry.kind)
    if (!chosen) return
    if (chosen.kind !== entry.kind || chosen.name !== entry.name) throw new Error(t('readerWrongFile'))
    await library.remember({ ...entry, handle: chosen })
    await adoptHandle(chosen)
  } catch (error) { if ((error as Error).name !== 'AbortError') throw error }
}

function reviewError(error: any) {
  const key = ({ 'file-conflict': 'readerReviewConflict', 'file-stale': 'readerReviewStale', 'file-permission': 'readerReviewPermission', 'review-invalid': 'readerReviewInvalid' } as Record<string, string>)[error?.code]
  return key ? new Error(t(key)) : error
}

async function saveDocumentRevision(id: string, expectedRaw: string, nextRaw: string): Promise<string> {
  const tab = openDocuments.get(id)
  if (!tab || activeDocument !== tab || currentRaw !== expectedRaw || !documentReady) throw new Error(t('readerReviewStale'))
  if (writingDocumentId) throw new Error(t('readerReviewBusy'))
  writingDocumentId = id
  refreshInFlight = false
  ++refreshGeneration
  ++refreshRequest
  const generation = renderGeneration
  const isCurrent = () => pageActive && !extensionInvalidated && activeDocument === tab && openDocuments.has(id) && renderGeneration === generation && currentRaw === expectedRaw
  try {
    let file = tab.fileHandle || (tab.source ? await tab.source.fileHandle(tab.url) : null)
    if (!file) {
      if (!await confirmUI.confirm({ heading: t('readerReviewChooseTitle'), message: `${t('readerReviewChooseMessage')}\n${documentPath(tab)}`, action: t('readerSelectFile') })) throw new Error(t('readerReviewStale'))
      file = await pickOriginal('file')
      if (!file || file.name !== tab.name) throw new Error(t('readerWrongFile'))
    }
    const saved = await writeFileRevision(file, expectedRaw, nextRaw, { isCurrent })
    tab.fileHandle = file
    if (isCurrent()) {
      currentRaw = saved
      renderMarkdown(saved, true)
      setStatus('')
      void rememberDocument(tab)
    }
    return saved
  } catch (error) { throw reviewError(error) }
  finally {
    writingDocumentId = null
    if (activeDocument === tab) restartRefreshTimer()
  }
}

app.querySelector('[data-sidebar-toggle]')!.addEventListener('click', () => {
  if (searchMode === 'files') closeSearch()
  saveSetting('sidebarCollapsed', !settings.sidebarCollapsed)
  applySidebar()
})
reviewToggle.addEventListener('click', () => reviewUI.toggle())
content.addEventListener('change', async event => {
  const input = event.target as HTMLInputElement
  if (!input.matches('input[data-task-line]') || !activeDocument) return
  const tab = activeDocument
  const raw = currentRaw
  const checked = input.checked
  input.disabled = true
  try { await saveDocumentRevision(tab.id, raw, patchTask(raw, Number(input.dataset.taskLine), checked)) }
  catch (error) {
    if (content.contains(input)) input.checked = !checked
    if (activeDocument === tab) reportError(t('readerReviewSaveFailed'), tab.url, reviewError(error))
  } finally { if (content.contains(input)) input.disabled = false }
})
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && Object.keys(changes).some(key => key.startsWith('readerLibrary:'))) {
    void library.refresh().then(updateLibraryPanels).catch(reportLibraryError)
  }
})

function retainSource(source: DocumentSource | null) {
  if (source) sourceReferences.set(source, (sourceReferences.get(source) || 0) + 1)
}

function disposeUnusedSource(source: DocumentSource | null) {
  if (source && source !== explorerSource && !sourceReferences.has(source)) source.dispose()
}

function releaseSource(source: DocumentSource | null) {
  if (!source) return
  const count = (sourceReferences.get(source) || 1) - 1
  if (count) sourceReferences.set(source, count)
  else sourceReferences.delete(source)
  disposeUnusedSource(source)
}

function registerDocument(url: string, source: DocumentSource | null): OpenDocument {
  const normalized = normalizeFileURL(url)
  const existing = documentsByURL.get(normalized)
  if (existing) return existing
  const tab: OpenDocument = { id: String(++documentSequence), url: normalized, name: getFileName(normalized), source, scroll: null }
  openDocuments.set(tab.id, tab)
  documentsByURL.set(normalized, tab)
  if (!documentsByName.has(tab.name)) documentsByName.set(tab.name, new Set())
  documentsByName.get(tab.name)!.add(tab)
  retainSource(source)
  documentTabsUI.add({ id: tab.id, title: tab.name, description: source ? (source.rootURL ? `${source.name} / ${decodeURIComponent(new URL(normalized).pathname.split('/').slice(3).join('/'))}` : `${tab.name} · ${t('readerDocumentNumber', tab.id)}`) : decodeURI(normalized) })
  if (!rootDirectoryURL) {
    rootName.textContent = t('readerOpenDocuments')
    fileTree.append(entryElement({ name: tab.name, url: tab.url, type: 'file' }))
  }
  content.dataset.hasTabs = 'true'
  return tab
}

function stopDocumentWork() {
  reviewUI.clear()
  documentLoading.cancel()
  if (activeDocument && documentReady && !restoringDocumentScroll) activeDocument.scroll = captureScroll()
  documentReady = false
  restoringDocumentScroll = false
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
  refreshTimer = undefined
  ++refreshGeneration
  ++refreshRequest
  refreshInFlight = false
  ++renderGeneration
  ++enhancementGeneration
  pendingTextPaint?.disconnect()
  pendingTextPaint = undefined
  handleSource?.releaseImages()
  content.replaceChildren()
  toc.replaceChildren()
  tocEntries = []
  currentRaw = ''
}

async function activateDocument(tab: OpenDocument, requestedHash = '', preparedRaw?: string, force = false) {
  ++documentOpenRequest
  if (!pageActive || !openDocuments.has(tab.id)) return
  if (activeDocument === tab && documentReady && !force) {
    if (requestedHash) document.getElementById(decodeURIComponent(requestedHash.slice(1)))?.scrollIntoView()
    return
  }
  if (searchMode === 'toc') closeSearch()
  const loadingHeight = content.getBoundingClientRect().height
  stopDocumentWork()
  activeDocument = tab
  handleSource = tab.source
  currentFileURL = tab.url
  const isCurrent = captureReadTarget()
  documentLoading.begin(loadingHeight, isCurrent)
  documentTabsUI.select(tab.id)
  content.setAttribute('aria-labelledby', `ml-document-tab-${tab.id}`)
  content.hidden = false
  app.querySelector<HTMLElement>('.ml-welcome')!.hidden = true
  positionDocumentSearch()
  updateNavigation()
  setStatus('')
  let stage = t('readerDocumentReadFailed')
  try {
    const raw = preparedRaw ?? await readText(tab.url, tab.source)
    if (!isCurrent()) return
    currentRaw = raw
    stage = t('readerDocumentDisplayFailed')
    renderMarkdown(raw)
    documentLoading.finish()
    documentReady = true
    void rememberDocument(tab)
    updateActiveFile()
    setStatus('')
    if (requestedHash) {
      requestAnimationFrame(() => { if (isCurrent()) document.getElementById(decodeURIComponent(requestedHash.slice(1)))?.scrollIntoView() })
    } else if (tab.scroll) {
      restoringDocumentScroll = true
      restoreScroll(tab.scroll, () => { restoringDocumentScroll = false })
    }
    else window.scrollTo({ top: 0, behavior: 'instant' })
  } catch (error) {
    if (isCurrent()) {
      documentLoading.finish()
      reportError(stage, tab.url, error)
    }
  } finally {
    if (isCurrent()) {
      documentLoading.finish()
      restartRefreshTimer()
    }
  }
}

async function closeDocument(id: string) {
  const tab = openDocuments.get(id)
  if (!tab) return
  if (tab.pinned && !await confirmUI.confirm({ heading: t('readerPinnedCloseTitle'), message: tab.name, action: t('readerClose') })) return
  if (!openDocuments.has(id)) return
  const wasActive = activeDocument === tab
  const ordered = wasActive ? [...openDocuments.values()] : []
  const index = ordered.indexOf(tab)
  const next = ordered[index + 1] || ordered[index - 1]
  if (wasActive) {
    ++documentOpenRequest
    stopDocumentWork()
    activeDocument = null
    handleSource = null
    currentFileURL = ''
  }
  openDocuments.delete(id)
  reviewUI.forget(id)
  documentsByURL.delete(tab.url)
  const named = documentsByName.get(tab.name)!
  named.delete(tab)
  if (!named.size) documentsByName.delete(tab.name)
  documentTabsUI.remove(id)
  releaseSource(tab.source)
  if (!rootDirectoryURL) {
    [...fileTree.children].find((node) => (node as HTMLElement).dataset.url === tab.url)?.remove()
  }
  if (!wasActive) return
  if (next) await activateDocument(next)
  else {
    if (searchMode) closeSearch()
    documentTabsUI.select(null)
    delete content.dataset.hasTabs
    content.removeAttribute('aria-labelledby')
    activeNavigation = rootDirectoryURL ? 'files' : null
    activePanel = activeNavigation
    showWelcome()
    setStatus('')
    document.title = 'Markdown Leader'
    app.querySelector<HTMLButtonElement>('.ml-ribbon [data-open-file]')!.focus({ preventScroll: true })
  }
}

async function adoptHandle(handle: any) {
  const request = ++sourceSelection
  const openRequest = handle.kind === 'file' ? ++documentOpenRequest : documentOpenRequest
  if (handle.kind === 'file' && !/\.(?:md|markdown|mdown|mdwn|mkd|mkdn|mkdown|mdx|mdc)$/i.test(handle.name)) throw new Error(t('readerMarkdownOnly'))
  if (handle.kind === 'file') {
    for (const tab of documentsByName.get(handle.name) || []) {
      if (!tab.source) continue
      try {
        if (await tab.source.isSameFile(tab.url, handle)) {
          if (request === sourceSelection && openRequest === documentOpenRequest && openDocuments.has(tab.id)) await activateDocument(tab)
          return
        }
      } catch { /* 접근할 수 없는 기존 탭이 있어도 새 파일 선택은 계속한다. */ }
    }
  }
  const candidate = createHandleSource(handle)
  try {
    const raw = await candidate.readText(candidate.initialURL || candidate.rootURL!)
    if (request !== sourceSelection || !pageActive || (candidate.initialURL && openRequest !== documentOpenRequest)) { candidate.dispose(); return }
    if (candidate.initialURL) {
      const tab = registerDocument(candidate.initialURL, candidate)
      if (!activeNavigation) activeNavigation = 'files'
      if (!activePanel) activePanel = activeNavigation
      await activateDocument(tab, '', raw)
      if (!rootDirectoryURL) {
        const note = app.querySelector<HTMLElement>('.ml-tree-note')!
        note.textContent = t('readerSingleFileHint')
        note.hidden = false
      }
    } else {
      originalExpanded = null
      closeSearch()
      const previous = explorerSource
      explorerSource = candidate
      ++explorerGeneration
      ++documentOpenRequest
      ++refreshGeneration
      ++refreshRequest
      refreshInFlight = false
      rootDirectoryURL = candidate.rootURL
      void library.remember({ handle, name: handle.name, kind: 'directory', path: handle.name }).catch(reportLibraryError)
      disposeUnusedSource(previous)
      expandedDirectories.clear()
      directoryCache.clear()
      directoryVisibility.clear()
      fileTree.replaceChildren()
      delete fileTree.dataset.loaded
      delete fileTree.dataset.signature
      rootName.textContent = candidate.name
      rootName.title = candidate.name
      app.querySelector<HTMLElement>('.ml-tree-note')!.hidden = true
      activeNavigation = 'files'
      activePanel = 'files'
      if (!activeDocument) showWelcome()
      updateNavigation()
      await loadDirectory(candidate.rootURL!, fileTree, true)
      if (request !== sourceSelection) return
      restartRefreshTimer()
      setStatus('')
    }
    initialBackgroundWorkComplete = true
  } catch (error) {
    disposeUnusedSource(candidate)
    throw error
  }
}

async function chooseSource(folder: boolean) {
  if (choosingSource) return
  choosingSource = true
  try {
    const picker = window as typeof window & {
      showDirectoryPicker: (options: object) => Promise<any>
      showOpenFilePicker: (options: object) => Promise<any[]>
    }
    const handle = folder
      ? await picker.showDirectoryPicker({ mode: 'read', id: 'markdown-folder' })
      : (await picker.showOpenFilePicker({ multiple: false, id: 'markdown-file', types: [{ description: 'Markdown', accept: { 'text/markdown': ['.md', '.markdown', '.mdown', '.mdwn', '.mkd', '.mkdn', '.mkdown', '.mdx', '.mdc'] } }] }))[0]
    if (handle) await adoptHandle(handle)
  } catch (error) {
    if ((error as Error).name !== 'AbortError') reportError(t('readerChooseFailed'), '', error)
  } finally {
    choosingSource = false
  }
}

app.querySelectorAll('[data-open-folder]').forEach((button) => button.addEventListener('click', () => { void chooseSource(true) }))
app.querySelectorAll('[data-open-file]').forEach((button) => button.addEventListener('click', () => { void chooseSource(false) }))
const tooltip = app.querySelector<HTMLElement>('.ml-tooltip')!
function hideTooltip() { tooltip.hidden = true }
function showTooltip(target: HTMLElement, text: string, align: 'center' | 'right' = 'center') {
  if ((target as HTMLButtonElement).disabled || !text) return
  const box = target.getBoundingClientRect()
  tooltip.textContent = text
  tooltip.hidden = false
  const ribbon = target.closest('.ml-ribbon') !== null
  const left = ribbon ? box.right + 6 : align === 'right' ? box.right - tooltip.offsetWidth : box.left + (box.width - tooltip.offsetWidth) / 2
  tooltip.style.top = `${Math.max(6, ribbon ? box.top + (box.height - tooltip.offsetHeight) / 2 : box.bottom + 6)}px`
  tooltip.style.left = `${Math.max(6, Math.min(left, window.innerWidth - tooltip.offsetWidth - 6))}px`
}
function attachOverflowTooltip(target: HTMLElement, label: HTMLElement | HTMLElement[], text: string, anchor = target) {
  const labels = Array.isArray(label) ? label : [label]
  const show = () => {
    if (labels.some(item => item.scrollWidth > item.clientWidth)) showTooltip(anchor, text, 'right')
  }
  target.addEventListener('mouseenter', show)
  target.addEventListener('focus', show)
  target.addEventListener('mouseleave', hideTooltip)
  target.addEventListener('blur', hideTooltip)
  target.addEventListener('click', hideTooltip)
}
app.querySelectorAll<HTMLElement>('[data-tooltip]').forEach((button) => {
  const show = () => showTooltip(button, button.dataset.tooltip || '')
  button.addEventListener('mouseenter', show)
  button.addEventListener('focus', show)
  button.addEventListener('mouseleave', hideTooltip)
  button.addEventListener('blur', hideTooltip)
  button.addEventListener('click', hideTooltip)
})
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    hideTooltip()
    if (searchMode) { closeSearch(); app.querySelector<HTMLButtonElement>('[data-search-toggle]')!.focus() }
  }
})
const dropHint = app.querySelector<HTMLElement>('.ml-drop-hint')!
let dragDepth = 0
app.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth++
  dropHint.hidden = false
})
app.addEventListener('dragover', (event) => {
  if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' }
})
app.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dropHint.hidden = true } })
app.addEventListener('drop', (event) => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth = 0
  dropHint.hidden = true
  if (choosingSource) return
  const item = [...event.dataTransfer.items].find((item) => item.kind === 'file') as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<any> }) | undefined
  if (!item) return
  const file = item.getAsFile()
  const pending = item.getAsFileSystemHandle?.()
  choosingSource = true
  void (async () => {
    try {
      const handle = pending ? await pending : file && { kind: 'file', name: file.name, getFile: async () => file }
      if (handle) await adoptHandle(handle)
    } catch (error) { reportError(t('readerChooseFailed'), '', error) }
    finally { choosingSource = false }
  })()
})

let searchQuery = ''
let searchMatches: HTMLElement[][] = []
let searchIndex = -1
let searchGeneration = 0
let searchDebounce: number | undefined
let originalExpanded: Set<string> | null = null
const matchedFiles = new Set<string>()
const matchedDirectories = new Set<string>()
const searchCount = app.querySelector<HTMLOutputElement>('[data-testid="search-count"]')!
const searchFilesStatus = app.querySelector<HTMLOutputElement>('[data-testid="search-files"]')!

function highlightDocument(scroll: boolean) {
  const previousIndex = searchIndex
  searchMatches = highlightMatches(content, searchMode === 'toc' ? searchQuery : '')
  searchIndex = searchMatches.length ? Math.min(Math.max(0, previousIndex), searchMatches.length - 1) : -1
  selectSearch(scroll)
  reviewUI.refreshAnchors()
}

function selectSearch(scroll: boolean) {
  searchMatches.forEach((marks, index) => marks.forEach((mark) => mark.classList.toggle('ml-match-current', index === searchIndex)))
  searchCount.textContent = `${searchIndex + 1} / ${searchMatches.length}`
  app.querySelectorAll<HTMLButtonElement>('[data-search-step]').forEach((button) => { button.disabled = !searchMatches.length })
  if (scroll) {
    const match = searchMatches[searchIndex]?.[0]
    const details = match?.closest('details')
    if (details) details.open = true
    match?.scrollIntoView({ block: 'center' })
  }
}

function moveSearch(direction: number) {
  if (!searchMatches.length) return
  searchIndex = (searchIndex + direction + searchMatches.length) % searchMatches.length
  selectSearch(true)
}

function decorateSearchTree() {
  fileTree.querySelectorAll<HTMLElement>('.ml-tree-item').forEach((item) => {
    const url = normalizeFileURL(item.dataset.url || '')
    const matched = !!searchQuery && (matchedFiles.has(url) || matchedDirectories.has(url))
    item.classList.toggle('ml-search-hit', matched)
    const label = item.querySelector<HTMLElement>(':scope > a .ml-entry-name, :scope > button .ml-entry-name')
    if (label) label.title = matched ? t('readerSearchMatchTitle') : ''
  })
}

async function searchFiles() {
  const generation = ++searchGeneration
  const query = searchMode === 'files' ? searchQuery : ''
  matchedFiles.clear()
  matchedDirectories.clear()
  decorateSearchTree()
  if (!query || !rootDirectoryURL) {
    fileTree.dataset.searching = 'false'
    searchFilesStatus.textContent = ''
    if (originalExpanded) {
      expandedDirectories.clear()
      originalExpanded.forEach((url) => expandedDirectories.add(url))
      originalExpanded = null
      if (rootDirectoryURL) await loadDirectory(rootDirectoryURL, fileTree, true)
    }
    return
  }
  if (!originalExpanded) originalExpanded = new Set(expandedDirectories)
  searchFilesStatus.textContent = t('readerSearchingFolderDocuments')
  const queue = [rootDirectoryURL]
  const visited = new Set<string>()
  let checked = 0
  let failures = 0
  let limited = false
  while (queue.length && generation === searchGeneration && !extensionInvalidated) {
    const directory = queue.shift()!
    if (visited.has(directory)) continue
    visited.add(directory)
    if (visited.size > 2000 || checked >= 2000) { limited = true; break }
    try {
      const entries = parseDirectoryListing(await readText(directory, explorerSource), directory) as Entry[]
      for (const entry of entries) {
        if (generation !== searchGeneration || extensionInvalidated) return
        if (!entry.url.startsWith(directory) || entry.url === directory) continue
        if (entry.type === 'directory') { queue.push(entry.url); continue }
        if (checked >= 2000) { limited = true; break }
        checked++
        try {
          const raw = await readText(entry.url, explorerSource)
          if (generation !== searchGeneration) return
          const template = document.createElement('template')
          template.innerHTML = md.render(raw)
          const container = document.createElement('div')
          container.append(template.content)
          if (!`${entry.name} ${searchableText(container)}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())) continue
          matchedFiles.add(normalizeFileURL(entry.url))
          let parent = getParentDirectoryURL(entry.url)
          while (parent && parent.startsWith(rootDirectoryURL)) {
            matchedDirectories.add(parent)
            if (parent !== rootDirectoryURL) expandedDirectories.add(parent)
            const next = getParentDirectoryURL(parent)
            if (next === parent) break
            parent = next
          }
        } catch (error) {
          if (generation !== searchGeneration) return
          failures++
          reportError(t('readerSearchDocumentFailed'), entry.url, error)
        }
      }
    } catch (error) {
      if (generation !== searchGeneration) return
      failures++
      reportError(t('readerSearchFolderReadFailed'), directory, error)
    }
  }
  if (generation !== searchGeneration) return
  searchFilesStatus.textContent = t('readerSearchSummary', [
    matchedFiles.size,
    checked,
    failures ? t('readerSearchFailures', failures) : '',
    limited ? t('readerSearchLimitReached') : '',
    extensionInvalidated ? t('readerSearchStopped') : '',
  ])
  if (!extensionInvalidated) await loadDirectory(rootDirectoryURL, fileTree, true)
  if (generation !== searchGeneration) return
  decorateSearchTree()
  fileTree.dataset.searching = String(!!query)
}

let extensionInvalidated = false

function setStatus(message: string, error = false) {
  if (extensionInvalidated) return
  status.textContent = message
  status.classList.toggle('error', error)
}

function reportError(context: string, url: string, error: unknown, retry = false) {
  if (extensionInvalidated) return
  const detail = String((error as Error)?.message || error)
  if (/extension context invalidated/i.test(detail)) {
    setStatus(t('readerExtensionContextChanged'))
    extensionInvalidated = true
    if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
    refreshTimer = undefined
    console.info(`[Markdown Leader] ${t('readerExtensionContextChangedLog', detail)}`)
    return
  }
  console.error(`[Markdown Leader] ${context}\n${t('readerLogUrl')}: ${url}\n${t('readerLogError')}: ${detail}\n${(error as Error)?.stack || ''}`)
  setStatus(t('readerErrorStatus', [context, describeError(error, t), retry ? t('readerRetryNextCycle') : '']), true)
}

function requireExtension() {
  if (extensionInvalidated || !chrome.runtime?.id) {
    throw new Error('Extension context invalidated.')
  }
  if (!chrome.storage?.local) throw new Error(t('errorStorageUnavailable'))
}

function readText(url: string, source: DocumentSource | null = handleSource): Promise<string> {
  if (source) return source.readText(url)
  if (activeDocument?.url === url && activeDocument.fileHandle) return activeDocument.fileHandle.getFile().then((file: File) => file.text())
  return new Promise((resolve, reject) => {
    requireExtension()
    chrome.runtime.sendMessage({ action: 'readText', url }, (result: ReadResult) => {
      try {
        const runtimeError = chrome.runtime.lastError
        if (runtimeError) return reject(new Error(runtimeError.message))
        if (!result?.ok || typeof result.text !== 'string') return reject(new Error(result?.error || t('readerFileReadFailed')))
        resolve(result.text)
      } catch (error) {
        reject(error)
      }
    })
  })
}

function makeHeadingId(text: string, counts: Map<string, number>) {
  const base = text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-') || 'section'
  const count = counts.get(base) || 0
  counts.set(base, count + 1)
  return count ? `${base}-${count + 1}` : base
}

function captureScroll() {
  const headings = [...content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6')]
    .map((heading) => ({ id: heading.id, top: heading.getBoundingClientRect().top + window.scrollY }))
  return captureScrollSnapshot(window.scrollY, document.documentElement.scrollHeight, window.innerHeight, headings)
}

function restoreScroll(snapshot: ReturnType<typeof captureScroll>, afterRestore?: () => void) {
  const generation = renderGeneration
  requestAnimationFrame(() => {
    if (generation !== renderGeneration) return
    const heading = snapshot.headingId ? document.getElementById(snapshot.headingId) : null
    const headingTop = heading ? heading.getBoundingClientRect().top + window.scrollY : undefined
    window.scrollTo({ top: restoredScrollTop(snapshot, headingTop, document.documentElement.scrollHeight, window.innerHeight), behavior: 'instant' })
    afterRestore?.()
  })
}

function renderMarkdown(raw: string, preserveScroll = false) {
  const snapshot = preserveScroll ? captureScroll() : null
  content.hidden = false
  app.querySelector<HTMLElement>('.ml-welcome')!.hidden = true
  handleSource?.releaseImages()
  let body = raw
  try { body = parseReview(raw).body } catch { /* 형식이 잘못된 메모가 있어도 문서 읽기는 유지한다. */ }
  content.innerHTML = md.render(body.replace(/^\uFEFF/, ''))
  content.querySelectorAll<HTMLInputElement>('input[data-task-line]').forEach(input => { input.disabled = false })
  hydrateLocalImages()
  const counts = new Map<string, number>()
  content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading) => {
    heading.id = makeHeadingId(heading.textContent || '', counts)
  })
  populateDocumentToc(content)
  content.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'ml-copy'
    button.textContent = t('readerCopy')
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(pre.querySelector('code')?.textContent || pre.textContent || '')
      button.textContent = t('readerCopied')
      window.setTimeout(() => { button.textContent = t('readerCopy') }, 1200)
    })
    pre.appendChild(button)
  })
  content.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (link.getAttribute('href')?.startsWith('#') || (link.hash && normalizeFileURL(link.href) === currentFileURL)) {
        event.preventDefault()
        document.getElementById(decodeURIComponent(link.hash.slice(1)))?.scrollIntoView()
        return
      }
      if (link.href.startsWith('file:') && isSupportedDocument(link.href)) {
        event.preventDefault()
        void openFile(link.href, handleSource)
      }
    })
  })
  renderToc()
  reviewUI.setDocument({ id: activeDocument?.id || '', raw, ready: true })
  highlightDocument(false)
  document.title = `${getFileName(currentFileURL)} · Markdown Leader`
  if (snapshot) restoreScroll(snapshot)
  if (content.isConnected) scheduleEnhancements()
}

let enhancementGeneration = 0
let pendingTextPaint: PerformanceObserver | undefined

function scheduleEnhancements() {
  const request = ++enhancementGeneration
  pendingTextPaint?.disconnect()
  pendingTextPaint = undefined
  if (!content.isConnected || !pageActive || extensionInvalidated) return
  if (!content.querySelector('.ml-math[data-math-state="pending"], .ml-diagram')) return
  const generation = renderGeneration
  const page = pageGeneration
  const firstNode = content.firstChild
  const isCurrent = () => request === enhancementGeneration && pageActive && !extensionInvalidated && page === pageGeneration && generation === renderGeneration && firstNode === content.firstChild
  const render = () => {
    if (!isCurrent()) return
    const style = getComputedStyle(document.documentElement)
    void Promise.all([
      renderMath(content, { isCurrent, t }),
      renderDiagrams(content, {
        isCurrent, t,
        colors: {
          background: style.getPropertyValue('--ml-surface').trim(),
          text: style.getPropertyValue('--ml-text').trim(),
          border: style.getPropertyValue('--ml-diagram-border').trim(),
          primary: style.getPropertyValue('--ml-accent-strong').trim(),
          fontFamily: style.getPropertyValue('--ml-font-family').trim(),
          dark: settings.colorMode === 'dark' || (settings.colorMode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
        },
      }),
    ]).then(() => {
      if (isCurrent()) { reviewUI.refreshAnchors(); highlightDocument(false); scheduleTocUpdate() }
    }).catch((error: unknown) => {
      if (isCurrent()) reportError(t('readerDocumentDisplayFailed'), currentFileURL, error)
    })
  }
  // 일반 본문의 첫 표시 이후에 전용 렌더러 작업을 시작한다.
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(() => {
    if (!isCurrent()) return
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('paint')
      || performance.getEntriesByType('paint').some((entry) => entry.name === 'first-contentful-paint')) {
      render()
      return
    }
    const observer = new PerformanceObserver((list) => {
      if (!isCurrent()) {
        observer.disconnect()
        if (pendingTextPaint === observer) pendingTextPaint = undefined
        return
      }
      if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) {
        observer.disconnect()
        if (pendingTextPaint === observer) pendingTextPaint = undefined
        window.setTimeout(render, 0)
      }
    })
    pendingTextPaint = observer
    try {
      observer.observe({ type: 'paint', buffered: true })
    } catch {
      observer.disconnect()
      if (pendingTextPaint === observer) pendingTextPaint = undefined
      window.setTimeout(render, 0)
    }
  }, 0)))
}

window.addEventListener('pagehide', () => {
  pendingTextPaint?.disconnect()
  pendingTextPaint = undefined
})
window.addEventListener('pageshow', () => requestAnimationFrame(scheduleEnhancements))
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', scheduleEnhancements)

let tocEntries: { heading: HTMLElement; link: HTMLAnchorElement }[] = []
let tocFramePending = false

function updateActiveHeading() {
  if (!tocEntries.length) return
  let active = tocEntries[0]
  for (const entry of tocEntries) {
    if (entry.heading.getBoundingClientRect().top <= 100) active = entry
    else break
  }
  if (window.scrollY > 0 && Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight) {
    active = tocEntries[tocEntries.length - 1]
  }
  for (const entry of tocEntries) {
    const selected = entry === active
    entry.link.classList.toggle('active', selected)
    if (selected) entry.link.setAttribute('aria-current', 'location')
    else entry.link.removeAttribute('aria-current')
  }
}

function scheduleTocUpdate() {
  if (tocFramePending) return
  tocFramePending = true
  requestAnimationFrame(() => {
    tocFramePending = false
    updateActiveHeading()
  })
}

window.addEventListener('scroll', scheduleTocUpdate, { passive: true })
window.addEventListener('resize', scheduleTocUpdate)
void document.fonts.ready.then(scheduleTocUpdate)

function renderToc() {
  toc.replaceChildren()
  tocEntries = []
  content.querySelectorAll<HTMLElement>('h1,h2,h3,h4,h5,h6').forEach((heading) => {
    const item = document.createElement('li')
    item.style.setProperty('--level', heading.tagName.slice(1))
    item.dataset.level = heading.tagName.slice(1)
    const link = document.createElement('a')
    link.href = `#${heading.id}`
    link.textContent = heading.textContent || ''
    link.addEventListener('click', (event) => {
      event.preventDefault()
      heading.scrollIntoView({ behavior: 'smooth' })
    })
    item.append(link)
    toc.append(item)
    tocEntries.push({ heading, link })
  })
  updateActiveHeading()
}

function entryElement(entry: Entry): HTMLElement {
  const item = document.createElement('li')
  item.className = `ml-tree-item ${entry.type}`
  item.dataset.url = entry.url
  if (entry.type === 'directory') {
    item.hidden = directoryVisibility.get(entry.url) === 'empty'
    const button = document.createElement('button')
    button.type = 'button'
    button.innerHTML = `<svg class="ml-caret" viewBox="0 0 16 16" aria-hidden="true"><path d="m6 4 4 4-4 4"/></svg><svg class="ml-entry-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 6V4.5h5l2 2h8V16h-15Z"/></svg><span class="ml-entry-name"></span>`
    const label = button.querySelector<HTMLElement>('.ml-entry-name')!
    label.textContent = entry.name
    attachOverflowTooltip(button, label, entry.name)
    const children = document.createElement('ul')
    children.className = 'ml-tree'
    children.hidden = true
    button.addEventListener('click', async () => {
      const expanded = !expandedDirectories.has(entry.url)
      if (expanded) expandedDirectories.add(entry.url)
      else expandedDirectories.delete(entry.url)
      item.classList.toggle('expanded', expanded)
      children.hidden = !expanded
      if (expanded) await loadDirectory(entry.url, children)
    })
    item.append(button, children)
  } else {
    const link = document.createElement('a')
    link.href = entry.url
    link.innerHTML = '<span class="ml-caret-space" aria-hidden="true"></span><svg class="ml-entry-icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6l4 4v11H5Z M11 2.5v4h4 M7.5 10h5 M7.5 13h5"/></svg><span class="ml-entry-name"></span>'
    const label = link.querySelector<HTMLElement>('.ml-entry-name')!
    label.textContent = entry.name
    attachOverflowTooltip(link, label, entry.name)
    link.addEventListener('click', (event) => {
      event.preventDefault()
      void openFile(entry.url)
    })
    item.classList.toggle('active', normalizeFileURL(entry.url) === currentFileURL)
    item.append(link)
  }
  return item
}

function scheduleDirectoryFilter() {
  if (!pageActive || document.hidden || extensionInvalidated || !fileTree.isConnected) return
  directoryFilterPending = true
  if (directoryFilterRunning) return
  directoryFilterRunning = true
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(() => {
    void filterDirectoryTree().catch(() => {}).finally(() => {
      directoryFilterRunning = false
      if (directoryFilterPending) scheduleDirectoryFilter()
    })
  }, 0)))
}

async function filterDirectoryTree() {
  directoryFilterPending = false
  const requestCurrent = captureExplorerTarget()
  const explorer = explorerGeneration
  const refresh = refreshGeneration
  const isCurrent = () => requestCurrent() && explorer === explorerGeneration && refresh === refreshGeneration && !document.hidden && fileTree.isConnected
  const budget = { remaining: 2000 }
  const listings = new Map<string, Promise<Entry[]>>()
  const readEntries = (url: string) => {
    if (!listings.has(url)) listings.set(url, readText(url, explorerSource).then((html) => parseDirectoryListing(html, url) as Entry[]))
    return listings.get(url)!
  }
  // 목록만 읽어 확인한다. 실패하거나 확인이 끝나지 않은 폴더는 남긴다.
  for (const item of fileTree.querySelectorAll<HTMLElement>('.ml-tree-item.directory')) {
    if (!isCurrent()) return
    if (!item.isConnected) continue
    const url = item.dataset.url!
    const state = await probeDirectoryDocuments(url, { readEntries, isCurrent: () => isCurrent() && item.isConnected, budget })
    if (!isCurrent()) return
    if (!item.isConnected) continue
    directoryVisibility.set(url, state)
    if (state === 'empty' && item.contains(document.activeElement)) {
      app.querySelector<HTMLButtonElement>('[data-tab="files"]')!.focus({ preventScroll: true })
    }
    item.hidden = state === 'empty'
    item.dataset.documentState = state
  }
}

function captureReadTarget(background = false): () => boolean {
  const generation = renderGeneration
  const page = pageGeneration
  const refresh = refreshGeneration
  const url = currentFileURL
  return () => pageActive && !extensionInvalidated && page === pageGeneration
    && generation === renderGeneration
    && (!background || (url === currentFileURL && refresh === refreshGeneration && settings.refreshEnabled && !document.hidden && fileTree.isConnected))
}

function captureExplorerTarget(background = false): () => boolean {
  const explorer = explorerGeneration
  const page = pageGeneration
  const refresh = refreshGeneration
  return () => pageActive && !extensionInvalidated && page === pageGeneration && explorer === explorerGeneration
    && (!background || (refresh === refreshGeneration && settings.refreshEnabled && !document.hidden && fileTree.isConnected))
}

async function loadDirectory(url: string, target: HTMLElement, force = false, background = false, requestCurrent = captureExplorerTarget(background)): Promise<boolean> {
  const explorer = explorerGeneration
  const isCurrent = () => requestCurrent() && explorer === explorerGeneration && target.isConnected
  if (!isCurrent()) return false
  try {
    let successful = true
    const html = await readText(url, explorerSource)
    if (!isCurrent()) return false
    const entries = parseDirectoryListing(html, url) as Entry[]
    const signature = directorySignature(entries)
    const cached = directoryCache.get(url)
    directoryCache.set(url, { entries, signature })
    const changed = shouldReplaceDirectory(
      target.dataset.signature || '',
      signature,
      target.dataset.loaded === 'true',
      target.dataset.error === 'true',
      force,
    )
    if (changed) {
      const liveDirectories = new Set(entries.filter((entry) => entry.type === 'directory').map((entry) => entry.url))
      for (const previous of cached?.entries || []) {
        if (previous.type === 'directory' && !liveDirectories.has(previous.url)) {
          for (const known of directoryVisibility.keys()) {
            if (known === previous.url || known.startsWith(previous.url)) directoryVisibility.delete(known)
          }
          for (const expanded of expandedDirectories) {
            if (expanded === previous.url || expanded.startsWith(previous.url)) expandedDirectories.delete(expanded)
          }
        }
      }
      target.replaceChildren(...entries.map(entryElement))
    }
    target.dataset.loaded = 'true'
    target.dataset.error = 'false'
    target.dataset.signature = signature
    for (const entry of entries) {
      if (!isCurrent()) return false
      if (entry.type !== 'directory' || !expandedDirectories.has(entry.url)) continue
      const item = [...target.children].find((node) => (node as HTMLElement).dataset.url === entry.url) as HTMLElement | undefined
      const children = item?.querySelector<HTMLElement>(':scope > ul')
      if (item && children) {
        item.classList.add('expanded')
        children.hidden = false
        if (!await loadDirectory(entry.url, children, false, background, isCurrent)) successful = false
      }
    }
    if (!isCurrent()) return false
    decorateSearchTree()
    scheduleDirectoryFilter()
    return successful
  } catch (error) {
    if (!isCurrent()) return false
    target.dataset.error = 'true'
    if (!target.childElementCount) target.innerHTML = `<li class="ml-empty">${escapeHtml(t('readerFolderReadFailed'))}</li>`
    reportError(t('readerFolderRefreshFailed'), url, error)
    return false
  }
}

function updateActiveFile() {
  fileTree.querySelectorAll<HTMLElement>('.ml-tree-item.file').forEach((item) => {
    item.classList.toggle('active', normalizeFileURL(item.dataset.url || '') === currentFileURL)
  })
}

async function openFile(url: string, source: DocumentSource | null = explorerSource) {
  if (!pageActive) return
  const request = ++documentOpenRequest
  const requestedHash = (() => { try { return new URL(url).hash } catch { return '' } })()
  const normalized = normalizeFileURL(url)
  const existing = documentsByURL.get(normalized)
  if (existing) { await activateDocument(existing, requestedHash); return }
  const named = documentsByName.get(getFileName(normalized))
  if (source && named?.size) {
    try {
      const handle = await source.fileHandle(normalized)
      for (const tab of named) {
        if (request !== documentOpenRequest) return
        if (tab.source && await tab.source.isSameFile(tab.url, handle)) {
          if (request === documentOpenRequest && openDocuments.has(tab.id)) {
            if (source.rootURL && !tab.source.rootURL) {
              const previous = tab.source
              retainSource(source)
              documentsByURL.delete(tab.url)
              tab.source = source
              tab.url = normalized
              documentsByURL.set(normalized, tab)
              documentTabsUI.setDescription(tab.id, `${source.name} / ${decodeURIComponent(new URL(normalized).pathname.split('/').slice(3).join('/'))}`)
              try { await activateDocument(tab, requestedHash, undefined, true) }
              finally { releaseSource(previous) }
            } else await activateDocument(tab, requestedHash)
          }
          return
        }
      }
    } catch { /* 서로 다른 권한 범위는 주소별 문서로 유지한다. */ }
  }
  if (request !== documentOpenRequest) return
  await activateDocument(registerDocument(url, source), requestedHash)
}

async function refreshNow() {
  if (writingDocumentId || !activeDocument || !documentReady || !pageActive || extensionInvalidated || refreshInFlight || document.hidden || !settings.refreshEnabled || !fileTree.isConnected) return
  refreshInFlight = true
  const request = ++refreshRequest
  const isCurrent = captureReadTarget(true)
  const targetURL = currentFileURL
  let stage = t('readerAutomaticRefreshReadFailed')
  try {
    const raw = targetURL ? await readText(targetURL) : currentRaw
    if (!isCurrent()) return
    const contentChanged = raw !== currentRaw
    if (contentChanged) {
      stage = t('readerAutomaticRefreshDisplayFailed')
      renderMarkdown(raw, true)
      currentRaw = raw
      setStatus(t('readerRefreshedAt', new Date().toLocaleTimeString(readerLanguage)))
    }
    let treeSucceeded = true
    if (rootDirectoryURL) {
      treeSucceeded = await loadDirectory(rootDirectoryURL, fileTree, false, true, isCurrent)
      if (!isCurrent()) return
      updateActiveFile()
    }
    if (!contentChanged && treeSucceeded) setStatus('')
  } catch (error) {
    if (isCurrent()) reportError(stage, targetURL, error, true)
  } finally {
    if (request === refreshRequest) refreshInFlight = false
  }
}

function restartRefreshTimer() {
  if (!settings.refreshEnabled) refreshGeneration++
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
  refreshTimer = undefined
  settings.refreshIntervalMs = clampRefreshInterval(settings.refreshIntervalMs)
  refreshInterval.value = String(settings.refreshIntervalMs / 1000)
  if (activeDocument && documentReady && pageActive && !extensionInvalidated && settings.refreshEnabled && !document.hidden) {
    const generation = refreshGeneration
    const owner = activeDocument
    refreshTimer = window.setInterval(() => {
      if (generation === refreshGeneration && owner === activeDocument) void refreshNow()
    }, settings.refreshIntervalMs)
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) refreshGeneration++
  if (!initialBackgroundWorkComplete) return
  if (!document.hidden) scheduleDirectoryFilter()
  restartRefreshTimer()
  if (!document.hidden && settings.refreshEnabled) void refreshNow()
})

window.addEventListener('pagehide', () => {
  documentLoading.cancel()
  pageActive = false
  pageGeneration++
  refreshGeneration++
  if (refreshTimer !== undefined) window.clearInterval(refreshTimer)
  refreshTimer = undefined
})

window.addEventListener('pageshow', () => {
  if (pageActive) return
  pageActive = true
  if (!initialBackgroundWorkComplete) return
  scheduleDirectoryFilter()
  restartRefreshTimer()
  if (!document.hidden && settings.refreshEnabled) void refreshNow()
})

function applySettings(restartTimer = true) {
  applySidebar()
  document.documentElement.dataset.mlTheme = settings.colorMode
  document.documentElement.dataset.mlFontFamily = settings.fontFamily
  document.documentElement.style.setProperty('--ml-font-size', `${settings.fontSizePx}px`)
  document.documentElement.style.setProperty('--ml-content-width', `${settings.contentWidthPx}px`)
  content.dataset.widthMode = settings.widthMode
  refreshEnabled.checked = settings.refreshEnabled
  refreshInterval.disabled = !settings.refreshEnabled
  refreshInterval.value = String(settings.refreshIntervalMs / 1000)
  for (const button of themeButtons) button.setAttribute('aria-pressed', String(button.dataset.theme === settings.colorMode))
  fontFamily.value = settings.fontFamily
  fontSize.value = String(settings.fontSizePx)
  fontSizeValue.value = `${settings.fontSizePx}px`
  for (const button of widthModeButtons) button.setAttribute('aria-pressed', String(button.dataset.widthMode === settings.widthMode))
  contentWidth.value = String(settings.contentWidthPx)
  contentWidth.disabled = settings.widthMode === 'a4'
  contentWidthValue.value = `${settings.contentWidthPx}px`
  a4Note.hidden = settings.widthMode !== 'a4'
  if (restartTimer) restartRefreshTimer()
  if (content.isConnected) scheduleEnhancements()
}

function saveSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  settings[key] = value
  void (async () => {
    try {
      requireExtension()
      await chrome.storage.local.set({ [key]: value })
    } catch (error) {
      reportError(t('readerSettingSaveFailed'), currentFileURL, error)
    }
  })()
}

app.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    closeSearch()
    const tab = button.dataset.tab as NonNullable<typeof activePanel>
    activePanel = tab
    if (tab === 'files' || tab === 'toc') activeNavigation = tab
    if (settings.sidebarCollapsed) { saveSetting('sidebarCollapsed', false); applySidebar() }
    updateLibraryPanels()
    updateNavigation()
  })
})
app.querySelector('[data-search-toggle]')!.addEventListener('click', toggleSearch)
searchInput.addEventListener('input', () => {
  window.clearTimeout(searchDebounce)
  searchGeneration++
  searchQuery = searchInput.value.trim()
  searchIndex = -1
  matchedFiles.clear()
  matchedDirectories.clear()
  decorateSearchTree()
  highlightDocument(true)
  if (searchMode === 'files') searchDebounce = window.setTimeout(() => { void searchFiles() }, 300)
})
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || (event.key === 'Tab' && searchMatches.length > 0)) {
    event.preventDefault()
    moveSearch(event.shiftKey ? -1 : 1)
  }
  if (event.key === 'Escape') closeSearch()
})
app.querySelectorAll<HTMLButtonElement>('[data-search-step]').forEach((button) => {
  button.addEventListener('click', () => moveSearch(Number(button.dataset.searchStep)))
})
app.querySelector('[data-testid="search-clear"]')!.addEventListener('click', closeSearch)
refreshEnabled.addEventListener('change', () => {
  saveSetting('refreshEnabled', refreshEnabled.checked)
  applySettings()
})
refreshInterval.addEventListener('change', () => {
  const value = clampRefreshInterval(Number(refreshInterval.value) * 1000)
  saveSetting('refreshIntervalMs', value)
  restartRefreshTimer()
})
themeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    saveSetting('colorMode', button.dataset.theme as Theme)
    applySettings()
  })
})
fontFamily.addEventListener('change', () => {
  saveSetting('fontFamily', fontFamily.value as FontFamily)
  applySettings()
})
fontSize.addEventListener('input', () => {
  saveSetting('fontSizePx', Number(fontSize.value))
  applySettings()
})
contentWidth.addEventListener('input', () => {
  saveSetting('contentWidthPx', Number(contentWidth.value))
  applySettings()
})
widthModeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    saveSetting('widthMode', button.dataset.widthMode as WidthMode)
    applySettings()
  })
})
chrome.runtime.onMessage.addListener((message) => {
  if (message?.targetTabId !== undefined && message.targetTabId !== readerTabId) return
  if (message?.action === 'refreshChanged') {
    settings.refreshEnabled = Boolean(message.value)
    applySettings()
  }
  if (message?.action === 'themeChanged') {
    settings.colorMode = message.value as Theme
    applySettings()
  }
})

function mountViewer() {
  document.documentElement.replaceChildren(document.head, document.body)
  document.body.replaceChildren(app)
  document.body.className = 'markdown-leader'
  delete document.documentElement.dataset.markdownLeaderStartup
  scheduleEnhancements()
}

function scheduleInitialBackgroundWork() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void (async () => {
        let treeSucceeded = true
        if (rootDirectoryURL) treeSucceeded = await loadDirectory(rootDirectoryURL, fileTree, true)
        else fileTree.innerHTML = `<li class="ml-empty">${escapeHtml(t('readerFolderLocalFilesOnly'))}</li>`
        if (treeSucceeded) setStatus('')
        initialBackgroundWorkComplete = true
        restartRefreshTimer()
      })()
    })
  })
}

async function start() {
  requireExtension()
  if (standaloneReader) readerTabId = (await chrome.tabs.getCurrent())?.id
  const startupSettings = (globalThis as typeof globalThis & {
    markdownLeaderSettingsReady?: Promise<Partial<Settings>>
  }).markdownLeaderSettingsReady
  settings = { ...defaults, ...await (startupSettings || chrome.storage.local.get(defaults)) }
  settings.refreshIntervalMs = clampRefreshInterval(settings.refreshIntervalMs)
  settings.fontFamily = settings.fontFamily === 'pretendard' ? 'pretendard' : 'system'
  const readingSettings = app.querySelector<HTMLDetailsElement>('.ml-settings')!
  readingSettings.open = settings.readingSettingsOpen !== false
  readingSettings.addEventListener('toggle', () => {
    if (settings.readingSettingsOpen !== readingSettings.open) {
      saveSetting('readingSettingsOpen', readingSettings.open)
    }
  })
  applySettings(false)
  rootName.textContent = rootDirectoryURL ? getFileName(rootDirectoryURL) || t('readerLocalFile') : t('readerLocalFile')
  rootName.title = rootDirectoryURL || t('readerLocalFile')
  updateNavigation()
  void library.ready().then(updateLibraryPanels).catch(reportLibraryError)
  if (!currentFileURL) {
    mountViewer()
    showWelcome()
    initialBackgroundWorkComplete = true
    return
  }
  activeDocument = registerDocument(currentFileURL, null)
  documentTabsUI.select(activeDocument.id)
  content.setAttribute('aria-labelledby', `ml-document-tab-${activeDocument.id}`)
  const generation = ++renderGeneration
  currentRaw = originalPre !== null ? originalPre.textContent || '' : await readText(currentFileURL)
  if (generation !== renderGeneration) return
  renderMarkdown(currentRaw)
  documentReady = true
  void rememberDocument(activeDocument)
  if (settings.fontFamily === 'pretendard') {
    await document.fonts.load(`${settings.fontSizePx}px "Pretendard Variable"`)
    if (generation !== renderGeneration) return
  }
  mountViewer()
  scheduleInitialBackgroundWork()
}

function showStartupFailure(error: unknown) {
  try {
    console.error(`[Markdown Leader] ${t('readerInitializationFailedLog')}`, error)
    document.documentElement.replaceChildren(document.head, document.body)
    document.body.className = 'markdown-leader'
    document.body.textContent = t('readerInitializationFailed', describeError(error, t))
  } finally {
    delete document.documentElement.dataset.markdownLeaderStartup
  }
}

void start().catch(showStartupFailure)
}
