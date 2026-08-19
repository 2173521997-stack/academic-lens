import { useSettingsStore, DOMAIN_PRESETS, type DomainPreset } from '../stores/settingsStore'
import { useWordbookStore } from '../stores/wordbookStore'

const BASE = '你是专业学术翻译。将用户提供的英文内容翻译为简体中文，保持学术语气、术语准确、长难句拆分通顺。'

/**
 * 由当前生词本构造术语对照行（word → 中文），仅取有中文释义的词。
 * 上限 40 个，避免撑爆上下文；按词条加入顺序取，优先有释义者。
 */
export function buildTermLines(): string[] {
  const wb = useWordbookStore.getState().words
  const lines: string[] = []
  for (const w of wb) {
    const d = (w.definition ?? '').trim()
    if (!d) continue
    lines.push(`${w.word} → ${d}`)
    if (lines.length >= 40) break
  }
  return lines
}

function buildTermBlock(): string {
  if (!useSettingsStore.getState().settings.injectTerms) return ''
  const lines = buildTermLines()
  if (!lines.length) return ''
  return (
    '\n\n[术语对照表：以下术语必须遵循这里指定的译法，保持全文一致]\n' + lines.join('\n')
  )
}

/** 核心翻译系统提示：基础指令 + 领域预设 + 术语注入（domain 可显式指定，缺省取全局设置） */
export function buildTranslateSys(extra?: string, domain?: DomainPreset): string {
  const d = domain ?? useSettingsStore.getState().settings.domain
  const seg = DOMAIN_PRESETS[d ?? 'general'] ?? DOMAIN_PRESETS.general
  let sys = `${BASE}${seg ? '\n' + seg : ''}`
  sys += buildTermBlock()
  if (extra) sys += '\n' + extra
  sys += '\n只输出译文，不要任何解释或前缀。'
  return sys
}

/** 批处理 JSON 系统提示（key 为编号） */
export function buildBatchSys(domain?: DomainPreset): string {
  const base = buildTranslateSys(
    '输入以 [1] [2] … 编号，你只输出一个 JSON 对象：键为编号字符串（如 "1"、"2"），值为对应译文。不要用 Markdown 代码块包裹。',
    domain
  )
  return base
}

/** 表格专用系统提示：保持行列与结构，只译文本，数字/公式/引用不动 */
export function buildTableSys(domain?: DomainPreset): string {
  const base = buildTranslateSys(
    '输入内容是表格（以 | 分隔）。输出必须保持完全相同的行列数与 | 分隔结构，只翻译单元格内的文字，数字、公式、代码、引用保持不变。不要调整行数或列数。',
    domain
  )
  return base
}