import { create } from 'zustand'

export type ViewName =
  | 'research' // 来做学术（项目制文献工作台）
  | 'english'  // 来学英语（个性化英语空间）
  | 'agent'    // 智能体（全能指挥中枢）
  | 'settings' // 系统设置
  // 兼容旧路由
  | 'home' | 'polish' | 'wordbook' | 'flashcard' | 'quotes' | 'stats' | 'history'

interface AppState {
  view: ViewName
  assistantOpen: boolean
  platform: string
  isMac: boolean
  go: (view: ViewName) => void
  toggleAssistant: () => void
  setAssistant: (open: boolean) => void
  setPlatform: (platform: string, isMac: boolean) => void
}

/** 智能重定向：将细粒度旧路由归入 3 大顶级板块 */
function normalizeView(v: ViewName): ViewName {
  if (v === 'home' || v === 'polish') return 'research'
  if (v === 'wordbook' || v === 'flashcard' || v === 'quotes' || v === 'stats' || v === 'history') return 'english'
  return v
}

export const useAppStore = create<AppState>((set) => ({
  view: 'research',
  assistantOpen: true,
  platform: '',
  isMac: false,
  go: (view) => set({ view: normalizeView(view) }),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setAssistant: (open) => set({ assistantOpen: open }),
  setPlatform: (platform, isMac) => set({ platform, isMac })
}))
