import { llmJSON } from './llm'
import type { WordEntry } from '../stores/wordbookStore'

export interface Flashcard {
  id: string
  word: string
  phonetic?: string
  pos?: string
  /** 中文释义 */
  definition: string
  /** 例句（英文 + 中文） */
  context?: string
  /** 常用搭配（collocation） */
  collocation?: string
  /** 语域（正式 / 口语 / 学术） */
  register?: string
  /** 词族（同根词） */
  wordFamily?: string[]
  /** 内涵色彩 / 易混淆辨析 */
  nuance?: string
  /** 构词分析（词根/前缀/后缀拆解） */
  composition?: string
  /** 与其他词的关系（近义词 / 同族词 / 反义词） */
  related?: string[]
  /** 分级（CEFR / 四六级 / 雅思托福 / 专四专八） */
  level?: string
}

export type ExerciseType = 'choice' | 'fill' | 'spelling' | 'sentence'

export interface Exercise {
  id: string
  type: ExerciseType
  word: string
  prompt: string
  options?: string[]
  answer: string
  explanation?: string
}

function extractJson<T>(raw: string): T | null {
  const m = raw.trim().match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    return JSON.parse(m[0]) as T
  } catch {
    return null
  }
}

/** 生词本条目 → 基础闪卡（离线） */
export function cardsFromWordbook(words: WordEntry[]): Flashcard[] {
  return words.map((w) => ({
    id: w.id,
    word: w.word,
    phonetic: undefined,
    pos: w.pos,
    definition: w.definition || '—',
    context: w.context,
    related: undefined
  }))
}

/** AI 生成 7 维丰富词卡：音标、词性、释义、例句、搭配、语域、词族、内涵、同反、词根、分级 */
export async function aiGenerateCards(words: string[]): Promise<Flashcard[]> {
  const sys =
    '你是英语学习助手。为以下单词生成学习闪卡，为每个词补充 7 个维度：\n' +
    '1) 音标与词性；2) 简明中文释义；3) 一个英文例句（含中文）；\n' +
    '4) 常用搭配（collocation，如 "reach a goal"）；5) 语域（正式/口语/学术）；\n' +
    '6) 词族（同根词 1–3 个）与关联词（近义/反义）；7) 内涵色彩与易混淆辨析。\n' +
    '另给每个词标注难度分级，可选：CEFR A1–C2、四级 CET-4、六级 CET-6、专四 TEM-4、专八 TEM-8、雅思 5.5/7.0、托福 85/110。\n' +
    '只处理给定单词，不得新增其他词。必须严格输出 JSON，不要输出其他内容：\n' +
    '{"cards":[{"word":"...","phonetic":"...","pos":"...","definition":"...","context":"...","collocation":"...","register":"...","wordFamily":["..."],"related":["..."],"nuance":"...","composition":"...","level":"B2"}]}'

  const call = llmJSON(
    [
      { role: 'system', content: sys },
      { role: 'user', content: words.join('\n') }
    ],
    { temperature: 0.3, maxTokens: 12288 }
  )
  const raw = await call.promise
  const obj = extractJson<{
    cards?: {
      word?: string; phonetic?: string; pos?: string; definition?: string; context?: string
      collocation?: string; register?: string; wordFamily?: unknown; related?: unknown
      nuance?: string; composition?: string; level?: string
    }[]
  }>(raw)
  if (!obj?.cards) throw new Error('AI 未返回有效词卡')

  const byWord = new Map(words.map((w) => [w.toLowerCase(), true] as const))
  const cards: Flashcard[] = []
  for (const c of obj.cards) {
    const word = (c.word ?? '').trim()
    if (!word || !byWord.has(word.toLowerCase())) continue
    cards.push({
      id: `fc_${word}_${Math.random().toString(36).slice(2, 7)}`,
      word,
      phonetic: c.phonetic?.trim(),
      pos: c.pos?.trim(),
      definition: (c.definition ?? '').trim() || '—',
      context: c.context?.trim(),
      collocation: c.collocation?.trim(),
      register: c.register?.trim(),
      wordFamily: Array.isArray(c.wordFamily) ? c.wordFamily.filter((r): r is string => typeof r === 'string') : undefined,
      nuance: c.nuance?.trim(),
      composition: c.composition?.trim(),
      related: Array.isArray(c.related) ? c.related.filter((r): r is string => typeof r === 'string') : undefined,
      level: c.level?.trim()
    })
  }
  if (!cards.length) throw new Error('AI 未能识别给定单词')
  return cards
}

/** AI 生成词汇小练习：选择 / 填空 / 拼写 / 造句 混合 */
export async function aiGenerateExercises(cards: Flashcard[], count: number): Promise<Exercise[]> {
  const sys =
    '你是英语出题老师。基于给定单词生成若干道词汇练习题，题型混合：\n' +
    '- choice 选择题：给单词，选正确释义；options 为 4 个选项（含 1 个正确答案 + 3 个干扰项）\n' +
    '- fill 填空题：给带空格的英文句子（用 ___ 表示空格），填目标词\n' +
    '- spelling 拼写题：给释义，写出单词\n' +
    '- sentence 造句题：prompt 为「请用「目标词」造一个英文句子」，要求体现该词的常见用法；answer 为目标词\n' +
    '要求：答案必须是给定单词之一；选择题干扰项必须是释义而不是单词；其中造句题 1–2 道。\n' +
    '必须严格输出 JSON，不要输出其他内容：\n' +
    '{"exercises":[{"type":"choice|fill|spelling|sentence","word":"目标词","prompt":"题干","options":["A","B","C","D"],"answer":"正确答案","explanation":"解析"}]}'

  const wordList = cards.map((c) => `${c.word}（${c.definition}）`).join('\n')
  const call = llmJSON(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `请基于以下单词出 ${count} 道题（每道题的目标词只使用一次）：\n${wordList}` }
    ],
    { temperature: 0.5, maxTokens: 8192 }
  )
  const raw = await call.promise
  const obj = extractJson<{ exercises?: { type?: string; word?: string; prompt?: string; options?: unknown; answer?: string; explanation?: string }[] }>(raw)
  if (!obj?.exercises?.length) throw new Error('AI 未返回有效练习')

  const exercises: Exercise[] = []
  for (const e of obj.exercises) {
    const type =
      e.type === 'choice' || e.type === 'fill' || e.type === 'spelling' || e.type === 'sentence'
        ? e.type
        : 'choice'
    const answer = (e.answer ?? '').trim()
    if (!answer) continue
    exercises.push({
      id: `ex_${Math.random().toString(36).slice(2, 8)}`,
      type,
      word: (e.word ?? '').trim(),
      prompt: (e.prompt ?? '').trim(),
      options: Array.isArray(e.options) ? e.options.filter((o): o is string => typeof o === 'string') : undefined,
      answer,
      explanation: e.explanation?.trim()
    })
  }
  return exercises
}

