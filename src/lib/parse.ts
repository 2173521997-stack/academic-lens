import { marked } from 'marked'
import type { Segment, SegmentType, Block, Inline } from './types'
import { blockText } from './types'

let uid = 0

export function newId(): string {
  return `seg_${Date.now()}_${++uid}`
}

/** 纯文本 → 单条 paragraph 块（TXT / 回退场景） */
function para(text: string): Block {
  return { kind: 'paragraph', runs: [{ text }] }
}

export function makeSegment(
  type: SegmentType,
  text: string,
  page?: number,
  block?: Block,
  rect?: import('./types').SegmentRect
): Segment {
  const blk = block ?? para(text)
  // text 为空时由块推导可读文本（如 PDF 需先 parse 才能得到），保证提示词/历史/生词分析可用
  const src = text || blockText(blk)
  return {
    id: newId(),
    type,
    text: src,
    block: blk,
    translation: '',
    translating: false,
    ...(page !== undefined ? { page } : {}),
    ...(rect ? { rect } : {})
  }
}

/** 由纯文本构造段落段（外部临时使用，如文本翻译/文件名行） */
export function makeParagraphSegment(text: string, page?: number, rect?: import('./types').SegmentRect): Segment {
  return makeSegment('p', text, page, para(text), rect)
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/* ================= 行内样式解析 ================= */

function extractRuns(n: Node): Inline[] {
  const inner: Inline[] = []
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? ''
      if (t) inner.push({ text: t })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName?.toLowerCase()
    if (tag === 'br') {
      inner.push({ text: ' ' })
      return
    }
    const bold = tag === 'strong' || tag === 'b'
    const italic = tag === 'em' || tag === 'i'
    const code = tag === 'code' || tag === 'pre'
    const link = tag === 'a' ? (el.getAttribute('href') ?? undefined) : undefined
    const sub: Inline[] = []
    for (const c of Array.from(el.childNodes)) sub.push(...extractRuns(c))
    for (const e of sub) {
      if (bold) e.bold = true
      if (italic) e.italic = true
      if (code) e.code = true
      if (link && !e.link) e.link = link
    }
    inner.push(...sub)
  }
  walk(n)
  return inner
}

/** 把 DOM 元素的行内子内容提取为 Inline[] */
export function elementRuns(el: Element): Inline[] {
  const acc: Inline[] = []
  for (const c of Array.from(el.childNodes)) acc.push(...extractRuns(c))
  return acc.filter((r) => r.text.trim().length > 0)
}

/* ================= PDF 解析（按页分段，提取段落/标题/列表/表格与排版坐标） ================= */

interface TextItem {
  str: string
  x: number
  y: number
  width: number
  height: number
  bold: boolean
}

interface TextLine {
  items: TextItem[]
  y: number
  height: number
  text: string
  minX: number
  maxX: number
  minY: number
  maxY: number
  pageWidth: number
  pageHeight: number
}

interface PdfTextItemLike {
  str?: string
  width?: number
  transform?: number[]
  fontName?: string
}

