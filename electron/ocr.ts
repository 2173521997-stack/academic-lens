export interface OcrSettings {
  provider: 'baidu' | 'openai'
  apiKey: string
  secretKey?: string
  baseUrl?: string
  model?: string
}

export interface OcrResult {
  text: string
  lines: string[]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function getBaiduToken(apiKey: string, secretKey: string): Promise<string> {
  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`
  const res = await fetch(url, { method: 'POST' })
  const json = (await res.json()) as { access_token?: string; error_description?: string }
  if (!json.access_token) {
    throw new Error(`百度 OCR Token 获取失败: ${json.error_description ?? res.status}`)
  }
  return json.access_token
}

export async function recognizeImage(
  base64: string,
  settings: OcrSettings
): Promise<OcrResult> {
  if (!settings.apiKey) throw new Error('未配置 OCR API Key，请在设置中填写')

  if (settings.provider === 'baidu') {
    const token = await getBaiduToken(settings.apiKey, settings.secretKey ?? '')
    const res = await fetch(
      `https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `image=${encodeURIComponent(base64)}`
      }
    )
    const json = (await res.json()) as {
      words_result?: { words: string }[]
      error_msg?: string
    }
    if (!json.words_result) {
      throw new Error(`百度 OCR 识别失败: ${json.error_msg ?? res.status}`)
    }
    const lines = json.words_result.map((w) => w.words.trim()).filter(Boolean)
    return { text: lines.join('\n'), lines }
  }

  // OpenAI 兼容视觉模型（Kimi / 豆包 / GLM 等）
  const base = (settings.baseUrl || 'https://api.moonshot.cn/v1').replace(/\/+$/, '')
  const model = settings.model || 'moonshot-v1-8k-vision-preview'
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${base64}` }
            },
            {
              type: 'text',
              text: '请识别图片中的全部英文文字，逐行输出，保留原有换行与标点，不要翻译、不要解释。'
            }
          ]
        }
      ],
      max_tokens: 2000,
      temperature: 0
    })
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`视觉 OCR 请求失败 (${res.status}): ${detail.slice(0, 200)}`)
  }
  const json = (await res.json()) as {
    choices?: { message?: { content?: string } }[]
  }
  const text = (json.choices?.[0]?.message?.content ?? '').trim()
  if (!text) throw new Error('视觉 OCR 返回为空（模型不支持图片输入？）')
  const lines = text
    .split(/\n+/)
    .map((l) => l.trim().replace(/^[-*\d.\s]+/, ''))
    .filter((l) => l.length > 0)
  return { text, lines }
}

/** 重试一次（百度偶尔限流），保留原始错误 */
export async function recognizeWithRetry(
  base64: string,
  settings: OcrSettings
): Promise<OcrResult> {
  try {
    return await recognizeImage(base64, settings)
  } catch (first) {
    await sleep(800)
    return await recognizeImage(base64, settings).catch(() => {
      throw first
    })
  }
}
