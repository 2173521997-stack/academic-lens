import { create } from 'zustand'
import type { Segment, DocInfo } from '../lib/types'
import { llmStream, llmJSON, type StreamCall, type JSONCall } from '../lib/llm'
import { getCachedTranslation, setCachedTranslation } from '../lib/translationCache'
import { useSettingsStore } from './settingsStore'
import { useHistoryStore } from './historyStore'
import { buildTranslateSys, buildBatchSys, buildTableSys } from '../lib/prompt'

export type ReadingMode = 'en' | 'bilingual' | 'cn' | 'summary'
export type DocMode = ReadingMode

const CONCURRENCY = 4
const BATCH_SIZE = 10
const LONG_SEG_LIMIT = 400

const SYS_SUMMARY = `你是一个学术助手。请阅读以下文档并输出：
1. 核心主题与摘要（3 句话以内）
2. 5 个核心学术关键词
3. 3-5 条关键要点
用中文清晰回答，保持学术严谨。`

interface FileState {
  doc: DocInfo | null
  segments: Segment[]
  mode: ReadingMode
  summary: string
  summaryState: 'idle' | 'streaming' | 'done' | 'error'
  progress: { done: 0; total: 0 } | { done: number; total: number }
  error: string | null
  /** AI 回答中的段落引用跳转请求（para 为 1 起始段落序号） */
  locateRequest: { para: number; nonce: number } | null

  setDoc: (doc: DocInfo, segments: Segment[]) => void
  clearDoc: () => void
  setMode: (mode: ReadingMode) => void
  translateAll: () => void
  stopTranslate: () => void
  translateOne: (segId: string) => void
  summarize: () => void
  stopSummarize: () => void
  clearSummary: () => void
  locateParagraph: (para: number) => void
  clearLocate: () => void
}

function buildParagraphTranslatePrompt(segments: Segment[]): string {
  return segments.map((s) => s.text).join('\n\n')
}

function sysFor(seg: Segment): string {
  return seg.type === 'table' ? buildTableSys() : buildTranslateSys()
}

function parseBatchJson(raw: string): Record<string, string> {
  const map: Record<string, string> = {}
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string') map[k] = v.trim()
      }
    }
  } catch {
    /* 解析失败返回空对象走回退 */
  }
  return map
}

