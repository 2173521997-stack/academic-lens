import { useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Zap, CheckCircle2, XCircle, Keyboard, RefreshCw, ShieldCheck } from 'lucide-react'
import { PROVIDERS, useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { useAppStore } from '../stores/appStore'
import { llmChat } from '../lib/llm'

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

function StatusChip({ ok, text }: { ok: boolean; text: string }): React.JSX.Element {
  return (
    <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}>
      {ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
      {text}
    </span>
  )
}

export default function SettingsView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)
  const isMac = useAppStore((s) => s.isMac)
  const platform = useAppStore((s) => s.platform)

  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [shortcutState, setShortcutState] = useState<{ toggle: boolean; mode: boolean; selection: boolean } | null>(null)
  const [axTrusted, setAxTrusted] = useState<boolean | null>(null)

  useEffect(() => {
    void window.bridge.shortcutGetStatus().then(setShortcutState)
    const offStatus = window.bridge.onShortcutStatus(setShortcutState)
    if (isMac) void window.bridge.accessibilityGet().then(({ trusted }) => setAxTrusted(trusted))
    return () => offStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <Keyboard size={14} /> 快捷键
          </h2>
          {isMac && (
            <div className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-[12px] font-medium">
                  <ShieldCheck size={13} className="text-accent" />
                  一键翻译取词权限
                  {axTrusted === null ? null : axTrusted ? (
                    <StatusChip ok text="已授权" />
                  ) : (
                    <StatusChip ok={false} text="未授权" />
                  )}
                </span>
                <button
                  className="btn !px-3 !py-1.5 text-[11px]"
                  onClick={() => {
                    void window.bridge.accessibilityOpenSettings().then(() => {
                      setTimeout(() => void window.bridge.accessibilityGet().then(({ trusted }) => setAxTrusted(trusted)), 3000)
                    })
                  }}
                >
                  去授权
                </button>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                开启后按 Cmd/Ctrl+X 可自动复制任意 App 中选中的文字并翻译。授权后建议重启本软件。
              </p>
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="text-[13px]">一键翻译（复制选中 → 唤起 → 自动翻译）</span>
            <div className="flex items-center gap-2">
              {shortcutState && <StatusChip ok={shortcutState.selection} text={shortcutState.selection ? '已注册' : '未注册'} />}
              <kbd className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
                {isMac ? '⌘X' : 'Ctrl+X'}
              </kbd>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">唤起 / 隐藏小窗（并聚焦输入框）</span>
            <div className="flex items-center gap-2">
              {shortcutState && <StatusChip ok={shortcutState.toggle} text={shortcutState.toggle ? '已注册' : '未注册'} />}
              <kbd className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
                {isMac ? '⌘⇧T' : 'Ctrl+Shift+T'}
              </kbd>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">切换小窗 / 大窗</span>
            <div className="flex items-center gap-2">
              {shortcutState && <StatusChip ok={shortcutState.mode} text={shortcutState.mode ? '已注册' : '未注册'} />}
              <kbd className="rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
                {isMac ? '⌘⇧M' : 'Ctrl+Shift+M'}
              </kbd>
            </div>
          </div>
          {shortcutState && (!shortcutState.toggle || !shortcutState.mode) && (
            <div className="flex items-center gap-2">
              <button
                className="btn !px-3 !py-1.5 text-[11px]"
                onClick={() => void window.bridge.shortcutRetry().then(setShortcutState)}
              >
                <RefreshCw size={11} /> 重新注册快捷键
              </button>
              <p className="text-[11px] text-ink-3">可能被其他 App 占用，点此重试。</p>
            </div>
          )}
          <p className="text-[11px] leading-relaxed text-ink-3">
            一键翻译：在任意 App 选中单词或句子，按 {isMac ? '⌘X' : 'Ctrl+X'} 即自动完成「复制 → 唤起小窗 → 翻译」，
            单词显示音标释义与例句，中文自动译成英文；选中文字不足时提示重新选择。
            <br />
            仅唤起：按 {isMac ? '⌘⇧T' : 'Ctrl+Shift+T'} 唤起小窗并聚焦输入框，自己 Cmd/Ctrl+V 粘贴。
          </p>
          <p className="text-[11px] text-ink-3">
            当前平台：{platform || '…'} · 快捷键在 Windows 与 macOS 上自动适配（⌘ / Ctrl）
          </p>
        </section>
      </div>
    </div>
  )
}
