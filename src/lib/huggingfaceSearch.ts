/* =====================================================================
 * HuggingFace 开源大模型与权重检索工具
 * 免费公开接口：HuggingFace REST API
 * ===================================================================== */

export interface HFModelResult {
  id: string
  name: string
  likes: number
  downloads: number
  pipelineTag: string
  url: string
}

/** 检索 HuggingFace 开源模型与权重 */
export async function searchHuggingFaceModels(query: string, limit = 4): Promise<HFModelResult[]> {
  const cleanQ = encodeURIComponent(query.trim().slice(0, 60))
  const url = `https://huggingface.co/api/models?search=${cleanQ}&sort=downloads&direction=-1&limit=${limit}`

  try {
    const resp = await fetch(url)
    if (!resp.ok) return []
    const data = (await resp.json()) as any[]
    if (!Array.isArray(data)) return []

    return data.map((item) => ({
      id: item.id || '',
      name: item.id || 'Unknown',
      likes: Number(item.likes) || 0,
      downloads: Number(item.downloads) || 0,
      pipelineTag: item.pipeline_tag || 'custom',
      url: `https://huggingface.co/${item.id}`
    }))
  } catch {
    return []
  }
}