export const useFileStore = create<FileState>((set, get) => {
  let translateActive = false
  const activeStreams = new Map<string, StreamCall>()
  let batchCall: JSONCall | null = null
  let summaryCall: StreamCall | null = null
  let failed = 0

  const cancelAllRequests = (): void => {
    activeStreams.forEach((c) => c.cancel())
    activeStreams.clear()
    batchCall?.cancel()
    batchCall = null
    summaryCall?.cancel()
    summaryCall = null
  }

  const patchSeg = (id: string, patch: Partial<Segment>): void => {
    set({
      segments: get().segments.map((s) => (s.id === id ? { ...s, ...patch } : s))
    })
  }

  const bumpProgress = (total: number): void => {
    const done = get().segments.filter((s) => s.translation || s.error).length
    set({ progress: { done, total } })
  }

  const fileContext = (): string => {
    return get()
      .segments.map((s) => s.text)
      .join('\n\n')
      .slice(0, 15000)
  }

  const runPump = (list: Segment[], model: string): Promise<void> =>
    new Promise((done) => {
      let idx = 0
      let running = 0

      const next = (): void => {
        if (!translateActive) {
          if (running === 0) done()
          return
        }
        while (running < CONCURRENCY && idx < list.length) {
          const seg = list[idx++]
          running++
          patchSeg(seg.id, { translating: true, error: undefined })

          let acc = ''
          const call = llmStream(
            [
              { role: 'system', content: sysFor(seg) },
              { role: 'user', content: buildParagraphTranslatePrompt([seg]) }
            ],
            {
              onChunk: (d) => {
                acc += d
                patchSeg(seg.id, { translation: acc })
              },
              onDone: () => {
                if (acc) void setCachedTranslation(seg.text, model, acc)
                activeStreams.delete(seg.id)
                patchSeg(seg.id, { translating: false })
                running--
                bumpProgress(get().progress.total)
                next()
              },
              onError: (m) => {
                activeStreams.delete(seg.id)
                failed++
                patchSeg(seg.id, { translating: false, error: m })
                running--
                bumpProgress(get().progress.total)
                next()
              }
            },
            { maxTokens: 4096, temperature: 0.3 }
          )
          activeStreams.set(seg.id, call)
        }
        if (running === 0 && idx >= list.length) done()
      }

      next()
    })

  const runBatches = async (list: Segment[], model: string): Promise<void> => {
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      if (!translateActive) return
      const batch = list.slice(i, i + BATCH_SIZE)
      for (const s of batch) patchSeg(s.id, { translating: true, error: undefined })

      const prompt = batch.map((s, j) => `[${j + 1}] ${s.text}`).join('\n\n')
      const call = llmJSON(
        [
          { role: 'system', content: buildBatchSys() },
          { role: 'user', content: prompt }
        ],
        { maxTokens: 8192, temperature: 0.3 }
      )
      batchCall = call
      try {
        const raw = await call.promise
        const map = parseBatchJson(raw)
        const missing: Segment[] = []
        batch.forEach((s, j) => {
          const zh = map[String(j + 1)]
          if (zh) {
            patchSeg(s.id, { translating: false, translation: zh })
            void setCachedTranslation(s.text, model, zh)
            bumpProgress(get().progress.total)
          } else {
            missing.push(s)
          }
        })
        if (missing.length) {
          for (const s of missing) {
            patchSeg(s.id, { translating: false, error: undefined, translation: '' })
          }
          if (translateActive) await runPump(missing, model)
        }
      } catch {
        for (const s of batch) {
          patchSeg(s.id, { translating: false, error: undefined, translation: '' })
        }
        if (translateActive) await runPump(batch, model)
      } finally {
        if (batchCall === call) batchCall = null
      }
    }
  }

  const runTranslate = async (segs: Segment[]): Promise<void> => {
    const model = useSettingsStore.getState().settings.model
    const total = segs.length

    for (const seg of segs) {
      if (!translateActive) return
      if (seg.translation) {
        bumpProgress(total)
        continue
      }
      const cached = await getCachedTranslation(seg.text, model)
      if (cached) {
        patchSeg(seg.id, { translation: cached, translating: false })
        bumpProgress(total)
      }
    }

    if (!translateActive) return
    const pending = get()
      .segments.filter((s) => !s.translation && !s.translating)
      .filter((s) => segs.some((x) => x.id === s.id))
    const tableList = pending.filter((s) => s.type === 'table')
    const nonTable = pending.filter((s) => s.type !== 'table')
    const shortList = nonTable.filter((s) => s.text.length <= LONG_SEG_LIMIT)
    const longList = nonTable.filter((s) => s.text.length > LONG_SEG_LIMIT)

    await runBatches(shortList, model)
    if (!translateActive) return
    await runPump([...tableList, ...longList], model)

    const { segments } = get()
    const doneCount = segments.filter((s) => s.translation || s.error).length
    if (failed > 0) {
      set({ error: `${failed} 段翻译失败（请检查 API Key 与网络后重试）` })
    } else if (doneCount === segments.length) {
      set({ error: null })
      const name = get().doc?.name ?? ''
      useHistoryStore.getState().add('translate', name, `完成 ${doneCount} 段翻译`)
    }
  }

  return {
    doc: null,
    segments: [],
    mode: 'cn',
    summary: '',
    summaryState: 'idle',
    progress: { done: 0, total: 0 },
    error: null,
    locateRequest: null,

    setDoc: (doc, segments) => {
      translateActive = false
      cancelAllRequests()
      failed = 0
      set({
        doc,
        segments,
        mode: 'cn',
        summary: '',
        summaryState: 'idle',
        progress: { done: 0, total: 0 },
        error: null,
        locateRequest: null
      })
      useHistoryStore.getState().add('file', doc.name, `${segments.length} 段 · ${(doc.size / 1024).toFixed(1)} KB`)
    },

    clearDoc: () => {
      translateActive = false
      cancelAllRequests()
      failed = 0
      set({ doc: null, segments: [], summary: '', summaryState: 'idle', progress: { done: 0, total: 0 }, error: null, locateRequest: null })
    },

    setMode: (mode) => set({ mode }),

    translateAll: () => {
      const segs = get().segments.filter((s) => !s.translation && !s.translating)
      if (!segs.length) return
      set({ progress: { done: 0, total: segs.length }, error: null })
      translateActive = true
      failed = 0
      void runTranslate(segs)
    },

    stopTranslate: () => {
      translateActive = false
      cancelAllRequests()
      set({
        segments: get().segments.map((s) => ({ ...s, translating: false })),
        progress: { done: 0, total: 0 }
      })
    },

    translateOne: (segId) => {
      const seg = get().segments.find((s) => s.id === segId)
      if (!seg || seg.translating) return
      const model = useSettingsStore.getState().settings.model
      patchSeg(segId, { translating: true, error: undefined, translation: '' })
      void (async () => {
        const cached = await getCachedTranslation(seg.text, model)
        if (cached) {
          patchSeg(segId, { translating: false, translation: cached })
          return
        }
        const fresh = get().segments.find((s) => s.id === segId)
        if (!fresh) return
        let acc = ''
        const call = llmStream(
          [
            { role: 'system', content: sysFor(fresh) },
            { role: 'user', content: buildParagraphTranslatePrompt([fresh]) }
          ],
          {
            onChunk: (d) => {
              acc += d
              patchSeg(segId, { translation: acc })
            },
            onDone: () => {
              if (acc) void setCachedTranslation(fresh.text, model, acc)
              activeStreams.delete(segId)
              patchSeg(segId, { translating: false })
            },
            onError: (m) => {
              activeStreams.delete(segId)
              patchSeg(segId, { translating: false, error: m })
            }
          },
          { maxTokens: 4096, temperature: 0.3 }
        )
        activeStreams.set(segId, call)
      })()
    },

    summarize: () => {
      const text = fileContext()
      if (!text) return
      set({ summaryState: 'streaming', summary: '', error: null })
      summaryCall = llmStream(
        [
          { role: 'system', content: SYS_SUMMARY },
          { role: 'user', content: `请分析以下文档：\n\n${text}` }
        ],
        {
          onChunk: (d) => set({ summary: get().summary + d }),
          onDone: () => {
            summaryCall = null
            set({ summaryState: 'done' })
            useHistoryStore.getState().add('summary', get().doc?.name ?? '', '摘要已生成')
          },
          onError: (m) => {
            summaryCall = null
            set({ summaryState: 'error', error: m })
          }
        }
      )
    },

    stopSummarize: () => {
      summaryCall?.cancel()
      summaryCall = null
      set({ summaryState: 'idle', summary: '' })
    },

    clearSummary: () => set({ summary: '', summaryState: 'idle' }),

    locateParagraph: (para) => {
      const total = get().segments.length
      if (!total || para < 1 || para > total) return
      set({ mode: 'cn', locateRequest: { para, nonce: Date.now() } })
    },

    clearLocate: () => set({ locateRequest: null })
  }
})

export function getFileContextForChat(): string {
  return useFileStore
    .getState()
    .segments.map((s, i) => `【P${i + 1}】${s.text}`)
    .join('\n\n')
    .slice(0, 15000)
}
