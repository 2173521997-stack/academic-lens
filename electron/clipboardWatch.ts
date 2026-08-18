import { clipboard } from 'electron'

let lastText = ''
let lastOwnWrite = 0
let timer: NodeJS.Timeout | null = null

/** 标记自家写入（复制按钮 / 剪贴板恢复），800ms 内监听到变化视为自触发，跳过 */
export function markOwnClipboardWrite(): void {
  lastOwnWrite = Date.now()
}

/** 启动剪贴板监听：外部复制文本变化时回调（跳过自家写入与空文本） */
export function startClipboardWatch(onCopy: (text: string) => void): void {
  if (timer) return
  lastText = clipboard.readText()
  timer = setInterval(() => {
    const text = clipboard.readText()
    if (text === lastText) return
    lastText = text
    if (!text.trim()) return
    if (Date.now() - lastOwnWrite < 800) return
    onCopy(text.trim())
  }, 400)
}

export function stopClipboardWatch(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
