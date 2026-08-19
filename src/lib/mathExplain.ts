import { llmJSON } from './llm'

export interface MathSymbol {
  symbol: string
  name: string
  meaning: string
}

export interface MathExplanation {
  latex: string
  plainSummary: string
  intuition: string
  symbols: MathSymbol[]
  steps: string[]
}

const SYS_MATH =
  '你是一名顶级理工科与计算机学术导师，擅长用最清晰直观的语言向大学生讲解论文中的复杂数学公式。' +
  '用户会提供一个数学公式（或 LaTeX 表达式）及可能的前后文。' +
  '请剖析该公式，必须且只返回一个严格合法的 JSON 对象（不要 Markdown 格式块包裹，不要任何额外开场白），字段结构如下：\n' +
  '{\n' +
  '  "plainSummary": "一句话大白话直击要害（如：对难样本进行动态加权惩罚）",\n' +
  '  "intuition": "通俗原理解释：为什么设计这个公式？它在整篇论文算法链路中起什么关键作用？解决了什么传统方法的弊端？（2~3 句话讲透）",\n' +
  '  "symbols": [\n' +
  '    {"symbol": "\\\\alpha_i^{(t)}", "name": "注意力权重系数", "meaning": "表示第 t 步解码时对第 i 个输入词的关注度比例，介于 0 到 1 之间"}\n' +
  '  ],\n' +
  '  "steps": [\n' +
  '    "步骤 1：输入 Query 和 Key 计算点积相似度",\n' +
  '    "步骤 2：除以根号 d_k 进行缩放缩放，防止梯度消失",\n' +
  '    "步骤 3：经过 Softmax 归一化为概率分布"\n' +
  '  ]\n' +
  '}'

export async function explainMath(latex: string, context: string = ''): Promise<MathExplanation> {
  const trimmed = latex.trim()
  if (!trimmed) throw new Error('公式内容为空')

  const userPrompt = `【数学公式/LaTeX】：\n${trimmed}\n\n【论文上下文片段】：\n${context.trim() || '（无额外上下文，请根据公式自身常规数学/机器学习定义进行深度解析）'}`

  const call = llmJSON(
    [
      { role: 'system', content: SYS_MATH },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.2 }
  )

  const rawJson = await call.promise

  let parsed: {
    plainSummary?: string
    intuition?: string
    symbols?: MathSymbol[]
    steps?: string[]
  } = {}

  try {
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson)
  } catch {
    parsed = {
      plainSummary: '学术公式推导与计算变换',
      intuition: rawJson,
      symbols: [],
      steps: []
    }
  }

  return {
    latex: trimmed,
    plainSummary: parsed.plainSummary ?? '学术公式算法解析',
    intuition: parsed.intuition ?? '',
    symbols: Array.isArray(parsed.symbols) ? parsed.symbols : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : []
  }
}
