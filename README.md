# PhotoView

PhotoView 是一个本地优先的跨平台图片查看器与合集管理工具。它基于 Tauri 2、Rust、SQLite、React 和 TypeScript 构建，图片索引、缩略图、标签、搜索和重复检测都在本机完成，不上传用户图片。

PhotoView is a local-first, cross-platform image viewer and collection manager. It is built with Tauri 2, Rust, SQLite, React, and TypeScript. Image indexing, thumbnails, tags, search, and duplicate detection all run locally without uploading user photos.

## 功能概览 / Features

- 导入本地图片文件夹，递归扫描并增量同步合集。
- Import local image folders, recursively scan them, and keep collections in sync incrementally.
- 支持 jpg/jpeg、png、gif、bmp、ico、tiff/tif、webp、avif、svg 等格式识别。
- Detect jpg/jpeg, png, gif, bmp, ico, tiff/tif, webp, avif, svg, and other common image formats.
- 生成 WebP 缩略图并使用磁盘缓存，支持万级图片虚拟滚动。
- Generate cached WebP thumbnails and handle large libraries with virtual scrolling.
- 图片查看器支持上一张/下一张、缩放、旋转、全屏、幻灯片和信息面板。
- The viewer supports previous/next navigation, zoom, rotation, fullscreen, slideshow, and image details.
- 支持合集编辑、收藏、评分、封面、最近查看和查看次数。
- Manage collection names, descriptions, favorites, ratings, covers, recent views, and view counts.
- 支持单图/批量重命名、移动、复制、删除到系统回收站和批量评分。
- Rename, move, copy, trash, and rate images individually or in batches.
- 支持合集标签、图片标签、全局搜索、高级筛选、SHA256 完全重复检测和 pHash 相似图检测。
- Use collection tags, image tags, global search, advanced filters, SHA256 exact duplicate detection, and pHash visual similarity detection.
- 支持目录监听、手动同步、数据库备份/恢复、重建索引、JSON 导出和基础偏好设置。
- Watch folders, run manual sync, back up and restore the database, rebuild indexes, export JSON, and manage basic preferences.

## 技术栈 / Tech Stack

- 桌面壳 / Desktop shell: Tauri 2
- 后端 / Backend: Rust, SQLite/rusqlite
- 前端 / Frontend: React 19, TypeScript, Vite
- 包管理 / Package manager: pnpm
- 测试 / Testing: Vitest, Testing Library, Rust unit tests, Tauri command tests

## 目录结构 / Project Structure

- `src/`：React 前端代码。
- `src/`: React frontend code.
- `src-tauri/`：Tauri/Rust 后端、数据库、扫描、缩略图、文件操作和打包配置。
- `src-tauri/`: Tauri/Rust backend, database, scanning, thumbnails, file operations, and packaging configuration.
- `docs/`：架构、验收和性能说明。
- `docs/`: Architecture, acceptance, and performance notes.
- `scripts/bench/`：本地性能测试 fixture 生成脚本。
- `scripts/bench/`: Local performance fixture generator.
- `fixtures/`：本地测试图片目录，已被 `.gitignore` 忽略，不提交图片。
- `fixtures/`: Local test image directory. It is ignored by `.gitignore`; do not commit images.

## 开发环境准备 / Development Requirements

通用依赖 / Common requirements:

- Node.js 22 LTS
- pnpm 10.x
- Rust stable
- Git

启用 pnpm / Enable pnpm:

```bash
corepack enable
corepack prepare pnpm@10.33.0 --activate
```

macOS 额外依赖 / Additional macOS requirements:

```bash
xcode-select --install
```

正式签名和公证需要 Apple Developer 账号和对应证书；没有证书时，CI 会生成 ad-hoc signed 的 macOS 构建。

Official code signing and notarization require an Apple Developer account and the required certificates. Without certificates, CI produces ad-hoc signed macOS builds.

Windows 额外依赖 / Additional Windows requirements:

- Windows 10/11
- Microsoft Edge WebView2 Runtime
- Visual Studio Build Tools 2022，安装 C++ build tools 和 Windows SDK。
- Visual Studio Build Tools 2022 with C++ build tools and Windows SDK.
- Rust 使用 MSVC toolchain。
- Rust should use the MSVC toolchain.

Linux Ubuntu/Debian 额外依赖 / Additional Linux Ubuntu/Debian requirements:

```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  file \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libssl-dev \
  libwebkit2gtk-4.1-dev \
  libxdo-dev \
  pkg-config \
  wget
```

## 安装依赖 / Install Dependencies

```bash
pnpm install
```

## 启动项目 / Run the Project

启动完整桌面应用 / Start the full desktop app:

```bash
pnpm tauri dev
```

只启动前端页面调试 / Start only the frontend dev server:

```bash
pnpm dev
```

前端开发服务默认由 Tauri 使用 `http://localhost:1420`。

The frontend dev server used by Tauri runs at `http://localhost:1420` by default.

