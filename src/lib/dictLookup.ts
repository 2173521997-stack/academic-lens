import type { WordEntry } from './wordCard'

/**
 * uapis.cn 词典查询 + 发音 客户端。
 * 文档：https://uapis.cn/docs/api-reference/get-dictionary-lookup
 *
 * 作用：为「查询词」提供真实、免 LLM 的 Grounding 数据源。
 * 仅当用户配置了词典 API key 且查询方式为 dict 时启用。
 */

const DICT_BASE = 'https://uapis.cn/api/dictionary/lookup'
const PRON_BASE = 'https://uapis.cn/api/dictionary/pronunciation'

export interface DictPronunciation {
  /** 英式或美式音标 */
  text: string
  /** 发音音频 URL */
  audio?: string
}

/** 归一化后的词条（供 UI 与 wordCard 复用） */
export interface DictLookupResult {
  /** 兼容 WordEntry 的基础信息 */
  entry: WordEntry
  /** 英英释义（每条含英文解释与例句） */
  en: string[]
  /** 词形变化（复数/过去式/比较级等） */
  forms: string[]
  /** 常用词组 */
  phrases: string[]
  /** 英式/美式发音与音频 */
  audio: { uk?: DictPronunciation; us?: DictPronunciation }
  /** 是否来自 uapis（来源标识） */
  source: 'uapis'
  /** 未收录 / 拼写错误标记 */
  notFound?: boolean
}

/**
 * 查词。返回 null 表示服务不可用/网络失败（调用方回退 LLM）；
 * notFound=true 表示"明确未收录或拼写错误"（调用方据此拒答，不让 LLM 硬编）。
 */
export async function dictLookup(
  word: string,
  apiKey: string,
  timeout = 8000
): Promise<DictLookupResult | null> {
  const w = word.trim()
  if (!w) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeout)
  try {
    const res = await fetch(
      `${DICT_BASE}?word=${encodeURIComponent(w)}&engine=local`,
      { signal: ctrl.signal, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }
    )
    if (res.status === 404) {
      return { entry: emptyEntry(w), en: [], forms: [], phrases: [], audio: {}, source: 'uapis', notFound: true }
    }
    if (!res.ok) return null // 400/502 等 → 回退 LLM
    const data = (await res.json().catch(() => null)) as RawDict | null
    if (!data) return null
    return normalizeDict(data, w)
  } catch {
    return null // 网络失败/超时 → 回退
  } finally {
    clearTimeout(timer)
  }
}

/** 发音查询：按词返回英/美音标与音频（备用，若主查词已带音频则不调用） */
export async function dictPronunciation(word: string, apiKey: string): Promise<DictPronunciation | null> {
  const w = word.trim()
  if (!w) return null
  try {
    const res = await fetch(`${PRON_BASE}?word=${encodeURIComponent(w)}&engine=local`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as RawPron | null
    return normalizePron(data)
  } catch {
    return null
  }
}

function emptyEntry(word: string): WordEntry {
  return { word, phonetic: '', pos: '', def: '', exs: [] }
}

/* ---------------- 响应归一化（防御多种字段形状） ---------------- */

interface RawDict {
  phonetics?: unknown
  definitions?: unknown
  english_definitions?: unknown
  word_forms?: unknown
  phrases?: unknown
  synonyms?: unknown
  examples?: unknown
  word?: string
}

interface RawPron {
  uk?: { text?: string; audio?: string }
  us?: { text?: string; audio?: string }
  [k: string]: unknown
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}
function asStrArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string' && v) return [v]
  return []
}

/** 从 `definitions`（按词性归类的字段）提取词性与中文释义 */
function extractDefs(defs: unknown): { pos: string; def: string; exs: { en: string; zh: string }[] } {
  let pos = ''
  let defsText = ''
  const exs: { en: string; zh: string }[] = []
  if (Array.isArray(defs)) {
    for (const item of defs) {
      if (typeof item !== 'object' || item === null) continue
      const o = item as Record<string, unknown>
      if (o.pos) pos = asStr(o.pos)
      const zh = asStrArr(o.zh ?? o.translation ?? o.def ?? o.meaning)
      if (zh.length) defsText += (defsText ? '；' : '') + zh.join('；')
    }
  } else if (defs && typeof defs === 'object') {
    // 形如 { "n": [...], "v": [...] }
    const o = defs as Record<string, unknown>
    for (const [p, meanings] of Object.entries(o)) {
      const list = asStrArr(meanings)
      if (!list.length) continue
      if (!pos) pos = p
      defsText += (defsText ? '；' : '') + list.join('；')
    }
  }
  return { pos, def: defsText, exs }
}

