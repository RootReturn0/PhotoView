# Progress

## Current

- 阶段：阶段 1，基础工程。
- 正在做：应用初始化、SQLite schema migration、系统能力和基础 CRUD 已完成。
- 下一步：集成扫描模块，继续推进文件夹导入、图片格式识别、元数据提取和增量扫描。

## Done

- 已创建 `plan.md` 需求拆解来源。
- 已创建 `TODO.md`，按 Tauri 跨平台实现拆分阶段任务。
- 已创建 `AGENTS.md`，记录自动推进、上下文控制、风险控制和验证规则。
- 已将 `PROGRESS.md` 设为必须维护的续接文件。
- 已明确目标为完成 `plan.md` 全部功能，阶段划分只控制实现顺序。
- 已确定并初始化技术栈：Tauri 2、Rust 1.95.0、React 19、TypeScript、Vite、pnpm、SQLite/rusqlite。
- 已安装基础依赖：Tauri dialog/fs/opener 插件、rusqlite、image、kamadak-exif、notify、trash、walkdir、sha2、uuid、chrono、zustand、react-virtual、lucide-react、clsx。
- 已安装剪贴板依赖：`@tauri-apps/plugin-clipboard-manager`、`tauri-plugin-clipboard-manager`。
- 已完成基础验证：`pnpm build` 通过，`cargo check` 通过，`cargo fmt --check` 通过。
- 已配置应用标识 `com.dreamstronger.photoview`、产品名 `PhotoView`、主窗口 1200x800，并注册 dialog/fs/opener 插件。
- 已新增 `docs/ARCHITECTURE.md`，锁定 Rust command/API、数据库、缩略图缓存、配置目录、后台任务和前端状态边界。
- 已新增 `docs/ACCEPTANCE.md`，把 `plan.md` 全部功能整理为可验收清单，并明确阶段划分不裁剪功能。
- 已新增 Rust 基础模块：`app`、`commands`、`db`、`errors`、`paths`。
- 已实现应用数据目录初始化、SQLite schema migration、默认设置写入和 `get_app_status` command。
- 已替换模板首页为 PhotoView 应用骨架，可展示 schema、图片数、标签数和初始化错误。
- 已实现 `choose_import_folder`、`open_path_in_file_manager`、`copy_text_to_clipboard`、`copy_path_to_clipboard` 系统 command，并在前端导入按钮中接入文件夹选择、复制路径和打开所在位置。
- 已实现 collections、images、tags、settings 基础 CRUD repository 和 Tauri command，并补充 Rust 单元测试。
- 已完成本轮验证：`pnpm build` 通过，`cargo test` 通过，`cargo fmt --check` 通过。

## Blocked

- 当前 macOS 机器仅安装 Xcode Command Line Tools，`tauri info` 提示完整 Xcode 未安装；后续 macOS 打包/签名前需要处理。
