import { create } from 'zustand'

export type HistoryType = 'file' | 'translate' | 'summary' | 'chat' | 'word'

export interface HistoryEntry {
  id: string
  time: number
  type: HistoryType
  title: string
  detail?: string
}

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  add: (type: HistoryType, title: string, detail?: string) => void
  clear: () => void
}

const save = (entries: HistoryEntry[]): void => {
  void window.bridge.storeSet('history', entries.slice(0, 300))
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<HistoryEntry[]>('history')
    if (Array.isArray(saved)) set({ entries: saved })
    set({ loaded: true })
  },

  add: (type, title, detail) => {
    const entry: HistoryEntry = {
      id: `h_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      time: Date.now(),
      type,
      title,
      detail
    }
    const entries = [entry, ...get().entries]
    set({ entries })
    save(entries)
  },

  clear: () => {
    set({ entries: [] })
    save([])
  }
}))
