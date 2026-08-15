import { useState } from 'react'
import { Eye, EyeOff, ExternalLink, Zap, CheckCircle2, XCircle } from 'lucide-react'
import { PROVIDERS, useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { useAppStore } from '../stores/appStore'
import { llmChat } from '../lib/llm'

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

export default function SettingsView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const isMac = useAppStore((s) => s.isMac)
  const platform = useAppStore((s) => s.platform)

  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [shortcutMsg, setShortcutMsg] = useState<string | null>(null)

  const shortcut = isMac ? '⌘⇧T' : 'Ctrl+Shift+T'

  const testConnection = async (): Promise<void> => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await llmChat(
        [
          { role: 'system', content: '你是一个连通性测试助手。' },
          { role: 'user', content: '回复"连接成功"四个字即可。' }
        ],
        { maxTokens: 20, temperature: 0 }
      )
      setTestResult({ ok: true, msg: r.trim().slice(0, 60) })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-[17px] font-semibold">设置</h1>

        <section className="card space-y-4 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">AI 服务</h2>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-medium text-ink-2">
              服务商
              <select
                className="input mt-1"
                value={settings.provider}
                onChange={(e) => update({ provider: e.target.value })}
              >
                {Object.entries(PROVIDERS).map(([k, p]) => (
                  <option key={k} value={k}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              模型
              <input
                className="input mt-1"
                value={settings.model}
                onChange={(e) => update({ model: e.target.value })}
                placeholder="如 deepseek-chat"
              />
            </label>
          </div>
          <label className="block text-[12px] font-medium text-ink-2">
            API Base URL（OpenAI 兼容）
            <input
              className="input mt-1"
              value={settings.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder="https://api.deepseek.com"
            />
          </label>
          <label className="block text-[12px] font-medium text-ink-2">
            API Key
            <div className="relative mt-1">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={settings.apiKey}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="sk-…"
                autoComplete="off"
              />
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={() => void testConnection()} disabled={testing}>
              {testing ? <Zap size={13} className="animate-pulse" /> : <Zap size={13} />}
              {testing ? '测试中…' : '测试连接'}
            </button>
            {testResult && (
              <span className={`flex items-center gap-1.5 text-[12px] ${testResult.ok ? 'text-ok' : 'text-danger'}`}>
                {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span className="max-w-[380px] truncate">{testResult.msg}</span>
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            Key 仅保存在本机用户目录，不会上传或写入源码。
            <button
              className="ml-1 inline-flex items-center gap-0.5 text-accent hover:underline"
              onClick={() => void window.bridge.openExternal('https://platform.deepseek.com/api_keys')}
            >
              DeepSeek 控制台 <ExternalLink size={10} />
            </button>
          </p>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">图片识别（OCR）</h2>
          <div className="flex items-center gap-2">
            <span className="chip">本地引擎</span>
            <span className="text-[12px] text-ink-2">tesseract.js · 完全离线 · 免费</span>
          </div>
          <label className="block text-[12px] font-medium text-ink-2">
            识别语言
            <select
              className="input mt-1"
              value={settings.ocrLang}
              onChange={(e) => update({ ocrLang: e.target.value as 'eng' | 'chi_sim' | 'eng+chi_sim' })}
            >
              <option value="eng+chi_sim">中英混排（默认）</option>
              <option value="eng">仅英文（更快）</option>
              <option value="chi_sim">仅中文（更快）</option>
            </select>
          </label>
          <p className="text-[11px] leading-relaxed text-ink-3">
            大窗中截图后 <kbd className="rounded bg-surface px-1.5 py-0.5 font-semibold">Ctrl/Cmd+V</kbd> 粘贴即 OCR 翻译。
            首次识别需加载语言模型（约 2-5 秒），之后常驻秒级识别；空闲 30 秒自动释放内存。
          </p>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">外观</h2>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button
                key={t.value}
                onClick={() => update({ theme: t.value })}
                className={`btn ${settings.theme === t.value ? '!bg-accent !text-white' : ''}`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">快捷键</h2>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">唤起 / 隐藏小窗</span>
            <kbd className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
              {shortcut}
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">切换小窗 / 大窗</span>
            <kbd className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
              {isMac ? '⌘⇧M' : 'Ctrl+Shift+M'}
            </kbd>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">划词翻译（任意 App 选中文字）</span>
            <input
              className="input !w-56 !py-1.5 text-center text-[12px]"
              value={settings.selectionShortcut}
              placeholder="如 Ctrl+Shift+D / Cmd+Shift+D"
              onChange={(e) => {
                const raw = e.target.value.trim().replace(/\s+/g, '')
                const accel = raw
                  .replace(/Ctrl\+?|Control\+?/gi, 'CommandOrControl+')
                  .replace(/Cmd\+?/gi, 'CommandOrControl+')
                  .replace(/Command\+?/gi, 'CommandOrControl+')
                void window.bridge.shortcutSetSelection(accel || 'CommandOrControl+Shift+D').then((ok) => {
                  setShortcutMsg(ok ? '已生效' : '该组合键不可用或被占用，请换一个')
                  if (ok) update({ selectionShortcut: accel || 'CommandOrControl+Shift+D' })
                })
              }}
            />
          </div>
          {shortcutMsg && <p className="text-[11px] text-ok">{shortcutMsg}</p>}
          <p className="text-[11px] leading-relaxed text-ink-3">
            划词：在 Word / 浏览器 / PDF 中选中单词或句子，按 {isMac ? '⌘⇧D' : 'Ctrl+Shift+D'}，
            小窗自动弹出——单词显示音标释义与例句，整句自动翻译。
            {isMac && ' macOS 首次使用需在「系统设置 → 隐私与安全性 → 辅助功能」中授权。'}
          </p>
          <p className="text-[11px] text-ink-3">
            当前平台：{platform || '…'} · 快捷键在 Windows 与 macOS 上自动适配（⌘ / Ctrl）
          </p>
        </section>
      </div>
    </div>
  )
}
