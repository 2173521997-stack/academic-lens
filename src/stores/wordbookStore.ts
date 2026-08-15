import { create } from 'zustand'

export interface WordEntry {
  id: string
  word: string
  definition: string
  context?: string
  addedAt: number
}

interface WordbookState {
  words: WordEntry[]
  search: string
  loaded: boolean
  load: () => Promise<void>
  add: (w: Omit<WordEntry, 'id' | 'addedAt'>) => void
  remove: (id: string) => void
  setSearch: (v: string) => void
}

const save = (words: WordEntry[]): void => {
  void window.bridge.storeSet('wordbook', words)
}

export const useWordbookStore = create<WordbookState>((set, get) => ({
  words: [],
  search: '',
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<WordEntry[]>('wordbook')
    if (Array.isArray(saved)) set({ words: saved })
    set({ loaded: true })
  },

  add: (w) => {
    const entry: WordEntry = {
      id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      word: w.word.trim(),
      definition: w.definition.trim(),
      context: w.context?.trim(),
      addedAt: Date.now()
    }
    if (!entry.word) return
    const exists = get().words.some((x) => x.word.toLowerCase() === entry.word.toLowerCase())
    if (exists) return
    const words = [entry, ...get().words]
    set({ words })
    save(words)
  },

  remove: (id) => {
    const words = get().words.filter((w) => w.id !== id)
    set({ words })
    save(words)
  },

  setSearch: (v) => set({ search: v })
}))
