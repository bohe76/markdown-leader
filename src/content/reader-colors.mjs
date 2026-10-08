// 표시 색 프리셋과 사용자 지정 강조색 규칙. 값과 대비 근거는 DESIGN.md Colors를 따른다.
export const HIGHLIGHT_PRESETS = [
  { id: 'yellow', name: 'highlightYellow', light: ['#ffff00', '#000000'] },
  // Word에 없는 주황은 형광펜에서 흔한 색이라 16색을 맞추며 추가했다.
  { id: 'orange', name: 'highlightOrange', light: ['#ffa500', '#000000'] },
  { id: 'brightGreen', name: 'highlightBrightGreen', light: ['#00ff00', '#000000'] },
  { id: 'turquoise', name: 'highlightTurquoise', light: ['#00ffff', '#000000'] },
  { id: 'pink', name: 'highlightPink', light: ['#ff00ff', '#000000'] },
  { id: 'red', name: 'highlightRed', light: ['#ff0000', '#000000'] },
  { id: 'blue', name: 'highlightBlue', light: ['#0000ff', '#ffffff'] },
  { id: 'darkYellow', name: 'highlightDarkYellow', light: ['#808000', '#000000'] },
  { id: 'green', name: 'highlightGreen', light: ['#008000', '#ffffff'] },
  { id: 'teal', name: 'highlightTeal', light: ['#008080', '#ffffff'] },
  { id: 'darkBlue', name: 'highlightDarkBlue', light: ['#000080', '#ffffff'], dark: ['#38389c', '#ffffff'] },
  { id: 'violet', name: 'highlightViolet', light: ['#800080', '#ffffff'] },
  { id: 'darkRed', name: 'highlightDarkRed', light: ['#800000', '#ffffff'], dark: ['#8b1717', '#ffffff'] },
  { id: 'gray25', name: 'highlightGray25', light: ['#c0c0c0', '#000000'] },
  { id: 'gray50', name: 'highlightGray50', light: ['#808080', '#000000'] },
  { id: 'black', name: 'highlightBlack', light: ['#000000', '#ffffff'], dark: ['#474747', '#ffffff'] },
]

export const ACCENT_PRESETS = [
  // 기본 파랑은 기존 가리킴·포커스 값을 그대로 쓰고, 나머지는 strong 색에서 같은 규칙으로 만든다.
  { id: 'blue', name: 'accentBlue', light: ['#0088ff', '#1765e3'], dark: ['#0091ff', '#5cb8ff'], hover: ['#eff4ff', '#202a3a'], ring: ['#6c8ccb', '#9cb7e8'] },
  // 나머지는 Tailwind 기본 팔레트다. Light accent 600·strong 700, Dark accent 500·strong 400이며 노랑만 대비를 위해 한 단계 진하게 쓴다.
  { id: 'indigo', name: 'accentIndigo', light: ['#4f46e5', '#4338ca'], dark: ['#6366f1', '#818cf8'] },
  { id: 'violet', name: 'accentViolet', light: ['#7c3aed', '#6d28d9'], dark: ['#8b5cf6', '#a78bfa'] },
  { id: 'purple', name: 'accentPurple', light: ['#9333ea', '#7e22ce'], dark: ['#a855f7', '#c084fc'] },
  { id: 'pink', name: 'accentPink', light: ['#db2777', '#be185d'], dark: ['#ec4899', '#f472b6'] },
  { id: 'rose', name: 'accentRose', light: ['#e11d48', '#be123c'], dark: ['#f43f5e', '#fb7185'] },
  { id: 'red', name: 'accentRed', light: ['#dc2626', '#b91c1c'], dark: ['#ef4444', '#f87171'] },
  { id: 'orange', name: 'accentOrange', light: ['#ea580c', '#c2410c'], dark: ['#f97316', '#fb923c'] },
  { id: 'amber', name: 'accentAmber', light: ['#d97706', '#b45309'], dark: ['#f59e0b', '#fbbf24'] },
  { id: 'yellow', name: 'accentYellow', light: ['#a16207', '#854d0e'], dark: ['#eab308', '#facc15'] },
  { id: 'lime', name: 'accentLime', light: ['#65a30d', '#4d7c0f'], dark: ['#84cc16', '#a3e635'] },
  { id: 'green', name: 'accentGreen', light: ['#16a34a', '#15803d'], dark: ['#22c55e', '#4ade80'] },
  { id: 'emerald', name: 'accentEmerald', light: ['#059669', '#047857'], dark: ['#10b981', '#34d399'] },
  { id: 'teal', name: 'accentTeal', light: ['#0d9488', '#0f766e'], dark: ['#14b8a6', '#2dd4bf'] },
  { id: 'sky', name: 'accentSky', light: ['#0284c7', '#0369a1'], dark: ['#0ea5e9', '#38bdf8'] },
  { id: 'slate', name: 'accentSlate', light: ['#475569', '#334155'], dark: ['#64748b', '#94a3b8'] },
]

