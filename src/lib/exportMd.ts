import type { DocInfo, Segment } from './types'

export function buildExportMd(doc: DocInfo, segments: Segment[], summary: string): string {
  const lines: string[] = []
  lines.push(`# ${doc.name}`)
  lines.push('')
  lines.push(`> 由 Academic Lens 生成 · ${new Date().toLocaleString('zh-CN')}`)
  lines.push('')

  if (summary.trim()) {
    lines.push('---')
    lines.push('')
    lines.push('## 摘要卡片')
    lines.push('')
    lines.push(summary.trim())
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push('## 双语对照')
  lines.push('')
  for (const s of segments) {
    if (s.type === 'h') {
      lines.push(`### ${s.text}`)
      lines.push('')
    } else {
      lines.push(`**原文：** ${s.text}`)
      lines.push('')
      if (s.translation) {
        lines.push(`**译文：** ${s.translation}`)
        lines.push('')
      } else {
        lines.push('_（未翻译）_')
        lines.push('')
      }
    }
  }
  return lines.join('\n')
}
