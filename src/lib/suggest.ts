import { useWordbookStore } from '../stores/wordbookStore'
import { loadRecents } from './quickTranslate'

let raw: string | null = null
let loading: Promise<string> | null = null
let boost: Set<string> | null = null
// 稀疏行号索引：每 256 行记录偏移，二分定位时减少扫描
let lineIndex: Uint32Array | null = null

/** 词表（public/words.txt，dev 与 file:// 下均用相对路径可 fetch） */
const WORDS_URL = 'words.txt'
const BOOST_URL = 'boost.txt'

const LINE_STEP = 256

async function loadBoost(): Promise<Set<string>> {
  if (boost) return boost
  try {
    const res = await fetch(BOOST_URL)
    boost = new Set((await res.text()).split('\n').map((w) => w.trim()).filter(Boolean))
  } catch {
    boost = new Set()
  }
  return boost
}

async function loadRaw(): Promise<string> {
  if (raw !== null) return raw
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch(WORDS_URL)
      const text = await res.text()
      raw = text
      // 构建行号索引：每 LINE_STEP 行记录一个字节偏移
      const count = Math.ceil(text.length / LINE_STEP) + 1
      const idx = new Uint32Array(count)
      let line = 0
      idx[0] = 0
      for (let i = 0; i < text.length; i++) {
        if (text.charCodeAt(i) === 10) {
          line++
          if (line % LINE_STEP === 0) idx[line / LINE_STEP] = i + 1
        }
      }
      lineIndex = idx
      return text
    } catch {
      raw = ''
      return raw
    }
  })()
  return loading
}

function lineAt(n: number): string {
  const text = raw ?? ''
  const idx = lineIndex ?? new Uint32Array(0)
  const stepIdx = Math.floor(n / LINE_STEP)
  let start = idx[stepIdx] ?? 0
  let line = stepIdx * LINE_STEP
  while (line < n) {
    const nl = text.indexOf('\n', start)
    if (nl < 0) return ''
    start = nl + 1
    line++
  }
  const end = text.indexOf('\n', start)
  return text.slice(start, end < 0 ? undefined : end)
}

/**
 * 前缀推荐：输入几个字母推测完整单词。
 * 内存优化：不 split 成 27 万字符串数组，直接在原始文本上二分+逐行扫描。
 * 排序：生词本中的词 > 最近搜索过的词 > 词典序。
 */
export async function suggest(prefix: string, limit = 8): Promise<string[]> {
  const p = prefix.trim().toLowerCase()
  if (!/^[a-z]{2,}$/.test(p)) return []
  await loadRaw()
  if (!raw) return []

  // 二分定位第一个前缀匹配行
  let total = 0
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) === 10) total++
  let lo = 0
  let hi = total + 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const w = lineAt(mid)
    if (w < p) lo = mid + 1
    else hi = mid
  }

  const wordbook = new Set(useWordbookStore.getState().words.map((w) => w.word.toLowerCase()))
  const recent = new Set((await loadRecents()).map((r) => r.src.trim().toLowerCase()))
  const boostWords = await loadBoost()

  const hits: string[] = []
  for (let i = lo; i < total && hits.length < 2000; i++) {
    const w = lineAt(i)
    if (!w.startsWith(p)) break
    hits.push(w)
  }

  const score = (w: string): number => {
    if (wordbook.has(w)) return 0
    if (boostWords.has(w)) return 0.5
    if (recent.has(w)) return 1
    return 2
  }
  // 个性化（生词本/高频保底词/历史）置顶，其余保持词典字母序（稳定排序）
  const rank = new Map(hits.map((w, i) => [w, i]))
  return hits
    .sort((a, b) => score(a) - score(b) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    .slice(0, limit)
}
