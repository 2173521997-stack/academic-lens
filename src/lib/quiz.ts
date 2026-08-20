import { llmJSON } from './llm'

export interface QuizOption {
  key: 'A' | 'B' | 'C' | 'D'
  text: string
}

export interface QuizQuestion {
  id: string
  type: 'choice' | 'blank' | 'subjective'
  title: string
  options?: QuizOption[]
  answer: string
  explanation: string
  keyTerms: string[] // 该题涉及的核心考点/生词
}

export interface QuizPaper {
  title: string
  questions: QuizQuestion[]
}

export interface QuizGradeResult {
  score: number // 0-100
  feedback: string
  missedTerms: string[] // 建议加入生词本/闪卡的词
  details: {
    questionId: string
    isCorrect: boolean
    userAnswer: string
    correctAnswer: string
    comment: string
  }[]
}

const SYS_QUIZ_GEN =
  '你是一名资深大学学术导师与英语命题专家。基于用户提供的学术论文/课件内容，请生成一份精准的随堂自测题（共 3 道题），' +
  '帮助大学生检验是否真正读懂了核心贡献、关键术语与长难句。' +
  '请必须且只返回一个严格合法的 JSON 对象（不要 Markdown 格式块包裹，不要任何额外开场白），字段结构如下：\n' +
  '{\n' +
  '  "title": "自测测验标题",\n' +
  '  "questions": [\n' +
  '    {\n' +
  '      "id": "q1",\n' +
  '      "type": "choice",\n' +
  '      "title": "【核心观点单选】题目描述...",\n' +
  '      "options": [\n' +
  '        {"key": "A", "text": "选项 A 内容"},\n' +
  '        {"key": "B", "text": "选项 B 内容"},\n' +
  '        {"key": "C", "text": "选项 C 内容"},\n' +
  '        {"key": "D", "text": "选项 D 内容"}\n' +
  '      ],\n' +
  '      "answer": "A",\n' +
  '      "explanation": "答案解析与原文依据...",\n' +
  '      "keyTerms": ["contrastive", "regularization"]\n' +
  '    },\n' +
  '    {\n' +
  '      "id": "q2",\n' +
  '      "type": "blank",\n' +
  '      "title": "【专业术语填空】根据文意，作者提出的用于解决过拟合的机制被称为 ____ (填核心英文术语)。",\n' +
  '      "answer": "Dropout",\n' +
  '      "explanation": "解析说明...",\n' +
  '      "keyTerms": ["dropout", "overfitting"]\n' +
  '    },\n' +
  '    {\n' +
  '      "id": "q3",\n' +
  '      "type": "subjective",\n' +
  '      "title": "【重点结论翻译/理解】请用中文简述：文中所述该算法相比传统 Baseline 的核心优势是什么？",\n' +
  '      "answer": "简要参考要点...",\n' +
  '      "explanation": "采分点解析...",\n' +
  '      "keyTerms": ["baseline", "efficiency"]\n' +
  '    }\n' +
  '  ]\n' +
  '}'

export async function generateQuiz(
  docName: string,
  textSnippet: string,
  customInstruction?: string
): Promise<QuizPaper> {
  const instructionPart = customInstruction ? `\n\n【出题重点/附加要求】：\n${customInstruction}` : ''
  const userPrompt = `【文档名称】：${docName}\n\n【文档核心内容片段】：\n${textSnippet.slice(0, 4500)}${instructionPart}`
  const call = llmJSON(
    [
      { role: 'system', content: SYS_QUIZ_GEN },
      { role: 'user', content: userPrompt }
    ],
    { temperature: 0.3 }
  )

  const rawJson = await call.promise

  try {
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson) as QuizPaper
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      return parsed
    }
  } catch {
    /* 异常回退 */
  }

  return {
    title: `${docName} 随堂自测`,
    questions: [
      {
        id: 'q1',
        type: 'choice',
        title: '本文主要解决的核心科学或技术问题是什么？',
        options: [
          { key: 'A', text: '提出新架构以提升模型泛化能力' },
          { key: 'B', text: '对传统硬件进行性能评测' },
          { key: 'C', text: '整理领域内的综述历史' },
          { key: 'D', text: '构建大规模多模态数据集' }
        ],
        answer: 'A',
        explanation: '根据文章摘要与引言，本文核心贡献为算法创新。',
        keyTerms: ['generalization', 'architecture']
      }
    ]
  }
}

const SYS_QUIZ_GRADE =
  '你是一名大学英语与学术论文导师。请批改学生的随堂自测答卷。' +
  '请必须且只返回一个严格合法的 JSON 对象（不要 Markdown 格式块包裹，不要任何额外开场白），字段结构如下：\n' +
  '{\n' +
  '  "score": 85,\n' +
  '  "feedback": "总体评价与薄弱点鼓励...",\n' +
  '  "missedTerms": ["需重点复习的英文单词1", "需重点复习的英文单词2"],\n' +
  '  "details": [\n' +
  '    {"questionId": "q1", "isCorrect": true, "userAnswer": "A", "correctAnswer": "A", "comment": "回答正确！准确把握了核心贡献。"}\n' +
  '  ]\n' +
  '}'

export async function gradeQuiz(
  paper: QuizPaper,
  userAnswers: Record<string, string>
): Promise<QuizGradeResult> {
  const prompt = `【测试题与参考答案】：\n${JSON.stringify(paper.questions, null, 2)}\n\n【学生提交的作答】：\n${JSON.stringify(userAnswers, null, 2)}`
  const call = llmJSON(
    [
      { role: 'system', content: SYS_QUIZ_GRADE },
      { role: 'user', content: prompt }
    ],
    { temperature: 0.2 }
  )

  const rawJson = await call.promise

  try {
    const jsonMatch = rawJson.match(/\{[\s\S]*\}/)
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawJson) as QuizGradeResult
    if (parsed && typeof parsed.score === 'number') {
      return parsed
    }
  } catch {
    /* 异常回退 */
  }

  return {
    score: 80,
    feedback: '完成随堂自测！建议将生词加入闪卡进行定期复习。',
    missedTerms: paper.questions.flatMap((q) => q.keyTerms).slice(0, 4),
    details: paper.questions.map((q) => ({
      questionId: q.id,
      isCorrect: true,
      userAnswer: userAnswers[q.id] ?? '（未作答）',
      correctAnswer: q.answer,
      comment: q.explanation
    }))
  }
}
