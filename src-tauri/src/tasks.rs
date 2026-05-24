use crate::{
    db::{self, repositories},
    errors::{AppError, AppResult},
    models::ImageDto,
    thumbs::{
        get_or_create_thumbnail, read_source_metadata, ThumbnailCacheStatus, ThumbnailRequest,
    },
};
use std::{path::PathBuf, thread};

pub fn spawn_thumbnail_generation_task(
    task_id: String,
    database_path: PathBuf,
    thumbnails_dir: PathBuf,
    images: Vec<ImageDto>,
    target_size: u32,
) {
    thread::spawn(move || {
        if let Err(error) = run_thumbnail_generation_task(
            &task_id,
            database_path.clone(),
            thumbnails_dir,
            images,
            target_size,
        ) {
            if let Ok(conn) = db::open_database(&database_path) {
                let _ =
                    repositories::finish_task(&conn, &task_id, "failed", Some(error.to_string()));
            }
        }
    });
}

fn run_thumbnail_generation_task(
    task_id: &str,
    database_path: PathBuf,
    thumbnails_dir: PathBuf,
    images: Vec<ImageDto>,
    target_size: u32,
) -> AppResult<()> {
    let conn = db::open_database(&database_path)?;
    repositories::mark_task_running(&conn, task_id)?;

    if images.is_empty() {
        repositories::finish_task(&conn, task_id, "completed", None)?;
        return Ok(());
    }

    let mut completed_count = 0_i64;
    let mut failed_count = 0_i64;
    let mut last_error = None;

    for image in images {
        repositories::update_task_progress(
            &conn,
            task_id,
            completed_count,
            failed_count,
            Some(image.file_name.clone()),
            last_error.clone(),
        )?;

        match generate_thumbnail_for_image(&conn, &thumbnails_dir, &image, target_size) {
            Ok(()) => {}
            Err(error) => {
                failed_count += 1;
                last_error = Some(error.to_string());
            }
        }

        completed_count += 1;
        repositories::update_task_progress(
            &conn,
            task_id,
            completed_count,
            failed_count,
            Some(image.file_name),
            last_error.clone(),
        )?;
    }

    let status = if failed_count > 0 {
        "completed_with_errors"
    } else {
        "completed"
    };
    repositories::finish_task(&conn, task_id, status, last_error)
}

fn generate_thumbnail_for_image(
    conn: &rusqlite::Connection,
    thumbnails_dir: &PathBuf,
    image: &ImageDto,
    target_size: u32,
) -> AppResult<()> {
    if uses_source_thumbnail(&image.path) {
        return Ok(());
    }

    let source = read_source_metadata(&image.path)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;
    let request = ThumbnailRequest::new(
        &image.path,
        thumbnails_dir,
        &image.id,
        source.source_size_bytes,
        source.source_mtime.clone(),
        target_size,
    );
    let thumbnail = get_or_create_thumbnail(&request)
        .map_err(|value| AppError::new("thumbnail_error", value.to_string()))?;
    let cache_path = thumbnail.cache_path.display().to_string();

    repositories::upsert_thumbnail_cache_record(
        conn,
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
}

fn uses_source_thumbnail(path: &str) -> bool {
    matches!(
        std::path::Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("avif" | "svg")
    )
}
