/* =====================================================================
 * 学术文献引用生成器（BibTeX, APA, MLA, IEEE, GB/T 7714）
 * ===================================================================== */

export interface CitationMetadata {
  title: string
  authors: string[]
  year: string
  venue?: string
  doi?: string
  url?: string
}

/** 生成 BibTeX 引用代码 */
export function generateBibTeX(meta: CitationMetadata): string {
  const firstAuthor = meta.authors[0]?.split(' ').pop()?.toLowerCase() || 'author'
  const firstWord = meta.title.split(' ')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'paper'
  const citeKey = `${firstAuthor}${meta.year || '2024'}${firstWord}`
  const authorStr = meta.authors.length ? meta.authors.join(' and ') : 'Unknown'

  return `@article{${citeKey},
  title     = {${meta.title}},
  author    = {${authorStr}},
  journal   = {${meta.venue || 'arXiv preprint'}},
  year      = {${meta.year || '2024'}}${meta.doi ? `,\n  doi       = {${meta.doi}}` : ''}${meta.url ? `,\n  url       = {${meta.url}}` : ''}
}`
}

/** 生成 APA 格式引用 */
export function generateAPA(meta: CitationMetadata): string {
  const authorStr = meta.authors.length
    ? meta.authors.map((a) => {
        const parts = a.split(' ')
        const last = parts.pop()
        const initials = parts.map((p) => p[0] + '.').join(' ')
        return `${last}, ${initials}`
      }).join(', & ')
    : 'Unknown'

  return `${authorStr} (${meta.year || 'n.d.'}). ${meta.title}. ${meta.venue || 'Preprint'}.${meta.doi ? ` https://doi.org/${meta.doi}` : ''}`
}

/** 生成 IEEE 格式引用 */
export function generateIEEE(meta: CitationMetadata): string {
  const authorStr = meta.authors.length
    ? meta.authors.map((a) => {
        const parts = a.split(' ')
        const last = parts.pop()
        const initials = parts.map((p) => p[0] + '.').join(' ')
        return `${initials} ${last}`
      }).join(', ')
    : 'Unknown'

  return `${authorStr}, "${meta.title}," ${meta.venue || 'arXiv preprint'}, ${meta.year || '2024'}.`
}

/** 生成 GB/T 7714 中文国标格式引用 */
export function generateGBT7714(meta: CitationMetadata): string {
  const authorStr = meta.authors.length
    ? meta.authors.slice(0, 3).join(', ') + (meta.authors.length > 3 ? ', 等' : '')
    : '佚名'

  return `[1] ${authorStr}. ${meta.title}[J]. ${meta.venue || '科技导报/预印本'}, ${meta.year || '2024'}.`
}
