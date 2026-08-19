# AGENTS.md

## 最高指示（必须遵守）
- **每次调试完成、代码变更生效后，必须自动启动软件供用户检查。**
  - 启动方式：`Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "C:\AcademicLens"`
  - 若旧实例仍在运行：先 `Get-Process electron | Stop-Process -Force` 再启动（应用有单实例锁）。
  - 变更涉及主进程/preload/渲染层时，先 `npm run build`（tsc + vite）再启动。
- PowerShell 执行策略限制 `npm.ps1`，一律用 `npm.cmd`。

## 省 Token 政策（本文件夹所有对话强制生效）
本工作区已启用 headroom 压缩插件与 `token-saving` 技能（`C:\AcademicLens\.dsh\skills\token-saving\SKILL.md`）。所有会话必须遵守：

1. **读取**：先 `glob`/`grep` 定位，再按 `offset`/`limit` 只读需要的行区间；禁止整文件 dump 大文件（日志、锁文件、dist、package-lock、node_modules）。
2. **搜索**：合并模式一次问全（`(a|b|c)`），用 `include` 缩小范围，输出只取匹配行+少量上下文。
3. **写代码**：优先 `edit` 精确替换，不整文件 `write` 重写；复用现有函数；注释点到为止。
4. **上下文卫生**：长任务用 `todo_write` 跟踪；独立子任务交后台 `subagent`/`workflow`；会话变长提示 `/compact` 或依赖内置压缩；回复引用路径与结论，不复制全文。
5. **输出**：只给改了什么（路径）、为什么、验证结果；代码块只放必要片段。

违反以上习惯视为缺陷，会被纠正。

## 项目要点
- Electron + React 19 + Vite + Tailwind 4 + Zustand。
- 构建：`npm run build`（tsc --noEmit + vite build）。
- 划词/一键翻译走主进程 `electron/selection.ts`（macOS osascript / Windows cscript+VBS）。
