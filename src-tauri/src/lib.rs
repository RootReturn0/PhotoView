mod app;
mod commands;
mod db;
mod errors;
mod paths;

use commands::system::get_app_status;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let state = app::AppState::initialize(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_app_status])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
