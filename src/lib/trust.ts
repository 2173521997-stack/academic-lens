import { useProfileStore } from '../stores/profileStore'

/**
 * 可信度标注工具：在 AI 生成内容末尾追加「AI 生成 / 建议核实」标识，
 * 开关见「设置 → 可信度」。可在各类 AI 产出（周报、整理、分级、批改、摘要）复用。
 */
export function appendAiMark(text: string, kind = 'AI 生成', extra = ''): string {
  if (!text.trim()) return text
  const t = useProfileStore.getState().trust
  if (!t.aiWatermark) return text
  const note = t.withSources ? ' · 建议以原文/词典为准' : ''
  return `${text.trim()}\n\n---\n> ${kind} · 未经人工核对${note}${extra}`
}

/** 对话内联水印（用于智能体回复末尾标注），返回是否启用 */
export function aiMarkSuffix(): string {
  const t = useProfileStore.getState().trust
  return t.aiWatermark ? `\n\n（以上由 AI 生成，请谨慎参考。${t.withSources ? '关键信息请以词典/原文为准。' : ''}）` : ''
}