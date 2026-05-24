mod app;
mod commands;
mod db;
mod errors;
mod paths;

use commands::system::{
    choose_import_folder, copy_path_to_clipboard, copy_text_to_clipboard, get_app_status,
    open_path_in_file_manager,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = app::AppState::initialize(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            choose_import_folder,
            open_path_in_file_manager,
            copy_text_to_clipboard,
            copy_path_to_clipboard
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
