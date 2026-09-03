/** 白名单 HTML 清理：LLM 输出的 Markdown 渲染结果可能包含恶意标签/事件，渲染前必须过此函数 */
const ALLOWED_TAGS = new Set([
  'P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'DEL', 'CODE', 'PRE',
  'UL', 'OL', 'LI', 'BLOCKQUOTE', 'HR',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD',
  'A', 'IMG', 'SPAN', 'DIV'
])

const ALLOWED_ATTRS = new Set(['href', 'src', 'title', 'alt', 'colspan', 'rowspan', 'class', 'style'])

export function sanitizeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (el: Element): void => {
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toUpperCase()
      if (!ALLOWED_TAGS.has(tag)) {
        // 脚本/样式/内嵌/表单等一律剥离标签、保留文本
        child.replaceWith(...Array.from(child.childNodes))
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith('on')) {
          child.removeAttribute(attr.name)
          continue
        }
        if (!ALLOWED_ATTRS.has(name)) {
          child.removeAttribute(attr.name)
          continue
        }
        if (name === 'href' && !/^(https?:|mailto:|#)/i.test(attr.value)) {
          child.removeAttribute('href')
        }
        if (name === 'src' && !/^https?:/i.test(attr.value)) {
          child.removeAttribute('src')
        }
      }
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}
