import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, ExternalLink, FolderPlus } from "lucide-react";
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

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedImportPath, setSelectedImportPath] = useState<string | null>(null);

  useEffect(() => {
    invoke<AppStatus>("get_app_status")
      .then(setStatus)
      .catch((value) => setError(invokeErrorMessage(value)));
  }, []);

  async function handleChooseImportFolder() {
    setError(null);
    setNotice(null);

    try {
      const folder = await invoke<string | null>("choose_import_folder");
      if (!folder) {
        return;
      }

      setSelectedImportPath(folder);
      setNotice("已选择导入文件夹");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function handleCopyPath() {
    if (!selectedImportPath) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await invoke("copy_path_to_clipboard", { path: selectedImportPath });
      setNotice("路径已复制");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function handleOpenPath() {
    if (!selectedImportPath) {
      return;
    }

    setError(null);
    setNotice(null);

    try {
      await invoke("open_path_in_file_manager", { path: selectedImportPath });
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
          <input aria-label="搜索" placeholder="搜索合集、图片或标签" />
          <button className="primary-action" type="button" onClick={handleChooseImportFolder}>
            <FolderPlus size={16} aria-hidden="true" />
            <span>导入</span>
          </button>
        </header>

        <section className="content">
          <div className="section-heading">
            <h1>全部合集</h1>
            <span>{status ? `${status.collection_count} 个合集` : "初始化中"}</span>
          </div>

          <div className="empty-state">
            <h2>暂无合集</h2>
            <p>选择本地图片文件夹后，PhotoView 会在本机建立索引。</p>
          </div>

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

export default App;
