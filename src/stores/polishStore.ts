import { create } from 'zustand'
import { polishText, type PolishResult, type PolishTone } from '../lib/polish'

interface PolishHistoryItem {
  id: string
  timestamp: number
  input: string
  tone: PolishTone
  result: PolishResult
}

interface PolishState {
  input: string
  tone: PolishTone
  result: PolishResult | null
  state: 'idle' | 'loading' | 'done' | 'error'
  error: string | null
  history: PolishHistoryItem[]

  setInput: (input: string) => void
  setTone: (tone: PolishTone) => void
  runPolish: () => Promise<void>
  clear: () => void
  loadFromHistory: (item: PolishHistoryItem) => void
}

export const usePolishStore = create<PolishState>((set, get) => ({
  input: '',
  tone: 'strict',
  result: null,
  state: 'idle',
  error: null,
  history: [],

  setInput: (input) => set({ input }),
  setTone: (tone) => set({ tone }),

  runPolish: async () => {
    const { input, tone, history } = get()
    if (!input.trim()) return

    set({ state: 'loading', error: null })
    try {
      const res = await polishText(input, tone)
      const item: PolishHistoryItem = {
        id: `polish-${Date.now()}`,
        timestamp: Date.now(),
        input,
        tone,
        result: res
      }
      set({
        result: res,
        state: 'done',
        history: [item, ...history.slice(0, 19)]
      })
    } catch (err) {
      set({
        state: 'error',
        error: err instanceof Error ? err.message : String(err)
      })
    }
  },

  clear: () => set({ input: '', result: null, state: 'idle', error: null }),

  loadFromHistory: (item) =>
    set({
      input: item.input,
      tone: item.tone,
      result: item.result,
      state: 'done',
      error: null
    })
}))
