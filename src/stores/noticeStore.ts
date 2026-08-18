import { create } from 'zustand'
import { newId } from '../lib/parse'

export type NoticeLevel = 'info' | 'success' | 'warning' | 'danger' | 'ai'

export interface Notice {
  id: string
  level: NoticeLevel
  title?: string
  message: string
  /** 持续时间 ms；0 = 常驻，需手动关闭 */
  duration: number
}

interface NoticeState {
  notices: Notice[]
  push: (n: Omit<Notice, 'id'> & { id?: string }) => void
  dismiss: (id: string) => void
  clear: () => void
}

let timers = new Map<string, ReturnType<typeof setTimeout>>()

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notices: [],
  push: (n) => {
    const id = n.id ?? newId()
    const duration = n.duration ?? (n.level === 'info' || n.level === 'success' ? 4000 : 0)
    // 同 id 去重（用于同一处高频报错，如逐段翻译失败）
    if (get().notices.some((x) => x.id === id)) return
    const notice: Notice = { id, level: n.level, title: n.title, message: n.message, duration }
    // 复用已存在的 timer
    if (timers.has(id)) clearTimeout(timers.get(id)!)
    if (duration > 0) {
      const t = setTimeout(() => {
        timers.delete(id)
        get().dismiss(id)
      }, duration)
      timers.set(id, t)
    }
    set({ notices: [...get().notices, notice] })
  },
  dismiss: (id) => {
    if (timers.has(id)) {
      clearTimeout(timers.get(id)!)
      timers.delete(id)
    }
    set({ notices: get().notices.filter((n) => n.id !== id) })
  },
  clear: () => {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
    set({ notices: [] })
  }
}))

/** 便捷方法：一次性（短时）提示，带自动消失 */
export function toast(level: NoticeLevel, message: string, title?: string, duration = 4000): void {
  useNoticeStore.getState().push({ level, message, title, duration })
}