import { create } from 'zustand'

export type ReviewKind = 'card' | 'exercise' | 'sentence'

export interface ReviewRecord {
  id: string
  word: string
  kind: ReviewKind
  correct: boolean
  /** 造句批改得分（0–100），仅 kind=sentence */
  score?: number
  at: number
}

const MAX_RECORDS = 3000

interface ReviewLogState {
  records: ReviewRecord[]
  loaded: boolean
  load: () => Promise<void>
  add: (r: Omit<ReviewRecord, 'id' | 'at'>) => void
  clear: () => void
}

const save = (records: ReviewRecord[]): void => {
  void window.bridge.storeSet('reviewLog', records)
}

export const useReviewLogStore = create<ReviewLogState>((set, get) => ({
  records: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<ReviewRecord[]>('reviewLog')
    if (Array.isArray(saved)) set({ records: saved })
    set({ loaded: true })
  },

  add: (r) => {
    const entry: ReviewRecord = {
      id: `r_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      word: r.word.trim(),
      kind: r.kind,
      correct: r.correct,
      score: r.score,
      at: Date.now()
    }
    if (!entry.word) return
    const records = [entry, ...get().records].slice(0, MAX_RECORDS)
    set({ records })
    save(records)
  },

  clear: () => {
    set({ records: [] })
    save([])
  }
}))

/** 最近 n 天每天的复习量与正确率（含今天，返回长度 n） */
export function dailyStats(records: ReviewRecord[], days: number): { day: string; count: number; correct: number }[] {
  const out: { day: string; count: number; correct: number }[] = []
  const now = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)
    const start = d.getTime()
    const end = start + 86400000
    const dayRecords = records.filter((r) => r.at >= start && r.at < end)
    out.push({
      day: `${d.getMonth() + 1}/${d.getDate()}`,
      count: dayRecords.length,
      correct: dayRecords.filter((r) => r.correct).length
    })
  }
  return out
}
