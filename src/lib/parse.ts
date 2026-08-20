import { marked } from 'marked'
import type { Segment, SegmentType, Block, Inline } from './types'
import { blockText } from './types'
import { runDocLayoutAnalysis, getDocLayoutSession, type DetectedLayoutBox } from './docLayoutModel'

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
  colIndex: number
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

  const rawItems: TextItem[] = []
  let maxH = 8
  for (const it of content.items as unknown as PdfTextItemLike[]) {
    const str = it.str ?? ''
    if (!str) continue
    const t = it.transform ?? [1, 0, 0, 1, 0, 0]
    const h = Math.abs(t[3] || 0) || 9
    const w = it.width || str.length * h * 0.55
    if (h > maxH) maxH = h
    rawItems.push({
      str,
      x: t[4] || 0,
      y: t[5] || 0,
      width: w,
      height: h,
      bold: /bold/i.test(it.fontName ?? '')
    })
  }

  // 1. 过滤页眉页脚与边界元数据噪声（如 arXiv 顶栏标号、独立页码等）
  const cleanItems = rawItems.filter((it) => {
    const s = it.str.trim()
    if (!s) return false
    // 过滤顶部/底部极边缘的 arXiv 标签或单数字页码
    if ((it.y > pageHeight * 0.965 || it.y < pageHeight * 0.035) && (/^arxiv:/i.test(s) || /^\d+$/.test(s))) {
      return false
    }
    return true
  })

  if (!cleanItems.length) return []

  // 2. 初始按 y 坐标降序（从上到下）、x 升序（从左到右）排序
  cleanItems.sort((a, b) => b.y - a.y || a.x - b.x)

  // 3. 聚合成原子行片段（避免将同高度但分属左右两栏的文字拼进同一行）
  const lineFrags: {
    items: TextItem[]
    y: number
    height: number
    minX: number
    maxX: number
    minY: number
    maxY: number
    text: string
  }[] = []

  for (const item of cleanItems) {
    const last = lineFrags[lineFrags.length - 1]
    const sameY = last && Math.abs(item.y - last.y) <= Math.max(item.height, last.height) * 0.55
    // 栏间隙检测：若同一 Y 高度但横向跳跃跨越页面中线（如左栏末尾到右栏开头），则不归为同一行
    const isCrossingColumnGutter =
      last &&
      sameY &&
      last.maxX < pageWidth * 0.52 &&
      item.x > pageWidth * 0.48 &&
      item.x - last.maxX > pageWidth * 0.04

    if (sameY && !isCrossingColumnGutter) {
      last.items.push(item)
      last.height = Math.max(last.height, item.height)
      last.minX = Math.min(last.minX, item.x)
      last.maxX = Math.max(last.maxX, item.x + item.width)
      last.minY = Math.min(last.minY, item.y)
      last.maxY = Math.max(last.maxY, item.y + item.height)
    } else {
      lineFrags.push({
        items: [item],
        y: item.y,
        height: item.height,
        minX: item.x,
        maxX: item.x + item.width,
        minY: item.y,
        maxY: item.y + item.height,
        text: ''
      })
    }
  }

  // 构建各片段的文本内容
  for (const frag of lineFrags) {
    frag.items.sort((a, b) => a.x - b.x)
    let text = ''
    let prevEnd = 0
    for (const it of frag.items) {
      if (text && it.x > prevEnd + it.height * 0.22) text += ' '
      text += it.str
      prevEnd = it.x + it.width
    }
    frag.text = text.trim()
  }

  const validFrags = lineFrags.filter((f) => f.text.length > 0)
  if (!validFrags.length) return []

  // 4. 多栏排版识别：统计左右两栏分布
  let leftColCount = 0
  let rightColCount = 0
  for (const f of validFrags) {
    const isFull = f.maxX - f.minX > pageWidth * 0.58 || (f.minX < pageWidth * 0.35 && f.maxX > pageWidth * 0.65)
    if (!isFull) {
      if (f.maxX <= pageWidth * 0.53) leftColCount++
      else if (f.minX >= pageWidth * 0.47) rightColCount++
    }
  }

  const isMultiColumn = leftColCount >= 3 && rightColCount >= 3

  // 5. 按人类阅读顺序重构阅读流
  let orderedFrags: { frag: (typeof validFrags)[0]; colIndex: number }[] = []

  if (!isMultiColumn) {
    validFrags.sort((a, b) => b.y - a.y || a.minX - b.minX)
    orderedFrags = validFrags.map((f) => ({ frag: f, colIndex: 0 }))
  } else {
    // 将页面垂直切分为带（Bands）：通栏带（标题/摘要/跨栏图表）与分栏带（双栏正文）
    type BandType = {
      type: 'full' | 'columns'
      frags: (typeof validFrags)[0][]
    }

    const bands: BandType[] = []
    let curColFrags: (typeof validFrags)[0][] = []

    for (const f of validFrags) {
      const isFull = f.maxX - f.minX > pageWidth * 0.58 || (f.minX < pageWidth * 0.35 && f.maxX > pageWidth * 0.65)
      if (isFull) {
        if (curColFrags.length > 0) {
          bands.push({ type: 'columns', frags: curColFrags })
          curColFrags = []
        }
        bands.push({ type: 'full', frags: [f] })
      } else {
        curColFrags.push(f)
      }
    }
    if (curColFrags.length > 0) {
      bands.push({ type: 'columns', frags: curColFrags })
    }

    for (const band of bands) {
      if (band.type === 'full') {
        for (const f of band.frags) {
          orderedFrags.push({ frag: f, colIndex: 0 })
        }
      } else {
        const lefts: (typeof validFrags)[0][] = []
        const rights: (typeof validFrags)[0][] = []
        for (const f of band.frags) {
          const midX = (f.minX + f.maxX) / 2
          if (midX < pageWidth * 0.5) {
            lefts.push(f)
          } else {
            rights.push(f)
          }
        }
        // 左栏从上到下
        lefts.sort((a, b) => b.y - a.y || a.minX - b.minX)
        for (const f of lefts) {
          orderedFrags.push({ frag: f, colIndex: 1 })
        }
        // 右栏从上到下
        rights.sort((a, b) => b.y - a.y || a.minX - b.minX)
        for (const f of rights) {
          orderedFrags.push({ frag: f, colIndex: 2 })
        }
      }
    }
  }

  return orderedFrags.map(({ frag, colIndex }) => ({
    items: frag.items,
    y: frag.y,
    height: frag.height,
    text: frag.text,
    minX: frag.minX,
    maxX: frag.maxX,
    minY: frag.minY,
    maxY: frag.maxY,
    pageWidth,
    pageHeight,
    colIndex
  }))
}

