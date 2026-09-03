import { agentComplete, llmChat } from './llm'
import { TOOLS, runTool, resolveUserIntent, type ToolId } from './agentTools'
import type { LLMMessage } from '../bridge/types'

export interface AgentStep {
  kind: 'tool' | 'done'
  toolLabel?: string
  sideEffect?: boolean
  observation?: string
}

export interface AgentLoopOptions {
  maxSteps?: number
  deepReasoning?: boolean
  onStep?: (step: AgentStep) => void
}

const REACT_MAX_STEPS = 6

function buildToolDescription(): string {
  return TOOLS.map((t) => {
    const params = t.params.map((p) => `${p.name}${p.required ? '*' : ''} (${p.desc})`).join(', ')
    return `- ${t.id}: ${t.desc}${params ? ` [参数: ${params}]` : ''}`
  }).join('\n')
}

const REACT_SYS = (): string =>
  '你是 Academic Lens 的高级学术智能体与桌面操作助手。你具备直接操纵软件各项底层功能与数据的完整系统权限。\n' +
  '你可以根据用户的指令自主规划并调用以下工具完成翻译控制、词库管理、文档导出、系统设置等任务：\n\n' +
  '【可用系统工具列表】：\n' +
  `${buildToolDescription()}\n\n` +
  '【ReAct 运行规范】：\n' +
  '1. 若需要执行软件内部操作（如添加生词、页面跳转、导出、开始翻译、切换主题等），严格输出 JSON：\n' +
  '   {"tool":"<tool_id>","params":{"<key>":"<val>"}}\n' +
  '2. 若任务已执行完毕或属于纯学术/考研/雅思/课件提问，直接给出专业详尽的回答：\n' +
  '   {"done":true,"answer":"<给用户的专业解答>"}\n' +
  '3. 必须输出合法 JSON，不要包含任何前缀闲聊或 Markdown 代码块包裹。'

interface ReActDecision {
  tool?: string
  params?: Record<string, string>
  done?: boolean
  answer?: string
}

/**
 * 从模型输出中稳健提取 ReAct 决策 JSON：
 * - 剥掉 ```json/``` 代码块围栏与前后缀闲聊；
 * - 只取首个 {...} 完整块再 JSON.parse。
 */
function extractJsonObj(raw: string): ReActDecision | null {
  let text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as ReActDecision
  } catch {
    return null
  }
}

const JSON_REPAIR_HINT =
  '你的上一条输出不是合法 JSON（可能被 ``` 代码块或多余文字包裹）。' +
  '请重新输出，只给一个合法 JSON 对象，不要代码块、不要任何解释：' +
  '要么 {"tool":"<工具id>","params":{...}}，要么 {"done":true,"answer":"<给用户的专业解答>"}。'

export async function runReAct(
  userText: string,
  opts: AgentLoopOptions = {}
): Promise<{ answer: string; steps: AgentStep[] }> {
  const maxSteps = opts.maxSteps ?? REACT_MAX_STEPS
  const steps: AgentStep[] = []
  const seed: LLMMessage[] = [
    { role: 'system', content: REACT_SYS() },
    { role: 'user', content: userText }
  ]
  let messages: LLMMessage[] = seed
  let answer = ''
  let repairTried = false

  for (let i = 0; i < maxSteps; i++) {
    let rawResponse = ''
    if (opts.deepReasoning) {
      // 深度思考模式使用主模型
      rawResponse = await llmChat(messages, { temperature: 0.1, maxTokens: 1400 })
    } else {
      // 极速模式使用智能体默认模型
      const decRaw = await agentComplete(messages, { temperature: 0, maxTokens: 1024, json: true })
      rawResponse = await decRaw.promise
    }

    const decision = extractJsonObj(rawResponse)
    if (!decision) {
      // 输出里疑似含 JSON（可能解析失败），先引导模型修正一次，避免工具调用被吞成纯文本
      if (rawResponse.includes('{') && !repairTried && i < maxSteps - 1) {
        repairTried = true
        messages = [...messages, { role: 'user', content: JSON_REPAIR_HINT }]
        continue
      }
      // 非 JSON 输出：直接作为最终回答返回
      answer = rawResponse.trim() || '已处理完成。'
      steps.push({ kind: 'done' })
      break
    }

    if (decision.done || !decision.tool) {
      answer = (decision.answer ?? '').trim() || '（已完成）'
      steps.push({ kind: 'done' })
      break
    }

    const toolId = decision.tool as ToolId
    const tool = TOOLS.find((t) => t.id === toolId)
    if (!tool) {
      messages = [
        ...messages,
        { role: 'user', content: `错误：工具「${toolId}」不存在。请改用已知工具或输出最终 answer。` }
      ]
      continue
    }

    const params = decision.params ?? {}
    const result = await runTool(toolId, params)
    const step: AgentStep = {
      kind: 'tool',
      toolLabel: tool.name,
      sideEffect: tool.sideEffect,
      observation: result.text
    }
    steps.push(step)
    opts.onStep?.(step)

    const observation = `${tool.name} 执行结果：\n${result.text.slice(0, 800)}`
    messages = [
      ...messages,
      {
        role: 'user',
        content: `系统已执行工具「${tool.name}」，返回结果：\n${observation}\n请根据结果决定下一步调用工具或输出最终 answer。`
      }
    ]
  }

  if (!answer) answer = '已完成相关操作。'
  return { answer, steps }
}

export { resolveUserIntent as resolveByRules }
