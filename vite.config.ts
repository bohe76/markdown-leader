import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { build, defineConfig } from 'vite'
import { buildInfo } from './scripts/build-info.mjs'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))

function packageDirectory(name: string, importer: string) {
  const require = createRequire(resolve(importer, 'package.json'))
  const directory = (require.resolve.paths(name) ?? [])
    .map((path) => resolve(path, name))
    .find((path) => existsSync(resolve(path, 'package.json')))
  if (!directory) throw new Error(`Runtime package missing: ${name}`)
  return realpathSync(directory)
}

function runtimeNotices() {
  const visited = new Set<string>()
  const notices: string[] = []
  function visit(name: string, importer: string) {
    const directory = packageDirectory(name, importer)
    if (visited.has(directory)) return
    visited.add(directory)
    const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'))
    const licenseFiles = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^(licen[cs]e|copying|ofl|notice)([._-]|$)/i.test(entry.name))
      .map((entry) => readFileSync(resolve(directory, entry.name), 'utf8').trim())
    if (!licenseFiles.length) {
      const readme = readdirSync(directory).find((name) => /^readme(\.|$)/i.test(name))
      const embedded = readme && readFileSync(resolve(directory, readme), 'utf8').match(/^#{1,6}\s+Licen[cs]e[^\n]*\n([\s\S]*?)(?=^#{1,6}\s|$(?![\s\S]))/im)
      if (embedded) licenseFiles.push(embedded[1].trim())
    }
    if (!licenseFiles.length) throw new Error(`Runtime license file missing: ${metadata.name}`)
    notices.push(`${'='.repeat(72)}\n${metadata.name} ${metadata.version}\n${'='.repeat(72)}\n${licenseFiles.join('\n\n')}`)
    for (const dependency of Object.keys(metadata.dependencies ?? {}).sort()) visit(dependency, directory)
  }
  for (const name of Object.keys(pkg.dependencies ?? {}).sort()) visit(name, root)
  return `${notices.join('\n\n')}\n`
}

function escapeNoncharacters() {
  return {
    name: 'escape-extension-noncharacters',
    renderChunk: {
      order: 'post' as const,
      handler(code: string) {
        // esbuild는 정규식 안의 비문자를 ASCII 설정으로도 이스케이프하지 않는다.
        const escaped = code.replace(/[\uFDD0-\uFDEF\uFFFE\uFFFF]/g, (character) =>
          `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
        return escaped === code ? null : { code: escaped, map: null }
      },
    },
  }
}

let outputDirectory = resolve(root, 'dist')

export default defineConfig(({ mode }) => {
const info = buildInfo(pkg.version, mode === 'release', root)
return {
  esbuild: { charset: 'ascii' },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [{
    name: 'copy-extension-files',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    async writeBundle() {
      const source = resolve(root, 'src')
      const output = outputDirectory
      const contentSource = readFileSync(resolve(source, 'content/index.ts'), 'utf8')
      const manifest = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'))
      manifest.version = pkg.version
      manifest.version_name = info.displayVersion
      mkdirSync(resolve(output, 'assets'), { recursive: true })
      writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
      writeFileSync(resolve(output, 'build-info.json'), `${JSON.stringify(info, null, 2)}\n`)
      copyFileSync(resolve(source, 'background.js'), resolve(output, 'background.js'))
      copyFileSync(resolve(source, 'content/startup.js'), resolve(output, 'content/startup.js'))
      copyFileSync(resolve(source, 'content/startup.css'), resolve(output, 'content/startup.css'))
      copyFileSync(resolve(source, 'popup.html'), resolve(output, 'popup.html'))
      copyFileSync(resolve(source, 'popup.js'), resolve(output, 'popup.js'))
      copyFileSync(resolve(source, 'reader.html'), resolve(output, 'reader.html'))
      copyFileSync(resolve(root, 'LICENSE'), resolve(output, 'LICENSE'))
      writeFileSync(resolve(output, 'THIRD_PARTY_NOTICES.txt'), runtimeNotices())
      cpSync(resolve(source, 'assets'), resolve(output, 'assets'), { recursive: true })
      cpSync(resolve(source, '_locales'), resolve(output, '_locales'), { recursive: true })
      const rendererEntries: Record<string, string> = {}
      if (contentSource.includes('markdown-math')) {
        const katexDirectory = packageDirectory('katex', root)
        cpSync(resolve(katexDirectory, 'dist/fonts'), resolve(output, 'assets/katex'), { recursive: true })
        const mathCss = readFileSync(resolve(katexDirectory, 'dist/katex.min.css'), 'utf8')
          .replace(/url\((['"]?)fonts\//g, 'url($1../assets/katex/')
        mkdirSync(resolve(output, 'renderers'), { recursive: true })
        writeFileSync(resolve(output, 'renderers/katex.css'), mathCss)
        const mathEntry = resolve(source, 'content/math-renderer.mjs')
        if (existsSync(mathEntry)) rendererEntries.math = mathEntry
      }
      const diagramEntry = resolve(source, 'content/mermaid-renderer.mjs')
      if (existsSync(diagramEntry) && contentSource.includes('markdown-diagrams')) rendererEntries.mermaid = diagramEntry
      if (Object.keys(rendererEntries).length) {
        await build({
          configFile: false,
          plugins: [escapeNoncharacters()],
          root,
          base: './',
          esbuild: { charset: 'ascii' },
          build: {
            outDir: output,
            emptyOutDir: false,
            rollupOptions: {
              input: rendererEntries,
              preserveEntrySignatures: 'strict',
              output: {
                format: 'es',
                entryFileNames: 'renderers/[name].js',
                chunkFileNames: 'renderers/[name]-[hash].js',
                assetFileNames: 'renderers/[name]-[hash][extname]',
              },
            },
          },
        })
      }
    },
  }, escapeNoncharacters()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(root, 'src/content/index.ts'),
      output: {
        entryFileNames: 'content/index.js',
        assetFileNames: 'content/style.[ext]',
        inlineDynamicImports: true,
      },
    },
  },
}
})
