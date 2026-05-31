# PhotoView Architecture

本文件定义 PhotoView 的工程边界。目标是完整实现 `docs/plan.md` 的所有功能；阶段划分只控制实现顺序，不裁剪功能范围。

## 技术栈

- 桌面壳：Tauri 2。
- 前端：React 19 + TypeScript + Vite + pnpm。
- 前端状态：Zustand，局部 UI 状态优先放在组件内。
- 后端：Rust 1.95。
- 数据库：SQLite，Rust 侧通过 `rusqlite` 访问。
- 图片处理：Rust 侧使用 `image`、`kamadak-exif` 和后续 pHash 实现。
- 系统能力：Tauri dialog/fs/opener 插件，文件删除优先使用 `trash`。

## 目录边界

- `src/`：前端 UI、路由、状态、调用 Tauri command 的客户端封装。
- `src-tauri/src/`：Rust domain/service/repository/command/task 实现。
- `src-tauri/capabilities/`：Tauri 权限声明。
- `docs/`：需求、任务、架构、验收标准、后续设计文档。
- 用户数据目录：数据库、缩略图缓存、配置文件和任务状态。
- 导入的图片目录：只保存用户原始文件路径，不把图片复制进应用数据目录，除非用户明确执行复制/移动/合并等操作。

## Rust 模块规划

后续在 `src-tauri/src/` 下按职责拆分：

- `app.rs`：应用状态、依赖注入、启动初始化。
- `commands/`：Tauri command 入口，只做参数校验、权限边界和调用 service。
- `db/`：SQLite 连接、migration、事务、repository。
- `models/`：跨 command 返回给前端的 DTO 和数据库实体。
- `services/collections.rs`：合集导入、编辑、合并、拆分、导出。
- `services/images.rs`：图片元数据、移动、复制、重命名、删除、评分、收藏。
- `services/tags.rs`：标签 CRUD 和关联。
- `services/search.rs`：全局搜索和高级筛选。
- `services/duplicates.rs`：SHA256 完全重复和 pHash 相似检测。
- `services/settings.rs`：显示、导入、快捷键、缓存和数据管理设置。
- `services/history.rs`：最近浏览、查看次数、最后查看时间。
- `thumbs/`：缩略图生成、缓存命中、缓存清理。
- `scanner/`：目录扫描、格式识别、元数据提取、增量扫描。
- `tasks/`：后台任务、进度、取消、恢复和错误汇总。
- `watcher/`：文件系统监听、防抖和增量同步。
- `fs_ops/`：跨平台文件操作、回收站、打开位置、路径规范化。
- `errors.rs`：统一错误类型，转换为前端可展示错误。

## Tauri Command 边界

Command 命名按功能域分组，前端只能通过 allowlist command 调用 Rust 能力。

### 系统与设置

- `get_app_status`
- `get_settings`
- `update_settings`
- `choose_import_folder`
- `open_path_in_file_manager`
- `copy_text_to_clipboard`

### 合集

- `import_collection`
- `list_collections`
- `get_collection_detail`
- `update_collection`
- `delete_collection_record`
- `merge_collections`
- `split_collection`
- `export_collection`

### 图片

- `list_images`
- `get_image_detail`
- `get_image_file_url`
- `update_image`
- `favorite_image`
- `rate_images`
- `move_images`
- `copy_images`
- `rename_image`
- `delete_images`

### 标签

- `list_tags`
- `create_tag`
- `update_tag`
- `delete_tag`
- `assign_tags_to_collection`
- `assign_tags_to_images`

### 搜索与筛选

- `global_search`
- `advanced_search`

### 缩略图与查看器

- `get_thumbnail`
- `enqueue_thumbnail_jobs`
- `clear_thumbnail_cache`
- `get_image_metadata`

### 重复检测

- `start_duplicate_scan`
- `get_duplicate_scan_status`
- `cancel_duplicate_scan`
- `list_duplicate_groups`
- `resolve_duplicate_group`

### 后台任务与文件监听

- `list_tasks`
- `cancel_task`
- `retry_task`
- `start_folder_watcher`
- `stop_folder_watcher`

所有 command 必须：

- 校验路径必须属于用户选择的合集目录或应用数据目录。
- 校验分页、排序字段、ID、评分、颜色、标签名等输入。
- 只返回结构化错误，不把 Rust panic 暴露给前端。
- 对文件移动、删除、覆盖、合并、拆分等危险操作要求前端传入明确确认标记。