const LIGHT_SURFACE = '#ffffff'
const DARK_SURFACE = '#171c24'
const ON_ACCENT = ['#ffffff', '#11151b']
const HEX = /^#[0-9a-f]{6}$/i

export const isColor = value => typeof value === 'string' && HEX.test(value)

function luminance(hex) {
  const [r, g, b] = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

function mix(hex, target, amount) {
  const from = hex.slice(1).match(/../g).map(value => parseInt(value, 16))
  const to = target.slice(1).match(/../g).map(value => parseInt(value, 16))
  return `#${from.map((value, i) => Math.round(value + (to[i] - value) * amount).toString(16).padStart(2, '0')).join('')}`
}

// 상대 테마 색은 표면 대비 4.5:1에 처음 닿을 때까지 1%씩 흰색 또는 검정 쪽으로 섞는다.
function reachContrast(hex, surface, toward) {
  for (let step = 0; step <= 100; step++) {
    const color = mix(hex, toward, step / 100)
    if (contrast(color, surface) >= 4.5) return color
  }
  return toward
}

// 가리킴 바탕은 strong을 표면 쪽으로 Light 93%, Dark 88% 섞는다.
// 포커스 테두리는 Light에서 흰색 쪽으로 최대 30% 섞되 흰 바탕 대비 3:1을 지키고, Dark에서는 흰색 쪽으로 30% 섞는다.
function interactionColors(lightStrong, darkStrong) {
  let ringLight = lightStrong
  for (let step = 30; step >= 0; step--) {
    const color = mix(lightStrong, '#ffffff', step / 100)
    if (contrast(color, LIGHT_SURFACE) >= 3) { ringLight = color; break }
  }
  return { hover: [mix(lightStrong, '#ffffff', 0.93), mix(darkStrong, DARK_SURFACE, 0.88)], ring: [ringLight, mix(darkStrong, '#ffffff', 0.3)] }
}

export const darkPartner = hex => reachContrast(hex.toLowerCase(), DARK_SURFACE, '#ffffff')
export const lightPartner = hex => reachContrast(hex.toLowerCase(), LIGHT_SURFACE, '#000000')
export const onAccent = hex => (contrast(hex, ON_ACCENT[0]) >= contrast(hex, ON_ACCENT[1]) ? ON_ACCENT[0] : ON_ACCENT[1])

// 저장된 설정을 테마별 CSS 변수 값으로 바꾼다. 알 수 없는 값은 기본 프리셋으로 되돌린다.
export function colorVariables({ highlightColor, accentColor, accentCustom }) {
  const highlight = HIGHLIGHT_PRESETS.find(item => item.id === highlightColor) || HIGHLIGHT_PRESETS[0]
  const [markLight, markLightText] = highlight.light
  const [markDark, markDarkText] = highlight.dark || highlight.light
  const custom = accentColor === 'custom' && isColor(accentCustom?.light) && isColor(accentCustom?.dark) ? accentCustom : null
  const preset = ACCENT_PRESETS.find(item => item.id === accentColor) || ACCENT_PRESETS[0]
  const light = custom ? [custom.light, custom.light] : preset.light
  const dark = custom ? [custom.dark, custom.dark] : preset.dark
  const { hover, ring } = !custom && preset.hover ? preset : interactionColors(light[1], dark[1])
  return {
    '--ml-user-hover-light': hover[0],
    '--ml-user-hover-dark': hover[1],
    '--ml-user-focus-ring-light': ring[0],
    '--ml-user-focus-ring-dark': ring[1],
    '--ml-user-mark-bg-light': markLight,
    '--ml-user-mark-text-light': markLightText,
    '--ml-user-mark-bg-dark': markDark,
    '--ml-user-mark-text-dark': markDarkText,
    '--ml-user-accent-light': light[0],
    '--ml-user-accent-strong-light': light[1],
    '--ml-user-on-accent-light': custom ? onAccent(light[1]) : ON_ACCENT[0],
    '--ml-user-accent-dark': dark[0],
    '--ml-user-accent-strong-dark': dark[1],
    '--ml-user-on-accent-dark': custom ? onAccent(dark[1]) : ON_ACCENT[1],
  }
}

// 프리셋에서 한쪽 테마 색을 처음 고르면 다른 테마 색을 채우고, 이미 사용자 지정이면 고른 쪽만 바꾼다.
export function pickAccent(settings, theme, hex) {
  const value = hex.toLowerCase()
  if (settings.accentColor === 'custom' && isColor(settings.accentCustom?.light) && isColor(settings.accentCustom?.dark)) {
    return { ...settings.accentCustom, [theme]: value }
  }
  return theme === 'light' ? { light: value, dark: darkPartner(value) } : { light: lightPartner(value), dark: value }
}