async function extractPageLines(page: import('pdfjs-dist').PDFPageProxy): Promise<TextLine[]> {
  const content = await page.getTextContent()
  const viewport = page.getViewport({ scale: 1.0 })
  const pageWidth = viewport.width || 612
  const pageHeight = viewport.height || 792

  const items: TextItem[] = []
  let maxH = 8
  for (const it of content.items as unknown as PdfTextItemLike[]) {
    const str = it.str ?? ''
    if (!str) continue
    const t = it.transform ?? [1, 0, 0, 1, 0, 0]
    const h = Math.abs(t[3] || 0) || 9
    const w = it.width || str.length * h * 0.55
    if (h > maxH) maxH = h
    items.push({
      str,
      x: t[4] || 0,
      y: t[5] || 0,
      width: w,
      height: h,
      bold: /bold/i.test(it.fontName ?? '')
    })
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x)

  const lines: TextLine[] = []
  for (const item of items) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(item.y - last.y) <= Math.max(item.height, last.height) * 0.5) {
      last.items.push(item)
      last.height = Math.max(last.height, item.height)
      last.minX = Math.min(last.minX, item.x)
      last.maxX = Math.max(last.maxX, item.x + item.width)
      last.minY = Math.min(last.minY, item.y)
      last.maxY = Math.max(last.maxY, item.y + item.height)
    } else {
      lines.push({
        items: [item],
        y: item.y,
        height: item.height,
        text: '',
        minX: item.x,
        maxX: item.x + item.width,
        minY: item.y,
        maxY: item.y + item.height,
        pageWidth,
        pageHeight
      })
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = 0
    for (const it of line.items) {
      if (text && it.x > prevEnd + it.height * 0.25) text += ' '
      text += it.str
      prevEnd = it.x + it.width
    }
    line.text = text
  }
  return lines.filter((l) => l.text.trim().length > 0)
}

/** 检测一行是否 `<cell> | <cell>` 的对齐表格行 */
function isTableRow(line: TextLine): boolean {
  const m = line.text.match(/^(.*?)\s\|(.+)$/)
  if (!m) return false
  const cells = line.text.split(/\s*\|\s*/)
  return cells.length >= 2 && cells.every((c) => c.trim().length > 0)
}

export async function parsePdf(data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Segment[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data }).promise
  const segs: Segment[] = []
  try {
    const CONCURRENCY = 3
    const results: TextLine[][] = new Array(doc.numPages)
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < doc.numPages) {
        const i = next++
        const page = await doc.getPage(i + 1)
        results[i] = await extractPageLines(page)
        onProgress?.(i + 1, doc.numPages)
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, doc.numPages) }, () => worker()))

    for (let i = 0; i < results.length; i++) {
      const lines = results[i]
      const pageNo = i + 1
      const bodyHeight = lines.reduce((m, l) => Math.max(m, l.height), 8)

      let curLines: TextLine[] = []
      const flushPara = (segNo: number): void => {
        if (!curLines.length) return
        const curText = curLines.map((l) => l.text).join(' ').trim()
        if (!curText) {
          curLines = []
          return
        }

        const minX = Math.min(...curLines.map((l) => l.minX))
        const maxX = Math.max(...curLines.map((l) => l.maxX))
        const minY = Math.min(...curLines.map((l) => l.minY))
        const maxY = Math.max(...curLines.map((l) => l.maxY))
        const pw = curLines[0].pageWidth || 612
        const ph = curLines[0].pageHeight || 792

        const rect = {
          x: Math.max(0, Math.min(100, (minX / pw) * 100)),
          y: Math.max(0, Math.min(100, ((ph - maxY) / ph) * 100)),
          width: Math.max(2, Math.min(100, ((maxX - minX) / pw) * 100)),
          height: Math.max(1, Math.min(100, ((maxY - minY) / ph) * 100))
        }

        segs.push(
          makeSegment('p', curText, segNo, { kind: 'paragraph', runs: [{ text: curText }] }, rect)
        )
        curLines = []
      }

      let li = 0
      while (li < lines.length) {
        const line = lines[li]
        const text = line.text.trim()
        const nextLine = lines[li + 1]

        // 连续的列表项：`•`/`-` 无序，`1.`/`2.` 有序
        if (/^[•\-\*]\s/.test(text) || /^\d+[.)]\s/.test(text)) {
          const ordered = /^\d+[.)]\s/.test(text)
          const items: { runs: Inline[] }[] = []
          while (li < lines.length) {
            const t = lines[li].text.trim()
            if (ordered && !/^\d+[.)]\s/.test(t)) break
            if (!ordered && !/^[•\-\*]\s/.test(t)) break
            items.push({ runs: [{ text: t.replace(/^[•\-\*]\s|^\d+[.)]\s/, '') }] })
            li++
          }
          flushPara(pageNo)
          segs.push(makeSegment('list', '', pageNo, { kind: 'list', ordered, items }))
          continue
        }

        // 连续表格行：`a | b | c`
        if (isTableRow(line)) {
          const tableRows: Inline[][][] = []
          while (li < lines.length && isTableRow(lines[li])) {
            tableRows.push(
              lines[li].text
                .split(/\s*\|\s*/)
                .filter((c) => c.trim().length > 0)
                .map((c) => [{ text: c.trim() }])
            )
            li++
          }
          flushPara(pageNo)
          const header = tableRows.shift() ?? []
          segs.push(makeSegment('table', '', pageNo, { kind: 'table', header, rows: tableRows }))
          continue
        }

        const isHeading = line.height >= bodyHeight * 1.18
        if (isHeading) {
          flushPara(pageNo)
          const pw = line.pageWidth || 612
          const ph = line.pageHeight || 792
          const rect = {
            x: Math.max(0, Math.min(100, (line.minX / pw) * 100)),
            y: Math.max(0, Math.min(100, ((ph - line.maxY) / ph) * 100)),
            width: Math.max(2, Math.min(100, ((line.maxX - line.minX) / pw) * 100)),
            height: Math.max(1, Math.min(100, ((line.maxY - line.minY) / ph) * 100))
          }
          segs.push(
            makeSegment('h', text, pageNo, {
              kind: 'heading',
              level: 2,
              runs: [{ text }]
            }, rect)
          )
          li++
          continue
        }

        const gapToNext = nextLine ? line.y - (nextLine.y + nextLine.height) : 0
        const paraBreak = gapToNext > Math.max(line.height, 2) * 0.7
        curLines.push(line)
        if (paraBreak || /[.!?;:]$/.test(text)) {
          flushPara(pageNo)
        }
        li++
      }
      flushPara(pageNo)
    }
  } finally {
    await (doc as unknown as { loadingTask: { destroy: () => Promise<void> } }).loadingTask.destroy()
  }
  return segs
}

