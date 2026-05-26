use crate::{
    db,
    errors::{AppError, AppResult},
    paths::{AppPaths, AppPathsDto},
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    fs,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Runtime};

pub struct AppState {
    paths: AppPaths,
    db: Mutex<Connection>,
    import_cancel_requested: AtomicBool,
}

#[derive(Debug, Serialize)]
pub struct AppStatus {
    pub product_name: String,
    pub version: String,
    pub paths: AppPathsDto,
    pub schema_version: i64,
    pub current_schema_version: i64,
    pub collection_count: i64,
    pub image_count: i64,
    pub tag_count: i64,
}

impl AppState {
    pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> AppResult<Self> {
        let paths = AppPaths::initialize(app)?;
        let db = db::open_database(&paths.database_path)?;

        Ok(Self {
            paths,
            db: Mutex::new(db),
            import_cancel_requested: AtomicBool::new(false),
        })
    }

    #[cfg(test)]
    pub fn initialize_for_test(app_data_dir: std::path::PathBuf) -> AppResult<Self> {
        let paths = AppPaths::initialize_at(app_data_dir)?;
        let db = db::open_database(&paths.database_path)?;

        Ok(Self {
            paths,
            db: Mutex::new(db),
            import_cancel_requested: AtomicBool::new(false),
        })
    }

    pub fn status(&self) -> AppResult<AppStatus> {
        self.with_db(|db| {
            Ok(AppStatus {
                product_name: "PhotoView".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                paths: self.paths.to_dto(),
                schema_version: db::schema_version(db)?,
                current_schema_version: db::CURRENT_SCHEMA_VERSION,
                collection_count: db::count_rows(db, "collections")?,
                image_count: db::count_rows(db, "images")?,
                tag_count: db::count_rows(db, "tags")?,
            })
        })
    }

    pub fn with_db<T>(&self, f: impl FnOnce(&Connection) -> AppResult<T>) -> AppResult<T> {
        let db = self
            .db
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))?;

        f(&db)
    }

    pub fn with_db_mut<T>(&self, f: impl FnOnce(&mut Connection) -> AppResult<T>) -> AppResult<T> {
        let mut db = self
            .db
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))?;

        f(&mut db)
    }

    pub fn paths(&self) -> &AppPaths {
        &self.paths
    }

    pub fn reset_import_cancel(&self) {
        self.import_cancel_requested.store(false, Ordering::SeqCst);
    }

    pub fn request_import_cancel(&self) {
        self.import_cancel_requested.store(true, Ordering::SeqCst);
    }

    pub fn import_cancel_requested(&self) -> bool {
        self.import_cancel_requested.load(Ordering::SeqCst)
    }

    pub fn restore_database_from_backup(&self, backup_path: &Path) -> AppResult<()> {
        let replacement = db::open_database(backup_path)?;
        drop(replacement);

        let mut db = self
            .db
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))?;
        let placeholder = Connection::open_in_memory()?;
        let current = std::mem::replace(&mut *db, placeholder);
        drop(current);
        fs::copy(backup_path, &self.paths.database_path)?;
        *db = db::open_database(&self.paths.database_path)?;
        Ok(())
    }
}
