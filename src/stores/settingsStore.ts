import { create } from 'zustand'

export interface ProviderPreset {
  label: string
  baseUrl: string
  model: string
}

export const PROVIDERS: Record<string, ProviderPreset> = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-chat' },
  mimo: { label: 'MiMo（小米）', baseUrl: 'https://api.mimo.xiaomimimo.com/v1', model: 'mimo-7b-rl' },
  doubao: {
    label: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    model: 'doubao-seed-1-6-250615'
  },
  kimi: { label: 'Kimi（月之暗面）', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '' }
}

export type ThemeMode = 'system' | 'light' | 'dark'

/** 查词双轨：uapis 词典优先（自动回退 LLM） / 仅 LLM */
export type LookupSource = 'dict' | 'llm'

/** 领域/风格翻译预设：切换翻译提示词模板的措辞倾向 */
export type DomainPreset = 'general' | 'cs' | 'bio' | 'news' | 'academic'

export const DOMAIN_PRESETS: Record<DomainPreset, string> = {
  general: '普通阅读，通用与准确并重。',
  cs: '计算机/算法领域论文，术语采用 CS 领域通行译法，代码与标识符保持英文不译。',
  bio: '生物/医学领域课件，专业名词采用教科书标准译法，保留拉丁学名。',
  news: '新闻/时政类文稿，翻译自然流畅，保留专有名词原样。',
  academic: '学术论文/SSCI 摘要，风格严谨书面，适合投稿润色。'
}

/** 领域预设的中文展示名（设置页 / 文档页特化选择器共用） */
export const DOMAIN_LABELS: Record<DomainPreset, string> = {
  general: '通用',
  cs: '计算机科学',
  bio: '生物医学',
  news: '新闻时政',
  academic: '学术润色'
}

export interface Settings {
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  theme: ThemeMode
  ocrLang: 'eng' | 'chi_sim' | 'eng+chi_sim'
  /** 智能体（GLM-4-flash 免费 API）独立配置 */
  agentBaseUrl: string
  agentApiKey: string
  agentModel: string
  /** 词典 API（uapis.cn）key；为空则查词仅走 LLM */
  dictApiKey: string
  /** 查询方式双轨：dict = uapis 优先（失败回退 LLM），llm = 仅 LLM */
  lookupSource: LookupSource
  /** 翻译领域/风格预设 */
  domain: DomainPreset
  /** 是否把生词本作为术语注入翻译系统提示，保证术语译法统一 */
  injectTerms: boolean
  /** 每日复习提醒 */
  dailyReminder: boolean
  /** 提醒时间 HH:MM */
  dailyReminderTime: string
  /** 阅读视图字体：无衬线 / 衬线（学术阅读偏好） */
  readerFont: 'sans' | 'serif'
  /** 复制即译：监听剪贴板，外部复制文字自动弹小窗翻译 */
  copyWatch: boolean
}

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (patch: Partial<Settings>) => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: {
    provider: 'deepseek',
    baseUrl: PROVIDERS.deepseek.baseUrl,
    apiKey: '',
    model: PROVIDERS.deepseek.model,
    theme: 'system',
    ocrLang: 'eng+chi_sim',
    // 智谱开放平台 GLM-4-flash 免费模型
    agentBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    agentApiKey: '',
    agentModel: 'glm-4-flash',
    dictApiKey: '',
    lookupSource: 'dict',
    domain: 'general',
    injectTerms: true,
    dailyReminder: false,
    dailyReminderTime: '20:00',
    readerFont: 'sans',
    copyWatch: false
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
  }
}))
