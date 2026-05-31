use crate::{
    db,
    errors::{AppError, AppResult},
    paths::{AppPaths, AppPathsDto, DATABASE_FILE_NAME},
};
use rusqlite::Connection;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Runtime};
use uuid::Uuid;

pub struct AppState {
    paths: Mutex<AppPaths>,
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
            paths: Mutex::new(paths),
            db: Mutex::new(db),
            import_cancel_requested: AtomicBool::new(false),
        })
    }

    #[cfg(test)]
    pub fn initialize_for_test(app_data_dir: std::path::PathBuf) -> AppResult<Self> {
        let paths = AppPaths::initialize_at(app_data_dir)?;
        let db = db::open_database(&paths.database_path)?;

        Ok(Self {
            paths: Mutex::new(paths),
            db: Mutex::new(db),
            import_cancel_requested: AtomicBool::new(false),
        })
    }

    pub fn status(&self) -> AppResult<AppStatus> {
        let paths = self.paths_snapshot()?;
        self.with_db(|db| {
            Ok(AppStatus {
                product_name: "PhotoView".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
                paths: paths.to_dto(),
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

    pub fn paths(&self) -> AppPaths {
        self.paths_snapshot().expect("paths lock poisoned")
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
        let paths = self.paths_snapshot()?;

        let mut db = self
            .db
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))?;
        let placeholder = Connection::open_in_memory()?;
        let current = std::mem::replace(&mut *db, placeholder);
        drop(current);
        fs::copy(backup_path, &paths.database_path)?;
        *db = db::open_database(&paths.database_path)?;
        Ok(())
    }

    pub fn move_database_storage(&self, directory: &Path) -> AppResult<PathBuf> {
        let target_dir = prepare_database_directory(directory)?;
        let target_database_path = target_dir.join(DATABASE_FILE_NAME);
        let backup_database_path = target_dir.join(format!("{DATABASE_FILE_NAME}.bak"));
        let current_paths = self.paths_snapshot()?;

        if same_existing_path(&current_paths.database_path, &target_database_path) {
            return Ok(target_database_path);
        }

        if target_database_path.exists() || backup_database_path.exists() {
            let existing_path = if target_database_path.exists() {
                &target_database_path
            } else {
                &backup_database_path
            };
            return Err(AppError::new(
                "path_exists",
                format!(
                    "目标目录已存在数据库文件，请选择空目录或先备份处理：{}",
                    existing_path.display()
                ),
            ));
        }

        let temp_database_path =
            target_dir.join(format!("{}.{}.tmp", DATABASE_FILE_NAME, Uuid::new_v4()));
        let temp_database_path_string = temp_database_path.display().to_string();
        let next_paths = current_paths.with_database_path(target_database_path.clone())?;

        let mut db = self
            .db
            .lock()
            .map_err(|_| AppError::internal("database lock poisoned"))?;
        let _ = db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
        db.execute("VACUUM main INTO ?1", [&temp_database_path_string])?;

        if let Err(error) = db::open_database(&temp_database_path) {
            let _ = fs::remove_file(&temp_database_path);
            return Err(error);
        }

        if let Err(error) = fs::rename(&temp_database_path, &target_database_path) {
            let _ = fs::remove_file(&temp_database_path);
            return Err(error.into());
        }

        let placeholder = Connection::open_in_memory()?;
        let current = std::mem::replace(&mut *db, placeholder);
        drop(current);

        if let Err(error) =
            move_file_across_devices(&current_paths.database_path, &backup_database_path)
        {
            *db = db::open_database(&current_paths.database_path)?;
            let _ = fs::remove_file(&target_database_path);
            return Err(error);
        }

        if let Err(error) = remove_database_sidecars(&current_paths.database_path) {
            let _ = move_file_across_devices(&backup_database_path, &current_paths.database_path);
            *db = db::open_database(&current_paths.database_path)?;
            let _ = fs::remove_file(&target_database_path);
            return Err(error);
        }

        if let Err(error) = next_paths.persist_database_location() {
            let _ = move_file_across_devices(&backup_database_path, &current_paths.database_path);
            *db = db::open_database(&current_paths.database_path)?;
            let _ = fs::remove_file(&target_database_path);
            return Err(error);
        }

        let replacement = db::open_database(&target_database_path)?;
        *db = replacement;

        let mut paths = self
            .paths
            .lock()
            .map_err(|_| AppError::internal("paths lock poisoned"))?;
        *paths = next_paths;

        Ok(target_database_path)
    }

    fn paths_snapshot(&self) -> AppResult<AppPaths> {
        self.paths
            .lock()
            .map(|paths| paths.clone())
            .map_err(|_| AppError::internal("paths lock poisoned"))
    }
}

fn prepare_database_directory(directory: &Path) -> AppResult<PathBuf> {
    if directory.as_os_str().is_empty() {
        return Err(AppError::new("validation_error", "数据库目录不能为空"));
    }

    if directory.exists() && !directory.is_dir() {
        return Err(AppError::new(
            "invalid_path",
            format!("数据库存储位置必须是目录：{}", directory.display()),
        ));
    }

    fs::create_dir_all(directory)?;
    Ok(fs::canonicalize(directory)?)
}

fn same_existing_path(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }

    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(left), Ok(right)) => left == right,
        _ => false,
    }
}