/* ================= DOCX 解析（保留表格/列表/样式） ================= */

export async function parseDocx(data: Uint8Array): Promise<Segment[]> {
  const mammoth = (await import('mammoth')).default
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  const dom = new DOMParser().parseFromString(result.value, 'text/html')
  const segs: Segment[] = []

  const headingLevel = (tag: string): 1 | 2 | 3 | 4 | 5 | 6 | null => {
    const m = /^h([1-6])$/.exec(tag)
    return m ? (Number(m[1]) as 1 | 2 | 3 | 4 | 5 | 6) : null
  }

  const walk = (node: Element | ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) return
    const el = node as Element
    const tag = el.tagName?.toLowerCase()

    const lvl = headingLevel(tag)
    if (lvl) {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('h', t, undefined, { kind: 'heading', level: lvl, runs: elementRuns(el) }))
      return
    }
    if (tag === 'p') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('p', t, undefined, { kind: 'paragraph', runs: elementRuns(el) }))
      return
    }
    if (tag === 'ol' || tag === 'ul') {
      const ordered = tag === 'ol'
      const items: { runs: Inline[] }[] = []
      for (const liEl of Array.from(el.querySelectorAll(':scope > li'))) {
        const t = liEl.textContent?.trim()
        if (!t) continue
        items.push({ runs: elementRuns(liEl) })
      }
      if (items.length) {
        const fullText = ordered
          ? items.map((it, i) => `${i + 1}. ${it.runs.map((r) => r.text).join('')}`).join(' ')
          : items.map((it) => `• ${it.runs.map((r) => r.text).join('')}`).join(' ')
        segs.push(makeSegment('list', fullText, undefined, { kind: 'list', ordered, items }))
      }
      return
    }
    if (tag === 'table') {
      const rows: Inline[][][] = []
      for (const tr of Array.from(el.querySelectorAll(':scope > tr'))) {
        const cells: Inline[][] = []
        for (const td of Array.from(tr.querySelectorAll(':scope > td, :scope > th'))) {
          const runs = elementRuns(td)
          if (runs.length) cells.push(runs)
          else cells.push([{ text: '' }])
        }
        if (cells.length) rows.push(cells)
      }
      if (rows.length) {
        const fullText = rows.map((r) => r.map((c) => c.map((x) => x.text).join('')).join(' | ')).join(' ')
        const header = rows[0]
        const body = rows.slice(1)
        segs.push(makeSegment('table', fullText, undefined, { kind: 'table', header, rows: body }))
      }
      return
    }
    if (tag === 'blockquote') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('blockquote', t, undefined, { kind: 'blockquote', runs: elementRuns(el) }))
      return
    }
    if (tag === 'pre') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('code', t, undefined, { kind: 'code', text: t }))
      return
    }
    if (tag === 'img') {
      const name = el.getAttribute('alt') || el.getAttribute('src') || '图片'
      segs.push(makeSegment('image', name, undefined, { kind: 'image', name }))
      return
    }
    for (const child of Array.from(el.childNodes)) walk(child)
  }

  for (const child of Array.from(dom.body.childNodes)) walk(child)
  return segs
}

