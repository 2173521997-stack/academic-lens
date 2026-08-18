import { llmJSON } from './llm'
import type { WordEntry } from '../stores/wordbookStore'

/** 一组单词（整理结果） */
export interface WordCluster {
  id: string
  name: string
  note?: string
  words: WordEntry[]
}

/* ---------------- 文本相似度（普通整理） ---------------- */

/** Levenshtein 编辑距离 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

/** 归一化相似度：1 - 编辑距离 / 最长长度 */
export function textSimilarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length)
  if (!len) return 1
  return 1 - levenshtein(a.toLowerCase(), b.toLowerCase()) / len
}

const INFLECT_SUFFIXES = [
  'ization', 'isation', 'ization', 'ational', 'ations', 'ation', 'ition', 'itions',
  'ability', 'ableness', 'fulness', 'lessness', 'ness', 'nesses',
  'ments', 'ment', 'fully', 'ied', 'ies', 'ing', 'ed', 'es', 's',
  'able', 'ible', 'tive', 'sive', 'ive', 'ous', 'ic', 'al', 'ly', 'ize', 'ise', 'er', 'or', 'tion', 'sion', 'ity', 'ty'
].sort((a, b) => b.length - a.length)

/** 词形归一化：小写 + 反复去掉常见的屈折/派生后缀，用于「同一词的不同形态」聚类 */
export function normalizeForm(word: string): string {
  let w = word.trim().toLowerCase()
  let prev = ''
  while (w !== prev) {
    prev = w
    for (const suf of INFLECT_SUFFIXES) {
      if (w.length - suf.length >= 3 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length)
        // -ies -> -y（studies → study）
        if (suf === 'ies' && !w.endsWith('e')) w += 'y'
        break
      }
    }
  }
  return w
}

/** 文本相似度分组：把同一词根的不同词性延申（analyze / analysis / analyzed…）归为一组 */
export function clusterBySimilarity(words: WordEntry[], threshold = 0.62): WordCluster[] {
  const items = words.map((w, i) => ({ w, i, form: normalizeForm(w.word) }))
  const clusters: WordCluster[] = []
  const used = new Set<number>()

  for (const it of items) {
    if (used.has(it.i)) continue
    const group: WordEntry[] = [it.w]
    used.add(it.i)
    for (const other of items) {
      if (used.has(other.i)) continue
      if (it.form === other.form || textSimilarity(it.form, other.form) >= threshold) {
        group.push(other.w)
        used.add(other.i)
      }
    }
    if (group.length >= 2) {
      clusters.push({
        id: `sim_${it.i}`,
        name: it.w.word,
        note: '词形相近（同一词的不同形态 / 拼写相近）',
        words: group
      })
    } else {
      // 未成组的单词仍然展示，避免丢词
      clusters.push({ id: `sim_${it.i}`, name: it.w.word, note: '独立词', words: group })
    }
  }
  return clusters
}

/* ---------------- 词性分组（普通整理） ---------------- */

/** 词性分组：n. / v. / adj. 等 */
export function clusterByPos(words: WordEntry[]): WordCluster[] {
  const map = new Map<string, WordEntry[]>()
  for (const w of words) {
    const pos = (w.pos ?? '').trim() || '未标注词性'
    const list = map.get(pos) ?? []
    list.push(w)
    map.set(pos, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([pos, list]) => ({ id: `pos_${pos}`, name: pos, note: '按词性分组', words: list }))
}

/* ---------------- 智能整理（AI 分组） ---------------- */

export type OrganizeMode = 'synonym' | 'academic' | 'affix' | 'theme'

export const ORGANIZE_MODES: { value: OrganizeMode; label: string; desc: string }[] = [
  { value: 'synonym', label: '近反义词', desc: '把含义相近（同义/反义）的词归组，易混淆的一起记' },
  { value: 'academic', label: '专业·日常', desc: '区分学术术语与日常通用词，把握语域' },
  { value: 'affix', label: '词根词缀', desc: '按词根/前缀/后缀归组，记一词通多词' },
  { value: 'theme', label: '主题场景', desc: '按主题/场景/语义场自由分类（AI 智能归纳）' }
]

const AI_PROMPTS: Record<OrganizeMode, string> = {
  synonym:
    '将给定单词按「近义词 / 反义词」关系分组。含义相近的词归为一组并说明组内差异；含义相反的成对出现。',
  academic:
    '将给定单词分为「专业学术术语」与「日常通用词」两大语域分组；学术词可进一步按所属领域（如 CS / 生物 / 经济）细分。',
  affix:
    '按构词法分组：共享同一词根（如 port 搬运）、同一前缀（如 re- 再次）、或同一后缀（如 -tion 名词）的单词归为一组，并标注词根/词缀含义。',
  theme:
    '按主题场景 / 语义场自由分类（如「学习」「环境」「情绪」「科技」等），将词义相关的单词归纳为有意义的组，并给出组名。'
}

export interface AIOrganizeResult {
  clusters: WordCluster[]
  error?: string
}

const MAX_AI_WORDS = 100

/** 智能整理：调用 LLM 分析生词本并返回分组（仅使用词表中的词，严格 JSON 输出） */
export async function aiOrganize(words: WordEntry[], mode: OrganizeMode): Promise<AIOrganizeResult> {
  const list = words.slice(0, MAX_AI_WORDS)
  const wordList = list.map((w) => w.word).join('\n')

  const sys =
    '你是词汇学专家。请对用户给出的英文单词进行整理分组。\n' +
    `任务：${AI_PROMPTS[mode]}\n` +
    '要求：\n' +
    '- 只使用给定列表中的单词，不得新增任何词；每个词只能出现在一个组。\n' +
    '- 单词较多时按重要程度分组，不必强行纳入所有词。\n' +
    '- 必须严格输出 JSON，不要输出任何其他内容。格式如下：\n' +
    '{"clusters":[{"name":"组名","note":"分组理由说明","words":["word1","word2"]}]}'

  try {
    const call = llmJSON(
      [
        { role: 'system', content: sys },
        { role: 'user', content: `请整理以下单词：\n${wordList}` }
      ],
      { temperature: 0.3, maxTokens: 4096 }
    )
    const raw = await call.promise
    const m = raw.trim().match(/\{[\s\S]*\}/)
    if (!m) throw new Error('AI 未返回有效 JSON')
    const obj = JSON.parse(m[0]) as { clusters?: { name?: string; note?: string; words?: unknown }[] }
    const byWord = new Map(list.map((w) => [w.word.toLowerCase(), w]))

    const clusters: WordCluster[] = []
    for (const c of obj.clusters ?? []) {
      const ws = (Array.isArray(c.words) ? c.words : []).filter((x): x is string => typeof x === 'string')
      const entries = ws
        .map((w) => byWord.get(w.trim().toLowerCase()))
        .filter((w): w is WordEntry => Boolean(w))
      if (!entries.length) continue
      clusters.push({
        id: `ai_${mode}_${clusters.length}`,
        name: (c.name ?? '').trim() || entries[0].word,
        note: (c.note ?? '').trim() || undefined,
        words: entries
      })
    }
    return { clusters }
  } catch (err) {
    return { clusters: [], error: err instanceof Error ? err.message : String(err) }
  }
}
