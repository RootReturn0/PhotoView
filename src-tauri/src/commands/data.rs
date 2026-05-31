use crate::{
    app::AppState,
    db::repositories,
    errors::{AppError, AppResult},
    models::{
        ClearThumbnailCacheResult, CollectionDto, CopyImageFileRequest, CreateTagRequest,
        DataFileResult, DeleteImageFileRequest, DuplicateDetectionRequest,
        DuplicateDetectionResult, ImageDto, ImportCollectionRequest, ImportCollectionResult,
        ImportFolderResult, ListCollectionTagAssignmentsRequest, ListImageTagAssignmentsRequest,
        ListImagesRequest, MoveImageFileRequest, RenameImageFileRequest, SearchLibraryRequest,
        SearchResultsDto, SetTagAssignmentsRequest, SettingDto, TagAssignmentDto, TagDto, TaskDto,
        ThumbnailCacheStatsDto, ThumbnailDto, ThumbnailTaskRequest, UpdateCollectionRequest,
        UpdateImageRequest, UpdateSettingRequest, UpdateTagRequest, ViewerImageDto,
    },
    scanner::{self, ScanReport},
    thumbs::{
        clear_thumbnail_cache as clear_thumbnail_cache_files, collect_thumbnail_cache_stats,
        get_or_create_thumbnail, read_source_metadata, ThumbnailCacheStatus, ThumbnailRequest,
    },
    viewer::{get_or_create_viewer_image, ViewerImageRequest},
};
use chrono::Utc;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Emitter, Manager, State};

const IMPORT_DISCOVERY_PROGRESS_INTERVAL: usize = 25;

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> AppResult<Vec<CollectionDto>> {
    state.with_db(repositories::list_collections)
}

#[tauri::command]
pub fn get_collection(state: State<'_, AppState>, id: String) -> AppResult<Option<CollectionDto>> {
    state.with_db(|db| repositories::get_collection(db, &id))
}

#[tauri::command]
pub async fn import_folder(
    app: AppHandle,
    request: ImportCollectionRequest,
) -> AppResult<ImportFolderResult> {
    tauri::async_runtime::spawn_blocking(move || import_folder_blocking(app, request))
        .await
        .map_err(AppError::from)?
}

