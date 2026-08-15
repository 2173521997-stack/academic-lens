import { streamLLM } from '../electron/llm.ts'

const key = process.env.DEEPSEEK_API_KEY
if (!key) {
  console.error('MISSING DEEPSEEK_API_KEY')
  process.exit(1)
}

let chunks = 0
let full = ''
const t0 = Date.now()
const result = await streamLLM(
  {
    baseUrl: 'https://api.deepseek.com',
    apiKey: key,
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: '你是学术翻译。' },
      { role: 'user', content: 'Translate: "Machine learning models generalize well when trained on diverse data."' }
    ],
    maxTokens: 200
  },
  (d) => {
    chunks++
    full += d
  },
  new AbortController().signal
)

console.log(`OK 用时 ${Date.now() - t0}ms, ${chunks} 个 chunk, ${full.length} 字符`)
console.log('输出:', full)
console.log('完整长度校验:', result.full.length === full.length ? 'PASS' : 'FAIL')
