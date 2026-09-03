import { useEffect, useState } from 'react'
import {
  Eye,
  EyeOff,
  Zap,
  CheckCircle2,
  XCircle,
  Keyboard,
  RefreshCw,
  Bot,
  ChevronDown,
  ChevronRight,
  Sliders
} from 'lucide-react'
import { PROVIDERS, DOMAIN_PRESETS, type DomainPreset, useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { refreshAgentAvailability } from '../stores/agentStore'
import { useProfileStore } from '../stores/profileStore'
import { llmChat, agentComplete } from '../lib/llm'

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

const DOMAIN_LABELS: Record<DomainPreset, string> = {
  general: '通用阅读',
  cs: '计算机 / 算法',
  bio: '生物 / 医学',
  news: '新闻 / 社科',
  academic: '学术论文 / SSCI'
}

function StatusChip({ ok, text }: { ok: boolean; text: string }): React.JSX.Element {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${ok ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'}`}>
      {ok ? <CheckCircle2 size={10} strokeWidth={1.5} /> : <XCircle size={10} strokeWidth={1.5} />}
      {text}
    </span>
  )
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left py-1.5 hover:opacity-90 transition cursor-pointer"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] font-medium text-ink-1">{label}</span>
        <span className="block text-[11px] text-ink-3 leading-normal">{desc}</span>
      </span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out focus:outline-none ${
          checked ? 'bg-accent' : 'bg-black/20 dark:bg-white/20'
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-xs transition duration-200 ease-in-out ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
    </button>
  )
}

export default function SettingsView(): React.JSX.Element {
  const settings = useSettingsStore((s) => s.settings)
  const update = useSettingsStore((s) => s.update)

  const [showKey, setShowKey] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  // 智能体独立连通测试
  const [agentTesting, setAgentTesting] = useState(false)
  const [agentTestResult, setAgentTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    void useProfileStore.getState().load()
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

  const testAgentConnection = async (): Promise<void> => {
    setAgentTesting(true)
    setAgentTestResult(null)
    try {
      const call = agentComplete(
        [
          { role: 'system', content: '你是一个连通性测试助手。' },
          { role: 'user', content: '只回复"连接成功"四个字。' }
        ],
        { maxTokens: 20, temperature: 0 }
      )
      const r = await call.promise
      setAgentTestResult({ ok: true, msg: r.trim().slice(0, 60) })
    } catch (err) {
      setAgentTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) })
    } finally {
      setAgentTesting(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-surface select-none">
      <div className="mx-auto max-w-2xl space-y-4 p-5 sm:p-6">
        <div>
          <h1 className="text-[16px] font-semibold text-ink-1 tracking-tight">偏好设置</h1>
          <p className="text-[12px] text-ink-3 mt-0.5">管理服务商密钥、主题外观与高级翻译选项</p>
        </div>

        {/* ================= 基础必备：服务商与主模型配置 ================= */}
        <section className="card space-y-3.5 p-4.5 border border-line bg-card shadow-xs">
          <div className="flex items-center justify-between border-b border-line/60 pb-2">
            <h2 className="text-[13.5px] font-semibold text-ink-1 flex items-center gap-1.5">
              <Zap size={14} className="text-accent" />
              <span>翻译大模型配置</span>
            </h2>
            <StatusChip ok={Boolean(settings.apiKey)} text={settings.apiKey ? '已配置 Key' : '未配置 Key'} />
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-[11.5px] font-medium text-ink-2 mb-1">服务商</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {Object.keys(PROVIDERS).map((key) => {
                  const p = PROVIDERS[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        update({
                          provider: key,
                          baseUrl: p.baseUrl,
                          model: p.model
                        })
                        refreshAgentAvailability()
                      }}
                      className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition cursor-pointer ${
                        settings.provider === key
                          ? 'border-accent bg-accent-soft text-accent font-semibold'
                          : 'border-line hover:border-accent/40 text-ink-2'
                      }`}
                    >
                      {p.label}
                    </button>
                  )
                })}
              </div>
            </div>

            <div>
              <label className="block text-[11.5px] font-medium text-ink-2 mb-1">API Key</label>
              <div className="relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={settings.apiKey}
                  onChange={(e) => {
                    update({ apiKey: e.target.value })
                    refreshAgentAvailability()
                  }}
                  placeholder="sk-..."
                  className="input w-full pr-8 !text-[12.5px]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink-1 cursor-pointer"
                >
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11.5px] font-medium text-ink-2 mb-1">API 端点 (Base URL)</label>
                <input
                  type="text"
                  value={settings.baseUrl}
                  onChange={(e) => update({ baseUrl: e.target.value })}
                  className="input w-full !text-[12px]"
                />
              </div>
              <div>
                <label className="block text-[11.5px] font-medium text-ink-2 mb-1">模型名称 (Model)</label>
                <input
                  type="text"
                  value={settings.model}
                  onChange={(e) => update({ model: e.target.value })}
                  className="input w-full !text-[12px]"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                className="btn !px-3 !py-1 text-[11.5px] cursor-pointer"
                onClick={testConnection}
                disabled={testing || !settings.apiKey}
              >
                {testing ? <RefreshCw size={12} className="animate-spin text-accent" /> : <Zap size={12} />}
                <span>{testing ? '测试中…' : '测试主翻译连通性'}</span>
              </button>
              {testResult && (
                <span className={`text-[11.5px] ${testResult.ok ? 'text-ok font-medium' : 'text-danger'}`}>
                  {testResult.ok ? '✓ 连通成功' : `✗ ${testResult.msg}`}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ================= 基础必备：外观主题 ================= */}
        <section className="card space-y-3 p-4.5 border border-line bg-card shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink-1">界面主题</span>
            <div className="flex gap-1">
              {THEMES.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => update({ theme: t.value })}
                  className={`rounded-lg border px-3 py-1 text-[11.5px] font-medium transition cursor-pointer ${
                    settings.theme === t.value
                      ? 'border-accent bg-accent-soft text-accent font-semibold'
                      : 'border-line text-ink-2 hover:border-accent/40'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ================= ⚙️ 高级选项（手风琴折叠组） ================= */}
        <div className="card overflow-hidden border border-line bg-card shadow-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between p-4 text-left hover:bg-surface/50 transition cursor-pointer"
            onClick={() => setAdvancedOpen(!advancedOpen)}
          >
            <div className="flex items-center gap-2">
              <Sliders size={14} className="text-accent" />
              <span className="text-[13px] font-semibold text-ink-1">高级设置选项</span>
              <span className="text-[11px] text-ink-3">（学术领域、AI智能体双轨、术语注入、快捷键）</span>
            </div>
            {advancedOpen ? <ChevronDown size={14} className="text-ink-3" /> : <ChevronRight size={14} className="text-ink-3" />}
          </button>

          {advancedOpen && (
            <div className="space-y-4 border-t border-line/60 p-4.5 bg-surface/30">
              {/* 1. 学术领域预设 */}
              <div className="space-y-2">
                <label className="block text-[12px] font-medium text-ink-1">学术领域预设</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {(Object.keys(DOMAIN_PRESETS) as DomainPreset[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => update({ domain: key })}
                      className={`rounded-lg border p-2 text-left transition cursor-pointer ${
                        settings.domain === key
                          ? 'border-accent bg-accent-soft font-semibold'
                          : 'border-line text-ink-2 hover:border-accent/40'
                      }`}
                    >
                      <span className="block text-[11.5px] text-ink-1 font-medium">{DOMAIN_LABELS[key]}</span>
                      <span className="block text-[10px] text-ink-3 truncate">{DOMAIN_PRESETS[key]}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* 2. AI 智能体独立模型配置（双轨） */}
              <div className="space-y-2 pt-2 border-t border-line/50">
                <div className="flex items-center justify-between">
                  <span className="text-[12px] font-medium text-ink-1 flex items-center gap-1">
                    <Bot size={13} className="text-accent" /> AI 智能体 / 小窗翻译独立低配 API (GLM-4-flash 免费)
                  </span>
                  <StatusChip ok={Boolean(settings.agentApiKey)} text={settings.agentApiKey ? '独立配置' : '共享主 Key'} />
                </div>
                <input
                  type="password"
                  value={settings.agentApiKey || ''}
                  onChange={(e) => {
                    update({ agentApiKey: e.target.value })
                    refreshAgentAvailability()
                  }}
                  placeholder="留空则自动复用主翻译 API Key"
                  className="input w-full !text-[12px]"
                />
                <div className="flex items-center justify-between pt-1">
                  <button
                    className="btn !px-2.5 !py-0.8 text-[11px] cursor-pointer"
                    onClick={testAgentConnection}
                    disabled={agentTesting}
                  >
                    {agentTesting ? <RefreshCw size={11} className="animate-spin text-accent" /> : <Bot size={11} />}
                    <span>{agentTesting ? '测试中…' : '测试 AI 智能体'}</span>
                  </button>
                  {agentTestResult && (
                    <span className={`text-[11px] ${agentTestResult.ok ? 'text-ok font-medium' : 'text-danger'}`}>
                      {agentTestResult.ok ? '✓ 连通成功' : `✗ ${agentTestResult.msg}`}
                    </span>
                  )}
                </div>
              </div>

              {/* 3. 术语注入 */}
              <div className="space-y-2 pt-2 border-t border-line/50">
                <ToggleRow
                  label="自动注入生词本术语"
                  desc="将生词本词条作为专业术语表动态注入翻译模型，确保论文专有名词前后一致"
                  checked={Boolean(settings.injectTerms ?? true)}
                  onChange={(v) => update({ injectTerms: v })}
                />
              </div>

              {/* 4. 系统快捷键 */}
              <div className="space-y-2 pt-2 border-t border-line/50">
                <span className="block text-[12px] font-medium text-ink-1 flex items-center gap-1">
                  <Keyboard size={13} className="text-accent" /> 系统快捷键列表
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                  <div className="card p-2 border border-line bg-card flex items-center justify-between">
                    <span className="text-ink-2">查词 Spotlight</span>
                    <kbd className="font-mono bg-surface-alt px-1 rounded">⌘K</kbd>
                  </div>
                  <div className="card p-2 border border-line bg-card flex items-center justify-between">
                    <span className="text-ink-2">桌面小窗切换</span>
                    <kbd className="font-mono bg-surface-alt px-1 rounded">⌘⇧M</kbd>
                  </div>
                  <div className="card p-2 border border-line bg-card flex items-center justify-between">
                    <span className="text-ink-2">全局划词取词</span>
                    <kbd className="font-mono bg-surface-alt px-1 rounded">⌘X</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