fn import_folder_blocking(
    app: AppHandle,
    request: ImportCollectionRequest,
) -> AppResult<ImportFolderResult> {
    let requested_path = request.path.trim().to_string();
    if requested_path.is_empty() {
        return Err(AppError::new("validation_error", "导入路径不能为空"));
    }

    let root = fs::canonicalize(Path::new(&requested_path))?;
    validate_import_root(&root)?;

    let state = app.state::<AppState>();
    let app_state = state.inner();
    app_state.reset_import_cancel();
    let _import_session = ImportCancelSession { state: app_state };

    let mut skipped_dir_count = 0;
    let mut results = Vec::new();
    let mut processed_count = 0_i64;

    emit_import_progress(
        &app,
        import_progress(
            &root,
            &root,
            "preparing",
            processed_count,
            0,
            skipped_dir_count,
            &results,
        ),
    );

    let discovery = collect_import_directories(&root, app_state, |discovered, skipped| {
        if discovered > 1 && discovered % IMPORT_DISCOVERY_PROGRESS_INTERVAL != 0 {
            return;
        }

        emit_import_progress(
            &app,
            import_progress(
                &root,
                &root,
                "preparing",
                0,
                discovered as i64,
                skipped,
                &results,
            ),
        );
    })?;
    skipped_dir_count = discovery.skipped_dir_count;
    let target_dirs = discovery.directories;
    let total_directory_count = target_dirs.len() as i64;

    emit_import_progress(
        &app,
        import_progress(
            &root,
            &root,
            "preparing",
            processed_count,
            total_directory_count,
            skipped_dir_count,
            &results,
        ),
    );

    let requested_name = request.name;
    for (index, target_path) in target_dirs.iter().enumerate() {
        ensure_import_not_cancelled(app_state)?;
        let scanned_dir_count = index as i64;
        emit_import_progress(
            &app,
            import_progress(
                &root,
                target_path,
                "scanning",
                scanned_dir_count,
                total_directory_count,
                skipped_dir_count,
                &results,
            ),
        );

        let report = match scan_direct_images_for_import(target_path, app_state) {
            Ok(report) => report,
            Err(error) if error.code != "operation_cancelled" => {
                skipped_dir_count += 1;
                processed_count = scanned_dir_count + 1;
                emit_import_progress(
                    &app,
                    import_progress(
                        &root,
                        target_path,
                        "skipped",
                        processed_count,
                        total_directory_count,
                        skipped_dir_count,
                        &results,
                    ),
                );
                continue;
            }
            Err(error) => return Err(error),
        };
        ensure_import_not_cancelled(app_state)?;

        if report.candidates.is_empty() {
            skipped_dir_count += 1;
            processed_count = scanned_dir_count + 1;
            emit_import_progress(
                &app,
                import_progress(
                    &root,
                    target_path,
                    "skipped",
                    processed_count,
                    total_directory_count,
                    skipped_dir_count,
                    &results,
                ),
            );
            continue;
        }

        let image_paths = report
            .candidates
            .iter()
            .map(|candidate| candidate.path.clone())
            .collect::<Vec<_>>();
        let collection_name = if *target_path == root {
            requested_name.clone()
        } else {
            None
        };
        let has_nested_collection = target_dirs
            .iter()
            .any(|other| other != target_path && other.starts_with(target_path));

        let result = state.with_db_mut(|db| {
            repositories::import_scanned_collection_with_cancel(
                db,
                target_path,
                collection_name,
                report,
                || app_state.import_cancel_requested(),
            )
        })?;
        let collection_path = Path::new(&result.collection.path);
        if has_nested_collection {
            allow_asset_files(&app, &image_paths)?;
        } else if collection_path.is_dir() {
            app.asset_protocol_scope()
                .allow_directory(collection_path, true)?;
        }
        results.push(result);
        processed_count = scanned_dir_count + 1;
        emit_import_progress(
            &app,
            import_progress(
                &root,
                target_path,
                "imported",
                processed_count,
                total_directory_count,
                skipped_dir_count,
                &results,
            ),
        );
    }

    let collection_count = results.len() as i64;
    let scanned_count = results.iter().map(|result| result.scanned_count).sum();
    let inserted_count = results.iter().map(|result| result.inserted_count).sum();
    let updated_count = results.iter().map(|result| result.updated_count).sum();
    let error_count = results.iter().map(|result| result.error_count).sum();

    let result = ImportFolderResult {
        root_path: root.display().to_string(),
        collection_count,
        scanned_count,
        inserted_count,
        updated_count,
        error_count,
        skipped_dir_count,
        results,
    };
    emit_import_progress(
        &app,
        ImportFolderProgress {
            root_path: result.root_path.clone(),
            current_path: result.root_path.clone(),
            current_name: root
                .file_name()
                .map(|value| value.to_string_lossy().into_owned())
                .unwrap_or_else(|| result.root_path.clone()),
            phase: "completed".to_string(),
            processed_count,
            total_count: total_directory_count,
            collection_count: result.collection_count,
            scanned_count: result.scanned_count,
            inserted_count: result.inserted_count,
            updated_count: result.updated_count,
            error_count: result.error_count,
            skipped_dir_count: result.skipped_dir_count,
        },
    );

    Ok(result)
}

#[tauri::command]
pub fn cancel_import(state: State<'_, AppState>) -> AppResult<()> {
    state.request_import_cancel();
    Ok(())
}

#[tauri::command]
pub fn sync_collection(
    state: State<'_, AppState>,
    id: String,
) -> AppResult<ImportCollectionResult> {
    state.with_db_mut(|db| repositories::sync_collection(db, &id))
}

#[tauri::command]
pub fn sync_all_collections(state: State<'_, AppState>) -> AppResult<Vec<ImportCollectionResult>> {
    state.with_db_mut(repositories::sync_all_collections)
}

#[tauri::command]
pub fn update_collection(
    state: State<'_, AppState>,
    request: UpdateCollectionRequest,
) -> AppResult<CollectionDto> {
    state.with_db(|db| repositories::update_collection(db, request))
}

#[tauri::command]
pub fn mark_collection_viewed(state: State<'_, AppState>, id: String) -> AppResult<CollectionDto> {
    state.with_db(|db| repositories::mark_collection_viewed(db, &id))
}

