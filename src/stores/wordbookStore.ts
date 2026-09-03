import { create } from 'zustand'
import { lookupWordDetails } from '../lib/quickTranslate'

export interface WordEntry {
  id: string
  word: string
  phonetic?: string
  pos?: string
  definition: string
  context?: string
  synonyms?: string[]
  antonyms?: string[]
  tags?: string[]
  level?: string
  addedAt: number
}

export interface WordInput {
  word: string
  phonetic?: string
  pos?: string
  definition?: string
  context?: string
  synonyms?: string[]
  antonyms?: string[]
  tags?: string[]
  level?: string
}

interface WordbookState {
  words: WordEntry[]
  discardedWords: string[]
  search: string
  isLookingUp: boolean
  loaded: boolean
  load: () => Promise<void>
  add: (w: WordInput) => void
  addWithAutoLookup: (rawWord: string) => Promise<{ success: boolean; error?: string }>
  importExamWord: (w: { word: string; phonetic?: string; pos?: string; def: string; exEn?: string; exZh?: string; synonyms?: string[]; antonyms?: string[]; examTagLabel?: string }) => void
  hasWord: (word: string) => boolean
  isDiscarded: (word: string) => boolean
  discardWord: (word: string) => void
  restoreWord: (word: string) => void
  remove: (id: string) => void
  update: (id: string, patch: Partial<WordEntry>) => void
  setSearch: (v: string) => void
}

const saveWords = (words: WordEntry[]): void => {
  void window.bridge.storeSet('wordbook', words)
}

const saveDiscarded = (discarded: string[]): void => {
  void window.bridge.storeSet('discarded_words', discarded)
}

/**
 * 彻底清洗并严格拆分同义词/反义词为独立单词列表。
 * 兼容中英文分号；中文逗号，英文逗号, 顿号、 斜杠/ 竖线| 换行
 等各种分隔符。
 */
