import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Copy,
  ExternalLink,
  FolderPlus,
  Grid2X2,
  Images,
  List,
  Star,
} from "lucide-react";
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

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedImportPath, setSelectedImportPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<CollectionSortKey>("imported");
  const [viewMode, setViewMode] = useState<CollectionViewMode>("grid");
  const importInFlight = useRef(false);

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

  useEffect(() => {
    void refreshAppData();
  }, []);

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
                <article className="collection-card" key={collection.id}>
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
                      onClick={() => void copyPath(collection.path)}
                    >
                      <Copy size={16} aria-hidden="true" />
                    </button>
                    <button
                      aria-label="打开所在位置"
                      className="icon-button"
                      title="打开所在位置"
                      type="button"
                      onClick={() => void openPath(collection.path)}
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

export default App;
