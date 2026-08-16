export interface Segment {
  id: string
  type: 'h' | 'p'
  text: string
  translation: string
  translating: boolean
  error?: string
  /** PDF 页码（1 起），用于「按页分组」展示；非 PDF 无此字段 */
  page?: number
}

export interface DocInfo {
  name: string
  size: number
  path?: string
}

export const SUPPORTED_EXTS = ['pdf', 'docx', 'txt', 'md', 'markdown']

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}

export function isSupported(name: string): boolean {
  return SUPPORTED_EXTS.includes(extOf(name))
}
