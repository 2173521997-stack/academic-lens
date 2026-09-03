import type { DictLookupResult } from './dictLookup'

export interface WordEntry {
  word: string
  phonetic: string
  pos: string
  field?: string
  def: string
  exs: { en: string; zh: string }[]
  synonyms?: string[]
  antonyms?: string[]
  suggestion?: string
  /** 发音音频 URL（uapis 词典提供） */
  audio?: string
  /** 数据来源标识：uapis / llm */
  source?: 'uapis' | 'llm'
}

const KEYS = [
  'word',
  'phonetic',
  'pos',
  'field',
  'def',
  'ex1',
  'ex2',
  'syn',
  'ant',
  'suggestion',
  'audio',
  'source'
] as const

/** 解析词卡输出（word|音标 等 key|value 行格式） */
export function parseWordCard(raw: string): WordEntry | null {
  const entry: WordEntry = {
    word: '',
    phonetic: '',
    pos: '',
    def: '',
    exs: [],
    synonyms: [],
    antonyms: []
  }
  for (const line of raw.split('\n')) {
    const m = line.match(/^(word|phonetic|pos|field|def|ex1|ex2|syn|ant|suggestion|audio|source)\|(.*)$/)
    if (!m) continue
    const key = m[1] as (typeof KEYS)[number]
    const val = m[2].trim()
    if (key === 'ex1' || key === 'ex2') {
      const parts = val.split('|').map((s) => s.trim())
      const en = parts[0] ?? ''
      if (en) entry.exs.push({ en, zh: parts[1] ?? '' })
    } else if (key === 'syn') {
      entry.synonyms = val
        .split(/[;,/、，]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === 'ant') {
      entry.antonyms = val
        .split(/[;,/、，]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (key === 'suggestion') {
      entry.suggestion = val || undefined
    } else if (key === 'audio') {
      entry.audio = val || undefined
    } else if (key === 'source') {
      entry.source = val === 'uapis' ? 'uapis' : 'llm'
    } else if (key === 'word' || key === 'phonetic' || key === 'pos' || key === 'def' || key === 'field') {
      entry[key] = val
    }
  }
  if (!entry.word && !entry.def) return null
  return entry
}

/** 把 uapis 词典结果格式化为与 LLM 词卡同构的 key|value 文本（Grounding 层输出） */
export function formatUapisCard(r: DictLookupResult): string {
  const e = r.entry
  const lines: string[] = [
    `word|${e.word}`,
    `phonetic|${e.phonetic}`,
    `pos|${e.pos}`,
    `def|${e.def}`,
    `source|${r.source}`
  ]
  const audio = r.audio.uk?.audio ?? r.audio.us?.audio
  if (audio) lines.push(`audio|${audio}`)
  if (e.synonyms?.length) lines.push(`syn|${e.synonyms.join('; ')}`)
  if (e.antonyms?.length) lines.push(`ant|${e.antonyms.join('; ')}`)
  for (const ex of e.exs.slice(0, 2)) {
    lines.push(`ex1|${ex.en}|${ex.zh}`)
  }
  return lines.join('\n')
}
