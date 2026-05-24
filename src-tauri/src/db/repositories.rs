use crate::{
    errors::{AppError, AppResult},
    models::{
        CollectionDto, CreateCollectionRequest, CreateImageRequest, CreateTagRequest, ImageDto,
        ImportCollectionRequest, ImportCollectionResult, ImportErrorDto, ListImagesRequest,
        SettingDto, TagDto, TaskDto, UpdateCollectionRequest, UpdateImageRequest,
        UpdateSettingRequest, UpdateTagRequest,
    },
    scanner::{self, ScanCandidate},
};
use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use std::{path::Path, time::SystemTime};
use uuid::Uuid;

const DEFAULT_TAG_COLOR: &str = "#4f7cff";
const DEFAULT_PAGE_LIMIT: i64 = 200;
const MAX_PAGE_LIMIT: i64 = 1000;

pub fn list_collections(conn: &Connection) -> AppResult<Vec<CollectionDto>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, path, name, cover_image_id, description, rating, is_favorite,
               image_count, total_size_bytes, created_at, imported_at, updated_at,
               last_viewed_at, view_count
        FROM collections
        WHERE deleted_at IS NULL
        ORDER BY imported_at DESC, name COLLATE NOCASE ASC
        ",
    )?;

    let rows = collect_rows(stmt.query_map([], collection_from_row)?);
    rows
}

