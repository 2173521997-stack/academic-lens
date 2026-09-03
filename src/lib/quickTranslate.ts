import { agentStream } from './llm'
import { useHistoryStore } from '../stores/historyStore'
import { useSettingsStore } from '../stores/settingsStore'
import { dictLookup } from './dictLookup'
import { formatUapisCard, parseWordCard, type WordEntry } from './wordCard'
import { cleanWord, suggestSpelling } from './wordClean'

export type QuickMode = 'word' | 'translate' | 'ai' | 'cn2en'

const SYS_WORD =
  '你是专业的理工科与学术前沿英语词典。请用简体中文解释用户给出的英文单词或短语（如 gradient descent, attention mechanism 等）。\n' +
  '优先提供计算机科学(CS)、人工智能(AI)、数学、物理、电子工程、生物医学等理工科学术语境下的权威释义、学科归属与论文例句。\n' +
  '必须严格按以下格式输出，每行一个字段，不要输出其他任何非必要字符：\n' +
  'word|单词或短语\n' +
  'phonetic|音标或发音标注\n' +
  'pos|词性或类型（如 n. / v. / adj. / 学术短语 / 专有名词）\n' +
  'field|所属理工科领域（如 [计算机/AI]、[应用数学]、[电子信息]、[生物医药]、[通用学术]）\n' +
  'def|简明中文释义（理工科义项优先，多义项用；分隔）\n' +
  'syn|常用同义词/近义学术短语，多条用；分隔\n' +
  'ant|常用反义词，多条用；分隔（可选）\n' +
  'ex1|学术论文/经典教材英文例句 | 中文翻译\n' +
  'ex2|学术论文/经典教材英文例句 | 中文翻译'

const SYS_TRANSLATE =
  '你是顶级学术与理工科专业翻译专家。将用户提供的英文论文、课件PPT、技术文档或实验段落翻译为严谨流畅的简体中文。\n' +
  '必须严格遵守以下学术排版、缩进与公式保护规范：\n' +
  '1. 排版与视觉层次对齐：严格还原原文的视觉结构！原文有分段、换行、列表编号（如 1. 2. 3. 或 - 等）、首行缩进、独立公式行的，译文必须严格一一对应换行与排版对齐，保持与原文幻灯片/课件相同的层次感；\n' +
  '2. 数学公式与符号绝对保护：所有数学公式（包括 LaTeX 格式如 $...$、$$...$$、公式行、变量上下标、积分求和符号、矩阵、希腊字母等）必须完全原样保留，严禁篡改或擅自翻译公式内部符号；\n' +
  '3. 实验数据与指标保护：所有数值、统计量（如 p < 0.05, 95% CI, ±0.02, 100 Gbps）、物理单位及英文专业缩写原样保留；\n' +
  '4. 专业术语精准：计算机、人工智能、数学物理、电子通信等理工科名词保持标准学术译法；\n' +
  '5. 纯净输出：只输出最终的中文译文与排版内容，不要输出任何前缀、引言或额外解释说明。'

const SYS_MINI_AI =
  '你是学术解题与原理分析助手。专门为学生解答英文论文、课件中的复杂数学公式、定理推导、算法步骤与学术原理。\n' +
  '回答请用简体中文，条理清晰、深入浅出，突出公式中各变量的物理/几何意义与直观理解，公式表达规范。'

const SYS_CN2EN_WORD =
  '你是中英双向理工科与学术词典。用户给出中文词语或学术短语（如「梯度下降」、「注意力机制」、「消融实验」等），请给出对应的最权威英文术语词卡。\n' +
  '必须严格按以下格式输出，每行一个字段，不要输出其他任何内容：\n' +
  'word|对应英文术语或短语\n' +
  'phonetic|英文音标或发音\n' +
  'pos|词性或类型（如 n. / v. / adj. / 学术短语）\n' +
  'field|所属理工科领域（如 [计算机/AI]、[应用数学]、[电子工程]、[生物医药]）\n' +
  'def|中文原义及地道英文学术定义\n' +
  'syn|英文同义词/相关术语，多条用；分隔\n' +
  'ant|反义词，多条用；分隔（可选）\n' +
  'ex1|顶级期刊/会议论文英文例句 | 中文对照\n' +
  'ex2|顶级期刊/会议论文英文例句 | 中文对照'

const SYS_CN2EN_SENT =
  '你是专业学术翻译。将用户提供的中文长句或段落翻译为地道、准确的顶级学术英文（符合 IEEE/ACM/Nature/Science 风格），公式与数据原样保留，术语准确。只输出译文，不要任何解释或前缀。'

