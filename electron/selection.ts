import { clipboard } from 'electron'
import { execFile } from 'node:child_process'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 3000 }, () => resolve())
  })
}

async function sendCopyKey(): Promise<void> {
  if (isMac) {
    await run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'])
  } else if (isWin) {
    await run('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
    ])
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SelectionResult {
  text: string
  restored: boolean
}

/**
 * 全局取词：备份剪贴板 → 模拟 Ctrl/Cmd+C 复制前台窗口选中文本 → 读取 → 恢复剪贴板。
 * 注意：不切换焦点、不显示窗口，避免打断用户正在阅读的 App。
 */
export async function grabSelection(): Promise<SelectionResult> {
  const backupText = clipboard.readText()
  const backupImage = clipboard.readImage()
  const hasBackup = backupText !== '' || !backupImage.isEmpty()

  try {
    await sendCopyKey()
    await sleep(260)
    const text = clipboard.readText().trim()
    if (hasBackup) {
      // 延迟恢复，避免与读取竞争
      setTimeout(() => {
        try {
          if (backupText) clipboard.writeText(backupText)
          if (!backupImage.isEmpty()) clipboard.writeImage(backupImage)
        } catch {
          /* 恢复失败忽略 */
        }
      }, 1500)
    }
    return { text, restored: true }
  } catch (err) {
    return {
      text: '',
      restored: false
    }
  }
}
