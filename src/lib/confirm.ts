/**
 * 二次确认回复解析：判断用户输入是确认、取消还是无关输入。
 * 供智能体「破坏性工具执行前需用户确认」的状态机使用（见 agentStore.pendingConfirm）。
 * 纯函数、无依赖，便于单元测试。
 */
export type ConfirmIntent = 'affirm' | 'reject' | 'none'

const AFFIRM_RE = /^(确认|执行|确定|好|可以|是|对|yes|ok)/i
const REJECT_RE = /^(取消|不用|不要|不了|算了|停止|no|否|不)/i

/**
 * @param raw 用户原始输入
 * @returns 'affirm' 确认执行 | 'reject' 取消 | 'none' 与确认无关（当作新请求处理）
 * 注：先判确认再判取消；「好/可以/是/对」「不」等单字前缀即命中，属于预期行为。
 */
export function parseConfirmInput(raw: string): ConfirmIntent {
  const text = raw.trim()
  if (!text) return 'none'
  if (AFFIRM_RE.test(text)) return 'affirm'
  if (REJECT_RE.test(text)) return 'reject'
  return 'none'
}

/** pendingConfirm 状态机：输入 → 动作 的决策层（纯函数，便于单元测试） */
export type ConfirmAction = 'execute' | 'cancel' | 'discard' | 'pass'

/**
 * 根据「是否有挂起的二次确认」与用户当前输入，决定状态机下一步动作：
 * - 无挂起             → 'pass'（正常流程）
 * - 有挂起 + 确认       → 'execute'（执行挂起工具）
 * - 有挂起 + 取消       → 'cancel'（放弃挂起工具）
 * - 有挂起 + 无关输入    → 'discard'（丢弃挂起项，当作新请求继续）
 */
export function decidePendingInput(pending: boolean, raw: string): ConfirmAction {
  if (!pending) return 'pass'
  const intent = parseConfirmInput(raw)
  if (intent === 'affirm') return 'execute'
  if (intent === 'reject') return 'cancel'
  return 'discard'
}
