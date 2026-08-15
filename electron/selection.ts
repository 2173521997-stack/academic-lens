import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function run(cmd: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err) => resolve(!err))
  })
}

let vbsPath: string | null = null
function getVbs(): string {
  if (!vbsPath) {
    vbsPath = path.join(os.tmpdir(), 'al_sendcopy.vbs')
    try {
      fs.writeFileSync(vbsPath, 'Set w = CreateObject("WScript.Shell")\nw.SendKeys "^c"\n', 'utf-8')
    } catch {
      vbsPath = ''
    }
  }
  return vbsPath
}

async function sendCopyKey(): Promise<void> {
  if (isMac) {
    await run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'])
  } else if (isWin) {
    // cscript 启动约 150ms，远快于 PowerShell 冷启动（可达 3s+）
    const vbs = getVbs()
    if (vbs) {
      const ok = await run('cscript.exe', ['//B', '//NoLogo', vbs])
      if (ok) return
    }
    // fallback：PowerShell SendKeys
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
 * 全局取词：备份剪贴板 → 模拟 Ctrl/Cmd+C 复制前台窗口选中文本 → 轮询剪贴板变化 → 恢复剪贴板。
 * 轮询而非固定延时：进程冷启动耗时不定，固定延时极易读到旧内容。
 * 不切换焦点、不显示窗口，避免打断用户正在阅读的 App。
 */
export async function grabSelection(): Promise<SelectionResult> {
  const backupText = clipboard.readText()
  const backupImage = clipboard.readImage()
  const hasBackup = backupText !== '' || !backupImage.isEmpty()

  try {
    void sendCopyKey()
    const deadline = Date.now() + 4000
    let text = clipboard.readText().trim()
    while (Date.now() < deadline) {
      if (text && text !== backupText) break
      await sleep(80)
      text = clipboard.readText().trim()
    }
    if (text === backupText) {
      // 剪贴板无变化：说明没有选中文本（或与备份恰好相同），返回空避免误取旧内容
      return { text: '', restored: true }
    }
    if (hasBackup) {
      // 延迟恢复，避免与读取竞争
      setTimeout(() => {
        try {
          if (backupText) clipboard.writeText(backupText)
          if (!backupImage.isEmpty()) clipboard.writeImage(backupImage)
        } catch {
          /* 恢复失败忽略 */
        }
      }, 1800)
    }
    return { text, restored: true }
  } catch {
    return { text: '', restored: false }
  }
}
