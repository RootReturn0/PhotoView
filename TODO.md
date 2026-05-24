# PhotoView TODO

技术栈目标：Tauri 跨平台桌面应用。

## 阶段 0：架构与全量范围确认

- [x] 架构 subagent：确定 Tauri 2 + Rust + SQLite + 前端框架方案。
- [x] 架构 subagent：划分 Rust command/API、数据库、缩略图缓存、配置目录和前端状态边界。
- [x] 产品 subagent：把 `plan.md` 全部功能整理为可验收清单。
- [x] 产品 subagent：明确每个功能的完成标准、依赖关系和实现顺序。
- [x] 产品 subagent：确认阶段划分只控制实现顺序，不裁剪任何 `plan.md` 功能。

## 阶段 1：基础工程

- [x] Tauri 工程 subagent：初始化 Tauri 跨平台项目结构。
- [x] Tauri 工程 subagent：配置窗口、菜单、应用图标、基础权限。
- [x] Tauri 工程 subagent：封装文件夹选择、打开文件所在位置、复制路径等系统能力。
- [x] 数据库 subagent：设计 collections、images、tags、favorites、history、settings 表结构。
- [x] 数据库 subagent：实现 schema migration。
- [x] 数据库 subagent：实现 collections、images、tags、settings 基础 CRUD。
- [x] 文件扫描 subagent：实现文件夹导入和图片格式识别。
- [x] 文件扫描 subagent：实现图片元数据提取，包括文件大小、创建时间、分辨率、格式。
- [x] 文件扫描 subagent：实现增量扫描，避免重复入库。

## 阶段 2：核心浏览体验

- [x] 图片解码 subagent：支持 jpg/jpeg、png、gif、bmp、ico、tiff。
- [x] 图片解码 subagent：支持 webp、avif、svg。
- [x] 图片解码 subagent：处理大图加载、解码失败和占位图状态。
- [x] 缩略图 subagent：实现缩略图生成任务队列。
- [x] 缩略图 subagent：实现磁盘缓存、缓存命中和失败重试。
- [x] 缩略图 subagent：实现缓存大小统计和清理接口。
- [x] 前端 UI subagent：实现主布局、菜单栏、工具栏、侧边栏和主内容区。
- [x] 前端 UI subagent：实现合集网格、合集列表、排序和基础筛选。
- [x] 前端 UI subagent：实现合集详情页和缩略图虚拟滚动。
- [x] 查看器 subagent：实现图片打开、上一张/下一张、键盘快捷键。
- [x] 查看器 subagent：实现适应窗口、实际大小、自由缩放和旋转。
- [x] 查看器 subagent：实现全屏模式、幻灯片和图片信息面板。

## 阶段 3：管理能力

- [x] 合集管理 subagent：实现合集编辑，包括名称、描述、评分、封面。
- [x] 合集管理 subagent：实现合集收藏、最近查看、查看次数更新。
- [x] 合集管理 subagent：实现合集删除记录，并预留是否删除物理文件夹的确认流程。
- [x] 图片管理 subagent：实现单图打开、重命名、移动、复制、删除。
- [x] 图片管理 subagent：实现批量移动、批量复制、批量删除、批量评分。
- [x] 图片管理 subagent：实现右键菜单和拖拽操作。
- [x] 标签系统 subagent：实现标签创建、编辑、删除、重命名。
- [x] 标签系统 subagent：实现标签颜色和合集/图片多标签关联。
- [x] 标签系统 subagent：实现按标签筛选合集和图片。

## 阶段 4：高级功能

- [x] 搜索 subagent：实现全局搜索合集名称、图片文件名和标签。
- [x] 搜索 subagent：实现高级组合搜索，包括格式、分辨率、大小、标签、评分、日期、收藏状态。
- [x] 搜索 subagent：实现搜索结果分类展示和点击跳转定位。
- [x] 重复检测 subagent：实现 SHA256 完全重复检测。
- [x] 重复检测 subagent：实现 pHash 视觉相似检测。
- [x] 重复检测 subagent：实现重复/相似图片分组、删除建议和批量处理。
- [ ] 文件监听 subagent：监听已导入合集目录变化。
- [ ] 文件监听 subagent：自动同步新增、删除、重命名的图片和文件夹。
- [ ] 设置/数据 subagent：实现主题、语言、快捷键、缩略图大小设置。
- [ ] 设置/数据 subagent：实现数据库备份、恢复、重建索引和数据导出。

## 阶段 5：质量、性能与发布

- [ ] 性能 subagent：优化万级图片缩略图虚拟滚动。
- [ ] 性能 subagent：优化导入性能，目标 1000 张图片小于 30 秒。
- [ ] 性能 subagent：优化已缓存图片打开速度，目标小于 200ms。
- [ ] 性能 subagent：控制大图浏览内存占用，避免崩溃。
- [ ] QA subagent：补充 Rust 单元测试和 Tauri command 测试。
- [ ] QA subagent：补充前端组件测试和关键交互测试。
- [ ] QA subagent：执行 Windows、macOS、Linux 冒烟测试。
- [ ] 打包 subagent：配置跨平台构建、安装包和发布产物。
- [ ] 打包 subagent：配置应用图标、签名预留和自动更新预留。

## 建议执行顺序

1. 完成阶段 0，锁定全量功能边界、工程边界和验收标准。
2. 完成阶段 1，搭好可持续迭代的 Tauri 基础。
3. 完成阶段 2，交付可导入、可浏览、可查看图片的基础闭环。
4. 并行推进阶段 3 的管理能力。
5. 在核心体验稳定后推进阶段 4 的高级功能。
6. 持续执行阶段 5 的性能、测试和打包工作。
