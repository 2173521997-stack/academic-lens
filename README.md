# Academic Lens · 学术透镜

> 安静、快速、聪明的英文阅读伴侣 —— 论文 / 课件 / 网页的随取随译

Academic Lens 是一个基于 Electron 的本地桌面翻译工具，专注英文论文与课件的阅读场景：全局一键取词翻译、PDF 分页对照、Word 整篇译文、生词本与 AI 学术助手一应俱全。

![GitHub release](https://img.shields.io/github/v/release/your-name/academic-lens)

## ✨ 功能特性

- **一键翻译**：任意 App 中选中单词/句子，按 `Cmd+X` 即自动复制、唤起小窗并翻译（单词→音标词卡，句子→整句译文，中文→英文）
- **文档翻译**：导入 PDF / Word / TXT / Markdown，整体翻译全篇；**PDF 按页分组**，左右双栏（左英右中）逐段对照，译文常驻显示
- **翻译管线**：短段批量请求（省 8 倍请求数）+ 本地缓存（重开文档秒出）+ 失败自动重试与回退
- **中文↔英文双向**：输入中文自动译成英文（词语→英文词卡，句子→直译）
- **图片 OCR**：截图粘贴即可本地 OCR 识别（tesseract.js 离线引擎）
- **AI 学术助手**：基于当前文档提问、@段落引用、/总结 /解释术语 /出题 快捷指令
- **生词本**：一键收藏（音标/释义/例句），支持搜索
- **小窗 / 大窗双模式**：小窗随取随查，大窗沉浸阅读；全局快捷键唤起

## ⌨️ 快捷键

| 快捷键 | 功能 |
|---|---|
| `Cmd/Ctrl+X` | 一键翻译：复制选中 → 唤起小窗 → 自动翻译 |
| `Cmd/Ctrl+Shift+T` | 唤起 / 隐藏小窗（并聚焦输入栏） |
| `Cmd/Ctrl+Shift+M` | 切换小窗 / 大窗 |

> macOS 首次使用 `Cmd+X` 需在「系统设置 → 隐私与安全性 → 辅助功能」中授权本应用。

## 🔑 AI 服务配置

设置页内置多个 OpenAI 兼容服务商，填入 API Key 即可：

| 服务商 | 默认模型 |
|---|---|
| DeepSeek | deepseek-chat |
| GLM（智谱） | glm-4-flash |
| MiMo（小米） | mimo-7b-rl |
| 豆包（火山方舟） | doubao-seed-1-6-250615 |
| Kimi（月之暗面） | moonshot-v1-8k |
| 自定义（任意 OpenAI 兼容端点） | — |

API Key 仅保存在本机用户目录，不会上传。

> 💰 **小窗翻译默认走免费 GLM（glm-4-flash）**：小窗日常查词、句子翻译、图片公式校正/AI 深度解析均优先使用「AI 智能体独立低配 API」中配置的免费 GLM 模型，以经济为先；大窗整篇文档翻译仍使用「翻译大模型」中配置的主服务商模型。若该免费配置留空，则复用主翻译 API Key。

> 🤖 **AI 助手（内置）**：极速模式默认走免费 GLM-4-Flash（含对当前文档的提问），深度思考才调用主翻译模型；回答引用文档会用 `【P段落序号】` 标注，点击即可跳回原文定位；小窗底部「问 AI」可一键把当前划词/译文交给助手深入解析。

## 🛠️ 开发与构建

环境要求：Node.js ≥ 22（本地开发建议 22+，Electron 43）

```bash
# 安装依赖
npm install

# 开发模式（热更新）
npm run dev

# 类型检查 + 生产构建
npm run build

# 冒烟测试（启动应用并自动退出）
npm run smoke
```

### 打包安装包

```bash
# macOS（zip + dmg）
npm run dist:mac

# Windows（NSIS 安装包）
npm run dist:win
```

产物输出到 `release/` 目录。

### CI 自动打包

仓库已内置 GitHub Actions（`.github/workflows/build.yml`）：推送 `v*` 标签或手动触发（workflow_dispatch），自动在 **Windows / macOS / Linux** 三平台构建安装包并上传为 Actions Artifact。

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 📦 测试

```bash
# 端到端测试（含 mock LLM 服务：翻译管线 / 缓存 / 中译英 / 分页对照）
./node_modules/.bin/electron test/e2e-batch.cjs
./node_modules/.bin/electron test/e2e-pages.cjs
```

## 📁 目录结构

```
electron/     Electron 主进程（窗口/快捷键/LLM 网关/剪贴板取词/本地存储）
src/          渲染进程
  components/  界面组件（小窗/大窗/文档视图/设置/生词本…）
  lib/         解析（PDF/DOCX/MD）、LLM 客户端、翻译缓存、OCR、词表、sanitize
  stores/      zustand 状态（文档/聊天/设置/生词本/历史/窗口）
  bridge/      preload 类型与浏览器调试桥
test/         端到端测试与 PDF 样本生成器
public/       词表（words.txt）、Tesseract 语言包
```

## 📄 License

[MIT](LICENSE)
