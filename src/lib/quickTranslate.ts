import { llmStream } from './llm'
import { useHistoryStore } from '../stores/historyStore'

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
  handlers: { onChunk: (d: string) => void; onDone: (full: string) => void; onError: (m: string) => void }
): { cancel: () => void } {
  let sys: string
  if (mode === 'cn2en') {
    sys = isCnWord(text) ? SYS_CN2EN_WORD : SYS_CN2EN_SENT
  } else if (mode === 'translate') {
    sys = SYS_TRANSLATE
  } else {
    sys = SYS_WORD
  }
  let full = ''
  const call = llmStream(
    [
      { role: 'system', content: sys },
      { role: 'user', content: text }
    ],
    {
      onChunk: (d) => {
        full += d
        handlers.onChunk(d)
      },
      onDone: () => {
        useHistoryStore.getState().add('translate', text.slice(0, 40), full.slice(0, 80))
        saveRecent({ src: text, dst: full, mode, time: Date.now() })
        handlers.onDone(full)
      },
      onError: handlers.onError
    }
  )
  return { cancel: () => call.cancel() }
}
