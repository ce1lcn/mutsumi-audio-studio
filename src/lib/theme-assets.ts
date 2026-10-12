import mutsumiPortrait from '../assets/themes/mutsumi/portrait.webp'
import mutsumiSticker from '../assets/themes/mutsumi/audio-sticker.webp'
import mutsumiBackground from '../assets/themes/mutsumi/studio-background-v2.webp'
import mortisPortrait from '../assets/themes/mortis/portrait.webp'
import mortisSticker from '../assets/themes/mortis/audio-sticker.webp'
import mortisBackground from '../assets/themes/mortis/studio-background-v2.webp'
import type { ThemeMode } from '../../shared/contracts'

export interface ThemeArt {
  name: string
  portrait: string
  sticker: string
  background: string
  motto: string
}

export const THEME_ART: Record<ThemeMode, ThemeArt> = {
  light: { name: '若叶睦', portrait: mutsumiPortrait, sticker: mutsumiSticker, background: mutsumiBackground, motto: '留一点时间，听见自己的声音' },
  dark: { name: 'Mortis', portrait: mortisPortrait, sticker: mortisSticker, background: mortisBackground, motto: '夜色里，也有温柔的声音' },
}
