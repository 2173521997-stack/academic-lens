import { create } from 'zustand'
import { useWordbookStore, type WordEntry } from './wordbookStore'
import { useFileStore } from './fileStore'
import { analyzeUnknownWords } from '../lib/unknownWords'
import { useReviewLogStore } from './reviewLogStore'
import { isDue } from '../lib/srs'
import {
  cardsFromWordbook,
  aiGenerateCards,
  aiGenerateExercises,
  aiGradeSentence,
  normalizeAnswer,
  type Flashcard,
  type Exercise,
  type SentenceGrade
} from '../lib/flashcard'

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 按单词（小写）去重，保留首个出现 */
function dedup<T extends { word: string }>(arr: T[]): T[] {
  const seen = new Set<string>()
  return arr.filter((w) => {
    const k = w.word.toLowerCase()
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * 从生词本挑选复习池：优先「到期 + 新词」，用「学习早期」词兜底，
 * 尽量避免反复抽到已掌握(mature)的词，从而减少同一单词被重复计数/复习。
 */
function pickReviewPool(wb: WordEntry[], count: number): WordEntry[] {
  if (count <= 0) return []
  const now = Date.now()
  const due = wb.filter((w) => w.srs && w.srs.reps > 0 && isDue(w.srs, now))
  const fresh = wb.filter((w) => !w.srs || w.srs.reps === 0)
  const learning = wb.filter(
    (w) => w.srs && w.srs.reps > 0 && !isDue(w.srs, now) && (w.srs.interval ?? 0) <= 1
  )
  // mature：已较久未到期，降级为最后再补（避免重复回潮）
  const mature = wb.filter((w) => w.srs && w.srs.reps > 0 && !isDue(w.srs, now) && (w.srs.interval ?? 0) > 1)
  const picked = dedup([...shuffle(due), ...shuffle(fresh), ...shuffle(learning), ...shuffle(mature)]).slice(0, count)
  return picked
}

/** 复习结果统一落库：调度 + 学习记录 */
function recordReview(word: string, kind: 'card' | 'exercise' | 'sentence', correct: boolean, score?: number): void {
  useWordbookStore.getState().reviewWord(word, correct)
  useReviewLogStore.getState().add({ word, kind, correct, score })
}

/** 把 AI 词卡上的分级回写生词本（仅对已收藏词），避免重复分级 */
function persistLevels(deck: Flashcard[]): void {
  const st = useWordbookStore.getState()
  for (const c of deck) {
    if (!c.level) continue
    const entry = st.words.find((w) => w.word.toLowerCase() === c.word.toLowerCase())
    if (entry && !entry.level) st.update(entry.id, { level: c.level })
  }
}

interface FlashcardState {
  deck: Flashcard[]
  index: number
  flipped: boolean
  known: number
  unknown: number
  loading: boolean
  error: string | null
  /** 本轮卡组来源（生词本 / 到期队列 / 自选 / 当前文档未收藏词） */
  source: 'wordbook' | 'due' | 'custom' | 'doc'
  // 练习
  exercises: Exercise[]
  exIndex: number
  exAnswered: boolean
  exCorrect: boolean
  exInput: string
  exScore: number
  exDone: boolean
  exGrading: boolean
  exGrade: SentenceGrade | null

  drawFromWordbook: (count: number, aiEnhance: boolean) => Promise<void>
  drawDue: (count: number, aiEnhance: boolean) => Promise<void>
  drawFromWords: (words: string[], count: number, aiEnhance: boolean) => Promise<void>
  /** 从当前文档「未收藏生词」抽卡 */
  drawFromDoc: (count: number, aiEnhance: boolean) => Promise<void>
  flip: () => void
  mark: (known: boolean) => void
  genExercises: (count: number) => Promise<void>
  setExInput: (v: string) => void
  submitExercise: (value: string) => void
  gradeSentence: () => Promise<void>
  nextExercise: () => void
  clearExercises: () => void
  reset: () => void
  /** 设置抽卡来源（供文档页「去闪卡背」等外部入口指定） */
  setSource: (s: 'wordbook' | 'due' | 'custom' | 'doc') => void
}

export const useFlashcardStore = create<FlashcardState>((set, get) => ({
  deck: [],
  index: 0,
  flipped: false,
  known: 0,
  unknown: 0,
  loading: false,
  error: null,
  source: 'wordbook',

  exercises: [],
  exIndex: 0,
  exAnswered: false,
  exCorrect: false,
  exInput: '',
  exScore: 0,
  exDone: false,
  exGrading: false,
  exGrade: null,

  drawFromWordbook: async (count, aiEnhance) => {
    const wb = useWordbookStore.getState().words
    const picked = pickReviewPool(wb, count)
    if (!picked.length) {
      set({ error: '生词本是空的，先去收藏一些单词吧' })
      return
    }
    set({ loading: true, error: null })
    try {
      const deck = aiEnhance
        ? await aiGenerateCards(picked.map((w) => w.word))
        : cardsFromWordbook(picked)
      if (aiEnhance) persistLevels(deck)
      set({ deck, index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'wordbook' })
    } catch (err) {
      // AI 失败回退到离线卡组
      set({ deck: cardsFromWordbook(picked), index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'wordbook', error: `AI 生成失败（${err instanceof Error ? err.message : err}），已回退为基础词卡` })
    }
  },

  drawDue: async (count, aiEnhance) => {
    const wb = useWordbookStore.getState().words
    // 到期优先（越早到期越先复习），不足补新词
    const now = Date.now()
    const due = wb
      .filter((w) => w.srs && w.srs.reps > 0 && isDue(w.srs, now))
      .sort((a, b) => (a.srs?.due ?? 0) - (b.srs?.due ?? 0))
    const fresh = shuffle(wb.filter((w) => !w.srs || w.srs.reps === 0))
    const picked = dedup([...due, ...fresh]).slice(0, count)
    if (!picked.length) {
      set({ error: '当前没有到期单词，休息一下吧' })
      return
    }
    set({ loading: true, error: null })
    try {
      const deck = aiEnhance
        ? await aiGenerateCards(picked.map((w) => w.word))
        : cardsFromWordbook(picked)
      if (aiEnhance) persistLevels(deck)
      set({ deck, index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'due' })
    } catch (err) {
      set({ deck: cardsFromWordbook(picked), index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'due', error: `AI 生成失败（${err instanceof Error ? err.message : err}），已回退为基础词卡` })
    }
  },

  drawFromWords: async (words, count, aiEnhance) => {
    const list = [...new Set(words.map((w) => w.trim()).filter(Boolean))].slice(0, count)
    if (!list.length) {
      set({ error: '请输入要学习的单词' })
      return
    }
    set({ loading: true, error: null })
    try {
      const deck = aiEnhance
        ? await aiGenerateCards(list)
        : list.map((w) => ({ id: `fc_${w}_${Math.random().toString(36).slice(2, 7)}`, word: w, definition: '-' }))
      set({ deck, index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'custom' })
    } catch (err) {
      set({ error: `AI 生成失败：${err instanceof Error ? err.message : err}` })
      set({ loading: false })
    }
  },

  drawFromDoc: async (count, aiEnhance) => {
    const segments = useFileStore.getState().segments
    if (!segments.length) {
      set({ error: '请先在「翻译」中打开一篇文档，再来抽取本篇生词' })
      return
    }
    const words = analyzeUnknownWords(segments).unknownWords.slice(0, count)
    if (!words.length) {
      set({ error: '当前文档没有生词（都已收藏或都是常见词）' })
      return
    }
    set({ loading: true, error: null })
    try {
      const deck = aiEnhance
        ? await aiGenerateCards(words)
        : words.map((w) => ({ id: `fc_${w}_${Math.random().toString(36).slice(2, 7)}`, word: w, definition: '-' }))
      if (aiEnhance) persistLevels(deck)
      set({ deck, index: 0, flipped: false, known: 0, unknown: 0, loading: false, source: 'doc' })
    } catch (err) {
      set({ error: `AI 生成失败（${err instanceof Error ? err.message : err}），已回退为基础词卡`, loading: false })
      set({
        deck: words.map((w) => ({ id: `fc_${w}_${Math.random().toString(36).slice(2, 7)}`, word: w, definition: '-' })),
        index: 0, flipped: false, known: 0, unknown: 0, source: 'doc'
      })
    }
  },

  flip: () => set((s) => ({ flipped: !s.flipped })),

  mark: (known) => {
    const s = get()
    const card = s.deck[s.index]
    if (card) recordReview(card.word, 'card', known)
    if (s.index >= s.deck.length - 1) {
      set({ known: s.known + (known ? 1 : 0), unknown: s.unknown + (known ? 0 : 1), index: 0, flipped: false })
    } else {
      set({
        known: s.known + (known ? 1 : 0),
        unknown: s.unknown + (known ? 0 : 1),
        index: s.index + 1,
        flipped: false
      })
    }
  },

  genExercises: async (count) => {
    const s = get()
    if (!s.deck.length) {
      set({ error: '请先生成/抽取一组闪卡' })
      return
    }
    set({ loading: true, error: null })
    try {
      const exercises = await aiGenerateExercises(s.deck, Math.min(count, s.deck.length))
      set({ exercises, exIndex: 0, exAnswered: false, exCorrect: false, exInput: '', exScore: 0, exDone: false, exGrade: null, loading: false })
    } catch (err) {
      set({ error: `练习生成失败：${err instanceof Error ? err.message : err}`, loading: false })
    }
  },

  setExInput: (v) => set({ exInput: v }),

  submitExercise: (value) => {
    const s = get()
    const ex = s.exercises[s.exIndex]
    if (!ex) return
    let correct = false
    if (ex.type === 'choice') {
      correct = value === ex.answer
    } else {
      correct = normalizeAnswer(value) === normalizeAnswer(ex.answer)
    }
    recordReview(ex.word, 'exercise', correct)
    const last = s.exIndex >= s.exercises.length - 1
    set({
      exAnswered: true,
      exCorrect: correct,
      exScore: s.exScore + (correct ? 1 : 0),
      exDone: last
    })
  },

  gradeSentence: async () => {
    const s = get()
    const ex = s.exercises[s.exIndex]
    if (!ex || ex.type !== 'sentence' || s.exGrading) return
    const sentence = s.exInput.trim()
    if (!sentence) return
    set({ exGrading: true, error: null })
    try {
      const grade = await aiGradeSentence(ex.word, sentence)
      const correct = grade.score >= 60
      recordReview(ex.word, 'sentence', correct, grade.score)
      const last = s.exIndex >= s.exercises.length - 1
      set({
        exGrading: false,
        exAnswered: true,
        exCorrect: correct,
        exGrade: grade,
        exScore: s.exScore + (correct ? 1 : 0),
        exDone: last
      })
    } catch (err) {
      set({ exGrading: false, error: `批改失败：${err instanceof Error ? err.message : err}` })
    }
  },

  nextExercise: () => {
    const s = get()
    if (s.exIndex >= s.exercises.length - 1) {
      set({ exDone: true })
      return
    }
    set({ exIndex: s.exIndex + 1, exAnswered: false, exCorrect: false, exInput: '', exGrade: null })
  },

  clearExercises: () => set({ exercises: [], exDone: false, exScore: 0, exIndex: 0, exAnswered: false, exGrade: null }),

  reset: () =>
    set({
      deck: [], index: 0, flipped: false, known: 0, unknown: 0, error: null, source: 'wordbook',
      exercises: [], exDone: false, exScore: 0, exIndex: 0, exAnswered: false, exGrade: null
    }),

  setSource: (source) => set({ source })
}))