#[tauri::command]
pub fn delete_collection_record(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    let (collection_path, image_paths) = state.with_db(|db| {
        let collection_path =
            repositories::get_collection(db, &id)?.map(|collection| collection.path);
        let image_paths = repositories::list_image_paths_for_collection(db, &id)?;
        Ok::<_, crate::errors::AppError>((collection_path, image_paths))
    })?;
    state.with_db(|db| repositories::delete_collection_record(db, &id))?;

    if let Some(collection_path) = collection_path {
        revoke_asset_files(&app, &image_paths)?;
        let remaining_collections = state.with_db(repositories::list_collections)?;
        revoke_collection_asset_scope(&app, &collection_path, &remaining_collections)?;
    }

    Ok(())
}

#[tauri::command]
pub fn list_images(
    state: State<'_, AppState>,
    request: ListImagesRequest,
) -> AppResult<Vec<ImageDto>> {
    state.with_db(|db| repositories::list_images(db, request))
}

#[tauri::command]
pub fn get_image(state: State<'_, AppState>, id: String) -> AppResult<Option<ImageDto>> {
    state.with_db(|db| repositories::get_image(db, &id))
}

#[tauri::command]
pub fn update_image(
    state: State<'_, AppState>,
    request: UpdateImageRequest,
) -> AppResult<ImageDto> {
    state.with_db(|db| repositories::update_image(db, request))
}

#[tauri::command]
pub fn delete_image_record(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_db(|db| repositories::delete_image_record(db, &id))
}

#[tauri::command]
pub fn rename_image_file(
    state: State<'_, AppState>,
    request: RenameImageFileRequest,
) -> AppResult<ImageDto> {
    state.with_db(|db| repositories::rename_image_file(db, request))
}

#[tauri::command]
pub fn move_image_file(
    state: State<'_, AppState>,
    request: MoveImageFileRequest,
) -> AppResult<ImageDto> {
    state.with_db(|db| repositories::move_image_file(db, request))
}

#[tauri::command]
pub fn copy_image_file(
    state: State<'_, AppState>,
    request: CopyImageFileRequest,
) -> AppResult<ImageDto> {
    state.with_db(|db| repositories::copy_image_file(db, request))
}

