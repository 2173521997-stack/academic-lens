import { create } from 'zustand'
import { reviewSRS, isDue, type SRSState } from '../lib/srs'

export interface WordEntry {
  id: string
  word: string
  definition: string
  context?: string
  addedAt: number
  /** 词性（n. / v. / adj. 等），供「普通整理-词性」分组 */
  pos?: string
  /** 用户自定义标签，供筛选与整理 */
  tags: string[]
  /** 分级档位（CEFR / 四六级 / 雅思托福 / 专四专八），键见 lib/levels */
  level?: string
  /** 间隔重复调度状态（SM-2） */
  srs?: SRSState
}

/** 新增/编辑生词入参（tags 可选，入库时归一为数组） */
export interface WordInput {
  word: string
  definition: string
  context?: string
  pos?: string
  tags?: string[]
  level?: string
}

interface WordbookState {
  words: WordEntry[]
  search: string
  loaded: boolean
  load: () => Promise<void>
  add: (w: WordInput) => void
  /** 批量添加（去重），返回实际新增条数；一次性持久化避免多次写盘 */
  addMany: (items: WordInput[]) => number
  remove: (id: string) => void
  update: (id: string, patch: Partial<Pick<WordEntry, 'definition' | 'context' | 'pos' | 'tags' | 'level'>>) => void
  /** 复习某词（按词匹配，不区分大小写），更新 SM-2 调度 */
  reviewWord: (word: string, known: boolean) => void
  /** 今日到期（含新词）数量 */
  dueCount: () => number
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
    if (Array.isArray(saved)) {
      // 兼容旧数据：补全 tags 字段
      set({ words: saved.map((e) => ({ ...e, tags: Array.isArray(e.tags) ? e.tags : [] })) })
    }
    set({ loaded: true })
  },

  add: (w) => {
    const entry: WordEntry = {
      id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      word: w.word.trim(),
      definition: w.definition.trim(),
      context: w.context?.trim(),
      pos: w.pos?.trim() || undefined,
      tags: (w.tags ?? []).map((t) => t.trim()).filter(Boolean),
      level: w.level?.trim() || undefined,
      addedAt: Date.now()
    }
    if (!entry.word) return
    const exists = get().words.some((x) => x.word.toLowerCase() === entry.word.toLowerCase())
    if (exists) return
    const words = [entry, ...get().words]
    set({ words })
    save(words)
  },

  addMany: (items) => {
    const existing = new Set(get().words.map((w) => w.word.toLowerCase()))
    const fresh: WordEntry[] = []
    for (const w of items) {
      const word = w.word.trim()
      if (!word || existing.has(word.toLowerCase())) continue
      existing.add(word.toLowerCase())
      fresh.push({
        id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        word,
        definition: w.definition.trim(),
        context: w.context?.trim(),
        pos: w.pos?.trim() || undefined,
        tags: (w.tags ?? []).map((t) => t.trim()).filter(Boolean),
        level: w.level?.trim() || undefined,
        addedAt: Date.now()
      })
    }
    if (!fresh.length) return 0
    const words = [...fresh, ...get().words]
    set({ words })
    save(words)
    return fresh.length
  },

  remove: (id) => {
    const words = get().words.filter((w) => w.id !== id)
    set({ words })
    save(words)
  },

  update: (id, patch) => {
    const words = get().words.map((w) =>
      w.id === id
        ? {
            ...w,
            ...patch,
            pos: patch.pos?.trim() || undefined,
            level: patch.level?.trim() || undefined,
            tags: patch.tags ? [...new Set(patch.tags.map((t) => t.trim()).filter(Boolean))] : w.tags
          }
        : w
    )
    set({ words })
    save(words)
  },

  reviewWord: (word, known) => {
    const target = word.trim().toLowerCase()
    if (!target) return
    const words = get().words.map((w) =>
      w.word.toLowerCase() === target ? { ...w, srs: reviewSRS(w.srs, known) } : w
    )
    set({ words })
    save(words)
  },

  dueCount: () => get().words.filter((w) => isDue(w.srs)).length,

  setSearch: (v) => set({ search: v })
}))
