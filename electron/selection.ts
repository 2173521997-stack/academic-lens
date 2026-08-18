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

/** PowerShell 编码命令：utf16le base64，避免中文与引号转义问题 */
function encodedCommand(ps: string): string {
  return Buffer.from(ps, 'utf16le').toString('base64')
}

function sendCopyByPsSendKeys(): Promise<{ ok: boolean; error?: string }> {
  return run('powershell.exe', [
    '-NoProfile',
    '-WindowStyle', 'Hidden',
    '-EncodedCommand',
    encodedCommand(
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^c')`
    )
  ])
}

/** PowerShell user32 keybd_event 注入 Ctrl+C：对部分不吃 SendKeys 的应用更可靠 */
function sendCopyByPsSendInput(): Promise<{ ok: boolean; error?: string }> {
  const ps =
    `$sig = '[DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);';\n` +
    `$k = Add-Type -MemberDefinition $sig -Name Kbd -Namespace Win32 -PassThru;\n` +
    `$k::keybd_event(0x11,0,0,[UIntPtr]::Zero); $k::keybd_event(0x43,0,0,[UIntPtr]::Zero);\n` +
    `$k::keybd_event(0x43,0,2,[UIntPtr]::Zero); $k::keybd_event(0x11,0,2,[UIntPtr]::Zero);\n`
  return run('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-EncodedCommand', encodedCommand(ps)])
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
 * - Windows：cscript(VBS SendKeys，约150ms) → PowerShell SendKeys → PowerShell keybd_event 三重递进
 */
async function sendCopyKey(): Promise<{ ok: boolean; error?: string }> {
  if (isMac) {
    return run('osascript', ['-e', 'tell application "System Events" to keystroke "c" using command down'])
  }
  if (isWin) {
    const vbs = getVbs()
    if (vbs) {
      const r1 = await run('cscript.exe', ['//B', '//NoLogo', vbs])
      if (r1.ok) return r1
      const r2 = await sendCopyByPsSendKeys()
      if (r2.ok) return r2
      const r3 = await sendCopyByPsSendInput()
      return r3.ok
        ? r3
        : { ok: false, error: `cscript:${r1.error ?? ''} | PS:${r2.error ?? ''} | SendInput:${r3.error ?? ''}` }
    }
    const r2 = await sendCopyByPsSendKeys()
    if (r2.ok) return r2
    const r3 = await sendCopyByPsSendInput()
    return r3.ok ? r3 : { ok: false, error: `PS:${r2.error ?? ''} | SendInput:${r3.error ?? ''}` }
  }
  return { ok: false, error: '非 macOS/Windows 平台' }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * 一键取词：备份剪贴板 → 模拟 Ctrl/Cmd+C → 轮询剪贴板变化 → 延迟恢复原内容。
 * 返回失败原因（osascript/cscript 报错），供界面展示精确定位。
 */
export async function grabSelection(opts?: { onOwnWrite?: () => void }): Promise<{ text: string; error?: string }> {
  const backupText = clipboard.readText()
  const backupImage = clipboard.readImage()

  const copy = await sendCopyKey()
  if (!copy.ok) {
    return { text: '', error: `取词失败：${copy.error ?? '模拟复制按键未执行'}` }
  }

  const deadline = Date.now() + 3500
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
      opts?.onOwnWrite?.()
    } catch {
      /* 恢复失败忽略 */
    }
  }, 2500)
  return { text }
}
