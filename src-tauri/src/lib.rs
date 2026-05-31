mod app;
mod commands;
mod db;
mod duplicates;
mod errors;
mod models;
mod paths;
pub mod scanner;
mod tasks;
pub mod thumbs;
mod viewer;
mod watcher;

use commands::data::{
    backup_database, cancel_import, clear_thumbnail_cache, copy_image_file, create_tag,
    delete_collection_record, delete_image_file, delete_image_record, delete_tag,
    enqueue_thumbnail_generation, export_library_data, get_collection, get_image, get_setting,
    get_settings, get_tag, get_task, get_thumbnail, get_thumbnail_cache_stats, get_viewer_image,
    import_folder, list_collection_tag_assignments, list_collections, list_image_tag_assignments,
    list_images, list_tags, mark_collection_viewed, move_database_storage, move_image_file,
    rebuild_index, rename_image_file, restore_database_from_backup, run_duplicate_detection,
    search_library, set_collection_tags, set_image_tags, sync_all_collections, sync_collection,
    update_collection, update_image, update_setting, update_tag,
};
use commands::system::{
    choose_database_folder, choose_import_folder, copy_path_to_clipboard, copy_text_to_clipboard,
    get_app_status, open_path_in_file_manager,
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
            let collections = state.with_db(db::repositories::list_collections)?;
            for collection in &collections {
                let collection_path = Path::new(&collection.path);
                if !collection_path.is_dir() {
                    continue;
                }

                let has_nested_collection = collections.iter().any(|other| {
                    other.id != collection.id && Path::new(&other.path).starts_with(collection_path)
                });
                if has_nested_collection {
                    for image_path in state.with_db(|db| {
                        db::repositories::list_image_paths_for_collection(db, &collection.id)
                    })? {
                        let image_path = Path::new(&image_path);
                        if image_path.is_file() {
                            app.asset_protocol_scope().allow_file(image_path)?;
                        }
                    }
                } else {
                    app.asset_protocol_scope()
                        .allow_directory(collection_path, true)?;
                }
            }
            app.manage(state);
            watcher::start_file_watcher(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            choose_import_folder,
            choose_database_folder,
            open_path_in_file_manager,
            copy_text_to_clipboard,
            copy_path_to_clipboard,
            list_collections,
            get_collection,
            import_folder,
            cancel_import,
            sync_collection,
            sync_all_collections,
            update_collection,
            mark_collection_viewed,
            delete_collection_record,
            list_images,
            get_image,
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
            run_duplicate_detection,
            get_settings,
            get_setting,
            update_setting,
            backup_database,
            restore_database_from_backup,
            move_database_storage,
            rebuild_index,
            export_library_data,
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

#[cfg(test)]
mod command_tests {
    use super::*;
    use serde_json::{json, Value};
    use std::{fs, path::PathBuf};
    use tauri::{
        ipc::{CallbackFn, InvokeBody},
        test::{mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY},
        webview::InvokeRequest,
        Webview, WebviewWindowBuilder,
    };

    fn temp_app_data_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("photoview-{name}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("test app data dir should be created");
        dir
    }

    fn create_command_app(app_data_dir: PathBuf) -> tauri::App<MockRuntime> {
        let state = app::AppState::initialize_for_test(app_data_dir)
            .expect("test app state should initialize");

        mock_builder()
            .manage(state)
            .invoke_handler(tauri::generate_handler![
                get_app_status,
                list_collections,
                get_settings,
                update_setting,
            ])
            .build(mock_context(noop_assets()))
            .expect("test app should build")
    }

    fn invoke_json<W: AsRef<Webview<MockRuntime>>>(
        webview: &W,
        cmd: &str,
        body: Value,
    ) -> Result<Value, Value> {
        tauri::test::get_ipc_response(
            webview,
            InvokeRequest {
                cmd: cmd.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .expect("invoke url should parse"),
                body: InvokeBody::Json(body),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|body| {
            body.deserialize::<Value>()
                .expect("command response should be valid json")
        })
    }

    #[test]
    fn tauri_commands_report_status_and_collections() {
        let app_data_dir = temp_app_data_dir("status");
        let app = create_command_app(app_data_dir.clone());
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("test webview should build");

        let status = invoke_json(&webview, "get_app_status", json!({}))
            .expect("status command should succeed");
        assert_eq!(status["product_name"], "PhotoView");
        assert_eq!(status["collection_count"], 0);
        assert_eq!(status["image_count"], 0);

        let collections = invoke_json(&webview, "list_collections", json!({}))
            .expect("collections command should succeed");
        assert_eq!(collections.as_array().map(Vec::len), Some(0));

        drop(webview);
        drop(app);
        fs::remove_dir_all(app_data_dir).expect("test app data dir should be removed");
    }

    #[test]
    fn tauri_commands_update_and_list_settings() {
        let app_data_dir = temp_app_data_dir("settings");
        let app = create_command_app(app_data_dir.clone());
        let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("test webview should build");

        let updated = invoke_json(
            &webview,
            "update_setting",
            json!({
                "request": {
                    "key": "theme",
                    "value": "dark"
                }
            }),
        )
        .expect("update setting command should succeed");
        assert_eq!(updated["key"], "theme");
        assert_eq!(updated["value"], "dark");

        let settings = invoke_json(&webview, "get_settings", json!({}))
            .expect("settings command should succeed");
        let theme = settings
            .as_array()
            .expect("settings should be an array")
            .iter()
            .find(|setting| setting["key"] == "theme")
            .expect("theme setting should exist");
        assert_eq!(theme["value"], "dark");

        drop(webview);
        drop(app);
        fs::remove_dir_all(app_data_dir).expect("test app data dir should be removed");
    }
}

#[cfg(test)]
mod fixture_acceptance_tests {
    use super::*;
    use crate::models::{
        CopyImageFileRequest, CreateTagRequest, DeleteImageFileRequest, DuplicateDetectionRequest,
        ImportCollectionRequest, ListCollectionTagAssignmentsRequest,
        ListImageTagAssignmentsRequest, ListImagesRequest, MoveImageFileRequest,
        RenameImageFileRequest, SearchLibraryRequest, SetTagAssignmentsRequest,
        UpdateCollectionRequest, UpdateImageRequest, UpdateSettingRequest,
    };
    use std::{
        collections::BTreeSet,
        fs,
        path::{Path, PathBuf},
    };

    struct TempFixture {
        path: PathBuf,
    }

    impl TempFixture {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("photoview-{name}-{}", uuid::Uuid::new_v4()));
            fs::create_dir_all(&path).expect("temp fixture root should be created");
            Self { path }
        }

        fn join(&self, path: impl AsRef<Path>) -> PathBuf {
            self.path.join(path)
        }
    }

    impl Drop for TempFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn fixture_source_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("src-tauri should have repository parent")
            .join("fixtures/photo-library-basic")
    }

    fn copy_recursively(source: &Path, target: &Path) {
        fs::create_dir_all(target).expect("target directory should be created");
        for entry in fs::read_dir(source).expect("source directory should be readable") {
            let entry = entry.expect("source entry should be readable");
            let source_path = entry.path();
            let target_path = target.join(entry.file_name());
            let file_type = entry
                .file_type()
                .expect("source entry file type should be readable");
            if file_type.is_dir() {
                copy_recursively(&source_path, &target_path);
            } else if file_type.is_file() {
                fs::copy(&source_path, &target_path).expect("fixture file should copy");
            }
        }
    }

    fn import_fixture_collection(
        state: &app::AppState,
        root: &Path,
        name: &str,
    ) -> models::ImportCollectionResult {
        state
            .with_db_mut(|db| {
                db::repositories::import_collection(
                    db,
                    ImportCollectionRequest {
                        path: root.join(name).display().to_string(),
                        name: Some(name.to_string()),
                    },
                )
            })
            .expect("fixture collection should import")
    }

    fn list_all_images(state: &app::AppState) -> Vec<models::ImageDto> {
        state
            .with_db(|db| {
                db::repositories::list_images(
                    db,
                    ListImagesRequest {
                        collection_id: None,
                        limit: Some(20_000),
                        offset: Some(0),
                    },
                )
            })
            .expect("images should list")
    }

    fn find_image(images: &[models::ImageDto], file_name: &str) -> models::ImageDto {
        images
            .iter()
            .find(|image| image.file_name == file_name)
            .unwrap_or_else(|| panic!("fixture image {file_name} should exist"))
            .clone()
    }

    #[test]
    #[ignore = "requires local fixtures/photo-library-basic; run with `cargo test fixture_acceptance_core_flow -- --ignored`"]
    fn fixture_acceptance_core_flow() {
        let source_root = fixture_source_root();
        assert!(
            source_root.is_dir(),
            "missing fixture directory: {}",
            source_root.display()
        );

        let fixture_copy = TempFixture::new("fixture-acceptance-library");
        copy_recursively(&source_root, &fixture_copy.path);

        let app_data = TempFixture::new("fixture-acceptance-app-data");
        let state = app::AppState::initialize_for_test(app_data.path.clone())
            .expect("fixture app state should initialize");

        let collection_a = import_fixture_collection(&state, &fixture_copy.path, "collection-a");
        assert_eq!(collection_a.scanned_count, 5);
        assert_eq!(collection_a.inserted_count, 5);
        assert_eq!(collection_a.error_count, 0);
        assert_eq!(collection_a.collection.image_count, 5);

        let collection_b = import_fixture_collection(&state, &fixture_copy.path, "collection-b");
        assert_eq!(collection_b.scanned_count, 5);
        assert_eq!(collection_b.inserted_count, 5);
        assert_eq!(collection_b.error_count, 0);
        assert_eq!(collection_b.collection.image_count, 5);

        let duplicates = import_fixture_collection(&state, &fixture_copy.path, "duplicates");
        assert_eq!(duplicates.scanned_count, 2);
        assert_eq!(duplicates.inserted_count, 2);
        assert_eq!(duplicates.collection.image_count, 2);

        let empty = import_fixture_collection(&state, &fixture_copy.path, "empty-collection");
        assert_eq!(empty.scanned_count, 0);
        assert_eq!(empty.collection.image_count, 0);

        let invalid = import_fixture_collection(&state, &fixture_copy.path, "invalid");
        assert_eq!(invalid.scanned_count, 0);
        assert_eq!(invalid.error_count, 2);

        let non_images = import_fixture_collection(&state, &fixture_copy.path, "non-images");
        assert_eq!(non_images.scanned_count, 0);
        assert_eq!(non_images.error_count, 0);

        let repeated = import_fixture_collection(&state, &fixture_copy.path, "collection-a");
        assert_eq!(repeated.inserted_count, 0);
        assert_eq!(repeated.updated_count, 5);

        let images = list_all_images(&state);
        assert_eq!(images.len(), 12);
        let formats = images
            .iter()
            .map(|image| image.format.as_str())
            .collect::<BTreeSet<_>>();
        assert_eq!(
            formats,
            BTreeSet::from(["avif", "bmp", "gif", "ico", "jpeg", "png", "svg", "tiff", "webp",])
        );

        let large = find_image(&images, "large-4096x2304.jpg");
        assert_eq!(large.width, Some(4096));
        assert_eq!(large.height, Some(2304));

        let checker = find_image(&images, "checker-256.png");
        let thumbnail_metadata = thumbs::read_source_metadata(&checker.path)
            .expect("checker thumbnail metadata should read");
        let thumbnail_request = thumbs::ThumbnailRequest::new(
            &checker.path,
            &state.paths().thumbnails_dir,
            &checker.id,
            thumbnail_metadata.source_size_bytes,
            thumbnail_metadata.source_mtime.clone(),
            128,
        );
        let thumbnail = thumbs::get_or_create_thumbnail(&thumbnail_request)
            .expect("checker thumbnail should generate");
        assert_eq!(thumbnail.status, thumbs::ThumbnailCacheStatus::Miss);
        assert!(thumbnail.cache_path.exists());
        let thumbnail_hit = thumbs::get_or_create_thumbnail(&thumbnail_request)
            .expect("checker thumbnail should hit cache");
        assert_eq!(thumbnail_hit.status, thumbs::ThumbnailCacheStatus::Hit);

        let webp = find_image(&images, "wide-640x360.webp");
        let webp_metadata =
            thumbs::read_source_metadata(&webp.path).expect("webp metadata should read");
        let viewer_request = viewer::ViewerImageRequest::new(
            &webp.path,
            &state.paths().thumbnails_dir,
            &webp.id,
            webp_metadata.source_size_bytes,
            webp_metadata.source_mtime,
            512,
        );
        let viewer_preview = viewer::get_or_create_viewer_image(&viewer_request)
            .expect("webp viewer source asset should resolve");
        assert_eq!(viewer_preview.kind.as_str(), "source");
        assert_eq!(viewer_preview.status.as_str(), "source");
        assert!(viewer_preview.asset_path.exists());

        let svg = find_image(&images, "vector-layout.svg");
        let svg_metadata =
            thumbs::read_source_metadata(&svg.path).expect("svg metadata should read");
        let svg_viewer = viewer::get_or_create_viewer_image(&viewer::ViewerImageRequest::new(
            &svg.path,
            &state.paths().thumbnails_dir,
            &svg.id,
            svg_metadata.source_size_bytes,
            svg_metadata.source_mtime,
            512,
        ))
        .expect("svg viewer should use source asset");
        assert_eq!(svg_viewer.kind.as_str(), "source");

        let cache_stats = thumbs::collect_thumbnail_cache_stats(&state.paths().thumbnails_dir)
            .expect("thumbnail cache stats should collect");
        assert!(cache_stats.file_count >= 2);
        assert!(cache_stats.total_bytes > 0);

        state
            .with_db(|db| {
                let tag = db::repositories::create_tag(
                    db,
                    CreateTagRequest {
                        name: "fixture".to_string(),
                        color: Some("#3388ff".to_string()),
                    },
                )?;
                db::repositories::set_collection_tags(
                    db,
                    SetTagAssignmentsRequest {
                        target_id: collection_a.collection.id.clone(),
                        tag_ids: vec![tag.id.clone()],
                    },
                )?;
                db::repositories::set_image_tags(
                    db,
                    SetTagAssignmentsRequest {
                        target_id: checker.id.clone(),
                        tag_ids: vec![tag.id.clone()],
                    },
                )?;

                let cover = Some(checker.id.clone());
                let updated_collection = db::repositories::update_collection(
                    db,
                    UpdateCollectionRequest {
                        id: collection_a.collection.id.clone(),
                        name: Some("Fixture Acceptance A".to_string()),
                        description: Some("verified with fixture suite".to_string()),
                        rating: Some(5),
                        is_favorite: Some(true),
                        cover_image_id: cover,
                    },
                )?;
                assert_eq!(updated_collection.name, "Fixture Acceptance A");
                assert_eq!(updated_collection.rating, 5);
                assert!(updated_collection.is_favorite);
                assert_eq!(updated_collection.cover_image_id, Some(checker.id.clone()));

                let viewed =
                    db::repositories::mark_collection_viewed(db, &collection_a.collection.id)?;
                assert!(viewed.view_count >= 1);
                assert!(viewed.last_viewed_at.is_some());

                let updated_image = db::repositories::update_image(
                    db,
                    UpdateImageRequest {
                        id: checker.id.clone(),
                        file_name: None,
                        width: None,
                        height: None,
                        sha256: None,
                        phash: None,
                        rating: Some(4),
                        is_favorite: Some(true),
                        is_missing: None,
                    },
                )?;
                assert_eq!(updated_image.rating, 4);
                assert!(updated_image.is_favorite);

                let collection_tags = db::repositories::list_collection_tag_assignments(
                    db,
                    ListCollectionTagAssignmentsRequest {
                        collection_id: Some(collection_a.collection.id.clone()),
                    },
                )?;
                assert_eq!(collection_tags.len(), 1);
                let image_tags = db::repositories::list_image_tag_assignments(
                    db,
                    ListImageTagAssignmentsRequest {
                        collection_id: None,
                        image_id: Some(checker.id.clone()),
                    },
                )?;
                assert_eq!(image_tags.len(), 1);

                let query_results = db::repositories::search_library(
                    db,
                    SearchLibraryRequest {
                        query: Some("fixture".to_string()),
                        formats: None,
                        min_width: None,
                        max_width: None,
                        min_height: None,
                        max_height: None,
                        min_size_bytes: None,
                        max_size_bytes: None,
                        tag_ids: None,
                        min_rating: None,
                        max_rating: None,
                        date_from: None,
                        date_to: None,
                        is_favorite: None,
                        limit: Some(50),
                    },
                )?;
                assert!(query_results
                    .collections
                    .iter()
                    .any(|collection| collection.name == "Fixture Acceptance A"));
                assert!(query_results.tags.iter().any(|tag| tag.name == "fixture"));

                let webp_results = db::repositories::search_library(
                    db,
                    SearchLibraryRequest {
                        query: None,
                        formats: Some(vec!["webp".to_string()]),
                        min_width: None,
                        max_width: None,
                        min_height: None,
                        max_height: None,
                        min_size_bytes: None,
                        max_size_bytes: None,
                        tag_ids: None,
                        min_rating: None,
                        max_rating: None,
                        date_from: None,
                        date_to: None,
                        is_favorite: None,
                        limit: Some(50),
                    },
                )?;
                assert_eq!(webp_results.images.len(), 1);
                assert_eq!(webp_results.images[0].file_name, "wide-640x360.webp");

                let large_results = db::repositories::search_library(
                    db,
                    SearchLibraryRequest {
                        query: None,
                        formats: None,
                        min_width: Some(4096),
                        max_width: None,
                        min_height: Some(2304),
                        max_height: None,
                        min_size_bytes: None,
                        max_size_bytes: None,
                        tag_ids: None,
                        min_rating: None,
                        max_rating: None,
                        date_from: None,
                        date_to: None,
                        is_favorite: None,
                        limit: Some(50),
                    },
                )?;
                assert!(large_results
                    .images
                    .iter()
                    .any(|image| image.file_name == "large-4096x2304.jpg"));

                let duplicate_result = duplicates::run_duplicate_detection(
                    db,
                    DuplicateDetectionRequest {
                        collection_id: None,
                        max_hamming_distance: Some(4),
                    },
                )?;
                assert!(duplicate_result.scanned_count >= 12);
                assert!(duplicate_result
                    .exact_groups
                    .iter()
                    .any(|group| group.images.len() >= 2
                        && group
                            .images
                            .iter()
                            .any(|image| image.file_name == "duplicate-original.png")
                        && group
                            .images
                            .iter()
                            .any(|image| image.file_name == "duplicate-copy-renamed.png")));

                let settings = db::repositories::update_setting(
                    db,
                    UpdateSettingRequest {
                        key: "theme".to_string(),
                        value: "dark".to_string(),
                    },
                )?;
                assert_eq!(settings.value, "dark");

                Ok(())
            })
            .expect("tag, search, duplicate, and settings acceptance should pass");

        state
            .with_db(|db| {
                let renamed = db::repositories::rename_image_file(
                    db,
                    RenameImageFileRequest {
                        id: checker.id.clone(),
                        file_name: "checker-renamed.png".to_string(),
                    },
                )?;
                assert!(Path::new(&renamed.path).exists());
                assert!(!Path::new(&checker.path).exists());

                let copied = db::repositories::copy_image_file(
                    db,
                    CopyImageFileRequest {
                        id: renamed.id.clone(),
                        target_collection_id: empty.collection.id.clone(),
                    },
                )?;
                assert!(Path::new(&copied.path).exists());
                assert_ne!(copied.id, renamed.id);

                db::repositories::delete_image_file(
                    db,
                    DeleteImageFileRequest {
                        id: copied.id.clone(),
                        use_trash: Some(false),
                    },
                )?;
                assert!(!Path::new(&copied.path).exists());

                let moved = db::repositories::move_image_file(
                    db,
                    MoveImageFileRequest {
                        id: renamed.id.clone(),
                        target_collection_id: empty.collection.id.clone(),
                    },
                )?;
                assert_eq!(moved.collection_id, empty.collection.id);
                assert!(Path::new(&moved.path).exists());
                assert!(!Path::new(&renamed.path).exists());

                Ok(())
            })
            .expect("file management acceptance should pass");

        fs::copy(
            fixture_copy.join("_generated-sources/source-square.png"),
            fixture_copy.join("collection-a/new-sync.png"),
        )
        .expect("new sync image should copy");
        let inserted = state
            .with_db_mut(|db| db::repositories::sync_collection(db, &collection_a.collection.id))
            .expect("collection should sync new image");
        assert_eq!(inserted.inserted_count, 1);
        let new_sync = find_image(&list_all_images(&state), "new-sync.png");
        fs::remove_file(&new_sync.path).expect("new sync image should remove");
        state
            .with_db_mut(|db| db::repositories::sync_collection(db, &collection_a.collection.id))
            .expect("collection should sync missing image");
        let missing = state
            .with_db(|db| db::repositories::get_image(db, &new_sync.id))
            .expect("missing image lookup should run")
            .expect("missing image record should remain");
        assert!(missing.is_missing);

        fs::create_dir_all(&state.paths().backups_dir).expect("backup dir should exist");
        let backup_path = state
            .paths()
            .backups_dir
            .join("fixture-acceptance-backup.sqlite");
        let backup_path_string = backup_path.display().to_string();
        state
            .with_db(|db| {
                db.execute("VACUUM main INTO ?1", [&backup_path_string])?;
                Ok(())
            })
            .expect("database backup should be created");
        assert!(backup_path.metadata().expect("backup metadata").len() > 0);
        let backup_db =
            db::open_database(&backup_path).expect("backup should be a valid sqlite db");
        assert!(db::count_rows(&backup_db, "collections").expect("backup collections count") >= 6);

        fs::create_dir_all(&state.paths().exports_dir).expect("export dir should exist");
        let export_path = state
            .paths()
            .exports_dir
            .join("fixture-acceptance-export.json");
        let export_value = state
            .with_db(|db| {
                Ok(serde_json::json!({
                    "collections": db::repositories::list_collections(db)?,
                    "images": db::repositories::list_images(
                        db,
                        ListImagesRequest {
                            collection_id: None,
                            limit: Some(20_000),
                            offset: Some(0),
                        },
                    )?,
                    "tags": db::repositories::list_tags(db)?,
                    "settings": db::repositories::list_settings(db)?,
                }))
            })
            .expect("export data should collect");
        fs::write(
            &export_path,
            serde_json::to_vec_pretty(&export_value).expect("export should serialize"),
        )
        .expect("export should write");
        let exported_json: serde_json::Value =
            serde_json::from_slice(&fs::read(&export_path).expect("export should read"))
                .expect("export should parse");
        assert!(exported_json["collections"].as_array().unwrap().len() >= 6);
        assert!(exported_json["images"].as_array().unwrap().len() >= 12);

        state
            .restore_database_from_backup(&backup_path)
            .expect("database should restore from backup");
        let restored_collections = state
            .with_db(db::repositories::list_collections)
            .expect("restored collections should list");
        assert!(restored_collections.len() >= 6);

        let cleared = thumbs::clear_thumbnail_cache(&state.paths().thumbnails_dir)
            .expect("thumbnail cache should clear");
        assert!(cleared.deleted_file_count >= 2);
        let empty_stats = thumbs::collect_thumbnail_cache_stats(&state.paths().thumbnails_dir)
            .expect("empty thumbnail stats should collect");
        assert_eq!(empty_stats.file_count, 0);
    }
}
