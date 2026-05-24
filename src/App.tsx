import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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

  useEffect(() => {
    invoke<AppStatus>("get_app_status")
      .then(setStatus)
      .catch((value) => {
        if (typeof value === "object" && value && "message" in value) {
          setError(String(value.message));
          return;
        }

        setError(String(value));
      });
  }, []);

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
          <button type="button">导入</button>
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

          <footer className="status-bar">
            {error ? (
              <span className="status-error">{error}</span>
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

export default App;
