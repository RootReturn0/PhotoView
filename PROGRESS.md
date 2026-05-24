# Progress

## Current

- 阶段：阶段 0，架构与全量范围确认已完成；准备进入阶段 1 基础工程。
- 正在做：阶段 0 文档验收、提交和推送。
- 下一步：阶段 1 先实现应用初始化、配置路径、SQLite migration 和基础 repository。

## Done

- 已创建 `plan.md` 需求拆解来源。
- 已创建 `TODO.md`，按 Tauri 跨平台实现拆分阶段任务。
- 已创建 `AGENTS.md`，记录自动推进、上下文控制、风险控制和验证规则。
- 已将 `PROGRESS.md` 设为必须维护的续接文件。
- 已明确目标为完成 `plan.md` 全部功能，阶段划分只控制实现顺序。
- 已确定并初始化技术栈：Tauri 2、Rust 1.95.0、React 19、TypeScript、Vite、pnpm、SQLite/rusqlite。
- 已安装基础依赖：Tauri dialog/fs/opener 插件、rusqlite、image、kamadak-exif、notify、trash、walkdir、sha2、uuid、chrono、zustand、react-virtual、lucide-react、clsx。
- 已完成基础验证：`pnpm build` 通过，`cargo check` 通过，`cargo fmt --check` 通过。
- 已配置应用标识 `com.dreamstronger.photoview`、产品名 `PhotoView`、主窗口 1200x800，并注册 dialog/fs/opener 插件。
- 已新增 `docs/ARCHITECTURE.md`，锁定 Rust command/API、数据库、缩略图缓存、配置目录、后台任务和前端状态边界。
- 已新增 `docs/ACCEPTANCE.md`，把 `plan.md` 全部功能整理为可验收清单，并明确阶段划分不裁剪功能。

## Blocked

- 当前 macOS 机器仅安装 Xcode Command Line Tools，`tauri info` 提示完整 Xcode 未安装；后续 macOS 打包/签名前需要处理。
