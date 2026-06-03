use crate::errors::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

pub const DATABASE_FILE_NAME: &str = "photoview.sqlite";
const DATABASE_LOCATION_FILE_NAME: &str = "database-location.json";

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub app_data_dir: PathBuf,
    pub database_path: PathBuf,
    pub thumbnails_dir: PathBuf,
    pub tasks_dir: PathBuf,
    pub backups_dir: PathBuf,
    pub exports_dir: PathBuf,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppPathsDto {
    pub app_data_dir: String,
    pub database_path: String,
    pub thumbnails_dir: String,
    pub tasks_dir: String,
    pub backups_dir: String,
    pub exports_dir: String,
}

#[derive(Debug, Deserialize, Serialize)]
struct DatabaseLocationConfig {
    database_path: String,
}

impl AppPaths {
    pub fn initialize<R: Runtime>(app: &AppHandle<R>) -> AppResult<Self> {
        let app_data_dir = app.path().app_data_dir().map_err(AppError::from)?;
        Self::from_app_data_dir(app_data_dir)
    }

    #[cfg(test)]
    pub fn initialize_at(app_data_dir: PathBuf) -> AppResult<Self> {
        Self::from_app_data_dir(app_data_dir)
    }

    fn from_app_data_dir(app_data_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&app_data_dir)?;
        let database_path = read_database_location(&app_data_dir)?
            .unwrap_or_else(|| default_database_path(&app_data_dir));
        let thumbnails_dir = app_data_dir.join("thumbnails");
        let tasks_dir = app_data_dir.join("tasks");
        let backups_dir = app_data_dir.join("backups");
        let exports_dir = app_data_dir.join("exports");

        let paths = Self {
            app_data_dir,
            database_path,
            thumbnails_dir,
            tasks_dir,
            backups_dir,
            exports_dir,
        };
        paths.ensure_directories()?;

        Ok(paths)
    }

    pub fn with_database_path(&self, database_path: PathBuf) -> AppResult<Self> {
        let mut paths = self.clone();
        paths.database_path = database_path;
        paths.ensure_directories()?;
        Ok(paths)
    }

    pub fn persist_database_location(&self) -> AppResult<()> {
        let config = DatabaseLocationConfig {
            database_path: self.database_path.display().to_string(),
        };
        let bytes = serde_json::to_vec_pretty(&config)
            .map_err(|value| AppError::internal(value.to_string()))?;
        fs::write(self.database_location_config_path(), bytes)?;
        Ok(())
    }

    pub fn database_location_config_path(&self) -> PathBuf {
        database_location_config_path(&self.app_data_dir)
    }

    fn ensure_directories(&self) -> AppResult<()> {
        let database_parent = self
            .database_path
            .parent()
            .ok_or_else(|| AppError::new("invalid_path", "数据库路径必须包含目录"))?;

        for dir in [
            &self.app_data_dir,
            database_parent,
            &self.thumbnails_dir,
            &self.tasks_dir,
            &self.backups_dir,
            &self.exports_dir,
        ] {
            fs::create_dir_all(dir)?;
        }

        Ok(())
    }

    pub fn to_dto(&self) -> AppPathsDto {
        AppPathsDto {
            app_data_dir: display_path(&self.app_data_dir),
            database_path: display_path(&self.database_path),
            thumbnails_dir: display_path(&self.thumbnails_dir),
            tasks_dir: display_path(&self.tasks_dir),
            backups_dir: display_path(&self.backups_dir),
            exports_dir: display_path(&self.exports_dir),
        }
    }
}

pub fn default_database_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DATABASE_FILE_NAME)
}

fn database_location_config_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(DATABASE_LOCATION_FILE_NAME)
}

fn read_database_location(app_data_dir: &Path) -> AppResult<Option<PathBuf>> {
    let config_path = database_location_config_path(app_data_dir);
    if !config_path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(config_path)?;
    let config: DatabaseLocationConfig =
        serde_json::from_slice(&bytes).map_err(|value| AppError::internal(value.to_string()))?;
    let database_path = PathBuf::from(config.database_path.trim());
    if database_path.as_os_str().is_empty() {
        return Ok(None);
    }

    if database_path.is_absolute() {
        Ok(Some(database_path))
    } else {
        Ok(Some(app_data_dir.join(database_path)))
    }
}

pub fn display_path(path: &Path) -> String {
    let value = path.display().to_string();
    strip_windows_verbatim_prefix(&value)
}

fn strip_windows_verbatim_prefix(value: &str) -> String {
    const VERBATIM_PREFIX: &str = r"\\?\";
    const VERBATIM_UNC_PREFIX: &str = r"\\?\UNC\";

    if let Some(rest) = value.strip_prefix(VERBATIM_UNC_PREFIX) {
        return format!(r"\\{rest}");
    }

    if let Some(rest) = value.strip_prefix(VERBATIM_PREFIX) {
        let bytes = rest.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && (bytes[2] == b'\\' || bytes[2] == b'/')
        {
            return rest.to_string();
        }
    }

    value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_path_hides_windows_verbatim_drive_prefix() {
        assert_eq!(
            display_path(Path::new(r"\\?\F:\SoftCache\PhotoView\photoview.sqlite")),
            r"F:\SoftCache\PhotoView\photoview.sqlite"
        );
    }

    #[test]
    fn display_path_hides_windows_verbatim_unc_prefix() {
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\nas\Photos\photoview.sqlite")),
            r"\\nas\Photos\photoview.sqlite"
        );
    }

    #[test]
    fn display_path_keeps_regular_unc_paths() {
        assert_eq!(
            display_path(Path::new(r"\\nas\Photos\photoview.sqlite")),
            r"\\nas\Photos\photoview.sqlite"
        );
    }
}