## 构建 / Build

仅构建前端 / Build only the frontend:

```bash
pnpm build
```

构建当前平台桌面应用和安装包 / Build the desktop app and installer for the current platform:

```bash
pnpm tauri build
```

按平台指定产物 / Build specific platform bundles:

```bash
# macOS
pnpm tauri build --bundles app,dmg

# Windows
pnpm tauri build --bundles nsis,msi

# Linux
pnpm tauri build --bundles deb,appimage
```

构建产物位于 `src-tauri/target/release/bundle/`。推送 tag `v*` 会触发发布工作流，为 macOS、Windows、Linux 构建产物，并上传到对应 GitHub Release。

Build artifacts are written to `src-tauri/target/release/bundle/`. Pushing a `v*` tag triggers the release workflow, builds artifacts for macOS, Windows, and Linux, and uploads them to the matching GitHub Release.

## 各平台安装与启动 / Install and Launch on Each Platform

macOS:

1. 使用 `.dmg` 时打开镜像，将 `PhotoView.app` 拖到 `Applications`。
2. Open the `.dmg` and drag `PhotoView.app` into `Applications`.
3. 使用 `.app` 时直接放入 `Applications` 或任意目录。
4. If using the `.app` bundle directly, place it in `Applications` or any folder.
5. 未公证或 ad-hoc signed 构建首次启动可能被 Gatekeeper 拦截，可右键应用选择“打开”。
6. Non-notarized or ad-hoc signed builds may be blocked by Gatekeeper on first launch; right-click the app and choose Open.

Windows:

1. 优先使用 `.msi` 或 NSIS `.exe` 安装包。
2. Prefer the `.msi` or NSIS `.exe` installer.
3. 双击安装后从开始菜单启动 `PhotoView`。
4. Install it and launch `PhotoView` from the Start menu.
5. 未签名构建可能触发 SmartScreen，需要选择继续运行。
6. Unsigned builds may trigger SmartScreen; choose to continue running if you trust the build.

Linux:

```bash
# deb
sudo apt install ./PhotoView_*.deb
photoview

# AppImage
chmod +x PhotoView_*.AppImage
./PhotoView_*.AppImage
```

不同发行版的菜单入口名称可能显示为 `PhotoView`。

The desktop launcher may appear as `PhotoView`, depending on the distribution.

## 测试与验收 / Test and Validate

```bash
pnpm test
pnpm build

cd src-tauri
cargo fmt --check
cargo test
```

Windows CI 中 Tauri/WebView2 测试二进制存在启动兼容问题，因此自动化流程使用：

On Windows CI, Tauri/WebView2 test binaries can fail to launch even after compilation, so the automated workflow uses:

```bash
cd src-tauri
cargo test --no-run
```

跨平台 CI 已覆盖 macOS、Windows 和 Ubuntu：依赖安装、前端测试、前端构建、Rust 格式检查、Rust 测试或测试编译、Tauri no-bundle 构建。

Cross-platform CI covers macOS, Windows, and Ubuntu: dependency installation, frontend tests, frontend build, Rust formatting, Rust tests or test compilation, and Tauri no-bundle build.

## 测试数据 / Test Data

仓库忽略 `fixtures/`，图片不提交。

The repository ignores `fixtures/`; do not commit images.

生成 1000 张本地性能测试图片 / Generate 1000 local performance test images:

```bash
pnpm bench:fixtures 1000
```

生成后在桌面应用中导入 `fixtures/bench-1000`，用于观察导入耗时、缩略图滚动和缓存打开速度。涉及删除、移动、重命名等破坏性流程时，先复制到临时目录再测试。

After generation, import `fixtures/bench-1000` in the desktop app to measure import time, thumbnail scrolling, and cached image open speed. For destructive flows such as delete, move, or rename, copy fixtures to a temporary directory first.

## 发布说明 / Release Notes

`.github/workflows/release.yml` 会在推送 `v*` tag 时创建 GitHub Release，并构建上传：

`.github/workflows/release.yml` creates a GitHub Release when a `v*` tag is pushed, then builds and uploads:

- macOS: `app`, `dmg`
- Windows: `nsis`, `msi`
- Linux: `deb`, `appimage`

macOS workflow 会在存在 `APPLE_CERTIFICATE` 等 secrets 时走正式签名；没有 Apple 证书时会使用 ad-hoc signing。Windows 代码签名和自动更新签名仍需要在 GitHub Secrets 中补充对应证书和 `TAURI_SIGNING_PRIVATE_KEY` 等敏感信息。

The macOS workflow uses official signing when secrets such as `APPLE_CERTIFICATE` are available; otherwise it uses ad-hoc signing. Windows code signing and updater signing still require the matching certificates and secrets such as `TAURI_SIGNING_PRIVATE_KEY` in GitHub Secrets.

## 推荐 IDE / Recommended IDE

- VS Code
- Tauri extension
- rust-analyzer
