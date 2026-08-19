import { llmStream } from './llm'
import { useHistoryStore } from '../stores/historyStore'
import { useSettingsStore } from '../stores/settingsStore'
import { dictLookup } from './dictLookup'
import { formatUapisCard } from './wordCard'
import { cleanWord, fixHyphenationAndBreaks, suggestSpelling } from './wordClean'
import { isPhrase } from './phrases'
import { buildTranslateSys } from './prompt'

export type QuickMode = 'word' | 'translate' | 'polish' | 'cn2en'

export type PolishStyle = 'journal' | 'concise' | 'clear' | 'native'

export const POLISH_STYLES: { id: PolishStyle; label: string; desc: string }[] = [
  { id: 'journal', label: '顶刊规范', desc: '符合 IEEE / Nature 严谨学术书面语，彻底消除口语化与语法松散' },
  { id: 'concise', label: '精简凝练', desc: '剔除冗余修饰与啰嗦从句，强动词替换，压缩篇幅 15%~30%' },
  { id: 'clear', label: '逻辑清晰', desc: '理顺主从句结构与 logical flow，强化精准因果与转折连接' },
  { id: 'native', label: '地道母语', desc: '纯正英语母语学者措辞，地道学术短语与惯用表达' }
]

const SYS_WORD =
  '你是专业学术英语词典。请用简体中文解释用户给出的英文单词。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
  'word|单词\n' +
  'phonetic|音标（如 /ˈæt.ən.ʃən/）\n' +
  'pos|词性（如 n. / v. / adj. / adv.）\n' +
  'def|简明学术释义，多条用；分隔\n' +
  'ex1|英文学术例句 | 中文翻译\n' +
  'ex2|英文学术例句 | 中文翻译\n' +
  '如果该词是学术专业术语，在 def 末尾标注「（学术术语：所属领域）」'

const SYS_PHRASE =
  '你是专业学术英语词典。请用简体中文解释用户给出的英文学术短语或词组，说明其含义与学术用法。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
  'word|短语本身\n' +
  'phonetic|大致音标（可省略）\n' +
  'pos|类型（如 phrase / prep. phrase / conj. / idiom）\n' +
  'def|简明学术释义，多条用；分隔\n' +
  'ex1|英文学术例句 | 中文翻译\n' +
  'ex2|英文学术例句 | 中文翻译\n' +
  '如果该短语是学术专业术语，在 def 末尾标注「（学术术语：所属领域）」'

const SYS_CN2EN_WORD =
  '你是专业英汉双向学术词典。用户给出中文学术词语或常用词，请给出最准确、最地道的对应英文单词/短语。必须严格按以下格式输出，每行一个字段，不要输出其他内容：\n' +
  'word|对应英文单词或短语\n' +
  'phonetic|音标（如 /ˈæt.ən.ʃən/）\n' +
  'pos|词性（如 n. / v. / adj. / phrase）\n' +
  'def|对应英文释义及中文解释，多条用；分隔\n' +
  'ex1|英文学术例句 | 中文翻译\n' +
  'ex2|英文学术例句 | 中文翻译\n' +
  '如果是学术专业术语，在 def 末尾标注「（学术术语：所属领域）」'

const SYS_CN2EN_SENT =
  '你是资深英文学术期刊（Nature/IEEE/ACM）母语审稿人与专业学术翻译专家。将用户提供的中文内容翻译为地道、严谨、符合国际顶刊规范的学术英文。\n' +
  '要求：\n' +
  '1. 保持学术严肃语气，使用规范学术词汇与句式，杜绝口语化表达；\n' +
  '2. 术语翻译精准统一；\n' +
  '3. 长难句逻辑关系清晰流畅；\n' +
  '4. 只输出最终英文学术译文，不要任何解释或多余前缀。'