fn move_file_across_devices(source: &Path, destination: &Path) -> AppResult<()> {
    if destination.exists() {
        return Err(AppError::new(
            "path_exists",
            format!("目标文件已存在：{}", destination.display()),
        ));
    }

    match fs::rename(source, destination) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            if !source.exists() {
                return Err(rename_error.into());
            }

            fs::copy(source, destination)?;
            if let Err(remove_error) = fs::remove_file(source) {
                let _ = fs::remove_file(destination);
                return Err(remove_error.into());
            }
            Ok(())
        }
    }
}

fn remove_database_sidecars(database_path: &Path) -> AppResult<()> {
    for suffix in ["-wal", "-shm", "-journal"] {
        let sidecar_path = path_with_suffix(database_path, suffix);
        if sidecar_path.exists() {
            fs::remove_file(sidecar_path)?;
        }
    }

    Ok(())
}

fn path_with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_os_string();
    value.push(suffix);
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{db::repositories, models::UpdateSettingRequest};

    #[test]
    fn move_database_storage_switches_connection_and_persists_location() {
        let app_data_dir = std::env::temp_dir().join(format!("photoview-{}", Uuid::new_v4()));
        let state =
            AppState::initialize_for_test(app_data_dir.clone()).expect("state should initialize");
        let original_database_path = state.paths().database_path;

        state
            .with_db(|db| {
                repositories::update_setting(
                    db,
                    UpdateSettingRequest {
                        key: "theme".to_string(),
                        value: "dark".to_string(),
                    },
                )?;
                Ok(())
            })
            .expect("setting should save before moving");

        let target_dir = app_data_dir.join("custom-database");
        let moved_database_path = state
            .move_database_storage(&target_dir)
            .expect("database should move");

        assert_eq!(
            moved_database_path,
            fs::canonicalize(&target_dir)
                .expect("target dir should exist")
                .join(DATABASE_FILE_NAME)
        );
        assert!(moved_database_path.exists());
        let backup_database_path =
            moved_database_path.with_file_name(format!("{DATABASE_FILE_NAME}.bak"));
        assert!(backup_database_path.exists());
        assert_eq!(state.paths().database_path, moved_database_path);
        assert!(!original_database_path.exists());

        let setting = state
            .with_db(|db| repositories::get_setting(db, "theme"))
            .expect("setting lookup should run")
            .expect("setting should still exist");
        assert_eq!(setting.value, "dark");

        let reloaded_paths = AppPaths::initialize_at(app_data_dir.clone())
            .expect("paths should reload custom database location");
        assert_eq!(reloaded_paths.database_path, moved_database_path);
        let backup_db =
            db::open_database(&backup_database_path).expect("backup should be a valid sqlite db");
        let backup_setting = repositories::get_setting(&backup_db, "theme")
            .expect("backup setting lookup should run")
            .expect("backup setting should exist");
        assert_eq!(backup_setting.value, "dark");

        let _ = fs::remove_dir_all(app_data_dir);
    }

    #[test]
    fn move_database_storage_refuses_to_overwrite_existing_database() {
        let app_data_dir = std::env::temp_dir().join(format!("photoview-{}", Uuid::new_v4()));
        let state =
            AppState::initialize_for_test(app_data_dir.clone()).expect("state should initialize");
        let target_dir = app_data_dir.join("occupied-database");
        fs::create_dir_all(&target_dir).expect("target dir should exist");
        fs::write(target_dir.join(DATABASE_FILE_NAME), b"existing")
            .expect("target db should exist");

        let error = state
            .move_database_storage(&target_dir)
            .expect_err("existing database should not be overwritten");

        assert_eq!(error.code, "path_exists");
        let _ = fs::remove_dir_all(app_data_dir);
    }

    #[test]
    fn move_database_storage_refuses_to_overwrite_existing_backup() {
        let app_data_dir = std::env::temp_dir().join(format!("photoview-{}", Uuid::new_v4()));
        let state =
            AppState::initialize_for_test(app_data_dir.clone()).expect("state should initialize");
        let target_dir = app_data_dir.join("occupied-backup");
        fs::create_dir_all(&target_dir).expect("target dir should exist");
        fs::write(
            target_dir.join(format!("{DATABASE_FILE_NAME}.bak")),
            b"existing",
        )
        .expect("target backup should exist");

        let error = state
            .move_database_storage(&target_dir)
            .expect_err("existing database backup should not be overwritten");

        assert_eq!(error.code, "path_exists");
        let _ = fs::remove_dir_all(app_data_dir);
    }
}
