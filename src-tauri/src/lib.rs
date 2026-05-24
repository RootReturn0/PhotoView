mod app;
mod commands;
mod db;
mod errors;
mod models;
mod paths;
pub mod scanner;
mod tasks;
pub mod thumbs;
mod viewer;

use commands::data::{
    clear_thumbnail_cache, copy_image_file, create_collection, create_image, create_tag,
    delete_collection_record, delete_image_file, delete_image_record, delete_tag,
    enqueue_thumbnail_generation, get_collection, get_image, get_setting, get_settings, get_tag,
    get_task, get_thumbnail, get_thumbnail_cache_stats, get_viewer_image, import_collection,
    list_collection_tag_assignments, list_collections, list_image_tag_assignments, list_images,
    list_tags, mark_collection_viewed, move_image_file, rename_image_file, search_library,
    set_collection_tags, set_image_tags, update_collection, update_image, update_setting,
    update_tag,
};
use commands::system::{
    choose_import_folder, copy_path_to_clipboard, copy_text_to_clipboard, get_app_status,
    open_path_in_file_manager,
};
use std::path::Path;
use tauri::{
    menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, Runtime,
};

const MENU_IMPORT_COLLECTION: &str = "import_collection";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .menu(build_menu)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == MENU_IMPORT_COLLECTION {
                let _ = app.emit("menu-import-folder", ());
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let state = app::AppState::initialize(app.handle())?;
            app.asset_protocol_scope()
                .allow_directory(&state.paths().thumbnails_dir, true)?;
            for collection in state.with_db(db::repositories::list_collections)? {
                let collection_path = Path::new(&collection.path);
                if collection_path.is_dir() {
                    app.asset_protocol_scope()
                        .allow_directory(collection_path, true)?;
                }
            }
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
            import_collection,
            update_collection,
            mark_collection_viewed,
            delete_collection_record,
            list_images,
            get_image,
            create_image,
            update_image,
            delete_image_record,
            rename_image_file,
            move_image_file,
            copy_image_file,
            delete_image_file,
            list_tags,
            get_tag,
            create_tag,
            update_tag,
            delete_tag,
            list_collection_tag_assignments,
            set_collection_tags,
            list_image_tag_assignments,
            set_image_tags,
            search_library,
            get_settings,
            get_setting,
            update_setting,
            get_thumbnail,
            enqueue_thumbnail_generation,
            get_task,
            get_thumbnail_cache_stats,
            clear_thumbnail_cache,
            get_viewer_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let import = MenuItem::with_id(
        app,
        MENU_IMPORT_COLLECTION,
        "导入文件夹",
        true,
        Some("CmdOrCtrl+O"),
    )?;

    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[
            &import,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("退出 PhotoView"))?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    let about = AboutMetadata {
        name: Some("PhotoView".to_string()),
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        comments: Some("本地图片查看器与合集管理工具".to_string()),
        ..Default::default()
    };
    let help = Submenu::with_items(
        app,
        "帮助",
        true,
        &[&PredefinedMenuItem::about(
            app,
            Some("关于 PhotoView"),
            Some(about),
        )?],
    )?;

    Menu::with_items(app, &[&file, &edit, &window, &help])
}
