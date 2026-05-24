import { useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileImage,
  FolderPlus,
  Grid2X2,
  Images,
  Info,
  List,
  Maximize2,
  Pause,
  Play,
  RotateCw,
  Star,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./App.css";

type AppStatus = {
  product_name: string;
  version: string;
  paths: {
    app_data_dir: string;
    database_path: string;
    thumbnails_dir: string;
  };
  schema_version: number;
  current_schema_version: number;
  collection_count: number;
  image_count: number;
  tag_count: number;
};

type ImportCollectionResult = {
  collection: {
    id: string;
    name: string;
  };
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
};

type Collection = {
  id: string;
  path: string;
  name: string;
  description: string;
  rating: number;
  isFavorite: boolean;
  imageCount: number;
  totalSizeBytes: number;
  importedAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  viewCount: number;
};

type CollectionSortKey = "imported" | "name" | "images" | "size";
type CollectionViewMode = "grid" | "list";

type ImageRecord = {
  id: string;
  collectionId: string;
  path: string;
  fileName: string;
  extension: string;
  format: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  importedAt: string;
  rating: number;
  isFavorite: boolean;
  isMissing: boolean;
};

type Thumbnail = {
  imageId: string;
  cachePath: string;
  url: string;
  width: number;
  height: number;
  status: string;
};

type ViewerFitMode = "fit" | "actual";
type ImageLoadState = "loading" | "loaded" | "error";

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, Thumbnail>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string>>({});
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedImportPath, setSelectedImportPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CollectionSortKey>("imported");
  const [viewMode, setViewMode] = useState<CollectionViewMode>("grid");
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerFitMode, setViewerFitMode] = useState<ViewerFitMode>("fit");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerRotation, setViewerRotation] = useState(0);
  const [viewerImageState, setViewerImageState] = useState<ImageLoadState>("loading");
  const [isSlideshowActive, setIsSlideshowActive] = useState(false);
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(true);
  const importInFlight = useRef(false);
  const thumbnailRequests = useRef(new Set<string>());
  const imageListRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );

  const activeImage = viewerIndex === null ? null : images[viewerIndex] ?? null;

  const visibleCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = normalizedQuery
      ? collections.filter((collection) =>
          [collection.name, collection.path, collection.description]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : collections;

    return [...filtered].sort((left, right) => compareCollections(left, right, sortKey));
  }, [collections, query, sortKey]);

  const imageVirtualizer = useVirtualizer({
    count: images.length,
    getScrollElement: () => imageListRef.current,
    estimateSize: () => 78,
    overscan: 8,
  });

  useEffect(() => {
    void refreshAppData();
  }, []);

  useEffect(() => {
    if (selectedCollectionId) {
      closeViewer();
      void refreshImages(selectedCollectionId);
      return;
    }

    closeViewer();
    setImages([]);
    setThumbnails({});
    setThumbnailErrors({});
    thumbnailRequests.current.clear();
  }, [selectedCollectionId]);

  useEffect(() => {
    if (!isTauriRuntime() || images.length === 0) {
      return;
    }

    const visibleItems = imageVirtualizer.getVirtualItems();
    for (const item of visibleItems) {
      const image = images[item.index];
      if (!image || thumbnails[image.id] || thumbnailErrors[image.id]) {
        continue;
      }

      if (thumbnailRequests.current.has(image.id)) {
        continue;
      }

      thumbnailRequests.current.add(image.id);
      void loadThumbnail(image.id);
    }
  });

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlisten: (() => void) | undefined;

    listen("menu-import-folder", () => {
      void handleChooseImportFolder();
    }).then((value) => {
      unlisten = value;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!activeImage) {
      return;
    }

    setViewerImageState("loading");
  }, [activeImage?.id]);

  useEffect(() => {
    if (!activeImage) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPreviousImage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        showNextImage();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImage, images.length]);

  useEffect(() => {
    if (!isSlideshowActive || !activeImage || images.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      showNextImage();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [activeImage, images.length, isSlideshowActive]);

  async function refreshAppData() {
    await Promise.all([refreshStatus(), refreshCollections()]);
  }

  async function refreshStatus() {
    if (!isTauriRuntime()) {
      setStatus(mockStatus(collections.length, 0));
      return;
    }

    try {
      setStatus(await invoke<AppStatus>("get_app_status"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshCollections() {
    setCollectionsLoading(true);

    if (!isTauriRuntime()) {
      setCollections([]);
      setCollectionsLoading(false);
      return;
    }

    try {
      setCollections(await invoke<Collection[]>("list_collections"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setCollectionsLoading(false);
    }
  }

  async function refreshImages(collectionId: string) {
    setImagesLoading(true);

    if (!isTauriRuntime()) {
      setImages([]);
      setImagesLoading(false);
      return;
    }

    try {
      const nextImages = await invoke<ImageRecord[]>("list_images", {
        request: { collectionId, limit: 1000, offset: 0 },
      });
      setImages(nextImages);
      setThumbnails({});
      setThumbnailErrors({});
      thumbnailRequests.current.clear();
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setImagesLoading(false);
    }
  }

  async function loadThumbnail(imageId: string) {
    try {
      const thumbnail = await invoke<Thumbnail>("get_thumbnail", {
        imageId,
        targetSize: 192,
      });

      setThumbnails((current) => ({ ...current, [imageId]: thumbnail }));
    } catch (value) {
      setThumbnailErrors((current) => ({
        ...current,
        [imageId]: invokeErrorMessage(value),
      }));
    }
  }

  async function handleChooseImportFolder() {
    if (importInFlight.current) {
      return;
    }

    importInFlight.current = true;
    setError(null);
    setNotice(null);
    setIsImporting(true);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中导入文件夹");
      importInFlight.current = false;
      setIsImporting(false);
      return;
    }

    try {
      const folder = await invoke<string | null>("choose_import_folder");
      if (!folder) {
        setIsImporting(false);
        return;
      }

      setSelectedImportPath(folder);
      setNotice("正在导入文件夹");

      const result = await invoke<ImportCollectionResult>("import_collection", {
        request: { path: folder },
      });

      setNotice(
        `${result.collection.name}：扫描 ${result.scannedCount} 张，新增 ${result.insertedCount} 张，更新 ${result.updatedCount} 张，错误 ${result.errorCount} 个`,
      );
      await refreshAppData();
      setSelectedCollectionId(result.collection.id);
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      importInFlight.current = false;
      setIsImporting(false);
    }
  }

  async function handleCopyPath() {
    if (!selectedImportPath) {
      return;
    }

    await copyPath(selectedImportPath);
  }

  async function handleOpenPath() {
    if (!selectedImportPath) {
      return;
    }

    await openPath(selectedImportPath);
  }

  async function copyPath(path: string) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中复制路径");
      return;
    }

    try {
      await invoke("copy_path_to_clipboard", { path });
      setNotice("路径已复制");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function openPath(path: string) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中打开位置");
      return;
    }

    try {
      await invoke("open_path_in_file_manager", { path });
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function openCollection(collection: Collection) {
    setSelectedCollectionId(collection.id);
    setNotice(null);
    setError(null);
  }

  function openViewer(index: number) {
    if (!images[index]) {
      return;
    }

    setViewerIndex(index);
    setViewerFitMode("fit");
    setViewerZoom(1);
    setViewerRotation(0);
    setViewerImageState("loading");
    setIsSlideshowActive(false);
    setIsInfoPanelOpen(true);
  }

  function closeViewer() {
    setViewerIndex(null);
    setIsSlideshowActive(false);
  }

  function showPreviousImage() {
    setViewerIndex((current) => {
      if (current === null || images.length === 0) {
        return current;
      }

      return current === 0 ? images.length - 1 : current - 1;
    });
  }

  function showNextImage() {
    setViewerIndex((current) => {
      if (current === null || images.length === 0) {
        return current;
      }

      return current === images.length - 1 ? 0 : current + 1;
    });
  }

  function resetViewerTransform(mode: ViewerFitMode) {
    setViewerFitMode(mode);
    setViewerZoom(1);
  }

  function changeViewerZoom(delta: number) {
    setViewerFitMode("actual");
    setViewerZoom((current) => clamp(Number((current + delta).toFixed(2)), 0.25, 4));
  }

  function rotateViewer() {
    setViewerRotation((current) => (current + 90) % 360);
  }

  async function toggleFullscreen() {
    const element = viewerRef.current;
    if (!element) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="PhotoView navigation">
        <div className="brand">
          <span className="brand-mark">PV</span>
          <span>PhotoView</span>
        </div>
        <nav>
          <button className="nav-item active">全部</button>
          <button className="nav-item">收藏</button>
          <button className="nav-item">最近</button>
          <button className="nav-item">标签</button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <input
            aria-label="搜索"
            placeholder="搜索合集、路径或描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            className="primary-action"
            type="button"
            disabled={isImporting}
            aria-busy={isImporting}
            onClick={handleChooseImportFolder}
          >
            <FolderPlus size={16} aria-hidden="true" />
            <span>{isImporting ? "导入中" : "导入"}</span>
          </button>
        </header>

        <section className="content">
          {selectedCollection ? (
            <>
              <div className="section-heading detail-heading">
                <button
                  aria-label="返回合集"
                  className="icon-button"
                  title="返回合集"
                  type="button"
                  onClick={() => setSelectedCollectionId(null)}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <h1>{selectedCollection.name}</h1>
                <span>{images.length} 张图片</span>
              </div>

              <div className="detail-meta">
                <span>{selectedCollection.path}</span>
                <button
                  aria-label="打开所在位置"
                  className="icon-button"
                  title="打开所在位置"
                  type="button"
                  onClick={() => void openPath(selectedCollection.path)}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>

              <section className="image-surface" ref={imageListRef} aria-busy={imagesLoading}>
                {imagesLoading ? (
                  <div className="empty-state">
                    <h2>加载中</h2>
                    <p>正在读取图片索引。</p>
                  </div>
                ) : images.length > 0 ? (
                  <div
                    className="image-virtual-space"
                    style={{ height: `${imageVirtualizer.getTotalSize()}px` }}
                  >
                    {imageVirtualizer.getVirtualItems().map((virtualItem) => {
                      const image = images[virtualItem.index];

                      return (
                        <article
                          className="image-row"
                          key={image.id}
                          role="button"
                          tabIndex={0}
                          style={{ transform: `translateY(${virtualItem.start}px)` }}
                          onDoubleClick={() => openViewer(virtualItem.index)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              openViewer(virtualItem.index);
                            }
                          }}
                        >
                          <div className="image-thumb-placeholder">
                            {thumbnails[image.id] ? (
                              <img
                                alt=""
                                src={convertFileSrc(thumbnails[image.id].cachePath)}
                              />
                            ) : (
                              <FileImage size={20} aria-hidden="true" />
                            )}
                          </div>
                          <div className="image-row-main">
                            <h2>{image.fileName}</h2>
                            <p>{image.path}</p>
                          </div>
                          <div className="image-row-meta">
                            <span>{image.format}</span>
                            <span>
                              {image.width && image.height
                                ? `${image.width} x ${image.height}`
                                : "尺寸未知"}
                            </span>
                            <span>{formatBytes(image.sizeBytes)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    <h2>暂无图片</h2>
                    <p>重新导入或检查文件夹权限后再试。</p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="section-heading">
                <h1>全部合集</h1>
                <span>
                  {status
                    ? `${visibleCollections.length}/${status.collection_count} 个合集`
                    : "初始化中"}
                </span>
              </div>

              <div className="collection-controls">
                <select
                  aria-label="合集排序"
                  value={sortKey}
                  onChange={(event) => setSortKey(event.target.value as CollectionSortKey)}
                >
                  <option value="imported">最近导入</option>
                  <option value="name">名称</option>
                  <option value="images">图片数量</option>
                  <option value="size">占用空间</option>
                </select>
                <div className="segmented-control" aria-label="合集视图">
                  <button
                    aria-label="网格视图"
                    className={viewMode === "grid" ? "active" : ""}
                    title="网格视图"
                    type="button"
                    onClick={() => setViewMode("grid")}
                  >
                    <Grid2X2 size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="列表视图"
                    className={viewMode === "list" ? "active" : ""}
                    title="列表视图"
                    type="button"
                    onClick={() => setViewMode("list")}
                  >
                    <List size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <section className={`collection-surface ${viewMode}`} aria-busy={collectionsLoading}>
                {collectionsLoading ? (
                  <div className="empty-state">
                    <h2>加载中</h2>
                    <p>正在读取本地合集索引。</p>
                  </div>
                ) : visibleCollections.length > 0 ? (
                  visibleCollections.map((collection) => (
                    <article
                      className="collection-card"
                      key={collection.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => openCollection(collection)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          openCollection(collection);
                        }
                      }}
                    >
                      <div className="collection-cover">
                        <Images size={24} aria-hidden="true" />
                      </div>
                      <div className="collection-main">
                        <div className="collection-title-row">
                          <h2>{collection.name}</h2>
                          {collection.isFavorite ? <Star size={15} aria-label="已收藏" /> : null}
                        </div>
                        <p>{collection.path}</p>
                        <div className="collection-meta">
                          <span>{collection.imageCount} 张</span>
                          <span>{formatBytes(collection.totalSizeBytes)}</span>
                          <span>{formatDate(collection.importedAt)}</span>
                          <span>评分 {collection.rating}/5</span>
                        </div>
                      </div>
                      <div className="collection-actions">
                        <button
                          aria-label="复制路径"
                          className="icon-button"
                          title="复制路径"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyPath(collection.path);
                          }}
                        >
                          <Copy size={16} aria-hidden="true" />
                        </button>
                        <button
                          aria-label="打开所在位置"
                          className="icon-button"
                          title="打开所在位置"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openPath(collection.path);
                          }}
                        >
                          <ExternalLink size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h2>{collections.length > 0 ? "没有匹配合集" : "暂无合集"}</h2>
                    <p>
                      {collections.length > 0
                        ? "调整搜索关键词后再试。"
                        : "选择本地图片文件夹后，PhotoView 会在本机建立索引。"}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}

          {selectedImportPath ? (
            <div className="selected-folder" aria-label="已选择的导入文件夹">
              <span>{selectedImportPath}</span>
              <div className="selected-folder-actions">
                <button
                  aria-label="复制路径"
                  className="icon-button"
                  title="复制路径"
                  type="button"
                  onClick={handleCopyPath}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label="打开所在位置"
                  className="icon-button"
                  title="打开所在位置"
                  type="button"
                  onClick={handleOpenPath}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          <footer className="status-bar">
            {error ? (
              <span className="status-error">{error}</span>
            ) : notice ? (
              <span className="status-notice">{notice}</span>
            ) : status ? (
              <>
                <span>
                  Schema v{status.schema_version}/{status.current_schema_version}
                </span>
                <span>{status.image_count} 张图片</span>
                <span>{status.tag_count} 个标签</span>
              </>
            ) : (
              <span>正在初始化数据库</span>
            )}
          </footer>
        </section>
      </section>

      {activeImage ? (
        <section
          aria-label="图片查看器"
          aria-modal="true"
          className="viewer-overlay"
          ref={viewerRef}
          role="dialog"
        >
          <header className="viewer-toolbar">
            <div className="viewer-title">
              <strong>{activeImage.fileName}</strong>
              <span>
                {(viewerIndex ?? 0) + 1}/{images.length}
              </span>
            </div>
            <div className="viewer-controls" aria-label="查看器工具栏">
              <button type="button" onClick={() => resetViewerTransform("fit")}>
                适应
              </button>
              <button type="button" onClick={() => resetViewerTransform("actual")}>
                1:1
              </button>
              <button aria-label="缩小" title="缩小" type="button" onClick={() => changeViewerZoom(-0.25)}>
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <span className="viewer-zoom">{Math.round(viewerZoom * 100)}%</span>
              <button aria-label="放大" title="放大" type="button" onClick={() => changeViewerZoom(0.25)}>
                <ZoomIn size={16} aria-hidden="true" />
              </button>
              <button aria-label="旋转 90 度" title="旋转 90 度" type="button" onClick={rotateViewer}>
                <RotateCw size={16} aria-hidden="true" />
              </button>
              <button aria-label="全屏" title="全屏" type="button" onClick={() => void toggleFullscreen()}>
                <Maximize2 size={16} aria-hidden="true" />
              </button>
              <button
                aria-label={isSlideshowActive ? "暂停幻灯片" : "开始幻灯片"}
                title={isSlideshowActive ? "暂停幻灯片" : "开始幻灯片"}
                type="button"
                onClick={() => setIsSlideshowActive((current) => !current)}
              >
                {isSlideshowActive ? (
                  <Pause size={16} aria-hidden="true" />
                ) : (
                  <Play size={16} aria-hidden="true" />
                )}
              </button>
              <button
                aria-label="图片信息"
                title="图片信息"
                type="button"
                onClick={() => setIsInfoPanelOpen((current) => !current)}
              >
                <Info size={16} aria-hidden="true" />
              </button>
              <button aria-label="关闭查看器" title="关闭查看器" type="button" onClick={closeViewer}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <button
            aria-label="上一张"
            className="viewer-nav previous"
            title="上一张"
            type="button"
            onClick={showPreviousImage}
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>

          <div className={`viewer-stage ${isInfoPanelOpen ? "with-info" : ""}`}>
            <div className="viewer-canvas">
              {viewerImageState === "loading" ? (
                <div className="viewer-placeholder">正在加载图片</div>
              ) : null}
              {viewerImageState === "error" ? (
                <div className="viewer-placeholder error">图片解码失败</div>
              ) : null}
              <img
                alt={activeImage.fileName}
                className={viewerFitMode === "fit" ? "fit" : "actual"}
                src={convertImagePath(activeImage.path)}
                style={{
                  opacity: viewerImageState === "loaded" ? 1 : 0,
                  transform: `rotate(${viewerRotation}deg) scale(${viewerFitMode === "fit" ? 1 : viewerZoom})`,
                }}
                onError={() => setViewerImageState("error")}
                onLoad={() => setViewerImageState("loaded")}
              />
            </div>

            {isInfoPanelOpen ? (
              <aside className="viewer-info" aria-label="图片信息">
                <h2>信息</h2>
                <dl>
                  <div>
                    <dt>格式</dt>
                    <dd>{activeImage.format || activeImage.extension || "未知"}</dd>
                  </div>
                  <div>
                    <dt>尺寸</dt>
                    <dd>
                      {activeImage.width && activeImage.height
                        ? `${activeImage.width} x ${activeImage.height}`
                        : "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatBytes(activeImage.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>路径</dt>
                    <dd title={activeImage.path}>{activeImage.path}</dd>
                  </div>
                </dl>
              </aside>
            ) : null}
          </div>

          <button
            aria-label="下一张"
            className="viewer-nav next"
            title="下一张"
            type="button"
            onClick={showNextImage}
          >
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </section>
      ) : null}
    </main>
  );
}

function invokeErrorMessage(value: unknown): string {
  if (typeof value === "object" && value && "message" in value) {
    return String(value.message);
  }

  return String(value);
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function mockStatus(collectionCount: number, imageCount: number): AppStatus {
  return {
    product_name: "PhotoView",
    version: "0.1.0",
    paths: {
      app_data_dir: "",
      database_path: "",
      thumbnails_dir: "",
    },
    schema_version: 1,
    current_schema_version: 1,
    collection_count: collectionCount,
    image_count: imageCount,
    tag_count: 0,
  };
}

function compareCollections(
  left: Collection,
  right: Collection,
  sortKey: CollectionSortKey,
): number {
  if (sortKey === "name") {
    return left.name.localeCompare(right.name, "zh-CN");
  }

  if (sortKey === "images") {
    return right.imageCount - left.imageCount;
  }

  if (sortKey === "size") {
    return right.totalSizeBytes - left.totalSizeBytes;
  }

  return new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime();
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function convertImagePath(path: string): string {
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

export default App;
