import { create } from 'zustand'

export type ViewName = 'home' | 'wordbook' | 'settings'

interface AppState {
  view: ViewName
  assistantOpen: boolean
  sidebarOpen: boolean
  quickLookupOpen: boolean
  quickLookupWord: string
  platform: string
  isMac: boolean
  go: (view: ViewName) => void
  toggleAssistant: () => void
  setAssistant: (open: boolean) => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  openQuickLookup: (word?: string) => void
  closeQuickLookup: () => void
  setPlatform: (platform: string, isMac: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  view: 'home',
  assistantOpen: false,
  sidebarOpen: true,
  quickLookupOpen: false,
  quickLookupWord: '',
  platform: '',
  isMac: false,
  go: (view) => set({ view }),
  toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
  setAssistant: (open) => set({ assistantOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  openQuickLookup: (word = '') => set({ quickLookupOpen: true, quickLookupWord: word }),
  closeQuickLookup: () => set({ quickLookupOpen: false }),
  setPlatform: (platform, isMac) => set({ platform, isMac })
}))

