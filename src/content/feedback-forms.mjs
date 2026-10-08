export const FEEDBACK_FORMS = {
  ko: {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLSci0bKW5YUAObzyZxxaT_4b5CoSjKr1C9AJT6gJX6zJXT8pLw/viewform',
    versionEntry: 'entry.1313783617',
  },
  en: {
    url: 'https://docs.google.com/forms/d/e/1FAIpQLScBVqRq5UFowchiFOGYG_nTlw5QFGWvRpCdt05iw1Mflkq2OQ/viewform',
    versionEntry: 'entry.1313783617',
  },
}

/** @param {'ko' | 'en'} language @param {string} version */
export function feedbackFormURL(language, version) {
  const form = FEEDBACK_FORMS[language]
  const url = new URL(form.url)
  url.searchParams.set('usp', 'pp_url')
  url.searchParams.set('hl', language)
  url.searchParams.set(form.versionEntry, version)
  return url.href
}
