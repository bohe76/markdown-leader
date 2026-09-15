import { renderToString } from 'katex'

export function renderMathSource(source, displayMode) {
  return renderToString(source, {
    displayMode,
    output: 'htmlAndMathml',
    trust: false,
    throwOnError: true,
    strict: 'ignore',
    maxExpand: 1000,
    maxSize: 20,
    macros: {},
  })
}
