use crate::errors::AppResult;
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

pub mod repositories;

pub const CURRENT_SCHEMA_VERSION: i64 = 1;

pub fn open_database(path: &Path) -> AppResult<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    run_migrations(&conn)?;
    Ok(conn)
}

pub fn schema_version(conn: &Connection) -> AppResult<i64> {
    let version = conn
        .query_row("SELECT MAX(version) FROM schema_migrations", [], |row| {
            row.get::<_, Option<i64>>(0)
        })
        .optional()?
        .flatten()
        .unwrap_or(0);
    Ok(version)
}

pub fn count_rows(conn: &Connection, table_name: &str) -> AppResult<i64> {
    let sql = format!("SELECT COUNT(*) FROM {table_name}");
    Ok(conn.query_row(&sql, [], |row| row.get(0))?)
}

fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "
        BEGIN;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS collections (
          id TEXT PRIMARY KEY,
          path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          cover_image_id TEXT,
          description TEXT NOT NULL DEFAULT '',
          rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
          is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
          image_count INTEGER NOT NULL DEFAULT 0,
          total_size_bytes INTEGER NOT NULL DEFAULT 0,
          created_at TEXT,
          imported_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          last_viewed_at TEXT,
          view_count INTEGER NOT NULL DEFAULT 0,
          deleted_at TEXT
        );

        CREATE TABLE IF NOT EXISTS images (
          id TEXT PRIMARY KEY,
          collection_id TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          file_name TEXT NOT NULL,
          extension TEXT NOT NULL,
          format TEXT NOT NULL,
          size_bytes INTEGER NOT NULL DEFAULT 0,
          width INTEGER,
          height INTEGER,
          created_at TEXT,
          modified_at TEXT,
          imported_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          sha256 TEXT,
          phash TEXT,
          rating INTEGER NOT NULL DEFAULT 0 CHECK (rating >= 0 AND rating <= 5),
          is_favorite INTEGER NOT NULL DEFAULT 0 CHECK (is_favorite IN (0, 1)),
          is_missing INTEGER NOT NULL DEFAULT 0 CHECK (is_missing IN (0, 1)),
          last_viewed_at TEXT,
          view_count INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          color TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS collection_tags (
          collection_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (collection_id, tag_id),
          FOREIGN KEY (collection_id) REFERENCES collections(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_tags (
          image_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          PRIMARY KEY (image_id, tag_id),
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS favorites (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL CHECK (target_type IN ('collection', 'image')),
          target_id TEXT NOT NULL,
          favorited_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (target_type, target_id)
        );

        CREATE TABLE IF NOT EXISTS history (
          id TEXT PRIMARY KEY,
          target_type TEXT NOT NULL CHECK (target_type IN ('collection', 'image')),
          target_id TEXT NOT NULL,
          viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (target_type, target_id)
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS thumbnail_cache (
          id TEXT PRIMARY KEY,
          image_id TEXT NOT NULL,
          source_mtime TEXT,
          source_size_bytes INTEGER NOT NULL,
          width INTEGER NOT NULL,
          height INTEGER NOT NULL,
          format TEXT NOT NULL,
          cache_path TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE (image_id, source_mtime, source_size_bytes, width, height, format),
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          status TEXT NOT NULL,
          total_count INTEGER NOT NULL DEFAULT 0,
          completed_count INTEGER NOT NULL DEFAULT 0,
          failed_count INTEGER NOT NULL DEFAULT 0,
          current_item TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          finished_at TEXT
        );

        CREATE TABLE IF NOT EXISTS duplicate_groups (
          id TEXT PRIMARY KEY,
          scan_task_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('sha256', 'phash')),
          threshold REAL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          resolved_at TEXT,
          FOREIGN KEY (scan_task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS duplicate_items (
          group_id TEXT NOT NULL,
          image_id TEXT NOT NULL,
          score REAL,
          recommendation TEXT,
          keep INTEGER NOT NULL DEFAULT 0 CHECK (keep IN (0, 1)),
          PRIMARY KEY (group_id, image_id),
          FOREIGN KEY (group_id) REFERENCES duplicate_groups(id) ON DELETE CASCADE,
          FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_images_collection_id ON images(collection_id);
        CREATE INDEX IF NOT EXISTS idx_images_file_name ON images(file_name);
        CREATE INDEX IF NOT EXISTS idx_images_format ON images(format);
        CREATE INDEX IF NOT EXISTS idx_images_sha256 ON images(sha256);
        CREATE INDEX IF NOT EXISTS idx_collection_tags_tag_id ON collection_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_image_tags_tag_id ON image_tags(tag_id);
        CREATE INDEX IF NOT EXISTS idx_favorites_target ON favorites(target_type, target_id);
        CREATE INDEX IF NOT EXISTS idx_history_viewed_at ON history(viewed_at);
        CREATE INDEX IF NOT EXISTS idx_thumbnail_cache_image_id ON thumbnail_cache(image_id);
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_duplicate_items_image_id ON duplicate_items(image_id);

        INSERT OR IGNORE INTO settings(key, value) VALUES
          ('theme', '\"system\"'),
          ('language', '\"zh-CN\"'),
          ('thumbnail_size', '192'),
          ('recent_limit', '100');

        INSERT OR IGNORE INTO schema_migrations(version) VALUES (1);

        COMMIT;
        ",
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use uuid::Uuid;

    #[test]
    fn initializes_schema_on_empty_database() {
        let path = std::env::temp_dir().join(format!("photoview-{}.sqlite", Uuid::new_v4()));
        let conn = open_database(&path).expect("database should initialize");

        assert_eq!(schema_version(&conn).unwrap(), CURRENT_SCHEMA_VERSION);
        assert_eq!(count_rows(&conn, "collections").unwrap(), 0);

        drop(conn);
        let _ = fs::remove_file(path);
    }
}
