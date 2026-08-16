import { create } from 'zustand'
import type { DocInfo, Segment } from '../lib/types'
import { llmStream, llmJSON, type StreamCall } from '../lib/llm'
import { getCachedTranslation, setCachedTranslation } from '../lib/translationCache'
import { useSettingsStore } from './settingsStore'
import { useHistoryStore } from './historyStore'

/** 文档视图模式：中文译文（逐段对照）/ 总结 */
export type DocMode = 'cn' | 'summary'

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

const SYS_BATCH =
  '你是专业学术翻译。将用户提供的英文段落批量翻译为简体中文，保持学术语气、术语准确、长难句拆分通顺。' +
  '输入以 [1] [2] … 编号，你只输出一个 JSON 对象：键为编号字符串（如 "1"、"2"），值为对应译文。' +
  '不要输出任何其他内容，不要用 Markdown 代码块包裹。'

const SYS_SUMMARY =
  '你是学术论文分析助手。基于用户提供的论文内容，用 Markdown 输出以下四部分：\n' +
  '## 摘要\n3–5 句概括核心贡献。\n## 大纲\n用列表梳理论文结构。\n## 核心术语表\n用 Markdown 表格列出关键术语及其中文释义（英文术语 | 中文 | 说明）。\n## 重点难点句\n列出 2–3 个结构复杂的重点句，附中文翻译与简要语法讲解。\n只输出 Markdown 正文，不要多余说明。'

const BATCH_SIZE = 8
const LONG_SEG_LIMIT = 600
const CONCURRENCY = 3

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

/** 解析批量翻译返回的 JSON（容忍代码块包裹 / 前后杂质） */
function parseBatchJson(raw: string): Record<string, string> {
  const m = raw.trim().match(/\{[\s\S]*\}/)
  if (!m) return {}
  try {
    const obj = JSON.parse(m[0]) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v.trim()) out[String(k).trim()] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

export const useFileStore = create<FileState>((set, get) => {
  let translateActive = false
  const activeStreams = new Map<string, StreamCall>()
  let batchCall: { cancel: () => void } | null = null
  let summaryCall: StreamCall | null = null
  let failed = 0

  const cancelAllRequests = (): void => {
    if (batchCall) {
      batchCall.cancel()
      batchCall = null
    }
    for (const call of activeStreams.values()) call.cancel()
    activeStreams.clear()
  }

  const buildParagraphTranslatePrompt = (segs: Segment[]): string =>
    segs
      .map((s, i) => `[段落 ${i + 1}]${s.type === 'h' ? '（标题）' : ''}:\n${s.text}`)
      .join('\n\n')

  /** 只重建变更段的原子更新（旧实现每次全量 map + find 双遍历） */
  const patchSeg = (segId: string, patch: Partial<Segment>): void =>
    set((st) => ({
      segments: st.segments.map((s) => (s.id === segId ? { ...s, ...patch } : s))
    }))

  const bumpProgress = (total: number): void =>
    set({ progress: { done: get().progress.done + 1, total } })

  /** 单段流式翻译（长段 / 批量回退 / 单段重试共用） */
  const streamOne = (seg: Segment, model: string): Promise<void> =>
    new Promise((resolve) => {
      if (!translateActive) return resolve()
      patchSeg(seg.id, { translating: true, error: undefined })
      let acc = seg.translation || ''
      const call = llmStream(
        [
          { role: 'system', content: SYS_TRANSLATE },
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
            bumpProgress(get().progress.total)
            void resolve()
          },
          onError: (m) => {
            failed++
            activeStreams.delete(seg.id)
            patchSeg(seg.id, { translating: false, error: m })
            bumpProgress(get().progress.total)
            void resolve()
          }
        },
        { maxTokens: 4096, temperature: 0.3 }
      )
      activeStreams.set(seg.id, call)
    })

  /** 固定并发 3 的流式队列 */
  const runPump = (list: Segment[], model: string): Promise<void> =>
    new Promise((resolve) => {
      if (!translateActive || !list.length) return resolve()
      let cursor = 0
      let running = 0
      let resolved = false
      const done = (): void => {
        if (!resolved && running === 0 && (cursor >= list.length || !translateActive)) {
          resolved = true
          resolve()
        }
      }
      const worker = (): void => {
        if (!translateActive) return
        const seg = list[cursor]
        cursor++
        if (!seg) return
        running++
        void streamOne(seg, model).then(() => {
          running--
          if (translateActive && cursor < list.length) worker()
          done()
        })
      }
      while (running < CONCURRENCY && cursor < list.length) worker()
      done()
    })

  /** 批处理：短段 8 个一组走 JSON 非流式，省 8 倍请求数 */
  const runBatches = async (list: Segment[], model: string): Promise<void> => {
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      if (!translateActive) return
      const batch = list.slice(i, i + BATCH_SIZE)
      for (const s of batch) patchSeg(s.id, { translating: true, error: undefined })

      const prompt = batch.map((s, j) => `[${j + 1}] ${s.text}`).join('\n\n')
      const call = llmJSON(
        [
          { role: 'system', content: SYS_BATCH },
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
          // 缺段回退：重置后走单段流式
          for (const s of missing) {
            patchSeg(s.id, { translating: false, error: undefined, translation: '' })
          }
          if (translateActive) await runPump(missing, model)
        }
      } catch {
        // 批量失败（如服务端不支持 JSON 模式）：整体回退单段流式
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

    // 阶段 1：缓存命中直出（同会话重翻 / 重开文档秒出）
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
    // 注意：patchSeg 产生的是新对象引用，待译列表必须从最新 state 过滤，
    // 否则缓存命中的段（旧引用上 translation 仍为空）会被再次请求
    const pending = get()
      .segments.filter((s) => !s.translation && !s.translating)
      .filter((s) => segs.some((x) => x.id === s.id))
    const shortList = pending.filter((s) => s.text.length <= LONG_SEG_LIMIT)
    const longList = pending.filter((s) => s.text.length > LONG_SEG_LIMIT)

    await runBatches(shortList, model)
    if (!translateActive) return
    await runPump(longList, model)

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
    mode: 'cn',
    summary: '',
    summaryState: 'idle',
    progress: { done: 0, total: 0 },
    error: null,

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
        error: null
      })
      useHistoryStore.getState().add('file', doc.name, `${segments.length} 段 · ${(doc.size / 1024).toFixed(1)} KB`)
    },

    clearDoc: () => {
      translateActive = false
      cancelAllRequests()
      failed = 0
      set({ doc: null, segments: [], summary: '', summaryState: 'idle', progress: { done: 0, total: 0 }, error: null })
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
            { role: 'system', content: SYS_TRANSLATE },
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

    clearSummary: () => set({ summary: '', summaryState: 'idle' })
  }
})

export function getFileContextForChat(): string {
  return fileContext()
}
