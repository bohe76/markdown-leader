import english from './_locales/en/messages.json' with { type: 'json' }
import korean from './_locales/ko/messages.json' with { type: 'json' }

/** @param {string} [language] */
export function createTranslator(language = 'en') {
  const messages = /^ko(?:[-_]|$)/i.test(language) ? korean : english
  /** @param {string} name @param {string | number | Array<string | number>} [substitutions] */
  return (name, substitutions = []) => {
    const entry = messages[name] || english[name]
    if (!entry) return ''
    const values = Array.isArray(substitutions) ? substitutions : [substitutions]
    return entry.message.replace(/\$\$|\$([a-z0-9_]+)\$/gi, (token, placeholder) => {
      if (token === '$$') return '$'
      const content = entry.placeholders?.[placeholder.toLowerCase()]?.content
      if (content === undefined) return token
      return content.replace(/\$(\d+)/g, (_, index) => String(values[Number(index) - 1] ?? ''))
    })
  }
}