/* ================= MD / TXT 解析 ================= */

export function parseText(name: string, text: string): Segment[] {
  const isMd = /\.(md|markdown)$/i.test(name)
  if (isMd) return parseMd(text)
  // 纯 TXT：按空行分段
  return splitParagraphs(text).map((p) => makeParagraphSegment(p))
}

/** 用 marked.lexer 的 AST 解析 Markdown，保留标题/列表/表格/代码/引用 */
function parseMd(text: string): Segment[] {
  const tokens = marked.lexer(text) as MarkedToken[]
  const segs: Segment[] = []

  const walk = (nodes: MarkedToken[]): void => {
    for (const t of nodes) {
      if (t.type === 'space' || t.type === 'hr') continue
      if (t.type === 'heading') {
        const inner = parseInlineTokens(t.tokens ?? [])
        segs.push(
          makeSegment('h', inlinePlain(inner), undefined, {
            kind: 'heading',
            level: (t.depth as 1 | 2 | 3 | 4 | 5 | 6) ?? 2,
            runs: inner
          })
        )
      } else if (t.type === 'paragraph') {
        const inner = parseInlineTokens(t.tokens ?? [])
        if (inner.length) segs.push(makeSegment('p', inlinePlain(inner), undefined, { kind: 'paragraph', runs: inner }))
      } else if (t.type === 'list') {
        const ordered = (t as MarkedList).ordered ?? false
        const items = ((t as MarkedList).items ?? [])
          .map((it) => ({ runs: parseInlineTokens(it.tokens ?? []) }))
          .filter((it) => it.runs.length)
        if (items.length) {
          const full = ordered
            ? items.map((it, i) => `${i + 1}. ${inlinePlain(it.runs)}`).join(' ')
            : items.map((it) => `• ${inlinePlain(it.runs)}`).join(' ')
          segs.push(makeSegment('list', full, undefined, { kind: 'list', ordered, items }))
        }
      } else if (t.type === 'table') {
        const tbl = t as MarkedTable
        const cellRuns = (ct: { text?: string; tokens?: MarkedToken[] }): Inline[] =>
          parseInlineTokens(ct.tokens ?? [])
        const header: Inline[][] = (tbl.header ?? []).map((c) => cellRuns(c))
        const rows: Inline[][][] = (tbl.rows ?? []).map((r) => (r ?? []).map((c) => cellRuns(c)))
        const full = [header, ...rows]
          .map((r) => r.map((c) => inlinePlain(c)).join(' | '))
          .join(' ')
        segs.push(makeSegment('table', full, undefined, { kind: 'table', header, rows }))
      } else if (t.type === 'code') {
        const raw = (t as MarkedCode).text ?? ''
        segs.push(
          makeSegment('code', raw, undefined, {
            kind: 'code',
            lang: (t as MarkedCode).lang || undefined,
            text: raw
          })
        )
      } else if (t.type === 'blockquote') {
        const inner = parseInlineTokens(t.tokens ?? [])
        if (inner.length) segs.push(makeSegment('blockquote', inlinePlain(inner), undefined, { kind: 'blockquote', runs: inner }))
      } else if (t.type === 'image') {
        const tk = t as { text?: string; href?: string }
        const name = tk.text ?? tk.href ?? '图片'
        segs.push(makeSegment('image', name, undefined, { kind: 'image', name }))
      } else if (t.type === 'text') {
        const raw = (t.text ?? '').trim()
        if (raw) segs.push(makeSegment('p', raw, undefined, { kind: 'paragraph', runs: [{ text: raw }] }))
      }
    }
  }
  walk(tokens)
  return segs
}