#[tauri::command]
pub fn delete_image_file(
    state: State<'_, AppState>,
    request: DeleteImageFileRequest,
) -> AppResult<()> {
    state.with_db(|db| repositories::delete_image_file(db, request))
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<TagDto>> {
    state.with_db(repositories::list_tags)
}

#[tauri::command]
pub fn get_tag(state: State<'_, AppState>, id: String) -> AppResult<Option<TagDto>> {
    state.with_db(|db| repositories::get_tag(db, &id))
}

#[tauri::command]
pub fn create_tag(state: State<'_, AppState>, request: CreateTagRequest) -> AppResult<TagDto> {
    state.with_db(|db| repositories::create_tag(db, request))
}

#[tauri::command]
pub fn update_tag(state: State<'_, AppState>, request: UpdateTagRequest) -> AppResult<TagDto> {
    state.with_db(|db| repositories::update_tag(db, request))
}

#[tauri::command]
pub fn delete_tag(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_db(|db| repositories::delete_tag(db, &id))
}

#[tauri::command]
pub fn list_collection_tag_assignments(
    state: State<'_, AppState>,
    request: ListCollectionTagAssignmentsRequest,
) -> AppResult<Vec<TagAssignmentDto>> {
    state.with_db(|db| repositories::list_collection_tag_assignments(db, request))
}

#[tauri::command]
pub fn set_collection_tags(
    state: State<'_, AppState>,
    request: SetTagAssignmentsRequest,
) -> AppResult<Vec<TagDto>> {
    state.with_db(|db| repositories::set_collection_tags(db, request))
}

#[tauri::command]
pub fn list_image_tag_assignments(
    state: State<'_, AppState>,
    request: ListImageTagAssignmentsRequest,
) -> AppResult<Vec<TagAssignmentDto>> {
    state.with_db(|db| repositories::list_image_tag_assignments(db, request))
}

#[tauri::command]
pub fn set_image_tags(
    state: State<'_, AppState>,
    request: SetTagAssignmentsRequest,
) -> AppResult<Vec<TagDto>> {
    state.with_db(|db| repositories::set_image_tags(db, request))
}

#[tauri::command]
pub fn search_library(
    state: State<'_, AppState>,
    request: SearchLibraryRequest,
) -> AppResult<SearchResultsDto> {
    state.with_db(|db| repositories::search_library(db, request))
}

#[tauri::command]
pub fn run_duplicate_detection(
    state: State<'_, AppState>,
    request: DuplicateDetectionRequest,
) -> AppResult<DuplicateDetectionResult> {
    state.with_db(|db| crate::duplicates::run_duplicate_detection(db, request))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<Vec<SettingDto>> {
    state.with_db(repositories::list_settings)
}

#[tauri::command]
pub fn get_setting(state: State<'_, AppState>, key: String) -> AppResult<Option<SettingDto>> {
    state.with_db(|db| repositories::get_setting(db, &key))
}

#[tauri::command]
pub fn update_setting(
    state: State<'_, AppState>,
    request: UpdateSettingRequest,
) -> AppResult<SettingDto> {
    state.with_db(|db| repositories::update_setting(db, request))
}

#[tauri::command]
pub fn backup_database(state: State<'_, AppState>) -> AppResult<DataFileResult> {
    fs::create_dir_all(&state.paths().backups_dir)?;
    let path = state
        .paths()
        .backups_dir
        .join(format!("photoview-backup-{}.sqlite", file_timestamp()));
    let path_string = path.display().to_string();
    state.with_db(|db| {
        db.execute("VACUUM main INTO ?1", [&path_string])?;
        Ok(())
    })?;

    Ok(DataFileResult {
        path: path_string,
        message: "数据库备份已创建".to_string(),
    })
}

#[tauri::command]
pub fn restore_database_from_backup(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<DataFileResult> {
    let backup_path = Path::new(&path);
    state.restore_database_from_backup(backup_path)?;
    Ok(DataFileResult {
        path,
        message: "数据库已从备份恢复".to_string(),
    })
}

#[tauri::command]
pub fn move_database_storage(
    state: State<'_, AppState>,
    directory: String,
) -> AppResult<DataFileResult> {
    let path = state.move_database_storage(Path::new(&directory))?;
    Ok(DataFileResult {
        path: path.display().to_string(),
        message: "数据库存储路径已更新".to_string(),
    })
}

#[tauri::command]
pub fn rebuild_index(state: State<'_, AppState>) -> AppResult<DataFileResult> {
    let results = state.with_db_mut(repositories::sync_all_collections)?;
    Ok(DataFileResult {
        path: String::new(),
        message: format!("索引已重建：同步 {} 个合集", results.len()),
    })
}

#[tauri::command]
pub fn export_library_data(state: State<'_, AppState>) -> AppResult<DataFileResult> {
    fs::create_dir_all(&state.paths().exports_dir)?;
    let path = state
        .paths()
        .exports_dir
        .join(format!("photoview-export-{}.json", file_timestamp()));
    let export = state.with_db(|db| {
        Ok(serde_json::json!({
            "collections": repositories::list_collections(db)?,
            "images": repositories::list_images(db, ListImagesRequest {
                collection_id: None,
                limit: Some(20_000),
                offset: Some(0),
            })?,
            "tags": repositories::list_tags(db)?,
            "collectionTags": repositories::list_collection_tag_assignments(
                db,
                ListCollectionTagAssignmentsRequest { collection_id: None },
            )?,
            "imageTags": repositories::list_image_tag_assignments(
                db,
                ListImageTagAssignmentsRequest {
                    collection_id: None,
                    image_id: None,
                },
            )?,
            "settings": repositories::list_settings(db)?,
        }))
    })?;
    let bytes = serde_json::to_vec_pretty(&export)
        .map_err(|value| AppError::internal(value.to_string()))?;
    fs::write(&path, bytes)?;

    Ok(DataFileResult {
        path: path.display().to_string(),
        message: "图库数据已导出".to_string(),
    })
}

#[tauri::command]
pub fn get_thumbnail(
    state: State<'_, AppState>,
    image_id: String,
    target_size: Option<u32>,
) -> AppResult<ThumbnailDto> {
    let image = state
        .with_db(|db| repositories::get_image(db, &image_id))?
        .ok_or_else(|| AppError::new("not_found", "图片不存在"))?;

    if uses_source_thumbnail(&image.path) {
        return Ok(ThumbnailDto {
            image_id: image.id,
            cache_path: image.path.clone(),
            url: image.path,
            width: optional_dimension_to_u32(image.width),
            height: optional_dimension_to_u32(image.height),
            status: "source".to_string(),
        });
    }

    let source = read_source_metadata(&image.path)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;
    let request = ThumbnailRequest::new(
        &image.path,
        &state.paths().thumbnails_dir,
        &image.id,
        source.source_size_bytes,
        source.source_mtime.clone(),
        target_size.unwrap_or(192),
    );
    let thumbnail = get_or_create_thumbnail(&request)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;
    let cache_path = thumbnail.cache_path.display().to_string();
    state.with_db(|db| {
        repositories::upsert_thumbnail_cache_record(
            db,
            repositories::ThumbnailCacheRecord {
                image_id: &image.id,
                source_mtime: &source.source_mtime,
                source_size_bytes: i64::try_from(source.source_size_bytes)
                    .map_err(|_| AppError::new("validation_error", "源文件大小超出可支持范围"))?,
                width: i64::from(thumbnail.width),
                height: i64::from(thumbnail.height),
                format: thumbnail.format.as_str(),
                cache_path: &cache_path,
                status: match thumbnail.status {
                    ThumbnailCacheStatus::Hit => "hit",
                    ThumbnailCacheStatus::Miss => "miss",
                },
            },
        )
    })?;

    Ok(ThumbnailDto {
        image_id: image.id,
        cache_path: cache_path.clone(),
        url: cache_path,
        width: thumbnail.width,
        height: thumbnail.height,
        status: match thumbnail.status {
            ThumbnailCacheStatus::Hit => "hit".to_string(),
            ThumbnailCacheStatus::Miss => "miss".to_string(),
        },
    })
}

#[tauri::command]
pub fn enqueue_thumbnail_generation(
    state: State<'_, AppState>,
    request: ThumbnailTaskRequest,
) -> AppResult<TaskDto> {
    let target_size = request.target_size.unwrap_or(192);
    if target_size == 0 {
        return Err(AppError::new("validation_error", "缩略图尺寸必须大于 0"));
    }

    let images = state
        .with_db(|db| repositories::list_images_for_thumbnail_task(db, request.collection_id))?;
    let total_count = i64::try_from(images.len())
        .map_err(|_| AppError::new("validation_error", "图片数量超出可支持范围"))?;
    let task =
        state.with_db(|db| repositories::create_task(db, "thumbnail_generation", total_count))?;

    crate::tasks::spawn_thumbnail_generation_task(
        task.id.clone(),
        state.paths().database_path.clone(),
        state.paths().thumbnails_dir.clone(),
        images,
        target_size,
    );

    Ok(task)
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: String) -> AppResult<TaskDto> {
    state
        .with_db(|db| repositories::get_task(db, &id))?
        .ok_or_else(|| AppError::new("not_found", "任务不存在"))
}

#[tauri::command]
pub fn get_thumbnail_cache_stats(state: State<'_, AppState>) -> AppResult<ThumbnailCacheStatsDto> {
    let stats = collect_thumbnail_cache_stats(&state.paths().thumbnails_dir)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;

    Ok(ThumbnailCacheStatsDto {
        root_path: state.paths().thumbnails_dir.display().to_string(),
        file_count: stats.file_count,
        metadata_file_count: stats.metadata_file_count,
        total_bytes: stats.total_bytes,
    })
}

#[tauri::command]
pub fn clear_thumbnail_cache(state: State<'_, AppState>) -> AppResult<ClearThumbnailCacheResult> {
    let result = clear_thumbnail_cache_files(&state.paths().thumbnails_dir)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;
    state.with_db(repositories::clear_thumbnail_cache_records)?;

    Ok(ClearThumbnailCacheResult {
        deleted_file_count: result.deleted_file_count,
        deleted_dir_count: result.deleted_dir_count,
        freed_bytes: result.freed_bytes,
    })
}

#[tauri::command]
pub fn get_viewer_image(
    state: State<'_, AppState>,
    image_id: String,
    max_side: Option<u32>,
) -> AppResult<ViewerImageDto> {
    let image = state
        .with_db(|db| repositories::get_image(db, &image_id))?
        .ok_or_else(|| AppError::new("not_found", "图片不存在"))?;

    let source = read_source_metadata(&image.path)
        .map_err(|value| AppError::new("viewer_error", value.to_string()))?;
    let request = ViewerImageRequest::new(
        &image.path,
        &state.paths().thumbnails_dir,
        &image.id,
        source.source_size_bytes,
        source.source_mtime,
        max_side.unwrap_or(4096),
    );
    let asset = get_or_create_viewer_image(&request)?;
    let asset_path = asset.asset_path.display().to_string();

    Ok(ViewerImageDto {
        image_id: image.id,
        asset_path: asset_path.clone(),
        url: asset_path,
        width: asset.width,
        height: asset.height,
        format: asset.format,
        kind: asset.kind.as_str().to_string(),
        status: asset.status.as_str().to_string(),
    })
}

fn uses_source_thumbnail(path: &str) -> bool {
    matches!(
        Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("avif" | "svg")
    )
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportFolderProgress {
    root_path: String,
    current_path: String,
    current_name: String,
    phase: String,
    processed_count: i64,
    total_count: i64,
    collection_count: i64,
    scanned_count: i64,
    inserted_count: i64,
    updated_count: i64,
    error_count: i64,
    skipped_dir_count: i64,
}

struct ImportDirectoryDiscovery {
    directories: Vec<PathBuf>,
    skipped_dir_count: i64,
}

struct ImportCancelSession<'a> {
    state: &'a AppState,
}

impl Drop for ImportCancelSession<'_> {
    fn drop(&mut self) {
        self.state.reset_import_cancel();
    }
}

fn validate_import_root(root: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(root)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_dir() {
        return Err(AppError::new(
            "validation_error",
            "导入路径必须是真实文件夹，且不会跟随符号链接",
        ));
    }

    Ok(())
}

fn collect_import_directories<F>(
    root: &Path,
    state: &AppState,
    mut on_progress: F,
) -> AppResult<ImportDirectoryDiscovery>
where
    F: FnMut(usize, i64),
{
    let canonical_root = fs::canonicalize(root)?;
    let mut directories = vec![canonical_root.clone()];
    let mut skipped_dir_count = 0;
    on_progress(directories.len(), skipped_dir_count);
    collect_import_directories_into(
        &canonical_root,
        state,
        &mut directories,
        &mut skipped_dir_count,
        &mut on_progress,
    )?;
    directories.sort();
    on_progress(directories.len(), skipped_dir_count);
    Ok(ImportDirectoryDiscovery {
        directories,
        skipped_dir_count,
    })
}

fn collect_import_directories_into<F>(
    directory: &Path,
    state: &AppState,
    directories: &mut Vec<PathBuf>,
    skipped_dir_count: &mut i64,
    on_progress: &mut F,
) -> AppResult<()>
where
    F: FnMut(usize, i64),
{
    ensure_import_not_cancelled(state)?;
    let mut child_dirs = Vec::new();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(_) => {
            *skipped_dir_count += 1;
            on_progress(directories.len(), *skipped_dir_count);
            return Ok(());
        }
    };
    for entry in entries {
        ensure_import_not_cancelled(state)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                *skipped_dir_count += 1;
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => {
                *skipped_dir_count += 1;
                continue;
            }
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }

        match fs::canonicalize(entry.path()) {
            Ok(path) => child_dirs.push(path),
            Err(_) => *skipped_dir_count += 1,
        }
    }
    child_dirs.sort();

    for child_dir in child_dirs {
        directories.push(child_dir.clone());
        on_progress(directories.len(), *skipped_dir_count);
        collect_import_directories_into(
            &child_dir,
            state,
            directories,
            skipped_dir_count,
            on_progress,
        )?;
    }

    Ok(())
}

