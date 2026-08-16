import { clipboard } from 'electron'
import { execFile } from 'node:child_process'

const isMac = process.platform === 'darwin'

function sendCopyKey(): Promise<{ ok: boolean; error?: string }> {
  if (!isMac) return Promise.resolve({ ok: false, error: '非 macOS 平台' })
  return new Promise((resolve) => {
    // 模拟 Cmd+C 复制前台 App 选中内容，需「辅助功能」授权
    execFile(
      'osascript',
      ['-e', 'tell application "System Events" to keystroke "c" using command down'],
      { timeout: 3000 },
      (err, _stdout, stderr) => {
        if (err) resolve({ ok: false, error: String(stderr || err.message).trim().slice(0, 200) })
        else resolve({ ok: true })
      }
    )
  })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 一键取词：备份剪贴板 → 模拟 Cmd+C → 轮询剪贴板变化 → 延迟恢复原内容。
 * 返回失败原因（osascript 报错），供界面展示精确定位。
 */
export async function grabSelection(): Promise<{ text: string; error?: string }> {
  const backup = clipboard.readText()
  const copy = await sendCopyKey()
  if (!copy.ok) {
    return { text: '', error: `取词失败：${copy.error ?? '模拟复制按键未执行'}` }
  }

  const deadline = Date.now() + 2500
  let text = clipboard.readText().trim()
  while (Date.now() < deadline) {
    if (text && text !== backup) break
    await sleep(80)
    text = clipboard.readText().trim()
  }
  if (!text || text === backup) {
    return { text: '', error: '未检测到选中文字（请确认已在其他应用中选中内容）' }
  }

  setTimeout(() => {
    try {
      if (backup) clipboard.writeText(backup)
    } catch {
      /* 恢复失败忽略 */
    }
  }, 2500)
  return { text }
}
