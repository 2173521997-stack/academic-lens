import type { Inline } from './types'

/**
 * 解析译文里的轻量行内标记为 Inline[]：
 * `**加粗**` / `*斜体*` / `` `代码` `` / `[文字](link)`（link 简化为忽略）。
 * 用于让原始块模型两侧共用同一套渲染器。
 */
export function parseInlineMarkdown(text: string): Inline[] {
  const runs: Inline[] = []
  let i = 0
  const n = text.length

  const push = (str: string, style?: Partial<Inline>): void => {
    const s = str.trim()
    if (!s) return
    // 尝试与上一条普通文本合并
    const last = runs[runs.length - 1]
    if (last && !style && !last.bold && !last.italic && !last.code && !last.link) {
      last.text += str
      return
    }
    runs.push({ text: str, ...(style ?? {}) })
  }

  while (i < n) {
    const rest = text.slice(i)
    // 代码 ``...``
    const codeMatch = /^`([^`]*)`/.exec(rest)
    if (codeMatch) {
      push(codeMatch[1], { code: true })
      i += codeMatch[0].length
      continue
    }
    // 加粗 **...**
    const boldMatch = /^\*\*([^*]+)\*\*/.exec(rest)
    if (boldMatch) {
      push(boldMatch[1], { bold: true })
      i += boldMatch[0].length
      continue
    }
    // 斜体 *...*
    const emMatch = /^\*([^*]+)\*/.exec(rest)
    if (emMatch) {
      push(emMatch[1], { italic: true })
      i += emMatch[0].length
      continue
    }
    // 普通字符：累计直到下一个标记
    const nextMark = rest.search(/[`*]/)
    if (nextMark === 0) {
      push(rest[0])
      i++
    } else if (nextMark === -1) {
      push(rest)
      break
    } else {
      push(rest.slice(0, nextMark))
      i += nextMark
    }
  }
  return runs
}

/** 用 Intl.Segmenter 按句子切分英文段落 */
export function splitSentences(text: string): string[] {
  try {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' })
    return Array.from(seg.segment(text))
      .map((s) => s.segment.trim())
      .filter(Boolean)
  } catch {
    return [text.trim()].filter(Boolean)
  }
}