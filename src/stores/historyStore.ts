import { create } from 'zustand'

export type HistoryType = 'file' | 'translate' | 'summary' | 'chat' | 'word'

export interface HistoryEntry {
  id: string
  time: number
  type: HistoryType
  title: string
  detail?: string
  /** 正文内容承载（目前用于摘要全文），便于还原与智能体检索 */
  payload?: string
}

/** 文档翻译结果快照：原文 + 译文全文，独立于 history 列表、限定保留最近 N 篇 */
export interface DocResult {
  name: string
  time: number
  source: string
  translation: string
  segCount: number
}

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  add: (type: HistoryType, title: string, detail?: string, payload?: string) => void
  /** 保存一篇文档的翻译结果（原文+译文），保留最近 N 篇，超限清最旧 */
  saveDocResult: (name: string, source: string, translation: string, segCount: number) => void
  /** 按关键词检索历史里的摘要与文档译文，返回智能体可读的文本片段 */
  searchRecords: (keyword: string) => Promise<string>
  clear: () => void
}

const HISTORY_MAX = 300
const DOC_RESULT_MAX = 8

const saveEntries = (entries: HistoryEntry[]): void => {
  void window.bridge.storeSet('history', entries.slice(0, HISTORY_MAX))
}
const saveDocResults = (list: DocResult[]): void => {
  void window.bridge.storeSet('docResults', list.slice(0, DOC_RESULT_MAX))
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return
    const saved = await window.bridge.storeGet<HistoryEntry[]>('history')
    if (Array.isArray(saved)) set({ entries: saved })
    set({ loaded: true })
  },

  add: (type, title, detail, payload) => {
    const entry: HistoryEntry = {
      id: `h_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      time: Date.now(),
      type,
      title,
      detail,
      payload
    }
    const entries = [entry, ...get().entries]
    set({ entries })
    saveEntries(entries)
  },

  saveDocResult: (name, source, translation, segCount) => {
    void window.bridge.storeGet<DocResult[]>('docResults').then((list) => {
      const docResults = Array.isArray(list) ? list : []
      const entry: DocResult = { name, time: Date.now(), source, translation, segCount }
      // 同名文档覆盖旧的，其余按时间新→旧排序
      const next = [entry, ...docResults.filter((d) => d.name !== name)].slice(0, DOC_RESULT_MAX)
      saveDocResults(next)
    })
  },

  searchRecords: async (keyword) => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return '请在历史检索中提供关键词。'
    const parts: string[] = []
    // 摘要与记录：从历史 entries 中匹配标题、详情与 payload 全文
    for (const e of get().entries) {
      const matchTitle = e.title.toLowerCase().includes(kw)
      const matchDetail = e.detail ? e.detail.toLowerCase().includes(kw) : false
      const matchPayload = e.payload ? e.payload.toLowerCase().includes(kw) : false
      if (matchTitle || matchDetail || matchPayload) {
        const snippet = e.payload ? e.payload.slice(0, 400) : e.detail ?? ''
        parts.push(`【${e.type === 'summary' ? '摘要' : '历史'}·${e.title}】\n${snippet}`)
      }
    }
    // 文档译文快照：全文匹配文档名、原文或译文
    const docResults = await window.bridge.storeGet<DocResult[]>('docResults')
    if (Array.isArray(docResults)) {
      for (const d of docResults) {
        const matchName = d.name.toLowerCase().includes(kw)
        const matchSrc = d.source ? d.source.toLowerCase().includes(kw) : false
        const matchTrans = d.translation ? d.translation.toLowerCase().includes(kw) : false
        if (matchName || matchSrc || matchTrans) {
          // 提取匹配的上下文片段
          let snippet = ''
          const srcIdx = d.source.toLowerCase().indexOf(kw)
          if (srcIdx >= 0) {
            snippet = `...${d.source.slice(Math.max(0, srcIdx - 50), srcIdx + 150)}...`
          } else {
            snippet = d.source.slice(0, 180)
          }
          parts.push(
            `【文献·${d.name}】共 ${d.segCount} 段。\n匹配片段：${snippet}\n译文概况：${d.translation.slice(0, 200)}`
          )
        }
      }
    }
    return parts.length
      ? `在历史文献库中找到 ${parts.length} 条与「${keyword}」相关的记录：\n\n` + parts.join('\n\n')
      : `历史文献库中没有找到与「${keyword}」相关的文档、摘要或译文。`
  },

  clear: () => {
    set({ entries: [] })
    saveEntries([])
    void window.bridge.storeSet('docResults', [])
  }
}))