function buildPolishSys(style: PolishStyle = 'journal'): string {
  let styleGuide = ''
  if (style === 'journal') {
    styleGuide = '【顶刊严谨规范风格】：使用严谨高阶的学术书面语，规范主被动语态与专业术语，确保符合 IEEE/ACM/Nature/Science 标准。'
  } else if (style === 'concise') {
    styleGuide = '【精简紧凑风格】：在保留全部学术信息的前提下，大力剔除冗余词汇与空洞修饰，使用强力动词与紧凑结构，压缩篇幅 15%~30%。'
  } else if (style === 'clear') {
    styleGuide = '【逻辑清晰易读风格】：理顺长难句主干与修饰关系，强化 logical flow，使用精准因果与转折连接词，确保论证清晰易懂。'
  } else if (style === 'native') {
    styleGuide = '【地道母语学者风格】：采用英语母语资深教授的习惯表达，搭配纯正学术短语与固定搭配，读来自然地道无翻译腔。'
  }

  return (
    '你是顶级英文学术期刊（Nature/IEEE/ACM）资深母语审稿人与编辑。' +
    '用户会提供英文草稿或中文初稿，请按指定风格完成专业学术润色（若输入为中文则先翻译为英文再润色）。\n' +
    `${styleGuide}\n\n` +
    '必须严格按以下 Markdown 结构输出，不要有额外开场白：\n' +
    '### ✍️ 润色定稿\n完整润色后的整段地道英文正文。\n\n' +
    '### 💡 改进要点与用词建议\n' +
    '- **原表达 → 替换建议**：修改理由（指出语法、时态或用词升级点）\n\n' +
    '### 🔄 变体参考\n提供另一种行之有效的学术备选句式。'
  )
}

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
const RECENT_MAX = 20
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
  opts?: { forceLlm?: boolean; polishStyle?: PolishStyle }
): { cancel: () => void } {
  const settings = useSettingsStore.getState().settings
  let cancelled = false
  let llmCall: { cancel: () => void } | null = null
  const fallbackToLlm = (): void => {
    if (cancelled) return
    llmCall = runLlm(text, mode, handlers, opts?.polishStyle)
  }

  // 句子翻译 / 润色：自动修复 PDF 复制导致的断行与连字符
  if (mode === 'translate' || mode === 'polish') {
    const cleanedText = fixHyphenationAndBreaks(text)
    llmCall = runLlm(cleanedText, mode, handlers, opts?.polishStyle)
    return { cancel: () => { cancelled = true; llmCall?.cancel() } }
  }

  // 短语：绕过 cleanWord（它只取第一个单词，会破坏短语），直接走 LLM 词卡
  if (mode === 'word' && isPhrase(text)) {
    llmCall = runLlm(text.trim(), mode, handlers)
    return { cancel: () => { cancelled = true; llmCall?.cancel() } }
  }

  // 中文输入在 word 模式：词语走 SYS_CN2EN_WORD 词卡，长句走 SYS_CN2EN_SENT
  if (mode === 'word' && isCn(text)) {
    llmCall = runLlm(text.trim(), 'cn2en', handlers)
    return { cancel: () => { cancelled = true; llmCall?.cancel() } }
  }

  // mode=word：英文单词清洗（错误拼写 / 大小写 / 音标噪声）
  void (async () => {
    if (cancelled) return
    const cleaned = await cleanWord(text)
    if (cancelled) return
    const word = cleaned?.word ?? text.trim()

    // 拼写建议回传 UI
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
          if (handlers.onSuggestion) {
            void suggestSpelling(word).then((s) => {
              if (s && s !== word && !cancelled) handlers.onSuggestion?.(s)
            })
          }
          if (handlers.onNotFound) { handlers.onNotFound(word); return }
          handlers.onError(`「${word}」未收录于词典。若要查看，请使用 AI 查词。`)
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

    // LLM 查词
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
  },
  polishStyle?: PolishStyle
): { cancel: () => void } {
  let sys: string
  if (mode === 'cn2en') {
    sys = isCnWord(text) ? SYS_CN2EN_WORD : SYS_CN2EN_SENT
  } else if (mode === 'translate') {
    sys = isCn(text) ? SYS_CN2EN_SENT : buildTranslateSys() // 中译英用顶刊严谨提示词，英译中带领域与术语预设
  } else if (mode === 'polish') {
    sys = buildPolishSys(polishStyle)
  } else {
    sys = isPhrase(text) ? SYS_PHRASE : SYS_WORD
  }

  let full = ''
  const baseHandlers = {
    onChunk: (d: string) => {
      full += d
      handlers.onChunk(d)
    },
    onDone: () => {
      const sourced = (mode === 'word' || (mode === 'cn2en' && isCnWord(text))) && !isPhrase(text) ? `${full}\nsource|llm` : full
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
