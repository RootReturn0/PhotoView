use crate::errors::{AppError, AppResult};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager, Runtime};

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
        let database_path = app_data_dir.join("photoview.sqlite");
        let thumbnails_dir = app_data_dir.join("thumbnails");
        let tasks_dir = app_data_dir.join("tasks");
        let backups_dir = app_data_dir.join("backups");
        let exports_dir = app_data_dir.join("exports");

        for dir in [
            &app_data_dir,
            &thumbnails_dir,
            &tasks_dir,
            &backups_dir,
            &exports_dir,
        ] {
            fs::create_dir_all(dir)?;
        }

        Ok(Self {
            app_data_dir,
            database_path,
            thumbnails_dir,
            tasks_dir,
            backups_dir,
            exports_dir,
        })
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

fn display_path(path: &Path) -> String {
    path.display().to_string()
}
