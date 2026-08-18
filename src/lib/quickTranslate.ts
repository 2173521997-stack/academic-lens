import { llmStream } from './llm'
import { useHistoryStore } from '../stores/historyStore'
import { useSettingsStore } from '../stores/settingsStore'
import { dictLookup } from './dictLookup'
import { formatUapisCard } from './wordCard'
import { cleanWord, suggestSpelling } from './wordClean'

export type QuickMode = 'word' | 'translate' | 'cn2en'

const SYS_WORD =
  '你是英语词典。请用简体中文解释用户给出的英文单词。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
  'word|单词\n' +
  'phonetic|音标（如 /ˈæt.ən.ʃən/）\n' +
  'pos|词性（如 n. / v. / adj.）\n' +
  'def|简明释义，多条用；分隔\n' +
  'ex1|英文例句 | 中文翻译\n' +
  'ex2|英文例句 | 中文翻译\n' +
  '如果该词是学术术语，在 def 末尾标注「（学术术语：所属领域）」'

const SYS_TRANSLATE =
  '你是专业学术翻译。将用户提供的英文内容翻译为简体中文，保持学术语气、术语准确、长难句拆分通顺。只输出译文，不要任何解释。'

const SYS_CN2EN_WORD =
  '你是中英词典。用户给出中文词语，请给出最常用、最准确的英文翻译。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
  'word|英文单词\n' +
  'phonetic|音标（如 /ˈæt.ən.ʃən/）\n' +
  'pos|词性（如 n. / v. / adj.）\n' +
  'def|英文释义，多条用；分隔\n' +
  'ex1|英文例句 | 中文翻译\n' +
  'ex2|英文例句 | 中文翻译\n' +
  '如果是学术术语，在 def 末尾标注「（academic term: 所属领域）」'

const SYS_CN2EN_SENT =
  '你是专业中英翻译。将用户提供的中文内容翻译为地道、准确的英文，保持学术语气、术语准确。只输出译文，不要任何解释或前缀。'

/** 是否含中文字符（触发中译英） */
export function isCn(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 中文词语判定：1–8 个纯汉字（不含标点/数字/字母）→ 词典词卡；否则 → 直译 */
export function isCnWord(text: string): boolean {
  return /^[\u4e00-\u9fff]{1,8}$/.test(text.trim())
}

export interface QuickRecent {
  src: string
  dst: string
  mode: QuickMode
  time: number
}

const RECENT_KEY = 'quickRecent'
const RECENT_MAX = 15
let recentsCache: QuickRecent[] | null = null

export async function loadRecents(): Promise<QuickRecent[]> {
  if (recentsCache) return recentsCache
  const saved = await window.bridge.storeGet<QuickRecent[]>(RECENT_KEY)
  recentsCache = Array.isArray(saved) ? saved.slice(0, RECENT_MAX) : []
  return recentsCache
}

export function saveRecent(entry: QuickRecent): void {
  const list = recentsCache ?? []
  const next = [entry, ...list.filter((x) => x.src !== entry.src)].slice(0, RECENT_MAX)
  recentsCache = next
  void window.bridge.storeSet(RECENT_KEY, next)
}

/** 清空全部搜索历史 */
export function clearRecents(): void {
  recentsCache = []
  void window.bridge.storeSet(RECENT_KEY, [])
}

export function quickTranslate(
  text: string,
  mode: QuickMode,
  handlers: {
    onChunk: (d: string) => void
    onDone: (full: string) => void
    onError: (m: string) => void
    onNotFound?: (word: string) => void
    /** 命中拼写建议时回调（清洗阶段判定原文可能打错） */
    onSuggestion?: (suggestion: string) => void
  },
  opts?: { forceLlm?: boolean }
): { cancel: () => void } {
  const settings = useSettingsStore.getState().settings
  let cancelled = false
  let llmCall: { cancel: () => void } | null = null
  const fallbackToLlm = (): void => {
    if (cancelled) return
    llmCall = runLlm(text, mode, handlers)
  }

  // 中译英 / 句子翻译不走单词清洗（uapis 只支持英→中单词）
  if (mode === 'translate') {
    llmCall = runLlm(text, mode, handlers)
    return { cancel: () => { cancelled = true; llmCall?.cancel() } }
  }

  // mode=word 或 cn2en(word)：先统一清洗（错误拼写 / 大小写 / 音标噪声）
  void (async () => {
    if (cancelled) return
    const cleaned = await cleanWord(text)
    if (cancelled) return
    const word = cleaned?.word ?? text.trim()

    // 拼写建议回传 UI（无论词典还是 LLM 路径，只要有建议都提示，点击可改用建议拼写）
    if (cleaned?.suggestion) {
      handlers.onSuggestion?.(cleaned.suggestion)
    }

    // 词典双轨：仅英→中 word 模式且已启用字典
    const canUseDict =
      mode !== 'cn2en' &&
      !opts?.forceLlm &&
      settings.lookupSource === 'dict' &&
      !!settings.dictApiKey &&
      /^[A-Za-z][A-Za-z'-]{1,45}$/.test(word)

    if (canUseDict) {
      try {
        const res = await dictLookup(word, settings.dictApiKey)
        if (cancelled) return
        if (!res) { fallbackToLlm(); return }
        if (res.notFound) {
          // 后置纠错：词典 miss 后，问一次小模型拿拼写建议（仅失败路径成本）
          if (handlers.onSuggestion) {
            void suggestSpelling(word).then((s) => {
              if (s && s !== word && !cancelled) handlers.onSuggestion?.(s)
            })
          }
          if (handlers.onNotFound) { handlers.onNotFound(word); return }
          handlers.onError(`「${word}」未收录于词典（可能拼写有误）。若要查看，请先用 LLM 查词方式。`)
          return
        }
        const card = formatUapisCard(res)
        handlers.onChunk(card)
        useHistoryStore.getState().add('translate', word.slice(0, 40), card.slice(0, 80))
        saveRecent({ src: text, dst: card, mode, time: Date.now() })
        handlers.onDone(card)
      } catch {
        fallbackToLlm()
      }
      return
    }

    // LLM：用清洗后的规范词（大小写统一、去除噪声），保持来源标记
    llmCall = runLlm(cleaned ? cleaned.word : text, mode, handlers)
  })()

  return {
    cancel: () => {
      cancelled = true
      llmCall?.cancel()
    }
  }
}

/** LLM 路径：按 mode 选系统提示；word 模式低温度 + 来源=llm */
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
  if (mode === 'cn2en') sys = isCnWord(text) ? SYS_CN2EN_WORD : SYS_CN2EN_SENT
  else if (mode === 'translate') sys = SYS_TRANSLATE
  else sys = SYS_WORD

  let full = ''
  const baseHandlers = {
    onChunk: (d: string) => {
      full += d
      handlers.onChunk(d)
    },
    onDone: () => {
      const sourced = mode === 'word' ? `${full}\nsource|llm` : full
      useHistoryStore.getState().add('translate', text.slice(0, 40), full.slice(0, 80))
      saveRecent({ src: text, dst: sourced, mode, time: Date.now() })
      handlers.onDone(sourced)
    },
    onError: handlers.onError
  }
  return llmStream([{ role: 'system', content: sys }, { role: 'user', content: text }], baseHandlers, {
    temperature: mode === 'word' ? 0 : undefined
  })
}