/** 是否含中文字符（触发中译英） */
export function isCn(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 中文词语/短语判定：1–16 个汉字/短语 → 词典词卡；长句 → 直译 */
export function isCnWord(text: string): boolean {
  const t = text.trim()
  return /^[\u4e00-\u9fff\w\s·\-\/]{1,16}$/.test(t) && !/[。！？!?\n]/.test(t)
}

/** 英文单词/短语判定：单个单词或 2-8 个单词组成的短语（无句子标点） */
export function isEnglishWordOrPhrase(text: string): boolean {
  const t = text.trim()
  if (isCn(t)) return false
  if (/[.!?\n]/.test(t)) return false
  const words = t.split(/\s+/).filter(Boolean)
  return words.length >= 1 && words.length <= 8
}

export interface QuickRecent {
  src: string
  dst: string
  mode: QuickMode
  time: number
}

const WORD_RECENT_KEY = 'quickWordRecents'
const TRANSLATE_RECENT_KEY = 'quickTranslateRecents'
const RECENT_MAX = 15

let wordRecentsCache: QuickRecent[] | null = null
let translateRecentsCache: QuickRecent[] | null = null

export async function loadWordRecents(): Promise<QuickRecent[]> {
  if (wordRecentsCache) return wordRecentsCache
  const saved = await window.bridge.storeGet<QuickRecent[]>(WORD_RECENT_KEY)
  if (Array.isArray(saved) && saved.length > 0) {
    wordRecentsCache = saved.slice(0, RECENT_MAX)
  } else {
    // 兼容历史老数据
    const old = await window.bridge.storeGet<QuickRecent[]>('quickRecent')
    if (Array.isArray(old)) {
      wordRecentsCache = old.filter((x) => x.mode === 'word' || (x.mode === 'cn2en' && isCnWord(x.src))).slice(0, RECENT_MAX)
    } else {
      wordRecentsCache = []
    }
  }
  return wordRecentsCache
}

export function saveWordRecent(entry: QuickRecent): void {
  const list = wordRecentsCache ?? []
  const next = [entry, ...list.filter((x) => x.src !== entry.src)].slice(0, RECENT_MAX)
  wordRecentsCache = next
  void window.bridge.storeSet(WORD_RECENT_KEY, next)
}

export function clearWordRecents(): void {
  wordRecentsCache = []
  void window.bridge.storeSet(WORD_RECENT_KEY, [])
}

export async function loadTranslateRecents(): Promise<QuickRecent[]> {
  if (translateRecentsCache) return translateRecentsCache
  const saved = await window.bridge.storeGet<QuickRecent[]>(TRANSLATE_RECENT_KEY)
  if (Array.isArray(saved) && saved.length > 0) {
    translateRecentsCache = saved.slice(0, RECENT_MAX)
  } else {
    // 兼容历史老数据
    const old = await window.bridge.storeGet<QuickRecent[]>('quickRecent')
    if (Array.isArray(old)) {
      translateRecentsCache = old.filter((x) => x.mode === 'translate' || (x.mode === 'cn2en' && !isCnWord(x.src))).slice(0, RECENT_MAX)
    } else {
      translateRecentsCache = []
    }
  }
  return translateRecentsCache
}

export function saveTranslateRecent(entry: QuickRecent): void {
  const list = translateRecentsCache ?? []
  const next = [entry, ...list.filter((x) => x.src !== entry.src)].slice(0, RECENT_MAX)
  translateRecentsCache = next
  void window.bridge.storeSet(TRANSLATE_RECENT_KEY, next)
}

export function clearTranslateRecents(): void {
  translateRecentsCache = []
  void window.bridge.storeSet(TRANSLATE_RECENT_KEY, [])
}

export async function loadRecents(): Promise<QuickRecent[]> {
  const [w, t] = await Promise.all([loadWordRecents(), loadTranslateRecents()])
  return [...w, ...t].sort((a, b) => b.time - a.time).slice(0, RECENT_MAX)
}

export function clearRecents(): void {
  clearWordRecents()
  clearTranslateRecents()
}

// 统一保存入口
export function saveRecent(entry: QuickRecent): void {
  if (entry.mode === 'word' || (entry.mode === 'cn2en' && isCnWord(entry.src))) {
    saveWordRecent(entry)
  } else {
    saveTranslateRecent(entry)
  }
}

export function quickTranslate(
  text: string,
  mode: QuickMode,
  handlers: {
    onChunk: (d: string) => void
    onDone: (full: string) => void
    onError: (m: string) => void
    onNotFound?: (word: string) => void
    onSuggestion?: (suggestion: string) => void
  },
  opts?: { forceLlm?: boolean }
): { cancel: () => void } {
  const settings = useSettingsStore.getState().settings
  let cancelled = false
  let call: { cancel: () => void } | null = null
  const fallbackToLlm = (): void => {
    if (cancelled) return
    call = runLlm(text, mode, handlers)
  }

  // AI 助手模式或直接长文翻译模式
  if (mode === 'ai' || mode === 'translate') {
    call = runLlm(text, mode, handlers)
    return {
      cancel: () => {
        cancelled = true
        call?.cancel()
      }
    }
  }

  void (async () => {
    if (cancelled) return
    const rawTrimmed = text.trim()

    // 中译英模式
    if (mode === 'cn2en') {
      call = runLlm(rawTrimmed, mode, handlers)
      return
    }

    // 英文短语或单词
    const isSingle = /^[A-Za-z][A-Za-z'-]{1,45}$/.test(rawTrimmed)
    let cleanedWord = rawTrimmed

    if (isSingle) {
      const cleaned = await cleanWord(rawTrimmed)
      if (cleaned?.word) cleanedWord = cleaned.word
      if (cleaned?.suggestion) handlers.onSuggestion?.(cleaned.suggestion)
    }

    const canUseDict =
      isSingle &&
      !opts?.forceLlm &&
      settings.lookupSource === 'dict' &&
      !!settings.dictApiKey

    if (canUseDict) {
      try {
        const res = await dictLookup(cleanedWord, settings.dictApiKey)
        if (cancelled) return
        if (!res) {
          fallbackToLlm()
          return
        }
        if (res.notFound) {
          if (handlers.onSuggestion) {
            void suggestSpelling(cleanedWord).then((s) => {
              if (s && s !== cleanedWord && !cancelled) handlers.onSuggestion?.(s)
            })
          }
          if (handlers.onNotFound) {
            handlers.onNotFound(cleanedWord)
            return
          }
          handlers.onError(`「${cleanedWord}」未收录于基础词典。已自动切换至理工科 AI 词卡模式。`)
          fallbackToLlm()
          return
        }
        const card = formatUapisCard(res)
        handlers.onChunk(card)
        useHistoryStore.getState().add('translate', cleanedWord.slice(0, 40), card.slice(0, 80))
        saveWordRecent({ src: text, dst: card, mode, time: Date.now() })
        handlers.onDone(card)
      } catch {
        fallbackToLlm()
      }
      return
    }

    call = runLlm(cleanedWord, mode, handlers)
  })()

  return {
    cancel: () => {
      cancelled = true
      call?.cancel()
    }
  }
}

function runLlm(
  text: string,
  mode: QuickMode,
  handlers: {
    onChunk: (d: string) => void
    onDone: (full: string) => void
    onError: (m: string) => void
    onNotFound?: (word: string) => void
  }
): { cancel: () => void } {
  let sys: string
  if (mode === 'ai') sys = SYS_MINI_AI
  else if (mode === 'cn2en') sys = isCnWord(text) ? SYS_CN2EN_WORD : SYS_CN2EN_SENT
  else if (mode === 'translate') sys = SYS_TRANSLATE
  else sys = SYS_WORD

  let full = ''
  const baseHandlers = {
    onChunk: (d: string) => {
      full += d
      handlers.onChunk(d)
    },
    onDone: () => {
      const sourced = mode === 'word' || (mode === 'cn2en' && isCnWord(text)) ? `${full}\nsource|llm` : full
      useHistoryStore.getState().add('translate', text.slice(0, 40), full.slice(0, 80))
      saveRecent({ src: text, dst: sourced, mode, time: Date.now() })
      handlers.onDone(sourced)
    },
    onError: handlers.onError
  }

  // 小窗查词/翻译/词卡/AI 助手全走轻量免费的 agentStream (GLM-4-flash)，以经济为最高优先
  const temperature = mode === 'word' || (mode === 'cn2en' && isCnWord(text)) ? 0 : 0.3
  return agentStream([{ role: 'system', content: sys }, { role: 'user', content: text }], baseHandlers, {
    temperature
  })
}

/**
 * 完整异步查询某个单词/短语的详细信息（用于生词本后台自动录入）
 */
export async function lookupWordDetails(word: string): Promise<WordEntry | null> {
  const w = word.trim()
  if (!w) return null
  const settings = useSettingsStore.getState().settings

  if (settings.lookupSource === 'dict' && settings.dictApiKey && /^[A-Za-z][A-Za-z'-]{1,45}$/.test(w)) {
    try {
      const res = await dictLookup(w, settings.dictApiKey)
      if (res && !res.notFound) {
        return res.entry
      }
    } catch {
      /* 回退 LLM */
    }
  }

  const mode: QuickMode = isCn(w) ? 'cn2en' : 'word'

  return new Promise((resolve) => {
    let full = ''
    quickTranslate(w, mode, {
      onChunk: (d) => {
        full += d
      },
      onDone: (res) => {
        const card = parseWordCard(res || full)
        resolve(card)
      },
      onError: () => {
        resolve(null)
      }
    })
  })
}
