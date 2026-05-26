# Progress

## Current

- 阶段：阶段 6，性能、功能问题修复。
- 正在做：阶段 6 新增 TODO 已完成实现、fixtures 验收、最终视觉复审和 `v0.1.1` 发布准备。
- 下一步：提交并 push `development`，创建并 push `v0.1.1` 发布 tag；后续仍需处理签名、公证、完整 Xcode/DMG 等外部环境阻塞项。

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
- 已实现查看器后端预览 asset：jpg/png/bmp/ico/tiff/webp 由 Rust 解码成 PNG 预览缓存，avif/gif/svg 通过已授权源文件直显；前端查看器会先请求 `get_viewer_image` 再显示。
- 已调整 AVIF 扫描策略：AVIF 可入库但不强制 Rust 提取尺寸，避免默认构建引入系统 dav1d/pkg-config 依赖。
- 已完成格式兼容单元测试：`cargo test` 20 项通过，覆盖 AVIF/SVG 入库策略、常见栅格格式查看器预览和 AVIF/GIF/SVG 源文件查看策略。
- 已实现合集管理：可编辑名称、描述、评分，能从图片列表设置封面，收藏状态同步 `favorites` 表，打开合集会更新最近查看和查看次数，删除合集记录前确认且保留磁盘文件夹。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 20 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动空态冒烟无横向溢出。
- 已实现图片单图管理：图片行可重命名、移动到其他合集、复制到其他合集、删除到系统回收站；Rust command 会同步磁盘文件和数据库记录，并有文件名/目标冲突校验。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 21 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动空态冒烟无横向溢出。
- 已实现图片批量管理：支持多选图片后批量移动、复制、删除到回收站和批量评分；部分失败时仅移除成功项并展示失败原因。
- 已实现图片右键菜单和拖拽移动：右键图片可打开、重命名、移动、复制、查看信息、删除；选中或拖动图片时可拖到其他合集完成移动。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 21 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动空态冒烟无横向溢出。
- 已实现标签系统：可创建、编辑、重命名、删除标签，支持 #RRGGBB 颜色校验，合集和图片均可关联多个标签。
- 已实现标签筛选：合集页可按合集标签筛选，合集详情页可按图片标签筛选，图片支持单张和批量设置标签。
- 已完成阶段 3 最后一轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 21 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动空态冒烟无横向溢出。
- 已实现搜索功能：后端 `search_library` 支持合集名称、图片文件名、标签名全局搜索，以及格式、分辨率、文件大小、标签、评分、日期、收藏状态组合筛选。
- 已实现搜索结果前端：结果按合集/图片/标签分组展示；点击合集会进入合集，点击图片会进入对应合集并定位，点击标签会切换标签筛选。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 21 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动高级搜索面板无横向溢出。
- 已实现重复检测：后端会为图片计算 SHA256 和感知哈希，更新 `images.sha256`/`images.phash`，并返回完全重复组和视觉相似组。
- 已实现重复处理界面：工具栏可运行重复检测，结果按组展示，可打开定位图片，并支持保留第一张、批量删除其余候选到回收站。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 22 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动重复检测入口无横向溢出。
- 已实现文件同步：新增 `sync_collection`/`sync_all_collections`，同步时会扫描合集目录、入库新增图片、更新已有图片、将缺失路径标记为 missing 并刷新合集统计。
- 已实现目录监听：应用启动后后台监听已导入合集目录，文件创建、修改、删除、重命名后自动同步并向前端发送 `library-synced` 事件；前端收到后刷新合集/图片列表。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt` 后 `cargo test` 22 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动同步入口无横向溢出。
- 已实现设置与数据工具：主题、语言、快捷键方案、缩略图大小写入 settings 表；缩略图大小会影响新缩略图请求和列表显示变量。
- 已实现数据库备份、恢复、重建索引和导出：备份使用 SQLite `VACUUM INTO`，恢复会替换当前数据库连接，重建索引会同步所有合集，导出会生成 JSON。
- 已完成阶段 4 最后一轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 22 项通过，`pnpm tauri build --debug --bundles app` 通过，Playwright 桌面/移动设置面板无横向溢出。
- 已完成阶段 5 性能优化：图片列表分页上限提升到 20,000，前端合集详情一次加载 10,000 张并继续使用虚拟滚动，虚拟行高会随缩略图尺寸设置变化；重复检测和数据导出同步放宽到 20,000 张。
- 已完成设置默认值兼容：前端会兼容历史 JSON 字符串形式的设置值，避免主题、语言和缩略图尺寸被带引号的默认值污染。
- 已完成本轮验证：`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 22 项通过，`pnpm tauri build --debug --bundles app` 通过。
- 性能目标目前完成实现侧优化；1000 张导入小于 30 秒、已缓存打开小于 200ms 仍需要在真实图片集和目标机器上做基准采样。
- 已补充前端测试体系：新增 Vitest/jsdom、Testing Library、测试 setup、工具函数单测和应用空态/设置/高级搜索/浏览器预览交互测试。
- 已补充 Rust Tauri command 测试：使用 Tauri mock runtime 覆盖 `get_app_status`、`list_collections`、`update_setting`、`get_settings` 命令链路；Rust 测试总数提升到 24 项。
- 已补充跨平台 CI：`.github/workflows/ci.yml` 会在 macOS、Windows、Linux 执行依赖安装、前端测试、前端构建、Rust fmt、Rust 测试和 Tauri no-bundle 构建。
- 已补充发布工作流：`.github/workflows/release.yml` 会在 tag 上构建 macOS app/dmg、Windows nsis/msi、Linux deb/appimage，并上传产物；签名和 updater 私钥使用 GitHub Secrets 预留。
- 已补充打包配置：Tauri bundle 增加 publisher、分类、描述、Windows WebView2 安装模式、macOS hardened runtime/DMG 布局、Linux AppImage 配置和 favicon。
- 已补充性能基准说明和本地 fixture 生成脚本：`docs/PERFORMANCE.md` 与 `pnpm bench:fixtures`，生成内容在已忽略的 `fixtures/` 下，不提交图片。
- 已完成本轮验证：`pnpm test` 6 项通过，`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 24 项通过，`pnpm tauri build --debug --bundles app` 通过；Playwright 桌面/移动空态冒烟无横向溢出，favicon 404 已修复。
- 已完成 GitHub Actions 跨平台冒烟：push CI `26365159170` 在 macOS、Windows、Ubuntu 全部通过；Windows 上因 Tauri/WebView2 测试二进制启动问题改为 `cargo test --no-run`，并继续执行 Tauri no-bundle 构建。
- 已完成阶段 6 功能修复：侧边栏收藏/最近/标签成为真实导航；设置入口移到侧边栏并成为独立页面；合集卡片支持删除记录；缩略图尺寸变化会重载图片缩略图和合集封面；合集封面自动显示缩略图；WebP 查看器改用源文件以保留动图播放；大文件夹导入新增 `import_folder`，按顶层子目录形成多个合集并将扫描移出 DB 写锁。
- 已完成阶段 6 白色简约视觉迭代：侧边栏图标导航、白色现代化卡片、独立设置页、封面卡片、移动端布局压缩、次级操作 hover 展示。
- 已完成阶段 6 验证：`pnpm build` 通过，`pnpm test` 7 项通过，`cargo fmt --check` 通过，`cargo test` 24 项通过、1 项忽略，`cargo test fixture_acceptance_core_flow -- --ignored` 使用 `fixtures/photo-library-basic` 通过，`pnpm tauri build --debug --bundles app` 通过。
- 已完成 Playwright fixture mock 视觉截图：桌面、设置、详情、移动端均无控制台错误；截图文件为 `visual-photoview-desktop-final.png`、`visual-photoview-detail-final.png`、`visual-photoview-mobile-final.png`、`visual-photoview-settings.png`。
- 已完成最终移动端视觉修正：手机首屏可见合集卡片，次级操作默认隐藏，最新截图为 `visual-photoview-mobile-polished.png`；视觉 subagent 复审无高/中优先级意见。
- 已创建 `PRODUCT_ITERATION.md` 记录阶段 6 视觉/产品迭代过程。

## Blocked

- 当前 macOS 机器仅安装 Xcode Command Line Tools，`tauri info` 提示完整 Xcode 未安装；后续 macOS 打包/签名前需要处理。
- `pnpm tauri build --debug` 可生成 `.app`，但完整 DMG 打包在 `bundle_dmg.sh` 阶段失败；阶段 5 发布打包时需补充排查。
- 代码签名、公证和自动更新签名需要证书、Apple 账号、Windows 证书以及 `TAURI_SIGNING_PRIVATE_KEY` 等 GitHub Secrets。
