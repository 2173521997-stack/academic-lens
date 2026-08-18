import { create } from 'zustand'
import { useWordbookStore, type WordEntry } from './wordbookStore'
import { useReviewLogStore } from './reviewLogStore'
import { masteryLevel } from '../lib/srs'
import { llmStream, type StreamCall } from '../lib/llm'
import { appendAiMark } from '../lib/trust'

/** 周报的状态 */
type ReportState = 'idle' | 'loading' | 'done' | 'error'

/** 聚合后的周报数据 */
export interface WeeklyStats {
  totalWords: number
  newWords7d: number
  masteredWords: number
  reviews7d: number
  accuracy7d: number
  hasDue: number
  weakRoots: { label: string; count: number }[]
  errorProne: { word: string; lapses: number }[]
  words: WordEntry[]
}

interface ReportStoreState {
  state: ReportState
  report: string
  error: string | null
  generate: () => void
  stop: () => void
}

function collectWeeklyStats(): WeeklyStats {
  const wb = useWordbookStore.getState().words
  const records = useReviewLogStore.getState().records

  const now = Date.now()
  const weekAgo = now - 7 * 86400000

  const newWords7d = wb.filter((w) => w.addedAt >= weekAgo).length
  const masteredWords = wb.filter((w) => masteryLevel(w.srs) === 'mature').length
  const hasDue = wb.filter((w) => (w.srs?.due ?? 0) <= now && (w.srs?.reps ?? 0) > 0).length

  const weekRecords = records.filter((r) => r.at >= weekAgo)
  const correct7d = weekRecords.filter((r) => r.correct).length

  // 薄弱主题 Top3：优先用标签（用户自定主题），无标签词按词根推测
  const themeMap = new Map<string, { count: number; lapses: number }>()
  for (const w of wb) {
    const themes = w.tags.length ? w.tags : inferTheme(w.word)
    for (const t of themes) {
      const cur = themeMap.get(t) ?? { count: 0, lapses: 0 }
      cur.count++
      cur.lapses += w.srs?.lapses ?? 0
      themeMap.set(t, cur)
    }
  }
  const weakRoots = [...themeMap.entries()]
    .map(([label, v]) => ({ label, count: v.count, lapses: v.lapses }))
    .sort((a, b) => b.lapses - a.lapses || b.count - a.count)
    .slice(0, 3)
    .map(({ label, count }) => ({ label, count }))

  const errorProne = wb
    .filter((w) => (w.srs?.lapses ?? 0) > 0)
    .sort((a, b) => (b.srs?.lapses ?? 0) - (a.srs?.lapses ?? 0))
    .slice(0, 5)
    .map((w) => ({ word: w.word, lapses: w.srs?.lapses ?? 0 }))

  return {
    totalWords: wb.length,
    newWords7d,
    masteredWords,
    reviews7d: weekRecords.length,
    accuracy7d: weekRecords.length ? Math.round((correct7d / weekRecords.length) * 100) : 0,
    hasDue,
    weakRoots,
    errorProne,
    words: wb
  }
}

/** 无标签时粗粒度推测主题：去常见后缀后的词根作为"词族"主题 */
function inferTheme(word: string): string[] {
  const w = word.toLowerCase()
  const suffixes = ['ation', 'ition', 'ment', 'ness', 'able', 'ible', 'ous', 'ive', 'al', 'ly', 'ing', 'ed', 's']
  let s = w
  for (const suf of suffixes) {
    if (s.length - suf.length >= 4 && s.endsWith(suf)) {
      s = s.slice(0, -suf.length)
      break
    }
  }
  return s.length >= 4 ? [`${s}…词族`] : []
}

const SYS_REPORT =
  '你是英语学习数据教练（Academic Lens 学情周报生成器）。基于用户的英语学习数据生成周报，简体中文、Markdown。' +
  '要求：一屏内可读完、不要堆砌指标，用如下结构（无数据段落可省略）：\n' +
  '## 本周概览\n1–2 句话点出本周态度与成绩（复习量、正确率、新增词数、掌握词数、今日到期数）。\n' +
  '## 薄弱主题\n针对聚合出的高频/易错主题给 1–2 条具体改进建议。\n' +
  '## 易错词提醒\n列 2–3 个遗忘最多的词，说明易混淆点并给记忆技巧。\n' +
  '## 下周建议\n2–3 条可执行建议。只输出正文。'

export const useReportStore = create<ReportStoreState>((set, get) => {
  let call: StreamCall | null = null

  const generate = (): void => {
    if (get().state === 'loading') return
    const stats = collectWeeklyStats()
    if (!stats.words.length) {
      set({ state: 'error', error: '还没有学习数据，先去收藏和复习几个单词吧', report: '' })
      return
    }
    const dateRange = `${daysAgo(6)} ～ ${todayStr()}`
    const user =
      `以下是过去 7 天（${dateRange}）的学习数据：\n` +
      `- 生词总量：${stats.totalWords}，本周新增 ${stats.newWords7d}，已掌握 ${stats.masteredWords}\n` +
      `- 本周复习 ${stats.reviews7d} 次，正确率 ${stats.accuracy7d}%，今日到期未复习 ${stats.hasDue} 词\n` +
      `- 薄弱主题：${stats.weakRoots.length ? stats.weakRoots.map((r) => `${r.label}（${r.count} 词）`).join('、') : '暂无'}\n` +
      `- 易错词：${stats.errorProne.length ? stats.errorProne.map((e) => `${e.word}（遗忘${e.lapses}次）`).join('、') : '暂无'}\n` +
      '请据此生成周报。'

    set({ state: 'loading', report: '', error: null })
    let acc = ''
    call = llmStream(
      [
        { role: 'system', content: SYS_REPORT },
        { role: 'user', content: user }
      ],
      {
        onChunk: (d) => {
          acc += d
          set({ report: acc })
        },
        onDone: () => set({ state: 'done', report: appendAiMark(acc, 'AI 生成学情周报') }),
        onError: (m) => set({ state: 'error', error: m, report: acc })
      },
      { temperature: 0.4, maxTokens: 1300 }
    )
  }

  return {
    state: 'idle',
    report: '',
    error: null,
    generate,
    stop: () => {
      call?.cancel()
      call = null
      set({ state: 'idle', report: '', error: null })
    }
  }
})

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86400000)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
function todayStr(): string {
  const d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()}`
}