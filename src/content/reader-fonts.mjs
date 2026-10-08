// OS가 기본 제공하는 글꼴 선택지. 목록과 대체 글꼴 규칙은 DESIGN.md Typography를 따른다.
const SANS = 'system-ui, sans-serif'
const SERIF = 'serif'

export const OS_FONTS = [
  { id: 'malgunGothic', name: 'fontMalgunGothic', local: 'Malgun Gothic', fallback: SANS, os: ['win10', 'win11'] },
  // Segoe UI Variable은 영문 전용이라 한글은 맑은 고딕으로 잇는다.
  { id: 'segoeUIVariable', name: 'fontSegoeUIVariable', local: 'Segoe UI Variable Text', fallback: `'Malgun Gothic', ${SANS}`, os: ['win11'] },
  { id: 'gulim', name: 'fontGulim', local: 'Gulim', fallback: SANS, os: ['win10', 'win11'] },
  { id: 'dotum', name: 'fontDotum', local: 'Dotum', fallback: SANS, os: ['win10', 'win11'] },
  { id: 'batang', name: 'fontBatang', local: 'Batang', fallback: SERIF, os: ['win10', 'win11'] },
  { id: 'gungsuh', name: 'fontGungsuh', local: 'Gungsuh', fallback: SERIF, os: ['win10', 'win11'] },
  { id: 'appleSDGothicNeo', name: 'fontAppleSDGothicNeo', local: 'Apple SD Gothic Neo', fallback: SANS, os: ['mac'] },
  { id: 'nanumGothic', name: 'fontNanumGothic', local: 'NanumGothic', fallback: SANS, os: ['mac'] },
  { id: 'appleMyungjo', name: 'fontAppleMyungjo', local: 'AppleMyungjo', fallback: SERIF, os: ['mac'] },
  { id: 'nanumMyeongjo', name: 'fontNanumMyeongjo', local: 'NanumMyeongjo', fallback: SERIF, os: ['mac'] },
]

const BASE_FONTS = { system: SANS, pretendard: `"Pretendard Variable", ${SANS}` }

export const isFontId = id => Object.hasOwn(BASE_FONTS, id) || OS_FONTS.some(font => font.id === id)

export function fontStack(id) {
  const font = OS_FONTS.find(item => item.id === id)
  return font ? `'${font.local}', ${font.fallback}` : BASE_FONTS[id] || BASE_FONTS.system
}

// Windows 10과 11은 UA 문자열이 같아 platformVersion 앞자리로 나눈다. 13 이상이 11이며 판별 실패는 10으로 본다.
export async function detectPlatform(nav = navigator) {
  const platform = nav.userAgentData?.platform || nav.platform || ''
  if (/^mac/i.test(platform)) return 'mac'
  if (!/^win/i.test(platform)) return 'other'
  try {
    const { platformVersion } = await nav.userAgentData.getHighEntropyValues(['platformVersion'])
    return parseInt(platformVersion, 10) >= 13 ? 'win11' : 'win10'
  } catch {
    return 'win10'
  }
}

// 설치되지 않은 글꼴은 기본 글꼴로 대체돼 너비가 같으므로, 기본 글꼴 셋 중 하나라도 너비가 다르면 설치된 것으로 본다.
export function fontInstalled(local, doc = document) {
  const context = doc.createElement('canvas').getContext('2d')
  if (!context) return false
  const sample = '가나다라 Markdown 0123 mmmwwwiiil'
  return ['monospace', 'serif', 'sans-serif'].some((base) => {
    context.font = `72px ${base}`
    const width = context.measureText(sample).width
    context.font = `72px '${local}', ${base}`
    return context.measureText(sample).width !== width
  })
}

export const osFonts = (platform, installed) => OS_FONTS.filter(font => font.os.includes(platform) && installed(font.local))
