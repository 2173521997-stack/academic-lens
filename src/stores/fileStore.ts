import { create } from 'zustand'
import type { DocInfo, Segment } from '../lib/types'
import { llmStream } from '../lib/llm'
import { newId } from '../lib/parse'
import { useHistoryStore } from './historyStore'

export type DocMode = 'translate' | 'summary' | 'qa'

interface FileState {
  doc: DocInfo | null
  segments: Segment[]
  mode: DocMode
  summary: string
  summaryState: 'idle' | 'streaming' | 'done' | 'error'
  progress: { done: number; total: number }
  error: string | null

  setDoc: (doc: DocInfo, segments: Segment[]) => void
  clearDoc: () => void
  setMode: (mode: DocMode) => void

  translateAll: () => void
  stopTranslate: () => void
  translateOne: (segId: string) => void

  summarize: () => void
  stopSummarize: () => void

  clearSummary: () => void
}

const SYS_TRANSLATE =
  '你是专业学术翻译。将用户提供的英文内容翻译为简体中文，保持学术语气、术语准确、长难句拆分通顺。只输出译文，不要任何解释或前缀。'

const SYS_SUMMARY =
  '你是学术论文分析助手。基于用户提供的论文内容，用 Markdown 输出以下四部分：\n' +
  '## 摘要\n3–5 句概括核心贡献。\n## 大纲\n用列表梳理论文结构。\n## 核心术语表\n用 Markdown 表格列出关键术语及其中文释义（英文术语 | 中文 | 说明）。\n## 重点难点句\n列出 2–3 个结构复杂的重点句，附中文翻译与简要语法讲解。\n只输出 Markdown 正文，不要多余说明。'

function fileContext(): string {
  const { segments } = useFileStore.getState()
  if (!segments.length) return ''
  const parts = segments.map((s, i) => `[${i + 1}](${s.type === 'h' ? '标题' : '段落'}): ${s.text}`)
  let joined = parts.join('\n')
  if (joined.length > 6000) {
    joined = joined.slice(0, 6000) + '\n……（内容过长已截断）'
  }
  return `以下是当前正在阅读的文档内容（每段带编号）：\n${joined}\n`
}

export const useFileStore = create<FileState>((set, get) => {
  let translateActive = false

  const buildParagraphTranslatePrompt = (segs: Segment[]): string =>
    segs
      .map((s, i) => `[段落 ${i + 1}]${s.type === 'h' ? '（标题）' : ''}:\n${s.text}`)
      .join('\n\n')

  const patchSeg = (segId: string, patch: Partial<Segment>): void =>
    set({
      segments: get().segments.map((s) => (s.id === segId ? { ...s, ...patch } : s))
    })

  const runTranslate = async (segs: Segment[], startAt: number): Promise<void> => {
    const CONCURRENCY = 3
    let cursor = startAt
    let running = 0
    let failed = 0
    const total = segs.length

    const worker = (): Promise<void> =>
      new Promise((resolve) => {
        if (!translateActive) return resolve()
        const seg = segs[cursor]
        cursor++
        if (!seg) return resolve()

        patchSeg(seg.id, { translating: true, error: undefined })
        llmStream(
          [
            { role: 'system', content: SYS_TRANSLATE },
            { role: 'user', content: buildParagraphTranslatePrompt([seg]) }
          ],
          {
            onChunk: (d) => {
              const cur = get().segments.find((s) => s.id === seg.id)
              if (!cur) return
              patchSeg(seg.id, { translation: cur.translation + d })
            },
            onDone: () => {
              patchSeg(seg.id, { translating: false })
              set({ progress: { done: get().progress.done + 1, total } })
              void resolve()
            },
            onError: (m) => {
              failed++
              patchSeg(seg.id, { translating: false, error: m })
              set({ progress: { done: get().progress.done + 1, total } })
              void resolve()
            }
          }
        )
      })

    const pump = async (): Promise<void> => {
      if (!translateActive) return
      while (cursor < total && running < CONCURRENCY) {
        running++
        void worker().then(() => {
          running--
          if (translateActive) void pump()
        })
      }
    }

    await pump()
    if (!translateActive) return
    const { segments } = get()
    const doneCount = segments.filter((s) => s.translation || s.error).length
    if (failed > 0) {
      set({ error: `${failed} 段翻译失败（请检查 API Key 与网络后重试）` })
    } else if (doneCount === segments.length) {
      set({ error: null })
      useHistoryStore.getState().add('translate', get().doc?.name ?? '', `完成 ${doneCount} 段翻译`)
    }
  }

  return {
    doc: null,
    segments: [],
    mode: 'translate',
    summary: '',
    summaryState: 'idle',
    progress: { done: 0, total: 0 },
    error: null,

    setDoc: (doc, segments) => {
      translateActive = false
      set({
        doc,
        segments,
        mode: 'translate',
        summary: '',
        summaryState: 'idle',
        progress: { done: 0, total: 0 },
        error: null
      })
      useHistoryStore.getState().add('file', doc.name, `${segments.length} 段 · ${(doc.size / 1024).toFixed(1)} KB`)
    },

    clearDoc: () => {
      translateActive = false
      set({ doc: null, segments: [], summary: '', summaryState: 'idle', progress: { done: 0, total: 0 }, error: null })
    },

    setMode: (mode) => set({ mode }),

    translateAll: () => {
      const segs = get().segments.filter((s) => !s.translation && !s.translating)
      if (!segs.length) return
      set({ progress: { done: 0, total: segs.length }, error: null })
      translateActive = true
      void runTranslate(segs, 0)
    },

    stopTranslate: () => {
      translateActive = false
      set({
        segments: get().segments.map((s) => ({ ...s, translating: false })),
        progress: { done: 0, total: 0 }
      })
    },

    translateOne: (segId) => {
      const seg = get().segments.find((s) => s.id === segId)
      if (!seg || seg.translating) return
      patchSeg(segId, { translating: true, error: undefined, translation: '' })
      llmStream(
        [
          { role: 'system', content: SYS_TRANSLATE },
          { role: 'user', content: buildParagraphTranslatePrompt([seg]) }
        ],
        {
          onChunk: (d) => {
            const cur = get().segments.find((s) => s.id === segId)
            if (!cur) return
            patchSeg(segId, { translation: cur.translation + d })
          },
          onDone: () => patchSeg(segId, { translating: false }),
          onError: (m) => patchSeg(segId, { translating: false, error: m })
        }
      )
    },

    summarize: () => {
      const text = fileContext()
      if (!text) return
      set({ summaryState: 'streaming', summary: '', error: null })
      const summaryId = newId()
      llmStream(
        [
          { role: 'system', content: SYS_SUMMARY },
          { role: 'user', content: `请分析以下文档：\n\n${text}` }
        ],
        {
          onChunk: (d) => set({ summary: get().summary + d }),
          onDone: () => {
            set({ summaryState: 'done' })
            useHistoryStore.getState().add('summary', get().doc?.name ?? '', '摘要已生成')
          },
          onError: (m) => set({ summaryState: 'error', error: m })
        }
      )
      void summaryId
    },

    stopSummarize: () => set({ summaryState: 'idle', summary: '' }),

    clearSummary: () => set({ summary: '', summaryState: 'idle' })
  }
})

export function getFileContextForChat(): string {
  return fileContext()
}
