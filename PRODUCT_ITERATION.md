# Product Iteration

## Objective

- 本轮目标：优化主界面高级筛选展开后的布局，让筛选模块在桌面工具型应用里更清晰、紧凑、可扫读；使用视觉 subagent 评审并循环到无高/中/低风险意见。
- 修复 `TODO.md` 阶段 6 的功能问题，并把 PhotoView 调整为白色、简约、现代的桌面图片管理工具。
- 验证优先使用仓库 `fixtures/` 图片，避免触碰真实图片库。
- 视觉评审同时覆盖整体配色布局和局部功能模块，迭代到无高/中优先级意见。

## Inputs

- 本轮截图：`screenshots/latest/app-filter.png`。
- 本轮重点文件：`src/App.tsx`、`src/App.css`、`src/App.test.tsx`。
- `TODO.md` 阶段 6。
- `AGENTS.md`、`plan.md`、`PROGRESS.md`。
- 当前 React/Tauri 实现：`src/App.tsx`、`src/App.css`、`src-tauri/src/*`。
- Fixture 图片目录：`fixtures/photo-library-basic/`。

## Role Findings

- VIS-FILTER-001（高）：高级筛选面板过宽过扁，8 组条件横向均摊，阅读路径混乱。
- VIS-FILTER-002（高）：应用/重置按钮和字段混排，按钮文字在中文下换行，缺少面板级操作感。
- VIS-FILTER-003（高）：展开筛选后主内容被明显下压，页面重心从图库管理变成表单编辑。
- VIS-FILTER-004（中）：格式/标签多选框高度与其他字段不一致，格式列表露出滚动条显粗糙。
- VIS-FILTER-005（中）：日期输入窄列下显示截断，面板缺少标题和分组提示。
- VIS-FILTER-006（低）：`大小 MB` 文案生硬，空态高度和边框在筛选展开时偏重，移动端筛选会堆得过长。
- VIS-MACRO-1：侧边栏原为静态按钮，需成为真实导航。
- VIS-MACRO-2：白色简约方向需强化视觉层级，减少旧式蓝灰边框感。
- VIS-MODULE-1：设置需从顶部工具栏移到侧边栏，并成为独立页面。
- VIS-MODULE-2：合集卡片必须显示封面缩略图或明确 fallback。
- TECH-1：缩略图缓存只按 imageId 记忆，尺寸变化后不会重新请求。
- TECH-2：WebP 查看器走 PNG 预览会让动图静态化。
- TECH-3：大目录导入在 DB 锁内扫描，且没有按顶层子目录形成多个合集。
- TECH-4：移动端工具栏隐藏文字后，图标按钮需要稳定 `aria-label`/`title`。
- TECH-5：大目录导入需要按目录逐个扫描入库、可取消、取消后刷新已入库结果。
- TECH-6：根目录图片与子合集共存时，根目录图片不能静默忽略，asset 授权不能递归放大到子目录。
- TECH-7：未使用的任意路径写入 Tauri command 需要移除注册，避免绕过导入流程。
- VIS-MACRO-3：移动端首屏曾被侧边栏、工具栏和筛选区挤占；已压缩导航/工具栏并修复合集列表高度。
- VIS-MODULE-3：移动端合集卡片/图片行次级操作曾常驻堆叠；已改为 hover/focus 展示，移动端默认只保留主操作。
- UX-8：`全部`页不应重复承载标签管理；标签管理应集中到独立标签页。
- UX-9：标签创建/编辑/删除需从系统弹窗改为应用内简化流程；标签分配需用应用内下拉多选。
- UX-10：合集详情需要图片网格视图，网格只展示缩略图和名字，便于快速浏览。
- TECH-8：多层大目录导入要在发现目录、扫描目录、写入合集之间分阶段推进，避免长时间无进度或单个坏目录中断整体。
- TECH-9：嵌套合集的逐文件 asset 授权在删除合集时必须撤销全部历史图片路径，包括 missing 记录。

## Decision Log

