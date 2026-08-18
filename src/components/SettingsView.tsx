import { useEffect, useState } from 'react'
import { Eye, EyeOff, ExternalLink, Zap, CheckCircle2, XCircle, Keyboard, RefreshCw, ShieldCheck, Bot, BookOpen, Rocket, BadgeCheck, Sparkles, User } from 'lucide-react'
import { PROVIDERS, DOMAIN_PRESETS, type DomainPreset, useSettingsStore, type ThemeMode } from '../stores/settingsStore'
import { useAppStore } from '../stores/appStore'
import { refreshAgentAvailability } from '../stores/agentStore'
import { useProfileStore } from '../stores/profileStore'
import { llmChat, agentComplete } from '../lib/llm'

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

function OnboardStep({ done, title, desc, icon }: { done: boolean; title: string; desc: string; icon: React.ReactNode }): React.JSX.Element {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 ${done ? 'border-ok/30 bg-ok/5' : 'border-line bg-surface'}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${done ? 'bg-ok/15 text-ok' : 'bg-accent-soft text-accent'}`}>
        {done ? <CheckCircle2 size={15} /> : icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">{title}</p>
        <p className="truncate text-[11px] text-ink-3">{desc}</p>
      </div>
    </div>
  )
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }): React.JSX.Element {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-start justify-between gap-3 text-left">
      <span>
        <span className="block text-[12px] font-medium">{label}</span>
        <span className="block text-[11px] text-ink-3">{desc}</span>
      </span>
      <span className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? 'justify-end bg-accent' : 'justify-start bg-line-strong'}`}>
        <span className="h-4 w-4 rounded-full bg-white shadow" />
      </span>
    </button>
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
  const [shortcutState, setShortcutState] = useState<{ toggle: boolean; mode: boolean; selection: boolean; selectionAccel?: string; registeredAccels?: string[] } | null>(null)
  const [selTest, setSelTest] = useState<{ busy: boolean; ok?: boolean; msg?: string; accel?: string } | null>(null)
  const [axTrusted, setAxTrusted] = useState<boolean | null>(null)

  // 个人化档案 + 可信度开关
  const onboarded = useProfileStore((s) => s.onboarded)
  const profile = useProfileStore((s) => s.profile)
  const trust = useProfileStore((s) => s.trust)
  const updateProfile = useProfileStore((s) => s.updateProfile)
  const updateTrust = useProfileStore((s) => s.updateTrust)
  const setOnboarded = useProfileStore((s) => s.setOnboarded)

  const stepsDone = {
    translate: Boolean(settings.apiKey),
    agent: Boolean(settings.agentApiKey),
    dict: Boolean(settings.dictApiKey)
  }
  const doneCount = [stepsDone.translate, stepsDone.agent, stepsDone.dict].filter(Boolean).length

  useEffect(() => {
    void useProfileStore.getState().load()
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

  // 智能体（低配 GLM）独立连通测试
  const [agentTesting, setAgentTesting] = useState(false)
  const [agentTestResult, setAgentTestResult] = useState<{ ok: boolean; msg: string } | null>(null)
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
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-[17px] font-semibold">设置</h1>

        {/* 分组快捷跳转 */}
        <div className="sticky top-2 z-10 flex flex-wrap gap-1.5 rounded-xl border border-line bg-panel/90 p-2 backdrop-blur">
          {(
            [
              ['sec-translate', '翻译'],
              ['sec-agent', '智能体'],
              ['sec-dict', '词典'],
              ['sec-ocr', 'OCR'],
              ['sec-appearance', '外观'],
              ['sec-pref', '偏好'],
              ['sec-shortcuts', '快捷键']
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className="chip cursor-pointer transition hover:brightness-95"
              onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {label}
            </button>
          ))}
        </div>

        {!onboarded && (
          <section className="card space-y-3 border-accent/30 !bg-accent/5 p-5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Rocket size={14} className="text-accent" /> 快速开始 · {doneCount}/3 已配置
            </h2>
            <p className="text-[11px] leading-relaxed text-ink-3">
              三步即可让「翻译 + 智能助手 + 查词」全部可用。任一填上 Key 即可开始，可随时回来补全。
            </p>
            <div className="grid gap-2">
              <OnboardStep
                done={stepsDone.translate}
                title="① 翻译 / 重型任务"
                desc="关键，做文档 / 文本 / 图片翻译，例如 DeepSeek (免费额度)"
                icon={<Zap size={12} />}
              />
              <OnboardStep
                done={stepsDone.agent}
                title="② 智能助手"
                desc="免费 GLM-4-flash，指挥它帮你做事 / 复习 / 设目标"
                icon={<Sparkles size={12} />}
              />
              <OnboardStep
                done={stepsDone.dict}
                title="③ 词典查词 & 发音"
                desc="免费 uapis，查词带真实音标与发音，无幻觉"
                icon={<BookOpen size={12} />}
              />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-[11px] text-ink-3">全部配置后点「我已完成」开始使用。</p>
              <button className="btn btn-primary !px-4 !py-2 text-[12px]" disabled={doneCount < 3} onClick={() => setOnboarded(true)}>
                我已完成
              </button>
            </div>
          </section>
        )}

        {onboarded && (
          <section id="sec-profile" className="card space-y-3 p-5">
            <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
              <User size={14} className="text-accent" /> 个性化档案
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="text-[11px] font-medium text-ink-2">
                学习目标
                <input
                  className="input mt-1"
                  value={profile.goal}
                  onChange={(e) => updateProfile({ goal: e.target.value })}
                  placeholder="如：通过六级 / 读懂顶会论文"
                />
              </label>
              <label className="text-[11px] font-medium text-ink-2">
                当前水平
                <input
                  className="input mt-1"
                  value={profile.level}
                  onChange={(e) => updateProfile({ level: e.target.value })}
                  placeholder="如：四级 / IELTS 6"
                />
              </label>
            </div>
            <p className="text-[11px] leading-relaxed text-ink-3">
              智能体会在对话中参考这些信息，给出更贴合你的建议。
            </p>
          </section>
        )}

        <section id="sec-trust" className="card space-y-3 p-5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <BadgeCheck size={14} className="text-accent" /> 可信度
          </h2>
          <ToggleRow
            label="AI 生成内容标注"
            desc="在摘要 / 周报 / 批改等 AI 输出后附「AI 生成」标识，强调属机器生成"
            checked={trust.aiWatermark}
            onChange={(v) => updateTrust({ aiWatermark: v })}
          />
          <ToggleRow
            label="关键结论附带来源"
            desc="涉及具体数据 / 引用的结论尽量给出原文出处或定位"
            checked={trust.withSources}
            onChange={(v) => updateTrust({ withSources: v })}
          />
          <p className="text-[11px] leading-relaxed text-ink-3">
            查词默认走真实词典（uapis）避免幻觉；仅 AI 生产中，知识性判断会尽量区分「事实」与「推断」。
          </p>
        </section>

        <section id="sec-translate" className="card space-y-4 p-5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <Zap size={14} className="text-accent" /> 翻译 / 重型任务（高配 API）
          </h2>
          <p className="text-[11px] leading-relaxed text-ink-3">
            PDF/文本/图片翻译、文档总结、AI 批改等重量级生成任务统一走此处配置的模型（效果好、成本高）。
          </p>
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

        <section id="sec-agent" className="card space-y-3 p-5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <Bot size={14} className="text-accent" /> 智能体 / 轻量编排（低配 API）
          </h2>
          <p className="text-[11px] leading-relaxed text-ink-3">
            用于跳转、盘点生词、看到期、生成周报/摘要、朗读、讲名言等轻量编排；翻译与重型任务仍走上方高配 API。
            GLM-4-flash 免费额度见
            <button
              className="ml-0.5 inline-flex items-center gap-0.5 text-accent hover:underline"
              onClick={() => void window.bridge.openExternal('https://open.bigmodel.cn/pricing')}
            >
              智谱开放平台 <ExternalLink size={10} />
            </button>
            。
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-[12px] font-medium text-ink-2">
              Base URL
              <input
                className="input mt-1"
                value={settings.agentBaseUrl}
                onChange={(e) => update({ agentBaseUrl: e.target.value })}
                placeholder="https://open.bigmodel.cn/api/paas/v4"
              />
            </label>
            <label className="text-[12px] font-medium text-ink-2">
              模型
              <input
                className="input mt-1"
                value={settings.agentModel}
                onChange={(e) => update({ agentModel: e.target.value })}
                placeholder="glm-4-flash"
              />
            </label>
          </div>
          <label className="block text-[12px] font-medium text-ink-2">
            智能体 API Key（独立于翻译 Key）
            <div className="relative mt-1">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={settings.agentApiKey}
                onChange={(e) => {
                  update({ agentApiKey: e.target.value })
                  void refreshAgentAvailability()
                }}
                placeholder="智谱 API Key"
                autoComplete="off"
              />
            </div>
          </label>
          <div className="flex items-center gap-3">
            <button className="btn btn-primary" onClick={() => void testAgentConnection()} disabled={agentTesting}>
              {agentTesting ? <Bot size={13} className="animate-pulse" /> : <Bot size={13} />}
              {agentTesting ? '测试中…' : '测试连接'}
            </button>
            {agentTestResult && (
              <span className={`flex items-center gap-1.5 text-[12px] ${agentTestResult.ok ? 'text-ok' : 'text-danger'}`}>
                {agentTestResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                <span className="max-w-[380px] truncate">{agentTestResult.msg}</span>
              </span>
            )}
          </div>
        </section>

        <section id="sec-dict" className="card space-y-3 p-5">
          <h2 className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
            <BookOpen size={14} className="text-accent" /> 词典查询（uapis.cn · 免费）
          </h2>
          <p className="text-[11px] leading-relaxed text-ink-3">
            用于英文查词与发音（音标、词性、中文释义、双语例句，以及英/美发音音频），数据真实无幻觉。
            仅需一个 uapis API Key。
            <button
              className="ml-0.5 inline-flex items-center gap-0.5 text-accent hover:underline"
              onClick={() => void window.bridge.openExternal('https://uapis.cn')}
            >
              uapis.cn 官网 <ExternalLink size={10} />
            </button>
          </p>
          <label className="block text-[12px] font-medium text-ink-2">
            uapis API Key
            <div className="relative mt-1">
              <input
                className="input pr-10"
                type={showKey ? 'text' : 'password'}
                value={settings.dictApiKey}
                onChange={(e) => update({ dictApiKey: e.target.value })}
                placeholder="粘贴 uapis API Key"
                autoComplete="off"
              />
            </div>
          </label>
          <label className="block text-[12px] font-medium text-ink-2">
            查询方式（双轨）
            <select
              className="input mt-1"
              value={settings.lookupSource}
              onChange={(e) => update({ lookupSource: e.target.value as 'dict' | 'llm' })}
            >
              <option value="dict">词典优先：用 uapis（未关键词自动回退 AI）</option>
              <option value="llm">仅 AI 查词（需配置翻译 API）</option>
            </select>
          </label>
          <p className="text-[11px] leading-relaxed text-ink-3">
            填了 Key 且选择「词典优先」时，英文单词用免费词典 API（真实数据、带发音，未收录/拼写错误会直接提示，不硬编）；
            未填 Key 或词典查不到时自动回退到上方 AI 查词。中文查词、短语翻译仍走 AI。
          </p>
        </section>

        <section id="sec-ocr" className="card space-y-3 p-5">
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

        <section id="sec-appearance" className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">外观与提醒</h2>
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
          <div className="border-t border-line pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-1">每日复习提醒</p>
                <p className="text-[11px] leading-relaxed text-ink-3">
                  每天到点提示今天到期的生词（有到期词才提醒），点击通知可直达闪卡。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="input !w-28 !py-1.5 text-[12px]"
                  type="time"
                  value={settings.dailyReminderTime}
                  onChange={(e) => update({ dailyReminderTime: e.target.value || '20:00' })}
                  disabled={!settings.dailyReminder}
                />
                <button
                  className={`btn !px-3 !py-1.5 text-[11px] ${settings.dailyReminder ? '!bg-accent !text-white' : ''}`}
                  onClick={() => update({ dailyReminder: !settings.dailyReminder })}
                >
                  {settings.dailyReminder ? '已开启' : '开启提醒'}
                </button>
              </div>
            </div>
          </div>
        </section>

        <section id="sec-pref" className="card space-y-3 p-5">
          <h2 className="text-[13px] font-semibold text-ink-2">翻译偏好</h2>
          <label className="block text-[12px] font-medium text-ink-2">
            领域 / 风格预设
            <select
              className="input mt-1"
              value={settings.domain}
              onChange={(e) => update({ domain: e.target.value as DomainPreset })}
            >
              {Object.entries(DOMAIN_PRESETS).map(([k]) => (
                <option key={k} value={k}>
                  {k === 'general' ? '通用' : k === 'cs' ? '计算机论文' : k === 'bio' ? '生物医学' : k === 'news' ? '新闻时政' : '学术润色'}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[11px] leading-relaxed text-ink-3">切换翻译措辞倾向，术语用词随领域调整。</p>
          <ToggleRow
            label="术语一致性注入"
            desc="把生词本的词及其释义注入翻译提示词，保证同一术语全文译法统一"
            checked={settings.injectTerms}
            onChange={(v) => update({ injectTerms: v })}
          />
        </section>

        <section id="sec-shortcuts" className="card space-y-3 p-5">
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
              <kbd className="max-w-[240px] truncate rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-[12px] font-semibold">
                {isMac ? '⌘X' : (shortcutState?.registeredAccels?.length ? shortcutState.registeredAccels.join(' · ') : shortcutState?.selectionAccel || 'Alt+X')}
              </kbd>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[13px]">唤起小窗（并聚焦输入框）</span>
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
          {shortcutState && (!shortcutState.toggle || !shortcutState.mode || !shortcutState.selection) && (
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
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] font-medium">
                Windows 取词自检：模拟 Alt+X 全流程（隐藏本窗口 → 复制前台选中 → 读剪贴板）
              </span>
              <button
                className="btn !px-3 !py-1.5 text-[11px]"
                disabled={selTest?.busy}
                onClick={() => {
                  setSelTest({ busy: true })
                  void window.bridge.selectionTest().then((r) => {
                    setSelTest({
                      busy: false,
                      ok: !!r.text,
                      accel: r.accel,
                      msg: r.text
                        ? `取词成功（${r.text.length} 字符）`
                        : (r.error ?? '未检测到选中文字')
                    })
                  })
                }}
              >
                {selTest?.busy ? <Zap size={11} className="animate-pulse" /> : <Zap size={11} />}
                {selTest?.busy ? '测试中…' : '一键翻译自检'}
              </button>
            </div>
            {selTest && !selTest.busy && (
              <p className={`mt-2 flex items-center gap-1.5 text-[11px] ${selTest.ok ? 'text-ok' : 'text-danger'}`}>
                {selTest.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                <span className="max-w-[420px] break-all">
                  {selTest.accel ? `触发键 ${selTest.accel} · ` : ''}
                  {selTest.msg}
                </span>
              </p>
            )}
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
              提示：先在其它应用（浏览器/Word）选中一个英文单词，再点自检；若选中小窗自身文字会提示无选中。
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-ink-1">复制即译（剪贴板监听）</p>
                <p className="text-[11px] leading-relaxed text-ink-3">
                  在任意应用复制文字（Ctrl+C）即自动弹小窗翻译，不依赖快捷键；应用自身窗口内复制不打扰。
                </p>
              </div>
              <button
                className={`btn shrink-0 !px-3 !py-1.5 text-[11px] ${settings.copyWatch ? '!bg-accent !text-white' : ''}`}
                onClick={() => update({ copyWatch: !settings.copyWatch })}
              >
                {settings.copyWatch ? '已开启' : '开启'}
              </button>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-3">
            使用方式：先在任意应用（浏览器 / Word / PDF）里选中单词或句子（焦点须在该应用上），再按{' '}
            {isMac ? '⌘X' : 'Alt+X / Ctrl+Alt+X / Ctrl+Shift+X（已全部注册，任一可触发）'}
            即自动「复制 → 唤起小窗 → 翻译」；小窗自身聚焦时按它会提示先选词。
            <br />
            唤起小窗：按 {isMac ? '⌘⇧T' : 'Ctrl+Shift+T'}；或点击系统托盘图标随时唤回。
            <br />
            若快捷键始终无反应：打开上方「复制即译」，在任意应用 Ctrl+C 复制即可自动翻译。
          </p>
          <p className="text-[11px] text-ink-3">
            当前平台：{platform || '…'} · 快捷键在 Windows 与 macOS 上自动适配（⌘ / Ctrl）
          </p>
        </section>
      </div>
    </div>
  )
}
