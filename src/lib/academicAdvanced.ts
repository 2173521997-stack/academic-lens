/* =====================================================================
 * 高级学术研读与英语精通 AI 引擎
 * 包含：审稿人批判评审、算法复现代码骨架、长难句语法树拆解、同义词辨析、雅思托福打分
 * ===================================================================== */

import { agentComplete } from './llm'

/** 顶刊审稿人视角深度评审（Reviewer Perspective） */
export async function generatePeerReview(paperText: string, paperTitle: string): Promise<string> {
  const preview = paperText.slice(0, 3000)
  const prompt =
    `你是顶级国际学术期刊（如 Nature, Science, IEEE TPAMI, NeurIPS）的资深审稿专家（Senior Area Chair）。\n` +
    `请对文献《${paperTitle}》进行严谨、深刻、客观的同行评审（Peer Review）：\n\n` +
    `【文献材料预览】：\n${preview}\n\n` +
    `请用 Markdown 格式严格输出以下模块：\n` +
    `### ⚖️ 顶刊同行评审报告 (Peer Review Report)\n` +
    `> **文献题目**：《${paperTitle}》\n\n` +
    `#### 1. 🌟 核心贡献与创新性评估 (Novelty & Contribution)\n` +
    `- 核心解决的问题是什么？\n` +
    `- 与当前 SOTA 方法相比，其核心技术创新点在哪？\n\n` +
    `#### 2. 🔬 方法论与实验严谨度 (Methodological Soundness)\n` +
    `- 理论推导与实验设计是否扎实？\n` +
    `- 消融实验（Ablation Study）是否充分支撑了其结论？\n\n` +
    `#### 3. ⚠️ 主要局限性与质疑点 (Weaknesses & Critical Questions)\n` +
    `- 审稿人最为关切的 2-3 个技术盲点、假设缺陷或算力开销问题。\n\n` +
    `#### 4. 📊 综合评分与录用建议 (Verdict & Rating)\n` +
    `| 维度 | 得分 (1-10) | 审稿人简评 |\n` +
    `| :--- | :---: | :--- |\n` +
    `| **创新性 (Novelty)** | X/10 | ... |\n` +
    `| **严谨度 (Soundness)** | X/10 | ... |\n` +
    `| **写作清晰度 (Clarity)** | X/10 | ... |\n` +
    `| **潜在影响力 (Impact)** | X/10 | ... |\n\n` +
    `**评审结论**：Accept / Weak Accept / Borderline / Weak Reject`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是严谨深邃的顶刊审稿专家，评价客观中肯、直击痛点。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.2, maxTokens: 1500 }
    ).promise
    return res.trim()
  } catch (e) {
    return `审稿人评估生成失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 算法实验复现代码骨架生成（Code Skeleton & Repro Guide） */
export async function generateCodeSkeleton(paperText: string, paperTitle: string): Promise<string> {
  const preview = paperText.slice(0, 3000)
  const prompt =
    `你是顶尖的 AI 算法复现工程师。请根据文献《${paperTitle}》中的核心算法与架构，提取其实验复现关键要素，并编写一份清晰、模块化的 PyTorch/Python 核心实现代码骨架（Code Skeleton）：\n\n` +
    `【文献材料预览】：\n${preview}\n\n` +
    `请用 Markdown 格式输出：\n` +
    `### 💻 《${paperTitle}》核心算法实现与复现指南\n\n` +
    `#### 1. 📋 输入输出维度与超参数规范\n` +
    `#### 2. 🧠 核心模块 PyTorch 代码骨架 (含详细注释与 Forward 流程)\n` +
    `\`\`\`python\n` +
    `# 核心实现代码\n` +
    `\`\`\`\n` +
    `#### 3. 🎯 训练技巧与复现避坑指南 (Loss 函数、优化器设置与常见梯度问题)`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是顶尖算法工程师，输出代码规范优雅、类型注解完备。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.1, maxTokens: 1600 }
    ).promise
    return res.trim()
  } catch (e) {
    return `代码骨架生成失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 学术长难句语法树与结构深度拆解 */
export async function analyzeGrammarTree(sentence: string): Promise<string> {
  const prompt =
    `请对以下英文学术长难句进行深度语法解剖与结构拆解：\n\n` +
    `句子：${sentence}\n\n` +
    `请用 Markdown 格式输出：\n` +
    `### 🌳 学术长难句语法精析\n\n` +
    `> **原句**：${sentence}\n\n` +
    `#### 1. 🦴 核心主干提取 (Core Backbone)\n` +
    `- **主语 (Subject)**：...\n` +
    `- **谓语 (Predicate)**：...\n` +
    `- **宾语/表语 (Object/Predicative)**：...\n\n` +
    `#### 2. 🌿 修饰成分与从句层级剖析 (Clause & Modifiers)\n` +
    `- 定语从句 / 状语从句 / 分词短语的作用与修饰对象\n\n` +
    `#### 3. 💬 白话顺畅译文与学术写作借鉴\n` +
    `- **地道中文翻译**：...\n` +
    `- **可迁移句型公式**：...`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是资深英语语言学与学术写作教授，擅长长难句解剖。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.1, maxTokens: 1200 }
    ).promise
    return res.trim()
  } catch (e) {
    return `语法拆解失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 同义词学术语感辨析与搭配 */
export async function explainSynonymNuance(words: string): Promise<string> {
  const prompt =
    `请对以下相近的学术词汇进行深度辨析：${words}\n\n` +
    `请用 Markdown 格式输出：\n` +
    `### 💡 学术同义词辨析与地道搭配\n\n` +
    `1. 🎯 **核心语感差异与适用语境**（正式程度、强调侧重点）；\n` +
    `2. 📝 **顶刊高频搭配 (Collocations)** 与学术例句；\n` +
    `3. ⚠️ **常见混淆与误用警示**。`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是学术英语词汇专家。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.2, maxTokens: 1000 }
    ).promise
    return res.trim()
  } catch (e) {
    return `同义词辨析失败：${e instanceof Error ? e.message : String(e)}`
  }
}

/** 雅思 / 托福学术写作批改与 4 维度打分 */
export async function evaluateIeltsToeflEssay(essay: string, taskPrompt?: string): Promise<string> {
  const prompt =
    `你是雅思/托福官方认证的资深写作考官。请对考生的学术作文进行专业批改打分：\n\n` +
    `${taskPrompt ? `【题目要求】：${taskPrompt}\n\n` : ''}` +
    `【考生作文】：\n${essay}\n\n` +
    `请用 Markdown 输出：\n` +
    `### 📝 雅思 / 托福学术写作考官精批\n\n` +
    `| 评分维度 | 预估得分 (0-9 / 0-30) | 考官评价与失分点 |\n` +
    `| :--- | :---: | :--- |\n` +
    `| **任务切题度 (TR/TA)** | ... | ... |\n` +
    `| **连贯与衔接 (CC)** | ... | ... |\n` +
    `| **词汇丰富度 (LR)** | ... | ... |\n` +
    `| **语法多样性与准确性 (GRA)** | ... | ... |\n\n` +
    `#### 🌟 核心问题与逐句精修建议 (Top Improvements)\n` +
    `#### 💎 考官高分范文重写 (Band 8.0+ / 28+ Rewrite)`

  try {
    const res = await agentComplete(
      [
        { role: 'system', content: '你是极其严谨且建设性的雅思/托福写作前考官。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.2, maxTokens: 1600 }
    ).promise
    return res.trim()
  } catch (e) {
    return `作文批改失败：${e instanceof Error ? e.message : String(e)}`
  }
}