- 先修功能闭环，再做视觉统一；避免一次性引入高风险 UI 框架迁移。
- 暂不新增 shadcn/tailwind 依赖，除非现有 CSS 无法达成目标；当前项目未配置 Tailwind，直接迁移会扩大风险。
- 用户已确认允许同步远程 master、push、merge 和发布；远端 `v0.1.1` tag 已存在且指向旧提交，发布 tag 需要另行确认避免覆盖。

## Backlog

- [x] FE/UX：侧边栏收藏、最近、标签入口可点击并显示对应内容。
- [x] BE/FE：已导入合集可删除记录，并保持物理目录不被误删。
- [x] FE/BE：缩略图尺寸设置立即影响图片列表和合集封面，封面可显示缩略图。
- [x] Viewer：动态 WebP 以源文件播放，不被静态 PNG 预览替代。
- [x] BE/UX：导入包含多个子文件夹的大目录时不造成 UI 卡死，并按子文件夹形成合集。
- [x] Design：白色简约现代化界面，设置入口放入侧边栏，设置作为独立页面。
- [x] A11y：移动端图标工具栏按钮保留稳定可访问名称和 hover title。
- [x] BE/UX：导入进度事件、取消导入、取消后刷新已入库合集。
- [x] Security：收紧导入/启动/删除时的 asset scope，移除未使用的任意路径写入 command 注册。
- [x] FE/UX：`全部`页移除标签管理按钮，标签页改为内联表单和标签卡片内编辑/删除。
- [x] FE/UX：合集、单图、批量图片标签设置改为应用内下拉多选菜单。
- [x] FE/UX：合集详情新增图片列表/网格视图切换，网格仅展示缩略图和名字。
- [x] Viewer：长图适应模式限制在查看器容器内，实际大小模式保留滚动。
- [x] BE/UX：多层目录导入容忍异常子目录，扫描阶段有进度，导入阶段显示总合集数。
- [x] Security：删除合集时撤销该合集所有图片路径的 asset 文件授权。
- [x] QA：使用 fixtures 自动化导入/浏览/设置/删除/视觉截图验证。

## Implementation Log

- `src/App.tsx`：高级搜索面板改为带标题说明的分组布局，应用/重置按钮移到面板级操作区；格式筛选从粗糙多选框改为紧凑 chip；标签空态显示“无标签”；宽高、文件大小和评分占位符补齐 px/MB/0-5 提示。
- `src/App.css`：高级搜索从横向均摊表单改为常用条件、图片属性、时间范围三组卡片；桌面分组顶部对齐，移动端压缩 chips/间距并保留主内容入口。
- `src/App.test.tsx`：更新高级搜索测试，覆盖格式 chip 分组后的可访问结构。
- `src-tauri/src/commands/data.rs`：新增 `import_folder`，先扫描顶层子目录，再短暂持有 DB 写锁导入；保留单合集导入命令并移出命令层扫描锁。
- `src-tauri/src/db/repositories.rs`：新增 `import_scanned_collection`，刷新统计时自动补齐/修复合集封面。
- `src-tauri/src/commands/data.rs`、`src-tauri/src/app.rs`、`src-tauri/src/scanner/mod.rs`、`src-tauri/src/db/repositories.rs`：导入改为逐目录进度事件、扫描/入库可取消、根目录图片单独导入。
- `src-tauri/src/commands/system.rs`、`src-tauri/src/lib.rs`：文件夹选择只授权 FS scope；启动时嵌套合集按图片文件授权 asset；移除旧 `import_collection`、`create_collection`、`create_image` command 注册。
- `src-tauri/src/commands/data.rs`：删除父/根合集时按剩余合集关系收紧 asset scope，避免影响子合集。
- `src-tauri/src/viewer.rs`：WebP 查看器改用源文件，保留动图播放能力。
- `src/App.tsx`：新增侧边栏导航状态、收藏/最近/标签/设置页面、合集卡片删除入口、封面缩略图加载、缩略图尺寸变化后重载缓存。
- `src/App.tsx`：监听导入进度，支持取消导入；移动端图标按钮补齐 `aria-label`/`title`。
- `src/App.tsx`：移除全部页标签管理入口；标签页改为内联表单和卡片操作；标签设置改为应用内下拉复选菜单；合集详情新增图片网格视图。
- `src-tauri/src/commands/data.rs`：多层导入分为目录发现、直接图片扫描、合集写入三个阶段；异常子目录跳过不中断；导入进度总数在写入阶段表示待导入合集数。
- `src-tauri/src/db/repositories.rs`：合集图片路径查询包含 missing 记录，用于删除合集时撤销历史 asset 授权。
- `src/App.css`：调整为白色简约视觉、侧边栏图标导航、设置独立页、合集封面卡片、标签页和移动端布局。
- `src/App.css`：新增标签内联编辑、标签下拉多选、图片网格视图、导入进度条和长图查看器容器限制样式；补齐深色主题对比。
- `src/App.css`：最终收紧移动端导航/工具栏/筛选区，修复合集列表在移动端被压成 0 高的问题，并隐藏次级操作噪声。
- `src/App.test.tsx`：补充侧边栏导航、标签管理页内联表单和工具栏可访问名称测试，更新设置页测试。

