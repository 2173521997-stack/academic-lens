import { llmStream } from './llm'
import { useHistoryStore } from '../stores/historyStore'

export type QuickMode = 'word' | 'translate' | 'explain'

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

const SYS_EXPLAIN =
  '你是英语阅读老师。请用简体中文讲解用户提供的英文句子：先给整句翻译，再逐层拆解句子结构（主谓宾、从句、修饰关系），并解释关键生词与固定搭配。使用 Markdown 排版。'

export interface QuickRecent {
  src: string
  dst: string
  mode: QuickMode
  time: number
}

const RECENT_KEY = 'quickRecent'

export async function loadRecents(): Promise<QuickRecent[]> {
  const saved = await window.bridge.storeGet<QuickRecent[]>(RECENT_KEY)
  return Array.isArray(saved) ? saved.slice(0, 8) : []
}

export function saveRecent(entry: QuickRecent): void {
  void loadRecents().then((list) => {
    const next = [entry, ...list.filter((x) => x.src !== entry.src)].slice(0, 8)
    void window.bridge.storeSet(RECENT_KEY, next)
  })
}

export function quickTranslate(
  text: string,
  mode: QuickMode,
  handlers: { onChunk: (d: string) => void; onDone: (full: string) => void; onError: (m: string) => void }
): { cancel: () => void } {
  const sys = mode === 'translate' ? SYS_TRANSLATE : mode === 'explain' ? SYS_EXPLAIN : SYS_WORD
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
