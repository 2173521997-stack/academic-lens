import { create } from 'zustand'

export type ViewName = 'home' | 'polish' | 'agent' | 'wordbook' | 'flashcard' | 'quotes' | 'stats' | 'history' | 'settings'

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

export const useAppStore = create<AppState>((set) => ({
  view: 'home',
  assistantOpen: true,
  platform: '',
  isMac: false,
  go: (view) => set({ view }),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setAssistant: (open) => set({ assistantOpen: open }),
  setPlatform: (platform, isMac) => set({ platform, isMac })
}))