/** 归一化作答文本（小写 + 去空格），用于判定拼写/填空 */
export function normalizeAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/[^a-z' -]/g, '')
}

/** 批量分级结果 */
export interface GradeResult {
  word: string
  /** 解析后的标准档位键（见 lib/levels） */
  level?: string
  raw: string
}

/** 批量给一组单词打难度分级（CEFR / 四六级 / 雅思托福 / 专四专八） */
export async function aiGradeWords(words: string[]): Promise<GradeResult[]> {
  const sys =
    '你是英语词汇标注助手。为每个单词标注难度档位，选项：CEFR A1/A2/B1/B2/C1/C2、四级 CET-4、六级 CET-6、专四 TEM-4、专八 TEM-8、雅思 5.5/7.0、托福 85/110。' +
    '按最常见的教学考纲归属标注（如"四级"优先，其次 CEFR）。必须严格输出 JSON：' +
    '{"grades":[{"word":"...","level":"CET-4"}]}，不要输出其他内容。'

  const call = llmJSON(
    [
      { role: 'system', content: sys },
      { role: 'user', content: words.join('\n') }
    ],
    { temperature: 0, maxTokens: 8192 }
  )
  const raw = await call.promise
  const obj = extractJson<{ grades?: { word?: string; level?: string }[] }>(raw)
  if (!obj?.grades) throw new Error('AI 未返回有效分级')

  const map = new Map(words.map((w) => [w.toLowerCase(), true] as const))
  const out: GradeResult[] = []
  for (const g of obj.grades) {
    const w = (g.word ?? '').trim().toLowerCase()
    if (!w || !map.has(w)) continue
    const rawLevel = g.level ?? ''
    const key = resolveLevelKey(rawLevel)
    // 拿回原始拼写
    const orig = words.find((x) => x.toLowerCase() === w) ?? w
    out.push({ word: orig, level: key, raw: rawLevel })
  }
  return out
}

function resolveLevelKey(raw: string): string | undefined {
  const s = raw.trim().toLowerCase()
  if (!s) return undefined
  if (/cet[-\s]?4|四级/.test(s)) return 'cet4'
  if (/cet[-\s]?6|六级/.test(s)) return 'cet6'
  if (/tem[-\s]?4|专四/.test(s)) return 'tem4'
  if (/tem[-\s]?8|专八/.test(s)) return 'tem8'
  if (/toefl|托福/.test(s)) return /1\d\d/.test(s) ? 'toefl110' : 'toefl85'
  if (/ielts|雅思/.test(s)) return /[78]/.test(s) ? 'ielts7' : 'ielts5'
  if (/c2/.test(s)) return 'c2'
  if (/c1/.test(s)) return 'c1'
  if (/b2/.test(s)) return 'b2'
  if (/b1/.test(s)) return 'b1'
  if (/a2/.test(s)) return 'a2'
  if (/a1/.test(s)) return 'a1'
  return undefined
}

/** 造句批改结果 */
export interface SentenceGrade {
  /** 0–100 */
  score: number
  grammar: string
  collocation: string
  usage: string
  suggestion: string
  revised: string
}

/** AI 批改造句：从语法 / 搭配 / 词义用法三个维度点评并打分 */
export async function aiGradeSentence(word: string, sentence: string): Promise<SentenceGrade> {
  const sys =
    '你是英语写作老师。用户用目标词造了一个英文句子，请从语法、搭配、词义用法三个维度点评并打分（0–100）。\n' +
    '评分标准：正确使用目标词且句子无语病 85+；用法正确但有小瑕疵 60–84；未使用或误用目标词 <60。\n' +
    '必须严格输出 JSON，不要输出其他内容：\n' +
    '{"score":85,"grammar":"语法点评（简体中文）","collocation":"搭配点评","usage":"词义用法点评","suggestion":"改进建议","revised":"改写后的英文句子"}'

  const call = llmJSON(
    [
      { role: 'system', content: sys },
      { role: 'user', content: `目标词：${word}\n用户造句：${sentence}` }
    ],
    { temperature: 0.3, maxTokens: 2048 }
  )
  const raw = await call.promise
  const obj = extractJson<Partial<SentenceGrade>>(raw)
  if (!obj || typeof obj.score !== 'number') throw new Error('AI 未返回有效批改结果')
  return {
    score: Math.max(0, Math.min(100, Math.round(obj.score))),
    grammar: obj.grammar ?? '-',
    collocation: obj.collocation ?? '-',
    usage: obj.usage ?? '-',
    suggestion: obj.suggestion ?? '-',
    revised: obj.revised ?? ''
  }
}
