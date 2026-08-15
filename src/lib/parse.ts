import type { Segment } from './types'

let uid = 0

export function newId(): string {
  return `seg_${Date.now()}_${++uid}`
}

export function makeSegment(type: 'h' | 'p', text: string): Segment {
  return { id: newId(), type, text, translation: '', translating: false }
}

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

interface TextItem {
  str: string
  x: number
  y: number
  height: number
  bold: boolean
}

interface TextLine {
  items: TextItem[]
  y: number
  height: number
  text: string
}

interface PdfTextItemLike {
  str?: string
  transform?: number[]
  fontName?: string
}

function extractPdfLines(pdf: import('pdfjs-dist').PDFDocumentProxy): Promise<TextLine[][]> {
  return Promise.all(
    Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1).then(async (page) => {
      const content = await page.getTextContent()
      const items: TextItem[] = []
      let maxH = 8
      for (const it of content.items as unknown as PdfTextItemLike[]) {
        const str = it.str ?? ''
        if (!str) continue
        const t = it.transform ?? [1, 0, 0, 1, 0, 0]
        const h = Math.abs(t[3] || 0)
        if (h > maxH) maxH = h
        items.push({
          str,
          x: t[4],
          y: t[5],
          height: h,
          bold: /bold/i.test(it.fontName ?? '')
        })
      }
      items.sort((a, b) => a.y - b.y || a.x - b.x)

      const lines: TextLine[] = []
      for (const item of items) {
        const last = lines[lines.length - 1]
        if (last && Math.abs(item.y - last.y) <= Math.max(item.height, last.height) * 0.5) {
          last.items.push(item)
          last.height = Math.max(last.height, item.height)
        } else {
          lines.push({ items: [item], y: item.y, height: item.height, text: '' })
        }
      }

      for (const line of lines) {
        line.items.sort((a, b) => a.x - b.x)
        let text = ''
        let prevEnd = 0
        for (const it of line.items) {
          if (text && it.x > prevEnd + it.height * 0.25) text += ' '
          text += it.str
          prevEnd = it.x + it.str.length * it.height * 0.55
        }
        line.text = text
      }
      return lines.filter((l) => l.text.trim().length > 0)
    }))
  )
}

export async function parsePdf(data: Uint8Array, onProgress?: (done: number, total: number) => void): Promise<Segment[]> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const doc = await pdfjs.getDocument({ data }).promise
  const segs: Segment[] = []
  try {
    const pageLines = await extractPdfLines(doc)
    for (let i = 0; i < pageLines.length; i++) {
      const lines = pageLines[i]
      const bodyHeight = lines.reduce((m, l) => Math.max(m, l.height), 8)
      let cur = ''
      for (let li = 0; li < lines.length; li++) {
        const line = lines[li]
        const text = line.text.trim()
        if (!text) continue
        const next = lines[li + 1]
        const isHeading = line.height >= bodyHeight * 1.18
        const gapToNext = next ? next.y - (line.y + line.height) : 0
        const paraBreak = gapToNext > Math.max(line.height, 2) * 0.7
        if (isHeading) {
          if (cur.trim()) segs.push(makeSegment('p', cur.trim()))
          cur = ''
          segs.push(makeSegment('h', text))
          continue
        }
        if (cur) {
          if (paraBreak || /[.!?;:]$/.test(cur)) {
            segs.push(makeSegment('p', cur.trim()))
            cur = text
          } else {
            cur += ' ' + text
          }
        } else {
          cur = text
        }
      }
      if (cur.trim()) segs.push(makeSegment('p', cur.trim()))
      onProgress?.(i + 1, pageLines.length)
    }
  } finally {
    await (doc as unknown as { loadingTask: { destroy: () => Promise<void> } }).loadingTask.destroy()
  }
  return segs
}

export async function parseDocx(data: Uint8Array): Promise<Segment[]> {
  const mammoth = (await import('mammoth')).default
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
  const dom = new DOMParser().parseFromString(result.value, 'text/html')
  const segs: Segment[] = []
  const walk = (node: Element | ChildNode): void => {
    if (node.nodeType === Node.TEXT_NODE) return
    const el = node as Element
    const tag = el.tagName?.toLowerCase()
    if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4' || tag === 'h5' || tag === 'h6') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('h', t))
    } else if (tag === 'p') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('p', t))
    } else if (tag === 'li') {
      const t = el.textContent?.trim()
      if (t) segs.push(makeSegment('p', `• ${t}`))
    } else if (tag === 'table') {
      for (const row of Array.from(el.querySelectorAll('tr'))) {
        const cells = Array.from(row.querySelectorAll('td, th')).map((c) => c.textContent?.trim() ?? '')
        if (cells.length) segs.push(makeSegment('p', cells.join(' | ')))
      }
    } else {
      for (const child of Array.from(el.childNodes)) walk(child)
    }
  }
  for (const child of Array.from(dom.body.childNodes)) walk(child)
  return segs
}

export function parseText(name: string, text: string): Segment[] {
  const isMd = /\.(md|markdown)$/i.test(name)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const segs: Segment[] = []
  let cur = ''
  for (const line of lines) {
    const t = line.trim()
    if (isMd && /^#{1,4}\s+/.test(t)) {
      if (cur) {
        segs.push(makeSegment('p', cur))
        cur = ''
      }
      segs.push(makeSegment('h', t.replace(/^#+\s*/, '')))
      continue
    }
    if (!t) {
      if (cur) {
        segs.push(makeSegment('p', cur))
        cur = ''
      }
      continue
    }
    cur = cur ? `${cur} ${t}` : t
  }
  if (cur) segs.push(makeSegment('p', cur))
  return segs
}

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