pub fn get_collection(conn: &Connection, id: &str) -> AppResult<Option<CollectionDto>> {
    conn.query_row(
        "
        SELECT id, path, name, cover_image_id, description, rating, is_favorite,
               image_count, total_size_bytes, created_at, imported_at, updated_at,
               last_viewed_at, view_count
        FROM collections
        WHERE id = ?1 AND deleted_at IS NULL
        ",
        params![id],
        collection_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn get_collection_by_path(conn: &Connection, path: &str) -> AppResult<Option<CollectionDto>> {
    conn.query_row(
        "
        SELECT id, path, name, cover_image_id, description, rating, is_favorite,
               image_count, total_size_bytes, created_at, imported_at, updated_at,
               last_viewed_at, view_count
        FROM collections
        WHERE path = ?1 AND deleted_at IS NULL
        ",
        params![path],
        collection_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn import_collection(
    conn: &mut Connection,
    request: ImportCollectionRequest,
) -> AppResult<ImportCollectionResult> {
    let requested_path = require_text(request.path, "合集路径")?;
    let root = Path::new(&requested_path);
    let report = scanner::scan_directory(root)
        .map_err(|value| AppError::new("scan_error", value.to_string()))?;
    let root = std::fs::canonicalize(root)?;
    let collection_path = path_to_string(&root);
    let collection_name = request
        .name
        .map(|value| require_text(value, "合集名称"))
        .transpose()?;

    let tx = conn.transaction()?;
    let collection = ensure_import_collection(&tx, &collection_path, collection_name)?;
    let mut inserted_count = 0;
    let mut updated_count = 0;

    for candidate in &report.candidates {
        match upsert_scanned_image(&tx, &collection.id, candidate)? {
            UpsertOutcome::Inserted => inserted_count += 1,
            UpsertOutcome::Updated => updated_count += 1,
        }
    }

    refresh_collection_stats(&tx, &collection.id)?;
    let collection = get_collection_required(&tx, &collection.id)?;
    tx.commit()?;

    let errors = report
        .errors
        .into_iter()
        .map(|error| ImportErrorDto {
            path: path_to_string(&error.path),
            kind: error.kind.to_string(),
            message: error.message,
        })
        .collect::<Vec<_>>();

    Ok(ImportCollectionResult {
        collection,
        scanned_count: report.candidates.len() as i64,
        inserted_count,
        updated_count,
        error_count: errors.len() as i64,
        errors,
    })
}

pub fn create_collection(
    conn: &Connection,
    request: CreateCollectionRequest,
) -> AppResult<CollectionDto> {
    let id = Uuid::new_v4().to_string();
    let path = require_text(request.path, "合集路径")?;
    let name = match request.name {
        Some(value) => require_text(value, "合集名称")?,
        None => default_collection_name(&path),
    };
    let description = request.description.unwrap_or_default();
    let rating = validate_rating(request.rating.unwrap_or(0))?;
    let now = now();

    conn.execute(
        "
        INSERT INTO collections (
          id, path, name, description, rating, imported_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ",
        params![id, path, name, description, rating, now],
    )?;

    get_collection_required(conn, &id)
}

pub fn update_collection(
    conn: &Connection,
    request: UpdateCollectionRequest,
) -> AppResult<CollectionDto> {
    let current = get_collection_required(conn, &request.id)?;
    let name = match request.name {
        Some(value) => require_text(value, "合集名称")?,
        None => current.name,
    };
    let description = request.description.unwrap_or(current.description);
    let rating = match request.rating {
        Some(value) => validate_rating(value)?,
        None => current.rating,
    };
    let favorite_was_requested = request.is_favorite.is_some();
    let is_favorite = request.is_favorite.unwrap_or(current.is_favorite);
    let cover_image_id = match request.cover_image_id {
        Some(value) => normalize_collection_cover(conn, &request.id, value)?,
        None => current.cover_image_id,
    };
    let now = now();

    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "
        UPDATE collections
        SET name = ?2,
            description = ?3,
            rating = ?4,
            is_favorite = ?5,
            cover_image_id = ?6,
            updated_at = ?7
        WHERE id = ?1 AND deleted_at IS NULL
        ",
        params![
            request.id,
            name,
            description,
            rating,
            bool_to_i64(is_favorite),
            cover_image_id,
            now
        ],
    )?;
    if favorite_was_requested {
        sync_favorite(&tx, "collection", &request.id, is_favorite, &now)?;
    }
    tx.commit()?;

    get_collection_required(conn, &request.id)
}

pub fn delete_collection_record(conn: &Connection, id: &str) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM favorites WHERE target_type = 'collection' AND target_id = ?1",
        params![id],
    )?;
    tx.execute(
        "DELETE FROM history WHERE target_type = 'collection' AND target_id = ?1",
        params![id],
    )?;
    let affected = tx.execute("DELETE FROM collections WHERE id = ?1", params![id])?;
    ensure_affected(affected, "合集不存在")?;
    tx.commit()?;
    Ok(())
}

pub fn mark_collection_viewed(conn: &Connection, id: &str) -> AppResult<CollectionDto> {
    let now = now();
    let tx = conn.unchecked_transaction()?;
    let affected = tx.execute(
        "
        UPDATE collections
        SET last_viewed_at = ?2,
            view_count = view_count + 1,
            updated_at = ?2
        WHERE id = ?1 AND deleted_at IS NULL
        ",
        params![id, now],
    )?;
    ensure_affected(affected, "合集不存在")?;

    tx.execute(
        "
        INSERT INTO history (id, target_type, target_id, viewed_at)
        VALUES (?1, 'collection', ?2, ?3)
        ON CONFLICT(target_type, target_id)
        DO UPDATE SET viewed_at = excluded.viewed_at
        ",
        params![Uuid::new_v4().to_string(), id, now],
    )?;
    tx.commit()?;

    get_collection_required(conn, id)
}

pub fn list_images(conn: &Connection, request: ListImagesRequest) -> AppResult<Vec<ImageDto>> {
    let limit = validate_limit(request.limit)?;
    let offset = validate_offset(request.offset)?;

    if let Some(collection_id) = request.collection_id {
        let collection_id = require_text(collection_id, "合集 ID")?;
        let mut stmt = conn.prepare(
            "
            SELECT id, collection_id, path, file_name, extension, format, size_bytes,
                   width, height, created_at, modified_at, imported_at, updated_at,
                   sha256, phash, rating, is_favorite, is_missing, last_viewed_at, view_count
            FROM images
            WHERE collection_id = ?1
            ORDER BY file_name COLLATE NOCASE ASC
            LIMIT ?2 OFFSET ?3
            ",
        )?;

        let rows =
            collect_rows(stmt.query_map(params![collection_id, limit, offset], image_from_row)?);
        return rows;
    }

    let mut stmt = conn.prepare(
        "
        SELECT id, collection_id, path, file_name, extension, format, size_bytes,
               width, height, created_at, modified_at, imported_at, updated_at,
               sha256, phash, rating, is_favorite, is_missing, last_viewed_at, view_count
        FROM images
        ORDER BY imported_at DESC, file_name COLLATE NOCASE ASC
        LIMIT ?1 OFFSET ?2
        ",
    )?;

    let rows = collect_rows(stmt.query_map(params![limit, offset], image_from_row)?);
    rows
}

pub fn get_image(conn: &Connection, id: &str) -> AppResult<Option<ImageDto>> {
    conn.query_row(
        "
        SELECT id, collection_id, path, file_name, extension, format, size_bytes,
               width, height, created_at, modified_at, imported_at, updated_at,
               sha256, phash, rating, is_favorite, is_missing, last_viewed_at, view_count
        FROM images
        WHERE id = ?1
        ",
        params![id],
        image_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn create_image(conn: &Connection, request: CreateImageRequest) -> AppResult<ImageDto> {
    let collection_id = require_text(request.collection_id, "合集 ID")?;
    ensure_collection_exists(conn, &collection_id)?;

    let id = Uuid::new_v4().to_string();
    let path = require_text(request.path, "图片路径")?;
    let file_name = match request.file_name {
        Some(value) => require_text(value, "文件名")?,
        None => default_file_name(&path)?,
    };
    let extension = match request.extension {
        Some(value) => normalize_extension(value)?,
        None => default_extension(&path)?,
    };
    let format = match request.format {
        Some(value) => require_text(value, "图片格式")?,
        None => extension.clone(),
    };
    let size_bytes = validate_non_negative(request.size_bytes.unwrap_or(0), "文件大小")?;
    let width = validate_optional_dimension(request.width, "图片宽度")?;
    let height = validate_optional_dimension(request.height, "图片高度")?;
    let now = now();

    conn.execute(
        "
        INSERT INTO images (
          id, collection_id, path, file_name, extension, format, size_bytes,
          width, height, created_at, modified_at, imported_at, updated_at, sha256
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12, ?13)
        ",
        params![
            id,
            collection_id,
            path,
            file_name,
            extension,
            format,
            size_bytes,
            width,
            height,
            request.created_at,
            request.modified_at,
            now,
            request.sha256
        ],
    )?;

    refresh_collection_stats(conn, &collection_id)?;
    get_image_required(conn, &id)
}

pub fn update_image(conn: &Connection, request: UpdateImageRequest) -> AppResult<ImageDto> {
    let current = get_image_required(conn, &request.id)?;
    let file_name = match request.file_name {
        Some(value) => require_text(value, "文件名")?,
        None => current.file_name,
    };
    let rating = match request.rating {
        Some(value) => validate_rating(value)?,
        None => current.rating,
    };
    let width = validate_optional_dimension(request.width.or(current.width), "图片宽度")?;
    let height = validate_optional_dimension(request.height.or(current.height), "图片高度")?;
    let is_favorite = request.is_favorite.unwrap_or(current.is_favorite);
    let is_missing = request.is_missing.unwrap_or(current.is_missing);
    let sha256 = request.sha256.or(current.sha256);
    let phash = request.phash.or(current.phash);
    let now = now();

    conn.execute(
        "
        UPDATE images
        SET file_name = ?2,
            width = ?3,
            height = ?4,
            sha256 = ?5,
            phash = ?6,
            rating = ?7,
            is_favorite = ?8,
            is_missing = ?9,
            updated_at = ?10
        WHERE id = ?1
        ",
        params![
            request.id,
            file_name,
            width,
            height,
            sha256,
            phash,
            rating,
            bool_to_i64(is_favorite),
            bool_to_i64(is_missing),
            now
        ],
    )?;

    get_image_required(conn, &request.id)
}

pub fn delete_image_record(conn: &Connection, id: &str) -> AppResult<()> {
    let image = get_image_required(conn, id)?;
    let affected = conn.execute("DELETE FROM images WHERE id = ?1", params![id])?;
    ensure_affected(affected, "图片不存在")?;
    refresh_collection_stats(conn, &image.collection_id)
}

enum UpsertOutcome {
    Inserted,
    Updated,
}

fn ensure_import_collection(
    conn: &Connection,
    path: &str,
    name: Option<String>,
) -> AppResult<CollectionDto> {
    if let Some(collection) = get_collection_by_path(conn, path)? {
        if let Some(name) = name {
            conn.execute(
                "
                UPDATE collections
                SET name = ?2, updated_at = ?3
                WHERE id = ?1
                ",
                params![collection.id, name, now()],
            )?;

            return get_collection_required(conn, &collection.id);
        }

        return Ok(collection);
    }

    create_collection(
        conn,
        CreateCollectionRequest {
            path: path.to_string(),
            name,
            description: None,
            rating: None,
        },
    )
}

fn upsert_scanned_image(
    conn: &Connection,
    collection_id: &str,
    candidate: &ScanCandidate,
) -> AppResult<UpsertOutcome> {
    let path = candidate
        .path
        .canonicalize()
        .unwrap_or_else(|_| candidate.path.clone());
    let path = path_to_string(&path);
    let existing_id = conn
        .query_row(
            "SELECT id FROM images WHERE path = ?1",
            params![&path],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    let size_bytes = i64::try_from(candidate.size_bytes)
        .map_err(|_| AppError::new("validation_error", "文件大小超出可支持范围"))?;
    let width = candidate.width.map(i64::from);
    let height = candidate.height.map(i64::from);
    let created_at = system_time_to_string(candidate.created_at);
    let modified_at = system_time_to_string(candidate.modified_at);
    let now = now();

    if let Some(id) = existing_id {
        conn.execute(
            "
            UPDATE images
            SET collection_id = ?2,
                file_name = ?3,
                extension = ?4,
                format = ?5,
                size_bytes = ?6,
                width = ?7,
                height = ?8,
                created_at = ?9,
                modified_at = ?10,
                is_missing = 0,
                updated_at = ?11
            WHERE id = ?1
            ",
            params![
                id,
                collection_id,
                &candidate.file_name,
                &candidate.extension,
                candidate.format.as_str(),
                size_bytes,
                width,
                height,
                created_at,
                modified_at,
                now
            ],
        )?;

        return Ok(UpsertOutcome::Updated);
    }

    conn.execute(
        "
        INSERT INTO images (
          id, collection_id, path, file_name, extension, format, size_bytes,
          width, height, created_at, modified_at, imported_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)
        ",
        params![
            Uuid::new_v4().to_string(),
            collection_id,
            &path,
            &candidate.file_name,
            &candidate.extension,
            candidate.format.as_str(),
            size_bytes,
            width,
            height,
            created_at,
            modified_at,
            now
        ],
    )?;

    Ok(UpsertOutcome::Inserted)
}

pub fn list_tags(conn: &Connection) -> AppResult<Vec<TagDto>> {
    let mut stmt = conn.prepare(
        "
        SELECT id, name, color, created_at, updated_at
        FROM tags
        ORDER BY name COLLATE NOCASE ASC
        ",
    )?;

    let rows = collect_rows(stmt.query_map([], tag_from_row)?);
    rows
}

pub fn get_tag(conn: &Connection, id: &str) -> AppResult<Option<TagDto>> {
    conn.query_row(
        "
        SELECT id, name, color, created_at, updated_at
        FROM tags
        WHERE id = ?1
        ",
        params![id],
        tag_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn create_tag(conn: &Connection, request: CreateTagRequest) -> AppResult<TagDto> {
    let id = Uuid::new_v4().to_string();
    let name = require_text(request.name, "标签名称")?;
    let color = match request.color {
        Some(value) => validate_color(value)?,
        None => DEFAULT_TAG_COLOR.to_string(),
    };
    let now = now();

    conn.execute(
        "
        INSERT INTO tags (id, name, color, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?4)
        ",
        params![id, name, color, now],
    )?;

    get_tag_required(conn, &id)
}

pub fn update_tag(conn: &Connection, request: UpdateTagRequest) -> AppResult<TagDto> {
    let current = get_tag_required(conn, &request.id)?;
    let name = match request.name {
        Some(value) => require_text(value, "标签名称")?,
        None => current.name,
    };
    let color = match request.color {
        Some(value) => validate_color(value)?,
        None => current.color,
    };
    let now = now();

    conn.execute(
        "
        UPDATE tags
        SET name = ?2, color = ?3, updated_at = ?4
        WHERE id = ?1
        ",
        params![request.id, name, color, now],
    )?;

    get_tag_required(conn, &request.id)
}

pub fn delete_tag(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    ensure_affected(affected, "标签不存在")
}

pub fn list_settings(conn: &Connection) -> AppResult<Vec<SettingDto>> {
    let mut stmt = conn.prepare(
        "
        SELECT key, value, updated_at
        FROM settings
        ORDER BY key ASC
        ",
    )?;

    let rows = collect_rows(stmt.query_map([], setting_from_row)?);
    rows
}

pub fn get_setting(conn: &Connection, key: &str) -> AppResult<Option<SettingDto>> {
    conn.query_row(
        "
        SELECT key, value, updated_at
        FROM settings
        WHERE key = ?1
        ",
        params![key],
        setting_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn update_setting(conn: &Connection, request: UpdateSettingRequest) -> AppResult<SettingDto> {
    let key = require_text(request.key, "设置键")?;
    let value = require_text(request.value, "设置值")?;
    let now = now();

    conn.execute(
        "
        INSERT INTO settings (key, value, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        ",
        params![key, value, now],
    )?;

    get_setting(conn, &key)?.ok_or_else(|| AppError::internal("setting was not saved"))
}

pub fn list_images_for_thumbnail_task(
    conn: &Connection,
    collection_id: Option<String>,
) -> AppResult<Vec<ImageDto>> {
    if let Some(collection_id) = collection_id {
        let collection_id = require_text(collection_id, "合集 ID")?;
        ensure_collection_exists(conn, &collection_id)?;
        let mut stmt = conn.prepare(
            "
            SELECT id, collection_id, path, file_name, extension, format, size_bytes,
                   width, height, created_at, modified_at, imported_at, updated_at,
                   sha256, phash, rating, is_favorite, is_missing, last_viewed_at, view_count
            FROM images
            WHERE collection_id = ?1 AND is_missing = 0
            ORDER BY file_name COLLATE NOCASE ASC
            ",
        )?;

        return collect_rows(stmt.query_map(params![collection_id], image_from_row)?);
    }

    let mut stmt = conn.prepare(
        "
        SELECT id, collection_id, path, file_name, extension, format, size_bytes,
               width, height, created_at, modified_at, imported_at, updated_at,
               sha256, phash, rating, is_favorite, is_missing, last_viewed_at, view_count
        FROM images
        WHERE is_missing = 0
        ORDER BY imported_at DESC, file_name COLLATE NOCASE ASC
        ",
    )?;

    let rows = collect_rows(stmt.query_map([], image_from_row)?);
    rows
}

pub fn create_task(conn: &Connection, kind: &str, total_count: i64) -> AppResult<TaskDto> {
    let kind = require_text(kind.to_string(), "任务类型")?;
    let total_count = validate_non_negative(total_count, "任务总数")?;
    let id = Uuid::new_v4().to_string();
    let now = now();

    conn.execute(
        "
        INSERT INTO tasks (
          id, kind, status, total_count, completed_count, failed_count, created_at, updated_at
        )
        VALUES (?1, ?2, 'queued', ?3, 0, 0, ?4, ?4)
        ",
        params![id, kind, total_count, now],
    )?;

    get_task(conn, &id)?.ok_or_else(|| AppError::internal("task was not saved"))
}

pub fn get_task(conn: &Connection, id: &str) -> AppResult<Option<TaskDto>> {
    conn.query_row(
        "
        SELECT id, kind, status, total_count, completed_count, failed_count,
               current_item, error_message, created_at, updated_at, finished_at
        FROM tasks
        WHERE id = ?1
        ",
        params![id],
        task_from_row,
    )
    .optional()
    .map_err(Into::into)
}

pub fn mark_task_running(conn: &Connection, id: &str) -> AppResult<()> {
    let affected = conn.execute(
        "
        UPDATE tasks
        SET status = 'running', updated_at = ?2
        WHERE id = ?1
        ",
        params![id, now()],
    )?;

    ensure_affected(affected, "任务不存在")
}

pub fn update_task_progress(
    conn: &Connection,
    id: &str,
    completed_count: i64,
    failed_count: i64,
    current_item: Option<String>,
    error_message: Option<String>,
) -> AppResult<()> {
    let completed_count = validate_non_negative(completed_count, "任务完成数")?;
    let failed_count = validate_non_negative(failed_count, "任务失败数")?;
    let affected = conn.execute(
        "
        UPDATE tasks
        SET completed_count = ?2,
            failed_count = ?3,
            current_item = ?4,
            error_message = ?5,
            updated_at = ?6
        WHERE id = ?1
        ",
        params![
            id,
            completed_count,
            failed_count,
            current_item,
            error_message,
            now()
        ],
    )?;

    ensure_affected(affected, "任务不存在")
}

pub fn finish_task(
    conn: &Connection,
    id: &str,
    status: &str,
    error_message: Option<String>,
) -> AppResult<()> {
    let status = require_text(status.to_string(), "任务状态")?;
    let now = now();
    let affected = conn.execute(
        "
        UPDATE tasks
        SET status = ?2,
            current_item = NULL,
            error_message = ?3,
            updated_at = ?4,
            finished_at = ?4
        WHERE id = ?1
        ",
        params![id, status, error_message, now],
    )?;

    ensure_affected(affected, "任务不存在")
}

pub struct ThumbnailCacheRecord<'a> {
    pub image_id: &'a str,
    pub source_mtime: &'a str,
    pub source_size_bytes: i64,
    pub width: i64,
    pub height: i64,
    pub format: &'a str,
    pub cache_path: &'a str,
    pub status: &'a str,
}

pub fn upsert_thumbnail_cache_record(
    conn: &Connection,
    record: ThumbnailCacheRecord<'_>,
) -> AppResult<()> {
    let id = Uuid::new_v4().to_string();
    let now = now();

    conn.execute(
        "
        INSERT INTO thumbnail_cache (
          id, image_id, source_mtime, source_size_bytes, width, height,
          format, cache_path, status, error_message, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10)
        ON CONFLICT(image_id, source_mtime, source_size_bytes, width, height, format)
        DO UPDATE SET
          cache_path = excluded.cache_path,
          status = excluded.status,
          error_message = NULL,
          updated_at = excluded.updated_at
        ",
        params![
            id,
            record.image_id,
            record.source_mtime,
            record.source_size_bytes,
            record.width,
            record.height,
            record.format,
            record.cache_path,
            record.status,
            now
        ],
    )?;

    Ok(())
}

pub fn clear_thumbnail_cache_records(conn: &Connection) -> AppResult<()> {
    conn.execute("DELETE FROM thumbnail_cache", [])?;
    Ok(())
}

fn refresh_collection_stats(conn: &Connection, collection_id: &str) -> AppResult<()> {
    conn.execute(
        "
        UPDATE collections
        SET image_count = (
              SELECT COUNT(*) FROM images WHERE collection_id = ?1
            ),
            total_size_bytes = (
              SELECT COALESCE(SUM(size_bytes), 0) FROM images WHERE collection_id = ?1
            ),
            updated_at = ?2
        WHERE id = ?1
        ",
        params![collection_id, now()],
    )?;

    Ok(())
}

fn ensure_collection_exists(conn: &Connection, id: &str) -> AppResult<()> {
    let exists = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM collections WHERE id = ?1 AND deleted_at IS NULL)",
        params![id],
        |row| row.get::<_, i64>(0),
    )?;

    if exists == 1 {
        return Ok(());
    }

    Err(AppError::new("not_found", "合集不存在"))
}

fn normalize_collection_cover(
    conn: &Connection,
    collection_id: &str,
    cover_image_id: String,
) -> AppResult<Option<String>> {
    let cover_image_id = cover_image_id.trim().to_string();
    if cover_image_id.is_empty() {
        return Ok(None);
    }

    let belongs_to_collection = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM images WHERE id = ?1 AND collection_id = ?2)",
        params![cover_image_id, collection_id],
        |row| row.get::<_, i64>(0),
    )?;

    if belongs_to_collection == 1 {
        Ok(Some(cover_image_id))
    } else {
        Err(AppError::new("validation_error", "封面图片不属于当前合集"))
    }
}

fn sync_favorite(
    conn: &Connection,
    target_type: &str,
    target_id: &str,
    is_favorite: bool,
    now: &str,
) -> AppResult<()> {
    if is_favorite {
        conn.execute(
            "
            INSERT INTO favorites (id, target_type, target_id, favorited_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(target_type, target_id)
            DO UPDATE SET favorited_at = excluded.favorited_at
            ",
            params![Uuid::new_v4().to_string(), target_type, target_id, now],
        )?;
    } else {
        conn.execute(
            "DELETE FROM favorites WHERE target_type = ?1 AND target_id = ?2",
            params![target_type, target_id],
        )?;
    }

    Ok(())
}

fn get_collection_required(conn: &Connection, id: &str) -> AppResult<CollectionDto> {
    get_collection(conn, id)?.ok_or_else(|| AppError::new("not_found", "合集不存在"))
}

fn get_image_required(conn: &Connection, id: &str) -> AppResult<ImageDto> {
    get_image(conn, id)?.ok_or_else(|| AppError::new("not_found", "图片不存在"))
}

fn get_tag_required(conn: &Connection, id: &str) -> AppResult<TagDto> {
    get_tag(conn, id)?.ok_or_else(|| AppError::new("not_found", "标签不存在"))
}

fn ensure_affected(affected: usize, message: &str) -> AppResult<()> {
    if affected == 0 {
        return Err(AppError::new("not_found", message));
    }

    Ok(())
}

fn collection_from_row(row: &Row<'_>) -> rusqlite::Result<CollectionDto> {
    Ok(CollectionDto {
        id: row.get("id")?,
        path: row.get("path")?,
        name: row.get("name")?,
        cover_image_id: row.get("cover_image_id")?,
        description: row.get("description")?,
        rating: row.get("rating")?,
        is_favorite: row.get::<_, i64>("is_favorite")? == 1,
        image_count: row.get("image_count")?,
        total_size_bytes: row.get("total_size_bytes")?,
        created_at: row.get("created_at")?,
        imported_at: row.get("imported_at")?,
        updated_at: row.get("updated_at")?,
        last_viewed_at: row.get("last_viewed_at")?,
        view_count: row.get("view_count")?,
    })
}

fn image_from_row(row: &Row<'_>) -> rusqlite::Result<ImageDto> {
    Ok(ImageDto {
        id: row.get("id")?,
        collection_id: row.get("collection_id")?,
        path: row.get("path")?,
        file_name: row.get("file_name")?,
        extension: row.get("extension")?,
        format: row.get("format")?,
        size_bytes: row.get("size_bytes")?,
        width: row.get("width")?,
        height: row.get("height")?,
        created_at: row.get("created_at")?,
        modified_at: row.get("modified_at")?,
        imported_at: row.get("imported_at")?,
        updated_at: row.get("updated_at")?,
        sha256: row.get("sha256")?,
        phash: row.get("phash")?,
        rating: row.get("rating")?,
        is_favorite: row.get::<_, i64>("is_favorite")? == 1,
        is_missing: row.get::<_, i64>("is_missing")? == 1,
        last_viewed_at: row.get("last_viewed_at")?,
        view_count: row.get("view_count")?,
    })
}

fn tag_from_row(row: &Row<'_>) -> rusqlite::Result<TagDto> {
    Ok(TagDto {
        id: row.get("id")?,
        name: row.get("name")?,
        color: row.get("color")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

fn setting_from_row(row: &Row<'_>) -> rusqlite::Result<SettingDto> {
    Ok(SettingDto {
        key: row.get("key")?,
        value: row.get("value")?,
        updated_at: row.get("updated_at")?,
    })
}

fn task_from_row(row: &Row<'_>) -> rusqlite::Result<TaskDto> {
    Ok(TaskDto {
        id: row.get("id")?,
        kind: row.get("kind")?,
        status: row.get("status")?,
        total_count: row.get("total_count")?,
        completed_count: row.get("completed_count")?,
        failed_count: row.get("failed_count")?,
        current_item: row.get("current_item")?,
        error_message: row.get("error_message")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        finished_at: row.get("finished_at")?,
    })
}

fn collect_rows<T, I>(rows: I) -> AppResult<Vec<T>>
where
    I: IntoIterator<Item = rusqlite::Result<T>>,
{
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

fn default_collection_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(path)
        .to_string()
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn system_time_to_string(value: Option<SystemTime>) -> Option<String> {
    value.map(|value| DateTime::<Utc>::from(value).to_rfc3339())
}

fn default_file_name(path: &str) -> AppResult<String> {
    Path::new(path)
        .file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| AppError::new("validation_error", "图片路径缺少文件名"))
}

fn default_extension(path: &str) -> AppResult<String> {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .ok_or_else(|| AppError::new("validation_error", "图片路径缺少扩展名"))?;

    normalize_extension(extension.to_string())
}

fn normalize_extension(value: String) -> AppResult<String> {
    let value = require_text(value, "扩展名")?;
    Ok(value.trim_start_matches('.').to_ascii_lowercase())
}

fn require_text(value: String, label: &str) -> AppResult<String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(AppError::new(
            "validation_error",
            format!("{label}不能为空"),
        ));
    }

    Ok(value)
}

fn validate_rating(value: i64) -> AppResult<i64> {
    if !(0..=5).contains(&value) {
        return Err(AppError::new("validation_error", "评分必须在 0 到 5 之间"));
    }

    Ok(value)
}

fn validate_non_negative(value: i64, label: &str) -> AppResult<i64> {
    if value < 0 {
        return Err(AppError::new(
            "validation_error",
            format!("{label}不能为负数"),
        ));
    }

    Ok(value)
}

fn validate_optional_dimension(value: Option<i64>, label: &str) -> AppResult<Option<i64>> {
    match value {
        Some(value) if value <= 0 => Err(AppError::new(
            "validation_error",
            format!("{label}必须大于 0"),
        )),
        value => Ok(value),
    }
}

fn validate_limit(value: Option<i64>) -> AppResult<i64> {
    let limit = value.unwrap_or(DEFAULT_PAGE_LIMIT);
    if !(1..=MAX_PAGE_LIMIT).contains(&limit) {
        return Err(AppError::new(
            "validation_error",
            format!("分页大小必须在 1 到 {MAX_PAGE_LIMIT} 之间"),
        ));
    }

    Ok(limit)
}

fn validate_offset(value: Option<i64>) -> AppResult<i64> {
    validate_non_negative(value.unwrap_or(0), "分页偏移量")
}

fn validate_color(value: String) -> AppResult<String> {
    let value = require_text(value, "标签颜色")?;
    let valid = value.len() == 7
        && value.starts_with('#')
        && value.chars().skip(1).all(|value| value.is_ascii_hexdigit());

    if !valid {
        return Err(AppError::new(
            "validation_error",
            "标签颜色必须是 #RRGGBB 格式",
        ));
    }

    Ok(value)
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use image::{Rgb, RgbImage};
    use std::{fs, path::PathBuf};

    fn temp_database() -> (PathBuf, Connection) {
        let path = std::env::temp_dir().join(format!("photoview-crud-{}.sqlite", Uuid::new_v4()));
        let conn = db::open_database(&path).expect("database should initialize");
        (path, conn)
    }

    fn temp_directory(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("photoview-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).expect("test directory should be created");
        path
    }

    #[test]
    fn collection_and_image_crud_round_trip() {
        let (path, conn) = temp_database();

        let collection = create_collection(
            &conn,
            CreateCollectionRequest {
                path: "/tmp/photos".to_string(),
                name: Some("Photos".to_string()),
                description: Some("Local folder".to_string()),
                rating: Some(3),
            },
        )
        .expect("collection should be created");

        assert_eq!(collection.name, "Photos");
        assert_eq!(list_collections(&conn).unwrap().len(), 1);

        let updated = update_collection(
            &conn,
            UpdateCollectionRequest {
                id: collection.id.clone(),
                name: Some("Archive".to_string()),
                description: None,
                rating: Some(4),
                is_favorite: Some(true),
                cover_image_id: None,
            },
        )
        .expect("collection should be updated");

        assert_eq!(updated.name, "Archive");
        assert!(updated.is_favorite);
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM favorites WHERE target_type = 'collection' AND target_id = ?1",
                params![collection.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );

        let image = create_image(
            &conn,
            CreateImageRequest {
                collection_id: collection.id.clone(),
                path: "/tmp/photos/a.jpg".to_string(),
                file_name: None,
                extension: None,
                format: None,
                size_bytes: Some(42),
                width: Some(640),
                height: Some(480),
                created_at: None,
                modified_at: None,
                sha256: Some("abc".to_string()),
            },
        )
        .expect("image should be created");

        assert_eq!(image.file_name, "a.jpg");
        assert_eq!(image.extension, "jpg");

        let updated = update_collection(
            &conn,
            UpdateCollectionRequest {
                id: collection.id.clone(),
                name: None,
                description: Some("Updated description".to_string()),
                rating: None,
                is_favorite: None,
                cover_image_id: Some(image.id.clone()),
            },
        )
        .expect("collection cover should update");
        assert_eq!(updated.description, "Updated description");
        assert_eq!(updated.cover_image_id, Some(image.id.clone()));

        let viewed = mark_collection_viewed(&conn, &collection.id)
            .expect("collection view should be tracked");
        assert_eq!(viewed.view_count, 1);
        assert!(viewed.last_viewed_at.is_some());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM history WHERE target_type = 'collection' AND target_id = ?1",
                params![collection.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            1
        );

        let collection = get_collection_required(&conn, &collection.id).unwrap();
        assert_eq!(collection.image_count, 1);
        assert_eq!(collection.total_size_bytes, 42);

        let images = list_images(
            &conn,
            ListImagesRequest {
                collection_id: Some(collection.id.clone()),
                limit: Some(20),
                offset: Some(0),
            },
        )
        .unwrap();
        assert_eq!(images.len(), 1);

        let image = update_image(
            &conn,
            UpdateImageRequest {
                id: image.id.clone(),
                file_name: Some("renamed.jpg".to_string()),
                width: None,
                height: None,
                sha256: None,
                phash: Some("phash".to_string()),
                rating: Some(5),
                is_favorite: Some(true),
                is_missing: Some(false),
            },
        )
        .expect("image should be updated");

        assert_eq!(image.file_name, "renamed.jpg");
        assert_eq!(image.rating, 5);
        assert!(image.is_favorite);

        delete_image_record(&conn, &image.id).expect("image record should be deleted");
        let collection = get_collection_required(&conn, &collection.id).unwrap();
        assert_eq!(collection.image_count, 0);
        assert_eq!(collection.total_size_bytes, 0);

        delete_collection_record(&conn, &collection.id)
            .expect("collection record should be deleted");
        assert!(get_collection(&conn, &collection.id).unwrap().is_none());
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM favorites WHERE target_type = 'collection' AND target_id = ?1",
                params![collection.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );
        assert_eq!(
            conn.query_row(
                "SELECT COUNT(*) FROM history WHERE target_type = 'collection' AND target_id = ?1",
                params![collection.id],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
            0
        );

        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn tag_and_setting_crud_round_trip() {
        let (path, conn) = temp_database();

        let tag = create_tag(
            &conn,
            CreateTagRequest {
                name: "Travel".to_string(),
                color: None,
            },
        )
        .expect("tag should be created");

        assert_eq!(tag.color, DEFAULT_TAG_COLOR);

        let tag = update_tag(
            &conn,
            UpdateTagRequest {
                id: tag.id.clone(),
                name: Some("Trips".to_string()),
                color: Some("#12aB34".to_string()),
            },
        )
        .expect("tag should be updated");

        assert_eq!(tag.name, "Trips");
        assert_eq!(list_tags(&conn).unwrap().len(), 1);

        let setting = update_setting(
            &conn,
            UpdateSettingRequest {
                key: "thumbnail_size".to_string(),
                value: "256".to_string(),
            },
        )
        .expect("setting should be saved");

        assert_eq!(setting.value, "256");
        assert!(get_setting(&conn, "thumbnail_size").unwrap().is_some());

        delete_tag(&conn, &tag.id).expect("tag should be deleted");
        assert!(get_tag(&conn, &tag.id).unwrap().is_none());

        drop(conn);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn import_collection_scans_images_and_updates_existing_records() {
        let (database_path, mut conn) = temp_database();
        let import_dir = temp_directory("import");
        let image_path = import_dir.join("first.png");
        let broken_path = import_dir.join("broken.jpg");
        write_png(&image_path, 9, 7);
        fs::write(&broken_path, b"not an image").expect("broken fixture should be written");

        let first = import_collection(
            &mut conn,
            ImportCollectionRequest {
                path: import_dir.to_string_lossy().into_owned(),
                name: Some("Import".to_string()),
            },
        )
        .expect("collection should import");

        assert_eq!(first.collection.name, "Import");
        assert_eq!(first.scanned_count, 1);
        assert_eq!(first.inserted_count, 1);
        assert_eq!(first.updated_count, 0);
        assert_eq!(first.error_count, 1);
        assert_eq!(first.collection.image_count, 1);

        let second = import_collection(
            &mut conn,
            ImportCollectionRequest {
                path: import_dir.to_string_lossy().into_owned(),
                name: None,
            },
        )
        .expect("existing collection should incrementally update");

        assert_eq!(second.inserted_count, 0);
        assert_eq!(second.updated_count, 1);
        assert_eq!(second.collection.image_count, 1);
        assert_eq!(
            list_images(
                &conn,
                ListImagesRequest {
                    collection_id: Some(second.collection.id),
                    limit: None,
                    offset: None,
                }
            )
            .unwrap()
            .len(),
            1
        );

        drop(conn);
        let _ = fs::remove_file(database_path);
        let _ = fs::remove_dir_all(import_dir);
    }

    fn write_png(path: &Path, width: u32, height: u32) {
        let image = RgbImage::from_pixel(width, height, Rgb([8, 16, 32]));
        image.save(path).expect("png fixture should be saved");
    }
}
