use crate::{
    app::{AppState, AppStatus},
    errors::{AppError, AppResult},
};
use std::path::PathBuf;
use tauri::{AppHandle, State, Window};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_fs::FsExt;
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> AppResult<AppStatus> {
    state.status()
}

#[tauri::command]
pub async fn choose_import_folder(window: Window) -> AppResult<Option<String>> {
    let Some(folder) = window
        .dialog()
        .file()
        .set_title("选择图片文件夹")
        .blocking_pick_folder()
    else {
        return Ok(None);
    };

    let path = folder
        .into_path()
        .map_err(|value| AppError::new("invalid_path", value.to_string()))?;

    allow_selected_directory(&window, &path)?;

    Ok(Some(path_to_string(path)))
}

#[tauri::command]
pub fn open_path_in_file_manager(app: AppHandle, path: String) -> AppResult<()> {
    let path = existing_path(path)?;

    if path.is_dir() {
        app.opener()
            .open_path(path_to_string(path), None::<String>)
            .map_err(|value| AppError::new("open_path_error", value.to_string()))?;
        return Ok(());
    }

    app.opener()
        .reveal_item_in_dir(path)
        .map_err(|value| AppError::new("open_path_error", value.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn copy_text_to_clipboard(app: AppHandle, text: String) -> AppResult<()> {
    if text.is_empty() {
        return Err(AppError::new("empty_clipboard_text", "复制内容不能为空"));
    }

    app.clipboard()
        .write_text(text)
        .map_err(|value| AppError::new("clipboard_error", value.to_string()))
}

#[tauri::command]
pub fn copy_path_to_clipboard(app: AppHandle, path: String) -> AppResult<()> {
    let path = existing_path(path)?;

    app.clipboard()
        .write_text(path_to_string(path))
        .map_err(|value| AppError::new("clipboard_error", value.to_string()))
}

fn allow_selected_directory(window: &Window, path: &PathBuf) -> AppResult<()> {
    if let Some(scope) = window.try_fs_scope() {
        scope
            .allow_directory(path, true)
            .map_err(|value| AppError::new("scope_error", value.to_string()))?;
    }

    Ok(())
}

fn existing_path(path: String) -> AppResult<PathBuf> {
    let path = PathBuf::from(path);

    if !path.exists() {
        return Err(AppError::new(
            "path_not_found",
            format!("路径不存在：{}", path.display()),
        ));
    }

    Ok(path)
}

fn path_to_string(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}