fn scan_direct_images_for_import(root: &Path, state: &AppState) -> AppResult<ScanReport> {
    let mut report = ScanReport {
        root: root.to_path_buf(),
        candidates: Vec::new(),
        errors: Vec::new(),
    };

    for entry in fs::read_dir(root)? {
        ensure_import_not_cancelled(state)?;
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };
        if file_type.is_symlink() || !file_type.is_file() {
            continue;
        }

        let path = entry.path();
        match scanner::scan_file(&path) {
            Ok(Some(candidate)) => report.candidates.push(candidate),
            Ok(None) => {}
            Err(error) => report.errors.push(error),
        }
    }

    report
        .candidates
        .sort_by(|left, right| left.path.cmp(&right.path));
    report
        .errors
        .sort_by(|left, right| left.path.cmp(&right.path));
    Ok(report)
}

fn ensure_import_not_cancelled(state: &AppState) -> AppResult<()> {
    if state.import_cancel_requested() {
        return Err(AppError::new("operation_cancelled", "导入已取消"));
    }

    Ok(())
}

fn import_progress(
    root: &Path,
    current: &Path,
    phase: &str,
    processed_count: i64,
    total_count: i64,
    skipped_dir_count: i64,
    results: &[ImportCollectionResult],
) -> ImportFolderProgress {
    let (collection_count, scanned_count, inserted_count, updated_count, error_count) =
        summarize_import_results(results);
    ImportFolderProgress {
        root_path: root.display().to_string(),
        current_path: current.display().to_string(),
        current_name: current
            .file_name()
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_else(|| current.display().to_string()),
        phase: phase.to_string(),
        processed_count,
        total_count,
        collection_count,
        scanned_count,
        inserted_count,
        updated_count,
        error_count,
        skipped_dir_count,
    }
}

