import { create } from 'zustand'
import type { Quote } from '../lib/quotes'

export interface CustomQuote extends Quote {}

interface QuoteState {
  customs: CustomQuote[]
  loaded: boolean
  load: () => Promise<void>
  add: (q: Omit<Quote, 'id'>) => void
  remove: (id: string) => void
}

const save = (customs: CustomQuote[]): void => {
  void window.bridge.storeSet('quotes', customs)
}

export const useQuoteStore = create<QuoteState>((set, get) => ({
  customs: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<CustomQuote[]>('quotes')
    if (Array.isArray(saved)) set({ customs: saved })
    set({ loaded: true })
  },

  add: (q) => {
    const entry: CustomQuote = {
      id: `qu_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      text: q.text.trim(),
      zh: q.zh.trim(),
      source: q.source.trim(),
      link: q.link?.trim() || undefined,
      tags: q.tags
    }
    if (!entry.text) return
    const customs = [entry, ...get().customs]
    set({ customs })
    save(customs)
  },

  remove: (id) => {
    const customs = get().customs.filter((q) => q.id !== id)
    set({ customs })
    save(customs)
  }
}))
