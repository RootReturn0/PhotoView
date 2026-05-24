use crate::{
    app::AppState,
    db::repositories,
    errors::{AppError, AppResult},
    models::{
        ClearThumbnailCacheResult, CollectionDto, CreateCollectionRequest, CreateImageRequest,
        CreateTagRequest, ImageDto, ImportCollectionRequest, ImportCollectionResult,
        ListImagesRequest, SettingDto, TagDto, TaskDto, ThumbnailCacheStatsDto, ThumbnailDto,
        ThumbnailTaskRequest, UpdateCollectionRequest, UpdateImageRequest, UpdateSettingRequest,
        UpdateTagRequest, ViewerImageDto,
    },
    thumbs::{
        clear_thumbnail_cache as clear_thumbnail_cache_files, collect_thumbnail_cache_stats,
        get_or_create_thumbnail, read_source_metadata, ThumbnailCacheStatus, ThumbnailRequest,
    },
    viewer::{get_or_create_viewer_image, ViewerImageRequest},
};
use std::path::Path;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> AppResult<Vec<CollectionDto>> {
    state.with_db(repositories::list_collections)
}

#[tauri::command]
pub fn get_collection(state: State<'_, AppState>, id: String) -> AppResult<Option<CollectionDto>> {
    state.with_db(|db| repositories::get_collection(db, &id))
}

#[tauri::command]
pub fn create_collection(
    state: State<'_, AppState>,
    request: CreateCollectionRequest,
) -> AppResult<CollectionDto> {
    state.with_db(|db| repositories::create_collection(db, request))
}

#[tauri::command]
pub fn import_collection(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ImportCollectionRequest,
) -> AppResult<ImportCollectionResult> {
    let result = state.with_db_mut(|db| repositories::import_collection(db, request))?;
    let collection_path = Path::new(&result.collection.path);
    if collection_path.is_dir() {
        app.asset_protocol_scope()
            .allow_directory(collection_path, true)?;
    }

    Ok(result)
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
pub fn delete_collection_record(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.with_db(|db| repositories::delete_collection_record(db, &id))
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
pub fn create_image(
    state: State<'_, AppState>,
    request: CreateImageRequest,
) -> AppResult<ImageDto> {
    state.with_db(|db| repositories::create_image(db, request))
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

fn optional_dimension_to_u32(value: Option<i64>) -> u32 {
    value
        .and_then(|value| u32::try_from(value).ok())
        .unwrap_or(0)
}