fn summarize_import_results(results: &[ImportCollectionResult]) -> (i64, i64, i64, i64, i64) {
    (
        results.len() as i64,
        results.iter().map(|result| result.scanned_count).sum(),
        results.iter().map(|result| result.inserted_count).sum(),
        results.iter().map(|result| result.updated_count).sum(),
        results.iter().map(|result| result.error_count).sum(),
    )
}

fn emit_import_progress(app: &AppHandle, progress: ImportFolderProgress) {
    let _ = app.emit("import-folder-progress", progress);
}

fn allow_asset_files(app: &AppHandle, image_paths: &[PathBuf]) -> AppResult<()> {
    for image_path in image_paths {
        if image_path.is_file() {
            app.asset_protocol_scope().allow_file(image_path)?;
        }
    }

    Ok(())
}

fn revoke_asset_files(app: &AppHandle, image_paths: &[String]) -> AppResult<()> {
    for image_path in image_paths {
        app.asset_protocol_scope()
            .forbid_file(Path::new(image_path))?;
    }

    Ok(())
}

fn revoke_collection_asset_scope(
    app: &AppHandle,
    collection_path: &str,
    remaining_collections: &[CollectionDto],
) -> AppResult<()> {
    let collection_path = Path::new(collection_path);
    if !collection_path.is_dir() {
        return Ok(());
    }

    if remaining_collections
        .iter()
        .any(|collection| Path::new(&collection.path).starts_with(collection_path))
    {
        app.asset_protocol_scope()
            .forbid_directory(collection_path, false)?;
        return Ok(());
    }

    app.asset_protocol_scope()
        .forbid_directory(collection_path, true)?;
    Ok(())
}