/** 检测一行是否 `<cell> | <cell>` 的对齐表格行 */
function isTableRow(line: TextLine): boolean {
  const m = line.text.match(/^(.*?)\s\|(.+)$/)
  if (!m) return false
  const cells = line.text.split(/\s*\|\s*/)
  return cells.length >= 2 && cells.every((c) => c.trim().length > 0)
}

import { processFigureWithPaddle } from './paddleOcrModel'

/** 将 DocLayout-YOLO 的 AI 版面框与 PDF 矢量文字精准空间求交融合，图像部分交由 PaddleOCR 处理 */
async function buildSegmentsFromLayout(
  boxes: DetectedLayoutBox[],
  lines: TextLine[],
  pageNo: number,
  pageWidth: number,
  pageHeight: number,
  canvas?: HTMLCanvasElement
): Promise<Segment[]> {
  const result: Segment[] = []
  const assignedLineIndices = new Set<number>()

  for (const box of boxes) {
    const boxPxX1 = box.box.x1 - 4
    const boxPxX2 = box.box.x2 + 4
    const boxPxY1 = box.box.y1 - 4
    const boxPxY2 = box.box.y2 + 4

    // 1. 对于插图和图表区域：使用 PaddleOCR 进行图像级文字识别
    if (box.category === 'figure' || box.category === 'table') {
      // 标记落在图表区域内的散落矢量字符为已占用（避免图内乱飞碎片框）
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        const lineTopDownY1 = pageHeight - line.maxY
        const lineTopDownY2 = pageHeight - line.minY
        const lineMidX = (line.minX + line.maxX) / 2
        const lineMidY = (lineTopDownY1 + lineTopDownY2) / 2

        if (lineMidX >= boxPxX1 && lineMidX <= boxPxX2 && lineMidY >= boxPxY1 && lineMidY <= boxPxY2) {
          assignedLineIndices.add(li)
        }
      }

      // 如果有渲染 Canvas，调用 PaddleOCR 识别图像中的文字
      if (canvas) {
        try {
          const figureSegs = await processFigureWithPaddle(canvas, box.box, pageNo, pageWidth, pageHeight)
          if (figureSegs.length > 0) {
            result.push(...figureSegs)
          }
        } catch (err) {
          console.warn('[PaddleOCR] 图表文字识别异常:', err)
        }
      }
      continue
    }

    // 独立公式与页眉页脚废弃区：标记为已消耗
    if (box.category === 'isolate_formula' || box.category === 'abandon') {
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        const lineTopDownY1 = pageHeight - line.maxY
        const lineTopDownY2 = pageHeight - line.minY
        const lineMidX = (line.minX + line.maxX) / 2
        const lineMidY = (lineTopDownY1 + lineTopDownY2) / 2

        if (lineMidX >= boxPxX1 && lineMidX <= boxPxX2 && lineMidY >= boxPxY1 && lineMidY <= boxPxY2) {
          assignedLineIndices.add(li)
        }
      }
      continue
    }

    // 2. 收集属于当前 AI 版面框的正文/标题/图注行
    const matchedLines: TextLine[] = []
    for (let li = 0; li < lines.length; li++) {
      if (assignedLineIndices.has(li)) continue
      const line = lines[li]
      const lineTopDownY1 = pageHeight - line.maxY
      const lineTopDownY2 = pageHeight - line.minY
      const lineMidX = (line.minX + line.maxX) / 2
      const lineMidY = (lineTopDownY1 + lineTopDownY2) / 2

      if (lineMidX >= boxPxX1 && lineMidX <= boxPxX2 && lineMidY >= boxPxY1 && lineMidY <= boxPxY2) {
        matchedLines.push(line)
        assignedLineIndices.add(li)
      }
    }

    if (matchedLines.length === 0) continue

    // 3. 在版面框内按从上到下的 Top-Down 屏幕坐标排序
    matchedLines.sort((a, b) => {
      const aTop = pageHeight - a.maxY
      const bTop = pageHeight - b.maxY
      return aTop - bTop || a.minX - b.minX
    })

    // 4. 根据行间距切分自然段
    const paragraphs: TextLine[][] = []
    let currentPara: TextLine[] = [matchedLines[0]]

    for (let i = 1; i < matchedLines.length; i++) {
      const prev = matchedLines[i - 1]
      const curr = matchedLines[i]
      const prevBottom = pageHeight - prev.minY
      const currTop = pageHeight - curr.maxY
      const gap = currTop - prevBottom
      const avgH = Math.max(prev.height, curr.height)

      const isLargeGap = gap > avgH * 0.65
      const isIndentedNewPara = /[.!?;:。！？]$/.test(prev.text.trim()) && curr.minX > prev.minX + 6

      if (isLargeGap || isIndentedNewPara) {
        paragraphs.push(currentPara)
        currentPara = [curr]
      } else {
        currentPara.push(curr)
      }
    }
    if (currentPara.length > 0) {
      paragraphs.push(currentPara)
    }

    // 5. 为每个自然段计算 100% 严格贴合文字的紧密 Bounding Box
    for (const paraLines of paragraphs) {
      const text = paraLines.map((l) => l.text).join(' ').trim()
      if (!text || text.length < 2) continue

      const minX = Math.min(...paraLines.map((l) => l.minX))
      const maxX = Math.max(...paraLines.map((l) => l.maxX))
      const topDownY1 = Math.min(...paraLines.map((l) => pageHeight - l.maxY))
      const topDownY2 = Math.max(...paraLines.map((l) => pageHeight - l.minY))

      const tightRect = {
        x: Math.max(0, Math.min(100, (minX / pageWidth) * 100)),
        y: Math.max(0, Math.min(100, (topDownY1 / pageHeight) * 100)),
        width: Math.max(2, Math.min(100, ((maxX - minX) / pageWidth) * 100)),
        height: Math.max(1, Math.min(100, ((topDownY2 - topDownY1) / pageHeight) * 100))
      }

      if (box.category === 'title') {
        result.push(
          makeSegment('h', text, pageNo, {
            kind: 'heading',
            level: 1,
            runs: [{ text }]
          }, tightRect)
        )
      } else {
        result.push(
          makeSegment('p', text, pageNo, {
            kind: 'paragraph',
            runs: [{ text }]
          }, tightRect)
        )
      }
    }
  }

  // 6. 补充未能匹配进任何 AI 检测框的残留正文行
  const unassignedLines = lines.filter((_, idx) => !assignedLineIndices.has(idx))
  if (unassignedLines.length > 0) {
    unassignedLines.sort((a, b) => {
      const aTop = pageHeight - a.maxY
      const bTop = pageHeight - b.maxY
      return aTop - bTop || a.minX - b.minX
    })

    let cur: TextLine[] = []
    for (const line of unassignedLines) {
      if (line.text.trim().length < 15 && !/[.!?;:]$/.test(line.text)) continue
      cur.push(line)
      if (/[.!?;:]$/.test(line.text)) {
        const curText = cur.map((l) => l.text).join(' ').trim()
        if (curText) {
          const minX = Math.min(...cur.map((l) => l.minX))
          const maxX = Math.max(...cur.map((l) => l.maxX))
          const topDownY1 = Math.min(...cur.map((l) => pageHeight - l.maxY))
          const topDownY2 = Math.max(...cur.map((l) => pageHeight - l.minY))
          const rect = {
            x: Math.max(0, Math.min(100, (minX / pageWidth) * 100)),
            y: Math.max(0, Math.min(100, (topDownY1 / pageHeight) * 100)),
            width: Math.max(2, Math.min(100, ((maxX - minX) / pageWidth) * 100)),
            height: Math.max(1, Math.min(100, ((topDownY2 - topDownY1) / pageHeight) * 100))
          }
          result.push(makeSegment('p', curText, pageNo, { kind: 'paragraph', runs: [{ text: curText }] }, rect))
        }
        cur = []
      }
    }
    if (cur.length > 0) {
      const curText = cur.map((l) => l.text).join(' ').trim()
      if (curText && curText.length >= 15) {
        const minX = Math.min(...cur.map((l) => l.minX))
        const maxX = Math.max(...cur.map((l) => l.maxX))
        const topDownY1 = Math.min(...cur.map((l) => pageHeight - l.maxY))
        const topDownY2 = Math.max(...cur.map((l) => pageHeight - l.minY))
        const rect = {
          x: Math.max(0, Math.min(100, (minX / pageWidth) * 100)),
          y: Math.max(0, Math.min(100, (topDownY1 / pageHeight) * 100)),
          width: Math.max(2, Math.min(100, ((maxX - minX) / pageWidth) * 100)),
          height: Math.max(1, Math.min(100, ((topDownY2 - topDownY1) / pageHeight) * 100))
        }
        result.push(makeSegment('p', curText, pageNo, { kind: 'paragraph', runs: [{ text: curText }] }, rect))
      }
    }
  }

  return result
}