/** 从 `phonetics` 提取英/美音标与音频 */
function extractPhonetics(ph: unknown): { uk?: DictPronunciation; us?: DictPronunciation; phonetic: string } {
  let uk: DictPronunciation | undefined
  let us: DictPronunciation | undefined
  if (ph && typeof ph === 'object') {
    const o = ph as Record<string, unknown>
    const norm = (v: unknown): DictPronunciation | undefined => {
      if (typeof v === 'string') return v ? { text: v } : undefined
      if (v && typeof v === 'object') {
        const item = v as Record<string, unknown>
        const text = asStr(item.text ?? item.phonetic ?? item.pronunciation)
        const audio = asStr(item.audio ?? item.mp3 ?? item.link)
        return text || audio ? { text, audio: audio || undefined } : undefined
      }
      return undefined
    }
    uk = norm(o.uk ?? o['en-UK'] ?? o.en)
    us = norm(o.us ?? o['en-US'] ?? o.en)
    // 数组形态：uk/us 分开
    if (!uk && !us && Array.isArray(ph)) {
      for (const item of ph) {
        if (typeof item !== 'object' || item === null) continue
        const io = item as Record<string, unknown>
        const region = asStr(io.region ?? io.type ?? '').toLowerCase()
        const d: DictPronunciation = { text: asStr(io.text ?? io.phonetic) }
        const audio = asStr(io.audio ?? io.mp3)
        if (audio) d.audio = audio
        if (region.includes('uk') || region.includes('英')) uk = d
        else if (region.includes('us') || region.includes('美')) us = d
        else if (!uk) uk = d
      }
    }
  }
  return { uk, us, phonetic: (uk?.text ?? us?.text ?? '').trim() }
}

function extractExamples(ex: unknown): { en: string; zh: string }[] {
  const out: { en: string; zh: string }[] = []
  if (Array.isArray(ex)) {
    for (const item of ex) {
      if (typeof item === 'string') {
        out.push({ en: item, zh: '' })
      } else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>
        const en = asStr(o.en ?? o.english ?? o.sentence)
        const zh = asStr(o.zh ?? o.chinese ?? o.translation)
        if (en) out.push({ en, zh })
      }
    }
  } else if (typeof ex === 'string' && ex) {
    out.push({ en: ex, zh: '' })
  }
  return out.slice(0, 3)
}

function normalizeDict(data: RawDict, word: string): DictLookupResult {
  const ph = extractPhonetics(data.phonetics)
  const dd = extractDefs(data.definitions)
  const exs = extractExamples(data.examples)
  const en = asStrArr(data.english_definitions)
  const forms = asStrArr(data.word_forms)
  const phrases = asStrArr(data.phrases)

  const entry: WordEntry = {
    word: asStr(data.word) || word,
    phonetic: ph.phonetic,
    pos: dd.pos,
    def: dd.def || en.join('；'),
    exs: exs.length ? exs : dd.exs
  }
  // 至少要能展示；若完全无释义则视为未收录
  if (!entry.def && !en.length) {
    return { entry, en, forms, phrases, audio: { uk: ph.uk, us: ph.us }, source: 'uapis', notFound: true }
  }
  return { entry, en, forms, phrases, audio: { uk: ph.uk, us: ph.us }, source: 'uapis' }
}

function normalizePron(data: RawPron | null): DictPronunciation | null {
  if (!data) return null
  const text = asStr(data.uk?.text ?? data.us?.text)
  const audio = asStr(data.uk?.audio ?? data.us?.audio)
  if (!text && !audio) return null
  return { text, audio: audio || undefined }
}