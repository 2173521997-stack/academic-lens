import katex from 'katex'

/**
 * 智能将文本中的 LaTeX 公式（$$, \[\]; $, \(\) 以及无界定符的标准数学公式）转换为标准 KaTeX HTML
 */
export function renderLatexInText(raw: string): string {
  if (!raw) return ''

  let text = raw

  // 1. 块级公式 $$ ... $$ 或 \[ ... \]
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_match, math) => {
    try {
      return `<div class="katex-block my-2 text-center overflow-x-auto py-1">${katex.renderToString(math.trim(), {
        displayMode: true,
        throwOnError: false
      })}</div>`
    } catch {
      return _match
    }
  })

  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_match, math) => {
    try {
      return `<div class="katex-block my-2 text-center overflow-x-auto py-1">${katex.renderToString(math.trim(), {
        displayMode: true,
        throwOnError: false
      })}</div>`
    } catch {
      return _match
    }
  })

  // 2. 行内公式 \( ... \)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_match, math) => {
    try {
      return katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false
      })
    } catch {
      return _match
    }
  })

  // 3. 行内公式 $ ... $ (防止与货币符号误伤：排除纯数字金额如 $100)
  text = text.replace(/(^|[^\\])\$([^$\n]+?)\$/g, (match, prefix, math) => {
    if (/^\s*\d+(\.\d+)?\s*$/.test(math)) return match
    try {
      const rendered = katex.renderToString(math.trim(), {
        displayMode: false,
        throwOnError: false
      })
      return `${prefix}${rendered}`
    } catch {
      return match
    }
  })

  return text
}
