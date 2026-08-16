import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const FLUSH_DELAY = 300

export class Store {
  private file: string
  private cache: Record<string, unknown>
  private timer: NodeJS.Timeout | null = null

  constructor() {
    this.file = path.join(app.getPath('userData'), 'data.json')
    this.cache = {}
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
    } catch {
      this.cache = {}
    }
  }

  get<T>(key: string, fallback: T): T {
    return (this.cache[key] as T) ?? fallback
  }

  set(key: string, value: unknown): void {
    this.cache[key] = value
    this.schedulePersist()
  }

  all(): Record<string, unknown> {
    return { ...this.cache }
  }

  /** 立即写盘（退出前调用，保证防抖期间的改动不丢失） */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
    this.persist()
  }

  private schedulePersist(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.persist()
    }, FLUSH_DELAY)
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.file)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.cache, null, 2), 'utf-8')
      fs.renameSync(tmp, this.file)
    } catch (err) {
      console.error('store persist failed:', err)
    }
  }
}

export const store = new Store()
