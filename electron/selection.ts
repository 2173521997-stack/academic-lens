import { clipboard } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const isMac = process.platform === 'darwin'
const isWin = process.platform === 'win32'

function run(cmd: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000 }, (err, _stdout, stderr) => {
      if (err) {
        resolve({ ok: false, error: String(stderr || err.message).trim().slice(0, 200) })
      } else {
        resolve({ ok: true })
      }
    })
  })
}

function sendCopyBySendKeys(): Promise<{ ok: boolean; error?: string }> {
  return run('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-Command',
    `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
  ])
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

/**
 * 模拟系统复制快捷键（Cmd+C / Ctrl+C）复制前台 App 选中内容。
 * - macOS：osascript 模拟 ⌘C，需「辅助功能」授权
 * - Windows：cscript 跑 VBS 发送 Ctrl+C（约 150ms 启动，远快于 PowerShell 冷启动 3s+），失败回退 PowerShell SendKeys
 */
function sendCopyKey(): Promise<{ ok: boolean; error?: string }> {
  if (isMac) {
    return run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'])
  }
  if (isWin) {
    const vbs = getVbs()
    if (vbs) {
      return run('cscript.exe', ['//B', '//NoLogo', vbs]).then((r) => {
        if (r.ok) return r
        return sendCopyBySendKeys().then((fallback) =>
          fallback.ok
            ? fallback
            : { ok: false, error: `cscript: ${r.error ?? '失败'}；PowerShell: ${fallback.error ?? '失败'}` }
        )
      })
    }
    return sendCopyBySendKeys()
  }
  return Promise.resolve({ ok: false, error: '非 macOS/Windows 平台' })
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 一键取词：备份剪贴板 → 模拟 Ctrl/Cmd+C → 轮询剪贴板变化 → 延迟恢复原内容。
 * 返回失败原因（osascript/cscript 报错），供界面展示精确定位。
 */
export async function grabSelection(): Promise<{ text: string; error?: string }> {
  const backupText = clipboard.readText()
  const backupImage = clipboard.readImage()

  const copy = await sendCopyKey()
  if (!copy.ok) {
    return { text: '', error: `取词失败：${copy.error ?? '模拟复制按键未执行'}` }
  }

  const deadline = Date.now() + 2500
  let text = clipboard.readText().trim()
  while (Date.now() < deadline) {
    if (text && text !== backupText) break
    await sleep(80)
    text = clipboard.readText().trim()
  }
  if (!text || text === backupText) {
    return { text: '', error: '未检测到选中文字（请确认已在其他应用中选中内容）' }
  }

  // 延迟恢复剪贴板，避免与读取竞争
  setTimeout(() => {
    try {
      if (backupText) clipboard.writeText(backupText)
      if (!backupImage.isEmpty()) clipboard.writeImage(backupImage)
    } catch {
      /* 恢复失败忽略 */
    }
  }, 2500)
  return { text }
}
