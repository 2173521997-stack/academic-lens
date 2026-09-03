import { useWordbookStore } from '../stores/wordbookStore'

/** 常见高频词（识词时跳过，避免把小词都当生词）——精简内置词表 */
const COMMON_WORDS = new Set(
  (
    'the be to of and a in that have i it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is are was been has had did '
  ).split(/\s+/)
)

export interface SegmentUnknown {
  /** 该段中的生词（去重） */
  words: { word: string; known: boolean }[]
  /** 陌生词数 */
  unknownCount: number
  /** 生词在原文本中的字符区间（用于高亮），按位置升序 */
  ranges: { start: number; end: number }[]
}

export interface DocDiffResult {
  /** 每段命中信息（按段落原始顺序） */
  segments: SegmentUnknown[]
  /** 命中率：0–100，总词中出现于生词本的占比 */
  hitRate: number
  /** 陌生词总数（唯一） */
  totalUnknown: number
  /** 全部唯一生词 */
  unknownWords: string[]
}

/**
 * 统计文档生词命中率并定位每段的生词。
 * 命中规则：单词出现在生词本（不区分大小写）即视为"已收藏/认识"；
 * 否则若为常见词也跳过；其余记为生词。
 */
export function analyzeUnknownWords(segments: { text: string }[]): DocDiffResult {
  const wb = useWordbookStore.getState().words
  const knownSet = new Set(wb.map((w) => w.word.toLowerCase()))

  const result: SegmentUnknown[] = segments.map((s) => {
    const words: { word: string; known: boolean }[] = []
    const ranges: { start: number; end: number }[] = []
    const seen = new Set<string>()
    const re = /[A-Za-z][A-Za-z'-]*/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s.text)) !== null) {
      const t = m[0].toLowerCase()
      if (t.length < 3 || COMMON_WORDS.has(t)) continue
      if (seen.has(t)) continue
      seen.add(t)
      const known = knownSet.has(t)
      words.push({ word: t, known })
      if (!known) ranges.push({ start: m.index, end: m.index + m[0].length })
    }
    return { words, unknownCount: words.filter((w) => !w.known).length, ranges }
  })

  const uniqueUnknown = new Set<string>()
  for (const seg of result) {
    for (const w of seg.words) if (!w.known) uniqueUnknown.add(w.word)
  }

  // 命中率：生词本中出现与否。全部词中"已认识"占多少
  let knownCount = 0
  let totalCount = 0
  for (const seg of result) {
    for (const w of seg.words) {
      totalCount++
      if (w.known) knownCount++
    }
  }
  const hitRate = totalCount ? Math.round((knownCount / totalCount) * 100) : 100

  return {
    segments: result,
    hitRate,
    totalUnknown: uniqueUnknown.size,
    unknownWords: [...uniqueUnknown]
  }
}