interface MarkedToken {
  type: string
  text?: string
  tokens?: MarkedToken[]
  depth?: number
  [k: string]: unknown
}
interface MarkedList extends MarkedToken {
  ordered: boolean
  items: { text: string; tokens?: MarkedToken[] }[]
}
interface MarkedTable extends MarkedToken {
  header?: { text: string; tokens?: MarkedToken[] }[]
  rows?: { text: string; tokens?: MarkedToken[] }[][]
}
interface MarkedCode extends MarkedToken {
  lang?: string
  text: string
}

// marked 以 ESM 导出，见顶部静态 import { marked }
/** 解析 marked 的行内 token 为 Inline[]（递归处理嵌套 text/paragraph/strong/em/link） */
function parseInlineTokens(tokens: unknown[]): Inline[] {
  const runs: Inline[] = []
  for (const t of tokens as MarkedInlineToken[]) {
    switch (t.type) {
      case 'text':
      case 'paragraph': {
        // 若内部嵌套 tokens（如 list_item > text > [bold, ...]），先取内部
        const innerTokens = (t.tokens ?? t.children ?? []) as MarkedInlineToken[]
        if (innerTokens.length) {
          runs.push(...parseInlineTokens(innerTokens))
        } else if (t.text) {
          runs.push({ text: t.text })
        }
        break
      }
      case 'strong':
      case 'em': {
        const inner = parseInlineTokens((t.tokens ?? t.children ?? []) as MarkedInlineToken[])
        const pass = t.type === 'strong' ? { bold: true } : { italic: true }
        for (const r of inner) Object.assign(r, pass)
        runs.push(...inner)
        break
      }
      case 'codespan':
        runs.push({ text: t.text ?? '', code: true })
        break
      case 'link': {
        const inner = parseInlineTokens((t.tokens ?? t.children ?? []) as MarkedInlineToken[])
        for (const r of inner) r.link = t.href
        runs.push(...inner)
        break
      }
      default:
        if (t.text) runs.push({ text: t.text })
        else if (t.tokens?.length) runs.push(...parseInlineTokens(t.tokens as MarkedInlineToken[]))
    }
  }
  return runs.filter((r) => r.text.trim().length > 0)
}

interface MarkedInlineToken {
  type: string
  text?: string
  href?: string
  tokens?: MarkedInlineToken[]
  children?: MarkedInlineToken[]
}

function inlinePlain(runs: Inline[]): string {
  return runs.map((r) => r.text).join('')
}

/* ================= 统一入口 ================= */

export async function parseAnyFile(
  name: string,
  data: Uint8Array,
  onProgress?: (done: number, total: number) => void
): Promise<Segment[]> {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf') return parsePdf(data, onProgress)
  if (ext === 'docx') return parseDocx(data)
  if (ext === 'txt' || ext === 'md' || ext === 'markdown') {
    const text = new TextDecoder('utf-8').decode(data)
    return parseText(name, text)
  }
  throw new Error(`暂不支持 ${ext} 格式`)
}