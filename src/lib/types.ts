/** 行内单元：一段文字 + 可选样式标记（两侧共用同一套渲染器） */
export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  code?: boolean
  link?: string
}

/** 块模型：保留格式的文档内容单元 */
export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; runs: Inline[] }
  | { kind: 'paragraph'; runs: Inline[] }
  | { kind: 'list'; ordered: boolean; items: { runs: Inline[] }[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'code'; lang?: string; text: string }
  | { kind: 'blockquote'; runs: Inline[] }
  | { kind: 'image'; name: string; caption?: string } // 两侧同图占位，不翻译
  | { kind: 'math'; latex: string } // 原样保留，不翻译

export type SegmentType = 'h' | 'p' | 'list' | 'table' | 'code' | 'blockquote' | 'image' | 'math'

export interface Segment {
  id: string
  /**
   * 平铺主类型：兼容旧渲染/提示词/历史。h=标题，p=普通段落，
   * 其余对应块模型扩展类型（列表/表格/代码/引用/图片/公式）。
   */
  type: SegmentType
  /** 源文本（块模型的平铺可读文本，供提示词/历史/生词分析等使用） */
  text: string
  /** 完整块模型：保留标题层级/列表序号/表格行列/代码/引用/图片/公式与行内样式 */
  block: Block
  translation: string
  translating: boolean
  error?: string
  /** PDF 页码（1 起），非 PDF 无此字段 */
  page?: number
}

export interface DocInfo {
  name: string
  size: number
  path?: string
}

/* ---------------- 块模型辅助函数 ---------------- */

/** 把行内片段拼成纯文本 */
export function inlineText(runs: Inline[]): string {
  return runs.map((r) => r.text).join('')
}

/** 把块拼成可读纯文本（供提示词 / 历史 / 生词分析 / 平铺 text 回填） */
export function blockText(block: Block): string {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'blockquote':
      return inlineText(block.runs)
    case 'list':
      return block.items
        .map((it, i) => (block.ordered ? `${i + 1}. ${inlineText(it.runs)}` : `• ${inlineText(it.runs)}`))
        .join('\n')
    case 'table': {
      const all: Inline[][][] = [block.header, ...block.rows]
      return all.map((row) => row.map((cell) => inlineText(cell)).join(' | ')).join('\n')
    }
    case 'code':
      return block.text
    case 'image':
      return block.name
    case 'math':
      return block.latex
  }
}

/** 由行内片段构造纯文本段（含样式占位可忽略） */
export function segText(seg: Pick<Segment, 'block' | 'text'>): string {
  return seg.block ? blockText(seg.block) : seg.text
}

/** 规范一个块：为富渲染各行构造 Inline[]；无块时从平铺文本推导 */
export function blockToInlineRuns(block: Block): { kind: string; runs: Inline[] }[] {
  switch (block.kind) {
    case 'heading':
    case 'paragraph':
    case 'blockquote':
      return [{ kind: block.kind, runs: block.runs }]
    case 'list':
      return block.items.map((it) => ({ kind: 'list-item', runs: it.runs }))
    case 'table':
    case 'code':
    case 'image':
    case 'math':
      return []
  }
}

export const SUPPORTED_EXTS = ['pdf', 'docx', 'txt', 'md', 'markdown']

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isSupported(name: string): boolean {
  return SUPPORTED_EXTS.includes(extOf(name))
}