export function cleanTermList(list?: unknown): string[] {
  if (!list) return []
  const arr = Array.isArray(list) ? list : typeof list === 'string' ? [list] : []
  return arr
    .flatMap((item) => {
      if (typeof item !== 'string') return []
      return item.split(/[;；,，/、\n\t|·•]+/g)
    })
    .map((s) =>
      s
        .replace(/^[\(\[{"'“‘\s\d\.\、\-—–]+|[\)\]}"'”’,;；\.\s\-—–]+$/g, '')
        .trim()
    )
    .filter((s) => s.length > 0 && s !== '-' && s !== '无' && s !== 'null' && s !== 'undefined')
}

export const useWordbookStore = create<WordbookState>((set, get) => ({
  words: [],
  discardedWords: [],
  search: '',
  isLookingUp: false,
  loaded: false,

  load: async () => {
    if (get().loaded) return

    // 1. 加载已丢弃/已学会单词列表
    const savedDiscarded = await window.bridge.storeGet<string[]>('discarded_words')
    const discardedSet = new Set<string>()
    if (Array.isArray(savedDiscarded)) {
      for (const dw of savedDiscarded) {
        if (typeof dw === 'string' && dw.trim()) {
          discardedSet.add(dw.trim().toLowerCase())
        }
      }
    }
    const discardedList = Array.from(discardedSet)

    // 2. 加载生词本
    const saved = await window.bridge.storeGet<WordEntry[]>('wordbook')
    if (Array.isArray(saved)) {
      const seen = new Set<string>()
      const uniqueList: WordEntry[] = []
      for (const e of saved) {
        const k = (e.word || '').trim().toLowerCase()
        // 若已在丢弃列表或重复，则过滤
        if (!k || seen.has(k) || discardedSet.has(k)) continue
        seen.add(k)
        uniqueList.push({
          ...e,
          word: e.word.trim(),
          tags: Array.isArray(e.tags) ? e.tags : [],
          synonyms: cleanTermList(e.synonyms),
          antonyms: cleanTermList(e.antonyms)
        })
      }
      set({ words: uniqueList, discardedWords: discardedList })
      saveWords(uniqueList)
      saveDiscarded(discardedList)
    } else {
      set({ discardedWords: discardedList })
    }

    set({ loaded: true })
  },

  hasWord: (rawWord) => {
    const w = rawWord.trim().toLowerCase()
    return get().words.some((x) => x.word.trim().toLowerCase() === w)
  },

  isDiscarded: (rawWord) => {
    const w = rawWord.trim().toLowerCase()
    return get().discardedWords.includes(w)
  },

  discardWord: (rawWord) => {
    const w = rawWord.trim().toLowerCase()
    if (!w) return
    const currentDiscarded = get().discardedWords
    const nextDiscarded = currentDiscarded.includes(w) ? currentDiscarded : [...currentDiscarded, w]

    // 从当前生词本中移除（如果在生词本中）
    const nextWords = get().words.filter((x) => x.word.trim().toLowerCase() !== w)

    set({ words: nextWords, discardedWords: nextDiscarded })
    saveWords(nextWords)
    saveDiscarded(nextDiscarded)
  },

  restoreWord: (rawWord) => {
    const w = rawWord.trim().toLowerCase()
    if (!w) return
    const nextDiscarded = get().discardedWords.filter((x) => x !== w)
    set({ discardedWords: nextDiscarded })
    saveDiscarded(nextDiscarded)
  },

  add: (w) => {
    const word = w.word.trim()
    if (!word) return
    const lower = word.toLowerCase()
    const exists = get().words.some((x) => x.word.toLowerCase() === lower)
    if (exists) return

    // 如果之前被丢弃过，重新添加时从丢弃列表中解除
    if (get().discardedWords.includes(lower)) {
      get().restoreWord(lower)
    }

    const entry: WordEntry = {
      id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      word,
      phonetic: w.phonetic?.trim() || undefined,
      pos: w.pos?.trim() || undefined,
      definition: (w.definition ?? '').trim() || '（已收藏）',
      context: w.context?.trim() || undefined,
      synonyms: cleanTermList(w.synonyms),
      antonyms: cleanTermList(w.antonyms),
      tags: (w.tags ?? []).map((t) => t.trim()).filter(Boolean),
      level: w.level?.trim() || undefined,
      addedAt: Date.now()
    }
    const words = [entry, ...get().words]
    set({ words })
    saveWords(words)
  },

  importExamWord: (item) => {
    const word = item.word.trim()
    if (!word) return
    const lower = word.toLowerCase()
    const exists = get().words.some((x) => x.word.toLowerCase() === lower)
    if (exists) return

    if (get().discardedWords.includes(lower)) {
      get().restoreWord(lower)
    }

    const entry: WordEntry = {
      id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      word,
      phonetic: item.phonetic?.trim() || undefined,
      pos: item.pos?.trim() || undefined,
      definition: item.def.trim() || '（已收藏）',
      context: item.exEn ? `${item.exEn}（${item.exZh || ''}）` : undefined,
      synonyms: cleanTermList(item.synonyms),
      antonyms: cleanTermList(item.antonyms),
      tags: item.examTagLabel ? [item.examTagLabel] : [],
      addedAt: Date.now()
    }
    const words = [entry, ...get().words]
    set({ words })
    saveWords(words)
  },

  addWithAutoLookup: async (rawWord: string) => {
    const word = rawWord.trim()
    if (!word) return { success: false, error: '单词不能为空' }
    const lower = word.toLowerCase()
    const exists = get().words.some((x) => x.word.toLowerCase() === lower)
    if (exists) return { success: false, error: '该单词已在生词本中' }

    set({ isLookingUp: true })
    try {
      const details = await lookupWordDetails(word)
      const finalWord = details?.word || word
      const finalLower = finalWord.toLowerCase()
      const finalExists = get().words.some((x) => x.word.trim().toLowerCase() === finalLower)
      if (finalExists) {
        set({ isLookingUp: false })
        return { success: false, error: '该单词已在生词本中' }
      }

      if (get().discardedWords.includes(finalLower)) {
        get().restoreWord(finalLower)
      }

      const entry: WordEntry = {
        id: `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        word: finalWord,
        phonetic: details?.phonetic || undefined,
        pos: details?.pos || undefined,
        definition: details?.def || '（暂无释义）',
        context: details?.exs?.[0] ? `${details.exs[0].en}（${details.exs[0].zh}）` : undefined,
        synonyms: cleanTermList(details?.synonyms),
        antonyms: cleanTermList(details?.antonyms),
        tags: [],
        addedAt: Date.now()
      }
      const words = [entry, ...get().words]
      set({ words, isLookingUp: false })
      saveWords(words)
      return { success: true }
    } catch (err) {
      set({ isLookingUp: false })
      return { success: false, error: err instanceof Error ? err.message : '查词失败' }
    }
  },

  remove: (id) => {
    const words = get().words.filter((w) => w.id !== id && w.word.toLowerCase() !== id.toLowerCase())
    set({ words })
    saveWords(words)
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
    saveWords(words)
  },

  setSearch: (v) => set({ search: v })
}))
