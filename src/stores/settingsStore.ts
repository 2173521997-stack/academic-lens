import { create } from 'zustand'
import type { OcrSettings } from '../bridge/types'

export interface ProviderPreset {
  label: string
  baseUrl: string
  model: string
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  doubao: {
    label: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615'
  },
  kimi: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' }
}

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  theme: ThemeMode
  ocr: OcrSettings
  selectionShortcut: string
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => void
  updateOcr: (patch: Partial<OcrSettings>) => void
}

const DEFAULT_OCR: OcrSettings = {
  provider: 'baidu',
  apiKey: '',
  secretKey: '',
  baseUrl: 'https://api.moonshot.cn/v1',
  model: 'moonshot-v1-8k-vision-preview'
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    provider: 'deepseek',
    baseUrl: PROVIDERS.deepseek.baseUrl,
    apiKey: '',
    model: PROVIDERS.deepseek.model,
    theme: 'system',
    ocr: { ...DEFAULT_OCR },
    selectionShortcut: 'CommandOrControl+Shift+D'
  },
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<Partial<Settings>>('settings')
    if (saved) {
      const merged = { ...get().settings, ...saved }
      if (!merged.baseUrl && PROVIDERS[merged.provider]) {
        merged.baseUrl = PROVIDERS[merged.provider].baseUrl
      }
      if (!merged.model && PROVIDERS[merged.provider]) {
        merged.model = PROVIDERS[merged.provider].model
      }
      merged.ocr = { ...DEFAULT_OCR, ...(saved.ocr ?? {}) }
      set({ settings: merged })
    }
    set({ loaded: true })
  },

  update: (patch) => {
    const next = { ...get().settings, ...patch }
    if (patch.provider && PROVIDERS[patch.provider] && patch.provider !== 'custom') {
      next.baseUrl = PROVIDERS[patch.provider].baseUrl
      next.model = PROVIDERS[patch.provider].model
    }
    set({ settings: next })
    void window.bridge.storeSet('settings', next)
  },

  updateOcr: (patch) => {
    const next = { ...get().settings, ocr: { ...get().settings.ocr, ...patch } }
    set({ settings: next })
    void window.bridge.storeSet('settings', next)
  }
}))
