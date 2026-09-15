(() => {
  if (window.MathJax?.startup) return
  const root = new URL('../../../', document.currentScript.src)
  const url = (path) => new URL(path, root).href
  window.MathJax = {
    loader: {
      paths: { mathjax: url('renderers/mathjax'), 'mathjax-newcm': url('assets/mathjax') },
      load: ['ui/safe'],
    },
    tex: {
      packages: { '[-]': ['require', 'autoload'] },
      inlineMath: [['\\(', '\\)']],
      displayMath: [['\\[', '\\]']],
      processEscapes: true,
      processEnvironments: true,
      processRefs: true,
      tags: 'ams',
      maxMacros: 1000,
      maxBuffer: 8192,
    },
    chtml: {
      fontURL: url('assets/mathjax/chtml/woff2'),
      dynamicPrefix: url('assets/mathjax/chtml/dynamic'),
    },
    options: {
      enableMenu: false,
      safeOptions: { allow: { URLs: 'safe', classes: 'none', cssIDs: 'safe', styles: 'none' } },
    },
    startup: {
      typeset: false,
      ready() {
        MathJax.startup.defaultReady()
        Object.assign(MathJax.startup.document.options, {
          enableEnrichment: false,
          enableSpeech: false,
          enableBraille: false,
          enableComplexity: false,
          enableExplorer: false,
          enableAssistiveMml: true,
          enableMenu: false,
        })
      },
    },
  }
})()
