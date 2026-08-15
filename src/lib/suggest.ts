import { useWordbookStore } from '../stores/wordbookStore'
import { loadRecents } from './quickTranslate'

let words: string[] | null = null
let loading: Promise<string[]> | null = null

/** 词表（public/words.txt，dev 与 file:// 下均用相对路径可 fetch） */
const WORDS_URL = 'words.txt'

async function loadWords(): Promise<string[]> {
  if (words) return words
  if (loading) return loading
  loading = (async () => {
    try {
      const res = await fetch(WORDS_URL)
      const text = await res.text()
      words = text.split('\n').map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{2,45}$/.test(w))
      return words
    } catch {
      words = []
      return words
    }
  })()
  return loading
}

/**
 * 前缀推荐：输入几个字母推测完整单词。
 * 排序：生词本中的词 > 最近搜索过的词 > 短词优先 > 字母序。
 */
export async function suggest(prefix: string, limit = 8): Promise<string[]> {
  const p = prefix.trim().toLowerCase()
  if (!/^[a-z]{2,}$/.test(p)) return []
  const list = await loadWords()
  if (!list.length) return []

  const wordbook = new Set(useWordbookStore.getState().words.map((w) => w.word.toLowerCase()))
  const recent = new Set((await loadRecents()).map((r) => r.src.trim().toLowerCase()))

  const hits: string[] = []
  // 二分定位到第一个前缀匹配位置（词表按字母序）
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (list[mid] < p) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < list.length && hits.length < 200; i++) {
    if (!list[i].startsWith(p)) break
    hits.push(list[i])
  }

  const score = (w: string): number => {
    if (wordbook.has(w)) return 0
    if (recent.has(w)) return 1
    return 2
  }
  // 个性化（生词本/历史）置顶，其余保持词典字母序（稳定排序）
  const rank = new Map(hits.map((w, i) => [w, i]))
  return hits
    .sort((a, b) => score(a) - score(b) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    .slice(0, limit)
}
