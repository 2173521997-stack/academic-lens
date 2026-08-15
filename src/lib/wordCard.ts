export interface WordEntry {
  word: string
  phonetic: string
  pos: string
  def: string
  exs: { en: string; zh: string }[]
}

/** 解析词卡 LLM 输出（word|音标 等 key|value 行格式） */
export function parseWordCard(raw: string): WordEntry | null {
  const entry: WordEntry = { word: '', phonetic: '', pos: '', def: '', exs: [] }
  for (const line of raw.split('\n')) {
    const m = line.match(/^(word|phonetic|pos|def|ex1|ex2)\|(.*)$/)
    if (!m) continue
    const key = m[1]
    const val = m[2].trim()
    if (key === 'ex1' || key === 'ex2') {
      const parts = val.split('|').map((s) => s.trim())
      const en = parts[0] ?? ''
      if (en) entry.exs.push({ en, zh: parts[1] ?? '' })
    } else if (key === 'word' || key === 'phonetic' || key === 'pos' || key === 'def') {
      entry[key] = val
    }
  }
  if (!entry.word && !entry.def) return null
  return entry
}
