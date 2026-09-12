import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import vm from 'node:vm'
import test from 'node:test'
import { transformWithEsbuild } from 'vite'
import { buildInfo } from '../scripts/build-info.mjs'

const configSource = fs.readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
const { code } = await transformWithEsbuild(configSource, 'vite.config.ts', { loader: 'ts', target: 'es2022' })
const executable = code.replace(/^import .*;?\r?\n/gm, '').replace('export default', 'globalThis.config =')

function fixture(t, content = '') {
  const root = fs.mkdtempSync(resolve(tmpdir(), 'markdown-assets-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  function write(path, value = '') {
    fs.mkdirSync(resolve(root, path, '..'), { recursive: true })
    fs.writeFileSync(resolve(root, path), value)
  }
  write('package.json', JSON.stringify({ version: '9.8.7', dependencies: { engine: '15.0.0', katex: '1.0.0' } }))
  write('node_modules/engine/package.json', JSON.stringify({ name: 'engine', version: '15.0.0', dependencies: { parser: '2.0.0' } }))
  write('node_modules/engine/LICENSE', 'Engine copyright')
  write('node_modules/parser/package.json', JSON.stringify({ name: 'parser', version: '2.0.0' }))
  write('node_modules/parser/README.md', '# Parser\n\n## License\n\nParser copyright\n\n## Other\nNot part of the notice')
  write('node_modules/katex/package.json', JSON.stringify({ name: 'katex', version: '1.0.0' }))
  write('node_modules/katex/LICENSE', 'Math copyright')
  write('node_modules/katex/OFL.txt', 'Font copyright')
  write('node_modules/katex/dist/fonts/math.woff2', 'font')
  write('node_modules/katex/dist/katex.min.css', `@font-face{src:url(fonts/math.woff2),url("fonts/math.woff2"),url('fonts/math.woff2')}`)
  write('src/manifest.json', '{}')
  write('src/content/index.ts', content)
  for (const path of ['background.js', 'content/startup.js', 'content/startup.css', 'popup.html', 'popup.js', 'reader.html', 'assets/icon.png', '_locales/en/messages.json']) write(`src/${path}`)
  write('src/reader.html', '<!doctype html><script src="content/index.js"></script>')
  write('LICENSE', 'Project copyright')
  const calls = []
  const context = vm.createContext({ ...fs, createRequire, resolve, process: { cwd: () => root }, defineConfig: (value) => value, build: async (options) => { calls.push(options) } })
  vm.runInContext(executable, context)
  context.buildInfo = buildInfo
  const config = context.config({ mode: 'production' })
  const output = resolve(root, '.omx/build/staged')
  fs.mkdirSync(resolve(output, 'content'), { recursive: true })
  config.plugins[0].configResolved({ root, build: { outDir: '.omx/build/staged' } })
  return { config, output, root, calls, write }
}

test('copies to resolved custom outDir and gathers installed transitive licenses', async (t) => {
  const { config, output, root, calls } = fixture(t)
  await config.plugins[0].writeBundle()
  assert.equal(JSON.parse(fs.readFileSync(resolve(output, 'manifest.json'))).version, '9.8.7')
  assert.equal(config.define.__APP_VERSION__, '"9.8.7"')
  assert.equal(fs.readFileSync(resolve(output, 'reader.html'), 'utf8'), '<!doctype html><script src="content/index.js"></script>')
  const notices = fs.readFileSync(resolve(output, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
  for (const text of ['engine 15.0.0', 'parser 2.0.0', 'Parser copyright', 'Font copyright']) assert.ok(notices.includes(text))
  assert.equal(notices.includes('Not part of the notice'), false)
  assert.equal(fs.existsSync(resolve(root, 'dist')), false)
  assert.equal(fs.existsSync(resolve(output, 'assets/katex')), false)
  assert.equal(calls.length, 0)
})

test('math fonts and Mermaid ES chunks are gated by active content imports', async (t) => {
  const { config, output, calls, write } = fixture(t, "import './markdown-math.mjs'\nimport './markdown-diagrams.mjs'")
  write('src/content/mermaid-renderer.mjs', 'export const render = () => {}')
  write('src/content/math-renderer.mjs', 'export const renderMathSource = () => {}')
  await config.plugins[0].writeBundle()
  assert.equal(fs.readFileSync(resolve(output, 'assets/katex/math.woff2'), 'utf8'), 'font')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].configFile, false)
  assert.equal(config.esbuild.charset, 'ascii')
  assert.equal(calls[0].esbuild.charset, 'ascii')
  assert.equal(calls[0].plugins[0].name, 'escape-extension-noncharacters')
  assert.equal(calls[0].build.outDir, output)
  assert.equal(calls[0].build.emptyOutDir, false)
  assert.equal(calls[0].build.rollupOptions.preserveEntrySignatures, 'strict')
  assert.equal(calls[0].build.rollupOptions.output.format, 'es')
  assert.equal(calls[0].build.rollupOptions.output.entryFileNames, 'renderers/[name].js')
  assert.deepEqual(Object.keys(calls[0].build.rollupOptions.input).sort(), ['math', 'mermaid'])
  for (const [name, path] of Object.entries(calls[0].build.rollupOptions.input)) assert.ok(path.endsWith(`${name}-renderer.mjs`))
  const css = fs.readFileSync(resolve(output, 'renderers/katex.css'), 'utf8')
  const urls = [...css.matchAll(/url\((['"]?)([^)'"\s]+)\1\)/g)].map((match) => match[2])
  assert.equal(urls.length, 3)
  for (const url of urls) {
    assert.equal(url, '../assets/katex/math.woff2')
    assert.ok(fs.existsSync(resolve(output, 'renderers', url)))
  }
  assert.equal(config.build.rollupOptions.output.inlineDynamicImports, true)
})

test('renderer source alone does not bundle Mermaid before its stage', async (t) => {
  const { config, calls, write } = fixture(t)
  write('src/content/mermaid-renderer.mjs')
  write('src/content/math-renderer.mjs')
  await config.plugins[0].writeBundle()
  assert.equal(calls.length, 0)
})

test('math-only stage builds its independent renderer entry', async (t) => {
  const { config, calls, write } = fixture(t, "import './markdown-math.mjs'")
  write('src/content/math-renderer.mjs')
  write('src/content/mermaid-renderer.mjs')
  await config.plugins[0].writeBundle()
  assert.equal(calls.length, 1)
  assert.deepEqual(Object.keys(calls[0].build.rollupOptions.input), ['math'])
})

test('final JavaScript escapes KaTeX regex noncharacters without changing matching', async (t) => {
  const { config } = fixture(t)
  const noncharacter = String.fromCharCode(0xffff)
  const { code } = await transformWithEsbuild(`globalThis.pattern = /[${noncharacter}]/; globalThis.text = '${noncharacter}';`, 'katex-regex.js', { ...config.esbuild, minify: true })
  const finalizer = config.plugins.find((plugin) => plugin.name === 'escape-extension-noncharacters')
  assert.equal(finalizer.renderChunk.order, 'post')
  const output = finalizer.renderChunk.handler(code)?.code ?? code
  assert.equal(output.includes(noncharacter), false)
  assert.match(output, /\\u[fF]{4}/)
  const context = vm.createContext({})
  vm.runInContext(output, context)
  assert.equal(context.pattern.test(noncharacter), true)
  assert.equal(context.pattern.test('a'), false)
  assert.equal(context.text, noncharacter)
})
