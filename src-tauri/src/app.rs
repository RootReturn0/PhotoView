use crate::{
    db,
    errors::{AppError, AppResult},
    paths::{AppPaths, AppPathsDto},
};
use rusqlite::Connection;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Runtime};

pub struct AppState {
    paths: AppPaths,
    db: Mutex<Connection>,
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
}
