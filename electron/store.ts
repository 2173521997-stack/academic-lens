import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export class Store {
  private file: string
  private cache: Record<string, unknown>

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
    this.persist()
  }

  all(): Record<string, unknown> {
    return { ...this.cache }
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
