import { useWordbookStore } from '../stores/wordbookStore'
import { loadRecents, type QuickRecent } from './quickTranslate'
import { levenshtein } from './organize'

let raw: string | null = null
let loading: Promise<string> | null = null
let boost: Set<string> | null = null
// 稀疏行号索引：每 256 行记录偏移，二分定位时减少扫描
let lineIndex: Uint32Array | null = null
let lineCount = 0
// 生词本/最近搜索缓存：引用变化时才重建，避免每击键一次 Set 构建 + IPC
let wordbookCache: { ref: readonly { word: string }[]; set: Set<string> } | null = null
let recentsCache: Set<string> | null = null

/** 词表（public/words.txt，dev 与 file:// 下均用相对路径可 fetch） */
const WORDS_URL = 'words.txt'
const BOOST_URL = 'boost.txt'

const LINE_STEP = 256

const STEM_CORE_TERMS = [
  'algorithm', 'transformer', 'gradient', 'backpropagation', 'hyperparameter', 'stochastic',
  'eigenvalue', 'eigenvector', 'tensor', 'ablation', 'convolutional', 'latent', 'entropy',
  'manifold', 'regularization', 'robustness', 'orthogonal', 'asymptotic', 'heterogeneous',
  'homogeneous', 'convergence', 'optimization', 'heuristic', 'deterministic', 'probabilistic',
  'distribution', 'equilibrium', 'matrix', 'vector', 'derivative', 'integral', 'topology',
  'isomorphism', 'isometry', 'stochasticity', 'generalization', 'overfitting', 'underfitting',
  'discriminative', 'generative', 'autoencoder', 'recurrent', 'perceptron', 'normalization',
  'attention', 'residual', 'benchmark', 'baseline', 'empirical', 'hypothesis', 'inference',
  'quantum', 'thermodynamic', 'electromagnetic', 'semiconductor', 'nanotechnology', 'biomarker',
  'genome', 'polymerase', 'spectroscopy', 'microscopy', 'crystallography', 'diffraction'
]

async function loadBoost(): Promise<Set<string>> {
  if (boost) return boost
  const base = new Set(STEM_CORE_TERMS)
  try {
    const res = await fetch(BOOST_URL)
    const lines = (await res.text()).split('\n').map((w) => w.trim()).filter(Boolean)
    for (const l of lines) base.add(l)
  } catch {
    /* 忽略网络文件缺失，使用内置理工科词汇表 */
  }
  boost = base
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
      lineCount = line
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
  const total = lineCount
  let lo = 0
  let hi = total + 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const w = lineAt(mid)
    if (w < p) lo = mid + 1
    else hi = mid
  }

  const words = useWordbookStore.getState().words
  if (!wordbookCache || wordbookCache.ref !== words) {
    wordbookCache = { ref: words, set: new Set(words.map((w) => w.word.toLowerCase())) }
  }
  if (!recentsCache) {
    recentsCache = new Set((await loadRecents()).map((r: QuickRecent) => r.src.trim().toLowerCase()))
  }
  const wordbook = wordbookCache.set
  const recent = recentsCache
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

/** 二分查找一个词是否在词库中（小写精确匹配） */
export async function isKnownWord(word: string): Promise<boolean> {
  const w = word.trim().toLowerCase()
  if (!w) return false
  await loadRaw()
  if (!raw) return false
  let lo = 0
  let hi = lineCount + 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const cur = lineAt(mid)
    if (cur < w) lo = mid + 1
    else hi = mid
  }
  return lo < lineCount && lineAt(lo) === w
}

/**
 * 离线拼写纠正：词库中找不到该词时，在其字母序邻域用编辑距离找最接近的已知词。
 * 返回最佳建议词；距离过大（不确信）或词库未加载则返回 null。
 */
export async function bestOfflineSpelling(word: string): Promise<string | null> {
  const w = word.trim().toLowerCase()
  if (!w) return null
  await loadRaw()
  if (!raw) return null
  // 定位插入点（第一个 >= w 的行下标）
  let lo = 0
  let hi = lineCount + 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const cur = lineAt(mid)
    if (cur < w) lo = mid + 1
    else hi = mid
  }
  // 在邻域滑动窗口内做编辑距离（常见的错拼通常是"几个字符级别"的差异）
  const WINDOW = 3000
  const start = Math.max(0, lo - WINDOW)
  const end = Math.min(lineCount, lo + WINDOW)
  let best: string | null = null
  let bestDist = Infinity
  for (let i = start; i < end; i++) {
    const cand = lineAt(i)
    if (cand === w) return w
    // 长度差过大可直接跳过（编辑距离必然 >= 差）
    if (Math.abs(cand.length - w.length) >= bestDist) continue
    const d = levenshtein(cand, w)
    if (d < bestDist) {
      bestDist = d
      best = cand
    }
    if (d === 1) break // 编辑距离 1 已是最优，无需再搜
  }
  // 置信门槛：编辑距离 <=2 且相对长度差合理
  if (best && bestDist <= 2 && bestDist <= Math.max(1, Math.floor(w.length / 4))) {
    return best
  }
  return null
}

export async function findTypoSuggestion(word: string): Promise<string | null> {
  return bestOfflineSpelling(word)
}