## 数据库边界

SQLite 存储应用索引和元数据，不替代真实文件系统。

核心表：

- `schema_migrations`：migration 版本。
- `collections`：合集基础信息、路径、封面、统计、评分、收藏、查看状态。
- `images`：图片路径、文件名、格式、大小、分辨率、哈希、时间、评分、收藏、所属合集。
- `tags`：标签名称、颜色。
- `collection_tags`：合集和标签多对多关系。
- `image_tags`：图片和标签多对多关系。
- `favorites`：跨合集收藏记录，区分合集和图片。
- `history`：最近浏览记录。
- `settings`：设置项，JSON 值或类型化值。
- `thumbnail_cache`：缩略图缓存索引、源文件 mtime/size、缓存路径、状态。
- `tasks`：导入、缩略图、去重、监听同步等后台任务状态。
- `duplicate_groups` 和 `duplicate_items`：重复/相似图片扫描结果。

索引要求：

- `collections.path` 唯一。
- `images.collection_id`、`images.path`、`images.file_name`、`images.format`、`images.sha256`。
- 标签关联表按 `tag_id` 和目标 ID 双向索引。
- 搜索字段根据实际方案建立普通索引或 FTS 索引。

事务规则：

- 导入、移动、复制、删除、合并、拆分、恢复等操作必须使用事务。
- 文件系统操作和数据库更新必须有补偿策略，失败时返回可恢复状态。
- migration 必须幂等，失败不能破坏已有数据。

## 应用数据与缓存目录

应用数据目录按平台使用 Tauri app data 路径，不硬编码用户目录。

建议结构：

```text
PhotoView/
  photoview.sqlite
  settings.json
  thumbnails/
    aa/
      <image-id>-<mtime>-<size>.webp
  tasks/
    task-state.json
  backups/
    photoview-YYYYMMDD-HHMMSS.sqlite
  exports/
```

缩略图缓存策略：

- 缓存 key 基于图片 ID、mtime、size、目标尺寸和格式。
- 源文件 mtime 或 size 变化时缓存失效。
- 缩略图生成走后台队列，前端先显示占位状态。
- 清理缓存时只删除应用缓存目录内文件，不触碰用户图片。

## 后台任务边界

后台任务覆盖：

- 合集导入和增量扫描。
- 缩略图生成。
- 重复检测。
- 文件监听同步。
- 数据备份、恢复、重建索引。

任务必须具备：

- 进度：总数、完成数、失败数、当前文件。
- 状态：pending、running、paused、cancelled、failed、completed。
- 取消：用户取消后停止新任务，正在处理的单个文件安全结束。
- 恢复：应用重启后能识别未完成任务并安全重试或重建。
- 错误汇总：跳过坏图或无权限文件，不中断整个导入。

## 前端状态边界

Zustand store 按领域拆分：

- `collectionStore`：当前合集列表、筛选、排序、选中项。
- `imageStore`：当前合集图片、分页/虚拟滚动窗口、批量选择。
- `viewerStore`：查看器当前图片、缩放、旋转、全屏、幻灯片状态。
- `tagStore`：标签列表、颜色、筛选状态。
- `searchStore`：全局搜索关键词、高级筛选条件、结果。
- `taskStore`：后台任务进度和错误。
- `settingsStore`：主题、语言、缩略图大小、快捷键、缓存设置。

前端不直接操作文件系统路径；必须调用 Rust command。前端负责：

- 展示加载、空状态、错误状态和进度。
- 发起确认流程。
- 管理可撤销 UI 状态。
- 维护路由和跳转定位。

## 实现依赖顺序

1. App 初始化、路径和权限边界。
2. SQLite migration 和 repository。
3. 文件扫描与图片元数据。
4. 合集导入和缩略图缓存。
5. 主界面、合集详情和查看器。
6. 标签、收藏、最近浏览、排序筛选。
7. 图片批量操作、合集合并拆分。
8. 搜索和高级筛选。
9. 重复检测和文件系统监听。
10. 设置、备份恢复、性能优化和跨平台打包。

## 验收与安全约束

- 开发测试默认使用 fixture 或临时目录。
- 删除默认进入回收站，直接删除必须二次确认。
- 不跟随符号链接扫描，避免循环。
- Windows 必须处理长路径、文件锁、盘符和 UNC。
- macOS/Linux 必须处理大小写敏感、权限和符号链接。
- 所有平台必须处理 Unicode 文件名、特殊字符和路径规范化。
