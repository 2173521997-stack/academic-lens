/* =====================================================================
 * 学术联网检索与 GitHub 代码库 RAG 工具
 * 免费公开接口：arXiv API + GitHub REST Search API
 * ===================================================================== */

export interface PaperResult {
  title: string
  authors: string[]
  summary: string
  published: string
  url: string
  pdfUrl?: string
}

export interface RepoResult {
  name: string
  fullName: string
  description: string
  stars: number
  language: string
  url: string
}

/** 检索 arXiv 学术论文 */
export async function searchArxivPapers(query: string, maxResults = 5): Promise<PaperResult[]> {
  const cleanQ = encodeURIComponent(query.trim().slice(0, 100))
  const url = `https://export.arxiv.org/api/query?search_query=all:${cleanQ}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const text = await resp.text()

    // 简易解析 Atom XML
    const entries = text.split('<entry>').slice(1)
    const results: PaperResult[] = []

    for (const entry of entries) {
      const titleMatch = entry.match(/<title>([\s\S]*?)<\/title>/)
      const summaryMatch = entry.match(/<summary>([\s\S]*?)<\/summary>/)
      const publishedMatch = entry.match(/<published>([\s\S]*?)<\/published>/)
      const idMatch = entry.match(/<id>([\s\S]*?)<\/id>/)

      // 提取作者
      const authorMatches = Array.from(entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g))
      const authors = authorMatches.map((m) => m[1].trim()).slice(0, 4)

      const title = (titleMatch?.[1] ?? '').replace(/\s+/g, ' ').trim()
      const summary = (summaryMatch?.[1] ?? '').replace(/\s+/g, ' ').trim()
      const published = (publishedMatch?.[1] ?? '').slice(0, 10)
      const paperUrl = (idMatch?.[1] ?? '').trim()
      const pdfUrl = paperUrl.replace('/abs/', '/pdf/') + '.pdf'

      if (title) {
        results.push({
          title,
          authors,
          summary: summary.slice(0, 300) + (summary.length > 300 ? '…' : ''),
          published,
          url: paperUrl,
          pdfUrl
        })
      }
    }

    return results
  } catch {
    return []
  }
}

/** 检索 GitHub 开源学术项目与论文实现代码 */
export async function searchGithubRepos(query: string, maxResults = 4): Promise<RepoResult[]> {
  const cleanQ = encodeURIComponent(query.trim().slice(0, 80))
  const url = `https://api.github.com/search/repositories?q=${cleanQ}&sort=stars&order=desc&per_page=${maxResults}`

  try {
    const resp = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'AcademicLens-App'
      }
    })
    if (!resp.ok) return []
    const data = (await resp.json()) as { items?: any[] }
    if (!Array.isArray(data.items)) return []

    return data.items.map((item) => ({
      name: item.name ?? '',
      fullName: item.full_name ?? '',
      description: item.description ?? '暂无项目描述',
      stars: Number(item.stargazers_count) || 0,
      language: item.language ?? 'Unknown',
      url: item.html_url ?? ''
    }))
  } catch {
    return []
  }
}
