# AGENTS.md

## 最高指示（必须遵守）
- **每次调试完成、代码变更生效后，必须自动启动软件供用户检查。**
  - 启动方式：`Start-Process -FilePath "node_modules\electron\dist\electron.exe" -ArgumentList "." -WorkingDirectory "C:\AcademicLens"`
  - 若旧实例仍在运行：先 `Get-Process electron | Stop-Process -Force` 再启动（应用有单实例锁）。
  - 变更涉及主进程/preload/渲染层时，先 `npm run build`（tsc + vite）再启动。
- PowerShell 执行策略限制 `npm.ps1`，一律用 `npm.cmd`。

## 项目要点
- Electron + React 19 + Vite + Tailwind 4 + Zustand。
- 构建：`npm run build`（tsc --noEmit + vite build）。
- 划词/一键翻译走主进程 `electron/selection.ts`（macOS osascript / Windows cscript+VBS）。
