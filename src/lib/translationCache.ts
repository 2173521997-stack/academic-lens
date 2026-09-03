interface CacheEntry {
  zh: string
  model: string
  ts: number
}

const STORE_KEY = 'transCache'
const MAX_ENTRIES = 3000

let cache: Record<string, CacheEntry> | null = null

async function ensureCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache
  const saved = await window.bridge.storeGet<Record<string, CacheEntry>>(STORE_KEY)
  cache = saved ?? {}
  return cache
}

/** sha256 原文 → hex，作为缓存 key（文件指纹级可靠，冲突可忽略） */
async function hash(src: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function getCachedTranslation(src: string, model: string): Promise<string | null> {
  if (!src) return null
  const c = await ensureCache()
  const hit = c[await hash(src)]
  return hit && hit.model === model ? hit.zh : null
}

export async function setCachedTranslation(src: string, model: string, zh: string): Promise<void> {
  if (!src || !zh) return
  const c = await ensureCache()
  c[await hash(src)] = { zh, model, ts: Date.now() }
  const keys = Object.keys(c)
  if (keys.length > MAX_ENTRIES) {
    // 简单 LRU：淘汰最旧的 10%
    const sorted = keys
      .map((k) => ({ k, ts: c[k].ts }))
      .sort((a, b) => a.ts - b.ts)
      .slice(0, Math.floor(keys.length * 0.1))
    for (const { k } of sorted) delete c[k]
  }
  await window.bridge.storeSet(STORE_KEY, c)
}
