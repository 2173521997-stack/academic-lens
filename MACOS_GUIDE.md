# 🍎 Academic Lens — MacBook 开发与使用指南

本项目为基于 **Electron + React 19 + TypeScript + Vite + Tailwind CSS** 的跨平台学术翻译与精读伴侣。本文件夹已做体积深度精简（剔除了 400MB+ 的构建依赖缓存），大小仅约 **19 MB**，可在 MacBook 上即插即用、自由编辑与打包。

---

## 🚀 1. MacBook 快速启动与编辑

### 步骤 1：安装 Node.js
如果 MacBook 上尚未安装 Node.js，可以通过以下任一方式安装（推荐 Node.js 18、20 或 22）：
- **官网下载**：前往 [nodejs.org](https://nodejs.org) 下载 macOS 安装包（.pkg）；
- **Homebrew 安装**：
  ```bash
  brew install node
  ```

### 步骤 2：打开终端并安装依赖
将移动硬盘插入 MacBook，打开「终端（Terminal）」：
```bash
# 进入项目目录（路径根据移动硬盘挂载点而定）
cd /Volumes/移动硬盘/AcademicLens

# 一键安装依赖包（根据 package-lock.json 自动匹配精准依赖）
npm install
```

### 步骤 3：启动开发与实时预览
```bash
npm run dev
```
> 运行后将自动拉起 macOS 原生窗口，支持代码热重载（HMR），修改 `src/` 或 `electron/` 代码即时生效！

---

## 🛠️ 2. 如何编辑源码

推荐使用 **VS Code**、**Cursor** 或 **WebStorm** 打开 `AcademicLens` 文件夹：

- **`src/`（前端界面与交互）**：
  - `src/components/FileView.tsx`：大窗双栏对照阅读台、长文分页导航、生词收藏弹窗；
  - `src/components/QuickTranslate.tsx`：桌面小窗（查词翻译 / 图片公式解析双独立界面）；
  - `src/components/WordbookView.tsx`：生词本与六级/考研/雅思/托福考试必备词库；
  - `src/lib/renderLatex.ts`：LaTeX 标准数学公式排版转换引擎（基于 KaTeX）；
  - `src/lib/ocr.ts`：高精图像预处理与公式校正管线；
  - `src/stores/`：Zustand 全局状态（翻译设置、文档流、AI 智能体工具）。
- **`electron/`（macOS 底层能力与系统集成）**：
  - `electron/main.ts`：原生毛玻璃窗口、标题栏交通灯对齐、快捷键与原生菜单；
  - `electron/selection.ts`：macOS 原生 `osascript` 跨应用全局划词取词。

---

## 📦 3. 打包生成 macOS 原生安装包（.dmg / .zip / .app）

在 MacBook 终端中运行以下命令即可一键构建产物：
```bash
# 验证代码类型与编译
npm run build

# 打包生成 macOS 独立应用（输出至 release/ 目录）
npm run dist:mac
```

### 产物说明：
- `release/AcademicLens-0.1.0.dmg`：macOS 标准安装镜像文件（拖入 Applications 即可使用）；
- `release/mac/AcademicLens.app`：原生 macOS App 可执行包。

---

## ⌨️ 4. macOS 常用全局快捷键
- **⌘K**：唤起查词 Spotlight 搜索框；
- **⌘⇧M**（Command+Shift+M）：切换桌面小窗 / 大窗工作台；
- **⌘⇧A**（Command+Shift+A）：展开 / 收起 AI 助手面板；
- **⌘X**：全局划词取词并自动唤起小窗翻译（需在「系统设置 → 隐私与安全性 → 辅助功能」中允许 Academic Lens）。