## Verification

- 本轮筛选页验证：`pnpm test` 12 项通过，`pnpm build` 通过。
- 本轮筛选页截图：`screenshots/latest/app-filter-final.png`、`screenshots/latest/app-filter-final-mobile.png`。
- 本轮筛选页 Playwright 验收：桌面/移动端截图无 console error；视觉 subagent 最终确认“无高/中/低风险意见，可以收口”。
- 本轮筛选页 QA subagent 复核：`pnpm test`、`pnpm build`、`git diff --check` 均通过；确认设置页不显示筛选工具栏、格式 chip/应用/重置逻辑仍接原状态和函数、标签空态不会白屏，未发现功能回归。
- `pnpm build` 通过。
- `pnpm test` 通过，8 项前端测试。
- `cargo fmt --check` 通过。
- `cargo test` 通过，26 项通过、1 项 fixture 验收忽略。
- `cargo test fixture_acceptance_core_flow -- --ignored` 通过，使用 `fixtures/photo-library-basic` 覆盖导入、缩略图、WebP 查看器、搜索、重复检测、文件管理、备份导出等流程。
- `pnpm tauri build --debug --bundles app` 通过，生成 debug `.app`。
- Playwright 本地 dev server 桌面/移动冒烟通过，控制台错误 0，无横向溢出，工具栏按钮可访问名称齐全；测试页面和 dev server 已关闭。
- Playwright 注入 fixture mock 数据完成桌面、设置、详情、移动端截图，控制台错误 0。
- 第一轮视觉复审剩余 3 个中优先级问题；已二次迭代移动端工具栏、合集卡片常驻操作和详情行常驻操作。
- 最终移动端截图 `visual-photoview-mobile-polished.png`：首屏可见合集卡片、次级操作默认隐藏、无横向溢出、控制台错误 0。
- 最终视觉 subagent 复审：无高/中优先级意见，可以交付。
- 最终技术 subagent 复审：无高/中优先级意见。
- 最新阶段 6 TODO 验证：`pnpm test` 9 项通过，`pnpm build` 通过，`cargo fmt --check` 通过，`cargo test` 26 项通过、1 项忽略，`cargo test fixture_acceptance_core_flow -- --ignored` 通过，`pnpm tauri build --debug --bundles app` 通过。
- 最新 Playwright 移动端本地冒烟：标签页内联表单可见，`全部`页标签管理按钮为空，控制台错误 0，无横向溢出；测试页面和 dev server 已关闭。
- 最新 iteration 复审：UI/UX subagent 与技术 subagent 最终均确认无 High/Medium 修改意见。

## Remaining Risks

- 大目录真实性能仍需目标机器基准采样。
- 当前未引入 shadcn/tailwind；为了降低迁移风险，使用现有 CSS 完成白色现代化。
- Browser in-app `iab` 当前不可用，视觉验收使用临时 Playwright 页面替代并已关闭页面。
- 远端 `v0.1.1` tag 已存在且指向旧提交；发布当前修复需要确认是创建新版本 tag，还是显式覆盖旧 tag。
