mod app;
mod commands;
mod db;
mod errors;
mod models;
mod paths;

use commands::data::{
    create_collection, create_image, create_tag, delete_collection_record, delete_image_record,
    delete_tag, get_collection, get_image, get_setting, get_settings, get_tag, list_collections,
    list_images, list_tags, update_collection, update_image, update_setting, update_tag,
};
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
            copy_path_to_clipboard,
            list_collections,
            get_collection,
            create_collection,
            update_collection,
            delete_collection_record,
            list_images,
            get_image,
            create_image,
            update_image,
            delete_image_record,
            list_tags,
            get_tag,
            create_tag,
            update_tag,
            delete_tag,
            get_settings,
            get_setting,
            update_setting
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