export async function parsePdf(data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Segment[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  // 使用克隆的独立 buffer，防止 worker 传输后将主线程 ArrayBuffer 脱离 (detach)
  const doc = await pdfjs.getDocument({ data: data.slice(0) }).promise
  const segs: Segment[] = []
  try {
    // 预热检查 AI 版面模型
    const hasAiModel = await getDocLayoutSession()

    for (let i = 0; i < doc.numPages; i++) {
      const pageNo = i + 1
      const page = await doc.getPage(pageNo)
      const lines = await extractPageLines(page)
      const viewport = page.getViewport({ scale: 1.0 })
      onProgress?.(pageNo, doc.numPages)

      // 1. 优先尝试使用 DocLayout-YOLO AI 版面识别 + PaddleOCR 图像处理
      if (hasAiModel) {
        try {
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          const ctx = canvas.getContext('2d', { willReadFrequently: true })
          if (ctx) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            await page.render({ canvasContext: ctx, viewport, intent: 'display', canvas }).promise
            const boxes = await runDocLayoutAnalysis(canvas)
            if (boxes && boxes.length > 0) {
              const aiSegs = await buildSegmentsFromLayout(boxes, lines, pageNo, viewport.width, viewport.height, canvas)
              if (aiSegs.length > 0) {
                segs.push(...aiSegs)
                continue
              }
            }
          }
        } catch (err) {
          console.warn(`[DocLayout AI] 第 ${pageNo} 页版面分析异常，自动降级为规则分栏:`, err)
        }
      }

      // 2. 降级回退：使用规则分栏算法
      const bodyHeight = lines.reduce((m, l) => Math.max(m, l.height), 8)
      let curLines: TextLine[] = []
      const flushPara = (segNo: number): void => {
        if (!curLines.length) return
        const curText = curLines.map((l) => l.text).join(' ').trim()
        if (!curText) {
          curLines = []
          return
        }

        const isCaption = /^(Figure|Fig\.|Table|图|表)\s*\d+[:.]/i.test(curText)
        const isHeadingCandidate = curLines.some((l) => l.height >= bodyHeight * 1.15)
        const isShortNoise = curText.length < 15 && !isCaption && !isHeadingCandidate && !/[.!?;:]$/.test(curText)

        if (isShortNoise) {
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

        // 图表说明检测 (Figure Caption / Table Caption)
        const isCaptionStart = /^(Figure|Fig\.|Table|图|表)\s*\d+[:.]/i.test(text)
        if (isCaptionStart) {
          flushPara(pageNo)
          curLines.push(line)
          while (li + 1 < lines.length) {
            const nextL = lines[li + 1]
            const nextT = nextL.text.trim()
            if (nextL.height >= bodyHeight * 1.15 || /^(Figure|Fig\.|Table|图|表)\s*\d+[:.]/i.test(nextT)) {
              break
            }
            const gap = line.y - (nextL.y + nextL.height)
            if (gap > Math.max(line.height, 2) * 1.5 || nextL.colIndex !== line.colIndex) {
              break
            }
            curLines.push(nextL)
            li++
            if (/[.!?;:]$/.test(nextT)) break
          }
          flushPara(pageNo)
          li++
          continue
        }

        curLines.push(line)

        let shouldFlush = false
        if (!nextLine) {
          shouldFlush = true
        } else {
          const isColSwitch =
            line.colIndex !== nextLine.colIndex ||
            nextLine.y > line.y + line.height * 2 ||
            Math.abs(line.minX - nextLine.minX) > (line.pageWidth || 612) * 0.25

          const gapToNext = line.y - (nextLine.y + nextLine.height)
          const paraBreak = gapToNext > Math.max(line.height, 2) * 0.75

          const endsWithPunct =
            /[.!?。！？:：]$/.test(text) && (gapToNext > Math.max(line.height, 2) * 0.35 || isColSwitch)

          if (isColSwitch || paraBreak || endsWithPunct) {
            shouldFlush = true
          }
        }

        if (shouldFlush) {
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