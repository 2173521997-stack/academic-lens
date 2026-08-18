import type { Segment } from './types'
import { inlineText } from './types'
import { TextRun, Paragraph, Document, Packer, Table, TableRow, TableCell, WidthType, HeadingLevel } from 'docx'

/** 段落的可读源文本（块优先，回退平铺） */
function segSource(s: Segment): string {
  return s.text || inlineText('runs' in s.block ? s.block.runs : [])
}

/* ================= 纯文本译文（保留旧 API） ================= */

export function buildPlainText(segments: Segment[]): string {
  const blocks: string[] = []
  for (const s of segments) {
    const content = (s.translation || segSource(s)).trim()
    if (!content) continue
    blocks.push(s.type === 'h' ? `【${content}】` : content)
  }
  return blocks.join('\n\n')
}

export function buildPlainTextHeader(doc: { name: string }, segments: Segment[]): string {
  const lines: string[] = []
  lines.push(`# ${doc.name}`)
  lines.push('')
  lines.push(`> 中文译文 · Academic Lens · ${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(buildPlainText(segments))
  return lines.join('\n')
}

/* ================= 双语对照 Markdown ================= */

/** 双语对照 md：每块一个两列表格（左侧原文 / 右侧译文），保留块类型标注 */
export function buildBilingualMarkdown(doc: { name: string }, segments: Segment[]): string {
  const lines: string[] = []
  lines.push(`# ${doc.name}`)
  lines.push('')
  lines.push(`> 双语对照 · Academic Lens · ${new Date().toLocaleString('zh-CN')}`)
  lines.push('')
  lines.push('---')
  lines.push('')
  for (const s of segments) {
    const src = segSource(s)
    const dst = (s.translation || '').trim() || '（未翻译）'
    if (s.type === 'h') {
      lines.push(`## ${src}`)
      lines.push(`> ${dst}`)
      lines.push('')
      continue
    }
    if (s.type === 'code') {
      lines.push('```')
      lines.push(src)
      lines.push('```')
      lines.push('')
      continue
    }
    if (s.type === 'image' || s.type === 'math') {
      lines.push(`**[${s.type}] ${src}**`)
      lines.push('')
      continue
    }
    lines.push(`| 原文 | 译文 |`)
    lines.push(`| --- | --- |`)
    lines.push(`| ${src.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} | ${dst.replace(/\|/g, '\\|').replace(/\n/g, '<br>')} |`)
    lines.push('')
  }
  return lines.join('\n')
}

/* ================= 双语对照 DOCX ================= */

function isHeadingType(t: string): boolean {
  return t === 'h'
}

function textRunsOf(content: string): import('docx').TextRun[] {
  return [new TextRun({ text: content, size: 22 })]
}

function cellText(content: string, bold = false): import('docx').Paragraph[] {
  return [new Paragraph({ children: [new TextRun({ text: content, bold, size: 20 })] })]
}

/** 生成双语对照 DOCX（每个块一个双列表格：左原文 / 右译文），返回 base64 */
export async function buildDocxBase64(segments: Segment[]): Promise<string> {
  const children: unknown[] = []
  for (const s of segments) {
    const src = segSource(s)
    const dst = (s.translation || '').trim() || '（未翻译）'

    if (isHeadingType(s.type)) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: textRunsOf(src)
        }),
        new Paragraph({ children: textRunsOf(dst), spacing: { after: 120 } })
      )
      continue
    }
    if (s.type === 'code' || s.type === 'image' || s.type === 'math') {
      children.push(
        new Paragraph({
          children: textRunsOf(s.type === 'code' ? src : `[${s.type}] ${src}`)
        })
      )
      continue
    }

    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: cellText(src) }),
              new TableCell({ width: { size: 50, type: WidthType.PERCENTAGE }, children: cellText(dst) })
            ]
          })
        ]
      }),
      new Paragraph({ children: [] })
    )
  }

  const doc = new Document({ sections: [{ children: children as never[] }] })
  const blob = await Packer.toBlob(doc)
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x4000) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x4000)) as number[])
  }
  return btoa(bin)
}