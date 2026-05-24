# Progress

## Current

- 阶段：阶段 2，核心浏览体验。
- 正在做：阶段 2 核心浏览体验主体已完成，剩余图片格式兼容测试集逐项验收。
- 下一步：补齐 jpg/png/gif/bmp/ico/tiff/webp/avif/svg 真实文件打开验收，并开始阶段 3 管理能力。

## Done

- 已创建 `plan.md` 需求拆解来源。
- 已创建 `TODO.md`，按 Tauri 跨平台实现拆分阶段任务。
- 已创建 `AGENTS.md`，记录自动推进、上下文控制、风险控制和验证规则。
- 已将 `PROGRESS.md` 设为必须维护的续接文件。
- 已明确目标为完成 `plan.md` 全部功能，阶段划分只控制实现顺序。
- 已确定并初始化技术栈：Tauri 2、Rust 1.95.0、React 19、TypeScript、Vite、pnpm、SQLite/rusqlite。
- 已安装基础依赖：Tauri dialog/fs/opener 插件、rusqlite、image、kamadak-exif、notify、trash、walkdir、sha2、uuid、chrono、zustand、react-virtual、lucide-react、clsx。
- 已安装剪贴板依赖：`@tauri-apps/plugin-clipboard-manager`、`tauri-plugin-clipboard-manager`。
- 已完成主窗口配置、应用图标 bundle 配置、基础 CSP、Tauri capability 和原生命令菜单；菜单“导入文件夹”会触发现有导入流程。
- 已完成基础验证：`pnpm build` 通过，`cargo check` 通过，`cargo fmt --check` 通过。
- 已配置应用标识 `com.dreamstronger.photoview`、产品名 `PhotoView`、主窗口 1200x800，并注册 dialog/fs/opener 插件。
- 已新增 `docs/ARCHITECTURE.md`，锁定 Rust command/API、数据库、缩略图缓存、配置目录、后台任务和前端状态边界。
- 已新增 `docs/ACCEPTANCE.md`，把 `plan.md` 全部功能整理为可验收清单，并明确阶段划分不裁剪功能。
- 已新增 Rust 基础模块：`app`、`commands`、`db`、`errors`、`paths`。
- 已实现应用数据目录初始化、SQLite schema migration、默认设置写入和 `get_app_status` command。
- 已替换模板首页为 PhotoView 应用骨架，可展示 schema、图片数、标签数和初始化错误。
- 已实现 `choose_import_folder`、`open_path_in_file_manager`、`copy_text_to_clipboard`、`copy_path_to_clipboard` 系统 command，并在前端导入按钮中接入文件夹选择、复制路径和打开所在位置。
- 已实现 collections、images、tags、settings 基础 CRUD repository 和 Tauri command，并补充 Rust 单元测试。
- 已新增 `scanner` 模块，支持 jpg/jpeg、png、gif、bmp、ico、tiff/tif、webp、avif、svg 识别，递归扫描不跟随符号链接，并提取文件大小、创建时间、修改时间、分辨率和格式；异常图片返回结构化错误。
- 已实现 `import_collection` command：选择文件夹后扫描入库，重复路径执行更新，避免重复入库，并刷新合集图片数量和总大小。
- 已完成本轮验证：`pnpm build` 通过，`cargo test` 通过，`cargo fmt --check` 通过，`pnpm tauri build --debug --bundles app` 通过。
- 已进入阶段 2，前端已支持合集列表/网格切换、搜索、排序、导入后刷新，以及合集路径复制/打开。
- 已完成前端验证：`pnpm build` 通过，Playwright 桌面和移动视口快照无明显布局重叠。
- 已实现合集详情页骨架和图片虚拟列表，可加载 `list_images` 并展示文件名、路径、格式、尺寸和大小。
- 已新增 `thumbs` 模块，支持 WebP 缩略图生成、稳定分桶缓存路径、sidecar 元数据命中、坏图/SVG/大图错误处理。
- 已实现 `get_thumbnail` command，启用 Tauri asset protocol，并在图片虚拟列表可见范围内按需生成和展示缩略图。
- 已实现缩略图后台任务队列：`enqueue_thumbnail_generation` 创建任务、后台线程逐项生成缩略图、`get_task` 查询进度，并写入 `tasks` 与 `thumbnail_cache` 表。
- 已实现缩略图缓存统计和清理接口：`get_thumbnail_cache_stats`、`clear_thumbnail_cache`，并补充缓存统计/清理单元测试。
- 已为已导入合集目录注册 Tauri asset protocol 授权，查看器可通过 `convertFileSrc(image.path)` 加载原图；重启后会重新授权现有合集目录。
- 已实现图片查看器 overlay：双击/Enter 打开，支持上一张/下一张、左右键、Esc 关闭、适应窗口、实际大小、缩放、旋转、全屏、2s 幻灯片和信息面板。
- 已实现查看器图片加载状态和解码失败占位。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 17 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动空态冒烟无横向溢出。

## Blocked

- 当前 macOS 机器仅安装 Xcode Command Line Tools，`tauri info` 提示完整 Xcode 未安装；后续 macOS 打包/签名前需要处理。
- `pnpm tauri build --debug` 可生成 `.app`，但完整 DMG 打包在 `bundle_dmg.sh` 阶段失败；阶段 5 发布打包时需补充排查。
