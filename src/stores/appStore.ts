import { create } from 'zustand'

export type ViewName =
  | 'research' // 来做学术（项目制文献工作台）
  | 'english'  // 来学英语（个性化英语空间）
  | 'agent'    // 智能体（全能指挥中枢）
  | 'settings' // 系统设置
  // 兼容与深层直达路由
  | 'home'
  | 'reader'
  | 'bilingual'
  | 'summary'
  | 'review'
  | 'citation'
  | 'bibtex'
  | 'writing'
  | 'polish'
  | 'translate'
  | 'image'
  | 'ocr'
  | 'vocabulary'
  | 'wordbook'
  | 'flashcard'
  | 'history'
  | 'advanced'
  | 'phrasebank'
  | 'grammar'
  | 'ielts'
  | 'toefl'
  | 'profile'
  | 'goals'
  | 'stats'
  | 'report'
  | 'quotes'

export type ResearchTab = 'reader' | 'writing' | 'image'
export type ReaderSubTab = 'bilingual' | 'summary' | 'review' | 'citation'
export type WritingSubTab = 'polish' | 'translate'

export type EnglishTab = 'vocabulary' | 'advanced' | 'profile'
export type VocabSubTab = 'wordbook' | 'flashcard' | 'history'
export type AdvancedSubTab = 'phrasebank' | 'grammar' | 'writing'
export type ProfileSubTab = 'goals' | 'stats' | 'quotes'

export interface NavigateOptions {
  text?: string
  query?: string
  prompt?: string
}

interface AppState {
  view: ViewName
  assistantOpen: boolean
  platform: string
  isMac: boolean

  // 学术研读与工作台子路由
  researchTab: ResearchTab
  readerSubTab: ReaderSubTab
  writingSubTab: WritingSubTab

  // 英语自适应空间子路由
  englishTab: EnglishTab
  vocabSubTab: VocabSubTab
  advancedSubTab: AdvancedSubTab
  profileSubTab: ProfileSubTab

  // 跨页面表单注入暂存状态
  grammarInput: string
  writingInput: string
  phrasebankQuery: string

  setResearchTab: (tab: ResearchTab, subTab?: ReaderSubTab | WritingSubTab) => void
  setEnglishTab: (tab: EnglishTab, subTab?: VocabSubTab | AdvancedSubTab | ProfileSubTab) => void
  setGrammarInput: (text: string) => void
  setWritingInput: (text: string) => void
  setPhrasebankQuery: (query: string) => void

  go: (view: ViewName | string, options?: NavigateOptions) => void
  toggleAssistant: () => void
  setAssistant: (open: boolean) => void
  setPlatform: (platform: string, isMac: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'research',
  assistantOpen: true,
  platform: '',
  isMac: false,

  researchTab: 'reader',
  readerSubTab: 'bilingual',
  writingSubTab: 'polish',

  englishTab: 'vocabulary',
  vocabSubTab: 'wordbook',
  advancedSubTab: 'phrasebank',
  profileSubTab: 'goals',

  grammarInput: '',
  writingInput: '',
  phrasebankQuery: '',

  setResearchTab: (tab, subTab) =>
    set((s) => ({
      researchTab: tab,
      readerSubTab: (tab === 'reader' && subTab ? subTab : s.readerSubTab) as ReaderSubTab,
      writingSubTab: (tab === 'writing' && subTab ? subTab : s.writingSubTab) as WritingSubTab
    })),

  setEnglishTab: (tab, subTab) =>
    set((s) => ({
      englishTab: tab,
      vocabSubTab: (tab === 'vocabulary' && subTab ? subTab : s.vocabSubTab) as VocabSubTab,
      advancedSubTab: (tab === 'advanced' && subTab ? subTab : s.advancedSubTab) as AdvancedSubTab,
      profileSubTab: (tab === 'profile' && subTab ? subTab : s.profileSubTab) as ProfileSubTab
    })),

  setGrammarInput: (grammarInput) => set({ grammarInput }),
  setWritingInput: (writingInput) => set({ writingInput }),
  setPhrasebankQuery: (phrasebankQuery) => set({ phrasebankQuery }),

  go: (target, options) => {
    const raw = String(target).toLowerCase().trim()
    const nextText = options?.text || options?.query || ''

    // 1. 来做学术板块及细分子路由
    if (raw === 'research' || raw === 'home') {
      set({ view: 'research' })
      return
    }
    if (raw === 'reader' || raw === 'bilingual') {
      set({ view: 'research', researchTab: 'reader', readerSubTab: 'bilingual' })
      return
    }
    if (raw === 'summary') {
      set({ view: 'research', researchTab: 'reader', readerSubTab: 'summary' })
      return
    }
    if (raw === 'review' || raw === 'peer_review') {
      set({ view: 'research', researchTab: 'reader', readerSubTab: 'review' })
      return
    }
    if (raw === 'citation' || raw === 'bibtex') {
      set({ view: 'research', researchTab: 'reader', readerSubTab: 'citation' })
      return
    }
    if (raw === 'writing' || raw === 'polish') {
      set({ view: 'research', researchTab: 'writing', writingSubTab: 'polish' })
      return
    }
    if (raw === 'translate' || raw === 'text_translate') {
      set({ view: 'research', researchTab: 'writing', writingSubTab: 'translate' })
      return
    }
    if (raw === 'image' || raw === 'ocr') {
      set({ view: 'research', researchTab: 'image' })
      return
    }

    // 2. 来学英语板块及细分子路由
    if (raw === 'english') {
      set({ view: 'english' })
      return
    }
    if (raw === 'vocabulary' || raw === 'wordbook') {
      set({ view: 'english', englishTab: 'vocabulary', vocabSubTab: 'wordbook' })
      return
    }
    if (raw === 'flashcard') {
      set({ view: 'english', englishTab: 'vocabulary', vocabSubTab: 'flashcard' })
      return
    }
    if (raw === 'history') {
      set({ view: 'english', englishTab: 'vocabulary', vocabSubTab: 'history' })
      return
    }
    if (raw === 'advanced' || raw === 'phrasebank') {
      set({
        view: 'english',
        englishTab: 'advanced',
        advancedSubTab: 'phrasebank',
        ...(nextText ? { phrasebankQuery: nextText } : {})
      })
      return
    }
    if (raw === 'grammar') {
      set({
        view: 'english',
        englishTab: 'advanced',
        advancedSubTab: 'grammar',
        ...(nextText ? { grammarInput: nextText } : {})
      })
      return
    }
    if (raw === 'ielts' || raw === 'toefl' || raw === 'essay') {
      set({
        view: 'english',
        englishTab: 'advanced',
        advancedSubTab: 'writing',
        ...(nextText ? { writingInput: nextText } : {})
      })
      return
    }
    if (raw === 'profile' || raw === 'goals') {
      set({ view: 'english', englishTab: 'profile', profileSubTab: 'goals' })
      return
    }
    if (raw === 'stats' || raw === 'report') {
      set({ view: 'english', englishTab: 'profile', profileSubTab: 'stats' })
      return
    }
    if (raw === 'quotes') {
      set({ view: 'english', englishTab: 'profile', profileSubTab: 'quotes' })
      return
    }

    // 3. 智能体与系统设置
    if (raw === 'agent') {
      set({ view: 'agent' })
      return
    }
    if (raw === 'settings') {
      set({ view: 'settings' })
      return
    }

    // 默认兜底
    set({ view: 'research' })
  },

  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setAssistant: (open) => set({ assistantOpen: open }),
  setPlatform: (platform, isMac) => set({ platform, isMac })
}))

