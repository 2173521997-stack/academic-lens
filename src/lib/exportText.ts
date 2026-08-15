import type { DocInfo, Segment } from './types'

/** 纯中文译文：标题行、段落间空行，与原文语义分段一致；无译文的段回退原文 */
export function buildPlainText(segments: Segment[]): string {
  const blocks: string[] = []
  for (const s of segments) {
    const content = (s.translation || s.text).trim()
    if (!content) continue
    blocks.push(s.type === 'h' ? `【${content}】` : content)
  }
  return blocks.join('\n\n')
}

export function buildPlainTextHeader(doc: DocInfo, segments: Segment[]): string {
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