fn optional_dimension_to_u32(value: Option<i64>) -> u32 {
    value
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}

fn file_timestamp() -> String {
    Utc::now().format("%Y%m%d-%H%M%S").to_string()
}

#[cfg(test)]
mod import_tests {
    use super::*;
    use image::{ImageFormat, Rgb, RgbImage};

    #[test]
    fn direct_root_import_scan_excludes_child_collection_images() {
        let root = temp_dir("root-images");
        let app_data = temp_dir("app-data");
        let child = root.join("child");
        let grandchild = child.join("grandchild");
        fs::create_dir_all(&grandchild).expect("nested fixture directories should be created");
        let root_image = root.join("root.png");
        let child_image = child.join("child.png");
        let grandchild_image = grandchild.join("grandchild.png");
        write_png(&root_image);
        write_png(&child_image);
        write_png(&grandchild_image);

        let state = AppState::initialize_for_test(app_data.clone())
            .expect("test app state should initialize");
        let discovery =
            collect_import_directories(&root, &state, |_, _| {}).expect("import dirs should scan");
        let import_dirs = discovery.directories;
        let direct_report =
            scan_direct_images_for_import(&root, &state).expect("root files should scan");

        assert_eq!(import_dirs.len(), 3);
        assert!(import_dirs.contains(&fs::canonicalize(&root).expect("root should canonicalize")));
        assert!(import_dirs.contains(&fs::canonicalize(&child).expect("child should canonicalize")));
        assert!(import_dirs
            .contains(&fs::canonicalize(&grandchild).expect("grandchild should canonicalize")));
        assert_eq!(direct_report.candidates.len(), 1);
        assert_eq!(direct_report.candidates[0].path, root_image);

        drop(state);
        fs::remove_dir_all(root).expect("root fixture should be removed");
        fs::remove_dir_all(app_data).expect("app data fixture should be removed");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let path =
            std::env::temp_dir().join(format!("photoview_import_{name}_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    fn write_png(path: &Path) {
        let image = RgbImage::from_pixel(4, 4, Rgb([12, 34, 56]));
        image
            .save_with_format(path, ImageFormat::Png)
            .expect("image fixture should be saved");
    }
}
