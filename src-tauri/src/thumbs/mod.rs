use chrono::{DateTime, Utc};
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    error::Error,
    fmt, fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const CACHE_METADATA_VERSION: u32 = 1;
const MAX_SOURCE_PIXELS: u64 = 100_000_000;

pub type ThumbnailResultValue<T> = Result<T, ThumbnailError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbnailRequest {
    pub source_path: PathBuf,
    pub cache_root: PathBuf,
    pub image_id: String,
    pub source_size_bytes: u64,
    pub source_mtime: String,
    pub target_size: u32,
    pub format: ThumbnailOutputFormat,
}

impl ThumbnailRequest {
    pub fn new(
        source_path: impl Into<PathBuf>,
        cache_root: impl Into<PathBuf>,
        image_id: impl Into<String>,
        source_size_bytes: u64,
        source_mtime: impl Into<String>,
        target_size: u32,
    ) -> Self {
        Self {
            source_path: source_path.into(),
            cache_root: cache_root.into(),
            image_id: image_id.into(),
            source_size_bytes,
            source_mtime: source_mtime.into(),
            target_size,
            format: ThumbnailOutputFormat::Webp,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedThumbnail {
    pub cache_path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub status: ThumbnailCacheStatus,
    pub source_size_bytes: u64,
    pub source_mtime: String,
    pub target_size: u32,
    pub format: ThumbnailOutputFormat,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailCacheStatus {
    Hit,
    Miss,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailOutputFormat {
    Webp,
}

impl ThumbnailOutputFormat {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Webp => "webp",
        }
    }

    pub fn extension(self) -> &'static str {
        self.as_str()
    }

    fn image_format(self) -> ImageFormat {
        match self {
            Self::Webp => ImageFormat::WebP,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ThumbnailErrorKind {
    InvalidImageId,
    InvalidTargetSize,
    UnsupportedSourceFormat,
    SourceMetadata,
    SourceNotFile,
    SourceTooLarge,
    Decode,
    CreateCacheDirectory,
    Encode,
    WriteCache,
    WriteCacheMetadata,
    ReadCacheDirectory,
    RemoveCache,
    CacheRootNotDirectory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailError {
    pub kind: ThumbnailErrorKind,
    pub path: Option<PathBuf>,
    pub message: String,
}

impl ThumbnailError {
    fn new(kind: ThumbnailErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            path: None,
            message: message.into(),
        }
    }

    fn with_path(
        kind: ThumbnailErrorKind,
        path: impl AsRef<Path>,
        message: impl fmt::Display,
    ) -> Self {
        Self {
            kind,
            path: Some(path.as_ref().to_path_buf()),
            message: message.to_string(),
        }
    }
}

impl fmt::Display for ThumbnailError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.path {
            Some(path) => write!(
                formatter,
                "{:?} at {}: {}",
                self.kind,
                path.display(),
                self.message
            ),
            None => write!(formatter, "{:?}: {}", self.kind, self.message),
        }
    }
}

impl Error for ThumbnailError {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailSourceMetadata {
    pub source_size_bytes: u64,
    pub source_mtime: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCacheStats {
    pub file_count: u64,
    pub metadata_file_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCacheClearResult {
    pub deleted_file_count: u64,
    pub deleted_dir_count: u64,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CacheMetadata {
    version: u32,
    image_id: String,
    source_size_bytes: u64,
    source_mtime: String,
    target_size: u32,
    width: u32,
    height: u32,
    format: ThumbnailOutputFormat,
}

impl CacheMetadata {
    fn matches_request(&self, request: &ThumbnailRequest) -> bool {
        self.version == CACHE_METADATA_VERSION
            && self.image_id == request.image_id
            && self.source_size_bytes == request.source_size_bytes
            && self.source_mtime == request.source_mtime
            && self.target_size == request.target_size
            && self.format == request.format
            && self.width > 0
            && self.height > 0
    }
}

pub fn get_or_create_thumbnail(
    request: &ThumbnailRequest,
) -> ThumbnailResultValue<GeneratedThumbnail> {
    validate_target_size(request.target_size)?;
    validate_image_id(&request.image_id)?;
    ensure_supported_raster_source(&request.source_path)?;

    let cache_path = thumbnail_cache_path(
        &request.cache_root,
        &request.image_id,
        request.target_size,
        request.format,
    )?;
    let metadata_path = cache_metadata_path(&cache_path);

    if let Some(metadata) = read_matching_cache_metadata(&cache_path, &metadata_path, request) {
        return Ok(GeneratedThumbnail {
            cache_path,
            width: metadata.width,
            height: metadata.height,
            status: ThumbnailCacheStatus::Hit,
            source_size_bytes: metadata.source_size_bytes,
            source_mtime: metadata.source_mtime,
            target_size: metadata.target_size,
            format: metadata.format,
        });
    }

    ensure_regular_source_file(&request.source_path)?;
    let (source_width, source_height) = read_source_dimensions(&request.source_path)?;
    ensure_reasonable_source_size(&request.source_path, source_width, source_height)?;

    let image = decode_image(&request.source_path)?;
    let thumbnail = resize_to_fit(image, request.target_size);
    let (width, height) = thumbnail.dimensions();
    let metadata = CacheMetadata {
        version: CACHE_METADATA_VERSION,
        image_id: request.image_id.clone(),
        source_size_bytes: request.source_size_bytes,
        source_mtime: request.source_mtime.clone(),
        target_size: request.target_size,
        width,
        height,
        format: request.format,
    };

    write_thumbnail_file(&cache_path, &thumbnail, request.format)?;
    write_cache_metadata(&metadata_path, &metadata)?;

    Ok(GeneratedThumbnail {
        cache_path,
        width,
        height,
        status: ThumbnailCacheStatus::Miss,
        source_size_bytes: metadata.source_size_bytes,
        source_mtime: metadata.source_mtime,
        target_size: metadata.target_size,
        format: metadata.format,
    })
}

pub fn thumbnail_cache_path(
    cache_root: impl AsRef<Path>,
    image_id: &str,
    target_size: u32,
    format: ThumbnailOutputFormat,
) -> ThumbnailResultValue<PathBuf> {
    validate_target_size(target_size)?;
    let image_id = validate_image_id(image_id)?;
    let bucket = cache_bucket(image_id);

    Ok(cache_root
        .as_ref()
        .join(bucket)
        .join(image_id)
        .join(format!("{}.{}", target_size, format.extension())))
}

pub fn cache_metadata_path(cache_path: impl AsRef<Path>) -> PathBuf {
    let mut path = cache_path.as_ref().as_os_str().to_os_string();
    path.push(".json");
    PathBuf::from(path)
}

pub fn read_source_metadata(
    source_path: impl AsRef<Path>,
) -> ThumbnailResultValue<ThumbnailSourceMetadata> {
    let source_path = source_path.as_ref();
    let metadata = fs::symlink_metadata(source_path).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::SourceMetadata, source_path, error)
    })?;

    if !metadata.file_type().is_file() {
        return Err(ThumbnailError::with_path(
            ThumbnailErrorKind::SourceNotFile,
            source_path,
            "expected a regular source file",
        ));
    }

    let modified_at = metadata.modified().map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::SourceMetadata, source_path, error)
    })?;

    Ok(ThumbnailSourceMetadata {
        source_size_bytes: metadata.len(),
        source_mtime: system_time_to_rfc3339(modified_at),
    })
}

pub fn collect_thumbnail_cache_stats(
    cache_root: impl AsRef<Path>,
) -> ThumbnailResultValue<ThumbnailCacheStats> {
    let cache_root = cache_root.as_ref();
    if !cache_root.exists() {
        return Ok(ThumbnailCacheStats {
            file_count: 0,
            metadata_file_count: 0,
            total_bytes: 0,
        });
    }

    ensure_cache_root_directory(cache_root)?;
    let mut stats = ThumbnailCacheStats {
        file_count: 0,
        metadata_file_count: 0,
        total_bytes: 0,
    };
    collect_cache_stats_recursive(cache_root, &mut stats)?;
    Ok(stats)
}

pub fn clear_thumbnail_cache(
    cache_root: impl AsRef<Path>,
) -> ThumbnailResultValue<ThumbnailCacheClearResult> {
    let cache_root = cache_root.as_ref();
    if !cache_root.exists() {
        fs::create_dir_all(cache_root).map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::CreateCacheDirectory, cache_root, error)
        })?;
        return Ok(ThumbnailCacheClearResult {
            deleted_file_count: 0,
            deleted_dir_count: 0,
            freed_bytes: 0,
        });
    }

    ensure_cache_root_directory(cache_root)?;
    clear_cache_directory_contents(cache_root)
}

pub fn system_time_to_rfc3339(value: SystemTime) -> String {
    DateTime::<Utc>::from(value).to_rfc3339()
}

fn validate_target_size(target_size: u32) -> ThumbnailResultValue<()> {
    if target_size == 0 {
        return Err(ThumbnailError::new(
            ThumbnailErrorKind::InvalidTargetSize,
            "target size must be greater than zero",
        ));
    }

    Ok(())
}

fn validate_image_id(image_id: &str) -> ThumbnailResultValue<&str> {
    if image_id.is_empty() {
        return Err(ThumbnailError::new(
            ThumbnailErrorKind::InvalidImageId,
            "image id must not be empty",
        ));
    }

    if image_id.trim() != image_id {
        return Err(ThumbnailError::new(
            ThumbnailErrorKind::InvalidImageId,
            "image id must not contain leading or trailing whitespace",
        ));
    }

    if image_id
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        Ok(image_id)
    } else {
        Err(ThumbnailError::new(
            ThumbnailErrorKind::InvalidImageId,
            "image id may only contain ASCII letters, numbers, hyphens, and underscores",
        ))
    }
}

fn cache_bucket(image_id: &str) -> String {
    let mut bucket = image_id.chars().take(2).collect::<String>();
    while bucket.len() < 2 {
        bucket.push('_');
    }
    bucket
}

fn ensure_supported_raster_source(source_path: &Path) -> ThumbnailResultValue<()> {
    match source_path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg" | "png" | "gif" | "bmp" | "ico" | "tif" | "tiff" | "webp" | "avif") => {
            Ok(())
        }
        Some("svg") => Err(ThumbnailError::with_path(
            ThumbnailErrorKind::UnsupportedSourceFormat,
            source_path,
            "svg thumbnails are not generated by this raster thumbnail module",
        )),
        _ => Err(ThumbnailError::with_path(
            ThumbnailErrorKind::UnsupportedSourceFormat,
            source_path,
            "unsupported source image format",
        )),
    }
}

fn read_matching_cache_metadata(
    cache_path: &Path,
    metadata_path: &Path,
    request: &ThumbnailRequest,
) -> Option<CacheMetadata> {
    if !cache_path.is_file() || !metadata_path.is_file() {
        return None;
    }

    let bytes = fs::read(metadata_path).ok()?;
    let metadata = serde_json::from_slice::<CacheMetadata>(&bytes).ok()?;
    metadata.matches_request(request).then_some(metadata)
}

fn ensure_regular_source_file(source_path: &Path) -> ThumbnailResultValue<()> {
    let metadata = fs::symlink_metadata(source_path).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::SourceMetadata, source_path, error)
    })?;

    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(ThumbnailError::with_path(
            ThumbnailErrorKind::SourceNotFile,
            source_path,
            "expected a regular source file and will not follow symlinks",
        ));
    }

    Ok(())
}

fn ensure_cache_root_directory(cache_root: &Path) -> ThumbnailResultValue<()> {
    let metadata = fs::symlink_metadata(cache_root).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, cache_root, error)
    })?;

    if metadata.file_type().is_dir() {
        Ok(())
    } else {
        Err(ThumbnailError::with_path(
            ThumbnailErrorKind::CacheRootNotDirectory,
            cache_root,
            "thumbnail cache root must be a directory",
        ))
    }
}

fn collect_cache_stats_recursive(
    directory: &Path,
    stats: &mut ThumbnailCacheStats,
) -> ThumbnailResultValue<()> {
    let entries = fs::read_dir(directory).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, directory, error)
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, directory, error)
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, &path, error)
        })?;

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            collect_cache_stats_recursive(&path, stats)?;
            continue;
        }

        if file_type.is_file() {
            let metadata = entry.metadata().map_err(|error| {
                ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, &path, error)
            })?;
            stats.file_count += 1;
            stats.total_bytes += metadata.len();
            if path.extension().and_then(|value| value.to_str()) == Some("json") {
                stats.metadata_file_count += 1;
            }
        }
    }

    Ok(())
}

fn clear_cache_directory_contents(
    directory: &Path,
) -> ThumbnailResultValue<ThumbnailCacheClearResult> {
    let mut result = ThumbnailCacheClearResult {
        deleted_file_count: 0,
        deleted_dir_count: 0,
        freed_bytes: 0,
    };
    let entries = fs::read_dir(directory).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, directory, error)
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, directory, error)
        })?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, &path, error)
        })?;

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            let child = clear_cache_directory_contents(&path)?;
            result.deleted_file_count += child.deleted_file_count;
            result.deleted_dir_count += child.deleted_dir_count;
            result.freed_bytes += child.freed_bytes;
            fs::remove_dir(&path).map_err(|error| {
                ThumbnailError::with_path(ThumbnailErrorKind::RemoveCache, &path, error)
            })?;
            result.deleted_dir_count += 1;
            continue;
        }

        if file_type.is_file() {
            let size = entry
                .metadata()
                .map_err(|error| {
                    ThumbnailError::with_path(ThumbnailErrorKind::ReadCacheDirectory, &path, error)
                })?
                .len();
            fs::remove_file(&path).map_err(|error| {
                ThumbnailError::with_path(ThumbnailErrorKind::RemoveCache, &path, error)
            })?;
            result.deleted_file_count += 1;
            result.freed_bytes += size;
        }
    }

    Ok(result)
}

fn read_source_dimensions(source_path: &Path) -> ThumbnailResultValue<(u32, u32)> {
    image::image_dimensions(source_path)
        .map_err(|error| ThumbnailError::with_path(ThumbnailErrorKind::Decode, source_path, error))
}

fn ensure_reasonable_source_size(
    source_path: &Path,
    width: u32,
    height: u32,
) -> ThumbnailResultValue<()> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_SOURCE_PIXELS {
        return Err(ThumbnailError::with_path(
            ThumbnailErrorKind::SourceTooLarge,
            source_path,
            format!(
                "source image is {}x{} pixels, exceeding the {} pixel safety limit",
                width, height, MAX_SOURCE_PIXELS
            ),
        ));
    }

    Ok(())
}

fn decode_image(source_path: &Path) -> ThumbnailResultValue<DynamicImage> {
    let reader = ImageReader::open(source_path).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::SourceMetadata, source_path, error)
    })?;
    let reader = reader.with_guessed_format().map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::Decode, source_path, error)
    })?;

    reader
        .decode()
        .map_err(|error| ThumbnailError::with_path(ThumbnailErrorKind::Decode, source_path, error))
}

fn resize_to_fit(image: DynamicImage, target_size: u32) -> DynamicImage {
    let (width, height) = image.dimensions();
    let (target_width, target_height) = scaled_dimensions(width, height, target_size);

    if (width, height) == (target_width, target_height) {
        image
    } else {
        image.resize_exact(
            target_width,
            target_height,
            image::imageops::FilterType::Lanczos3,
        )
    }
}

fn scaled_dimensions(width: u32, height: u32, target_size: u32) -> (u32, u32) {
    let max_side = width.max(height);
    if max_side <= target_size {
        return (width, height);
    }

    let scale = target_size as f64 / max_side as f64;
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    (target_width, target_height)
}

fn write_thumbnail_file(
    cache_path: &Path,
    image: &DynamicImage,
    format: ThumbnailOutputFormat,
) -> ThumbnailResultValue<()> {
    let parent = cache_path.parent().ok_or_else(|| {
        ThumbnailError::with_path(
            ThumbnailErrorKind::CreateCacheDirectory,
            cache_path,
            "cache path has no parent directory",
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::CreateCacheDirectory, parent, error)
    })?;

    let temp_path = temporary_path_for(cache_path);
    let write_result = (|| {
        let file = fs::File::create(&temp_path).map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::WriteCache, &temp_path, error)
        })?;
        let mut writer = BufWriter::new(file);
        image
            .write_to(&mut writer, format.image_format())
            .map_err(|error| {
                ThumbnailError::with_path(ThumbnailErrorKind::Encode, &temp_path, error)
            })?;
        writer.flush().map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::WriteCache, &temp_path, error)
        })?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_file(&temp_path, cache_path, ThumbnailErrorKind::WriteCache)
}

fn write_cache_metadata(
    metadata_path: &Path,
    metadata: &CacheMetadata,
) -> ThumbnailResultValue<()> {
    let bytes = serde_json::to_vec_pretty(metadata).map_err(|error| {
        ThumbnailError::with_path(ThumbnailErrorKind::WriteCacheMetadata, metadata_path, error)
    })?;
    let temp_path = temporary_path_for(metadata_path);
    let write_result = (|| {
        let mut file = fs::File::create(&temp_path).map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::WriteCacheMetadata, &temp_path, error)
        })?;
        file.write_all(&bytes).map_err(|error| {
            ThumbnailError::with_path(ThumbnailErrorKind::WriteCacheMetadata, &temp_path, error)
        })
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_file(
        &temp_path,
        metadata_path,
        ThumbnailErrorKind::WriteCacheMetadata,
    )
}

fn replace_file(
    temp_path: &Path,
    target_path: &Path,
    kind: ThumbnailErrorKind,
) -> ThumbnailResultValue<()> {
    if target_path.exists() {
        fs::remove_file(target_path)
            .map_err(|error| ThumbnailError::with_path(kind, target_path, error))?;
    }

    fs::rename(temp_path, target_path)
        .map_err(|error| ThumbnailError::with_path(kind, target_path, error))
}

fn temporary_path_for(path: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let mut temp_path = path.as_os_str().to_os_string();
    temp_path.push(format!(".{}.{}.tmp", std::process::id(), nanos));
    PathBuf::from(temp_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgb, RgbImage};

    struct TestDirectory {
        path: PathBuf,
    }

    impl TestDirectory {
        fn new(name: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system time should be after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "photoview_thumbs_{name}_{}_{}",
                std::process::id(),
                nanos
            ));

            fs::create_dir_all(&path).expect("test directory should be created");
            Self { path }
        }

        fn join(&self, path: impl AsRef<Path>) -> PathBuf {
            self.path.join(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn cache_path_is_stable_and_bucketed() {
        let path = thumbnail_cache_path(
            "/cache-root",
            "ab-image-id",
            192,
            ThumbnailOutputFormat::Webp,
        )
        .expect("cache path should be generated");

        assert_eq!(
            path,
            Path::new("/cache-root")
                .join("ab")
                .join("ab-image-id")
                .join("192.webp")
        );
        assert_eq!(
            cache_metadata_path(&path),
            Path::new("/cache-root")
                .join("ab")
                .join("ab-image-id")
                .join("192.webp.json")
        );
    }

    #[test]
    fn generates_webp_thumbnail_and_reports_miss() {
        let directory = TestDirectory::new("generate");
        let source_path = directory.join("source.png");
        let cache_root = directory.join("cache");
        write_png(&source_path, 400, 200);

        let source = read_source_metadata(&source_path).expect("source metadata should read");
        let request = ThumbnailRequest::new(
            &source_path,
            &cache_root,
            "image-0001",
            source.source_size_bytes,
            source.source_mtime,
            192,
        );

        let result = get_or_create_thumbnail(&request).expect("thumbnail should be generated");

        assert_eq!(result.status, ThumbnailCacheStatus::Miss);
        assert_eq!(result.width, 192);
        assert_eq!(result.height, 96);
        assert_eq!(
            result.cache_path,
            cache_root.join("im").join("image-0001").join("192.webp")
        );
        assert!(result.cache_path.is_file());
        assert!(cache_metadata_path(&result.cache_path).is_file());

        let (decoded_width, decoded_height) =
            image::image_dimensions(&result.cache_path).expect("webp dimensions should decode");
        assert_eq!((decoded_width, decoded_height), (192, 96));
    }

    #[test]
    fn returns_hit_when_cache_metadata_matches() {
        let directory = TestDirectory::new("hit");
        let source_path = directory.join("source.png");
        let cache_root = directory.join("cache");
        write_png(&source_path, 256, 128);

        let source = read_source_metadata(&source_path).expect("source metadata should read");
        let request = ThumbnailRequest::new(
            &source_path,
            &cache_root,
            "image-0002",
            source.source_size_bytes,
            source.source_mtime,
            128,
        );

        let first = get_or_create_thumbnail(&request).expect("thumbnail should be generated");
        let second = get_or_create_thumbnail(&request).expect("thumbnail should hit cache");

        assert_eq!(first.status, ThumbnailCacheStatus::Miss);
        assert_eq!(second.status, ThumbnailCacheStatus::Hit);
        assert_eq!(second.cache_path, first.cache_path);
        assert_eq!((second.width, second.height), (128, 64));
    }

    #[test]
    fn regenerates_when_source_mtime_changes() {
        let directory = TestDirectory::new("stale");
        let source_path = directory.join("source.png");
        let cache_root = directory.join("cache");
        write_png(&source_path, 320, 160);

        let source = read_source_metadata(&source_path).expect("source metadata should read");
        let request = ThumbnailRequest::new(
            &source_path,
            &cache_root,
            "image-0003",
            source.source_size_bytes,
            source.source_mtime,
            160,
        );
        let first = get_or_create_thumbnail(&request).expect("thumbnail should be generated");

        let stale_request = ThumbnailRequest::new(
            &source_path,
            &cache_root,
            "image-0003",
            request.source_size_bytes,
            "2024-01-01T00:00:00Z",
            160,
        );
        let second =
            get_or_create_thumbnail(&stale_request).expect("thumbnail should be regenerated");

        assert_eq!(first.status, ThumbnailCacheStatus::Miss);
        assert_eq!(second.status, ThumbnailCacheStatus::Miss);
        assert_eq!(second.cache_path, first.cache_path);
        assert_eq!(second.source_mtime, "2024-01-01T00:00:00Z");
    }

    #[test]
    fn returns_unsupported_for_svg_without_panicking() {
        let directory = TestDirectory::new("svg");
        let source_path = directory.join("source.svg");
        fs::write(
            &source_path,
            r#"<svg width="10" height="20" xmlns="http://www.w3.org/2000/svg"></svg>"#,
        )
        .expect("svg fixture should be written");

        let request = ThumbnailRequest::new(
            &source_path,
            directory.join("cache"),
            "image-0004",
            1,
            "mtime",
            64,
        );
        let error = get_or_create_thumbnail(&request).expect_err("svg should be unsupported");

        assert_eq!(error.kind, ThumbnailErrorKind::UnsupportedSourceFormat);
    }

    #[test]
    fn returns_decode_error_for_broken_raster_file() {
        let directory = TestDirectory::new("broken");
        let source_path = directory.join("broken.png");
        fs::write(&source_path, b"not a png").expect("broken fixture should be written");

        let source = read_source_metadata(&source_path).expect("source metadata should read");
        let request = ThumbnailRequest::new(
            &source_path,
            directory.join("cache"),
            "image-0005",
            source.source_size_bytes,
            source.source_mtime,
            64,
        );
        let error =
            get_or_create_thumbnail(&request).expect_err("broken image should fail to decode");

        assert_eq!(error.kind, ThumbnailErrorKind::Decode);
    }

    #[test]
    fn rejects_invalid_image_ids_and_sizes() {
        let error =
            thumbnail_cache_path("/cache-root", "../escape", 192, ThumbnailOutputFormat::Webp)
                .expect_err("path traversal should be rejected");
        assert_eq!(error.kind, ThumbnailErrorKind::InvalidImageId);

        let error =
            thumbnail_cache_path("/cache-root", " image ", 192, ThumbnailOutputFormat::Webp)
                .expect_err("whitespace should be rejected");
        assert_eq!(error.kind, ThumbnailErrorKind::InvalidImageId);

        let error = thumbnail_cache_path("/cache-root", "image", 0, ThumbnailOutputFormat::Webp)
            .expect_err("zero target size should be rejected");
        assert_eq!(error.kind, ThumbnailErrorKind::InvalidTargetSize);
    }

    #[test]
    fn reports_and_clears_cache_size() {
        let directory = TestDirectory::new("stats");
        let source_path = directory.join("source.png");
        let cache_root = directory.join("cache");
        write_png(&source_path, 96, 48);

        let source = read_source_metadata(&source_path).expect("source metadata should read");
        let request = ThumbnailRequest::new(
            &source_path,
            &cache_root,
            "image-0006",
            source.source_size_bytes,
            source.source_mtime,
            64,
        );
        let thumbnail = get_or_create_thumbnail(&request).expect("thumbnail should be generated");
        let metadata_path = cache_metadata_path(&thumbnail.cache_path);

        let stats = collect_thumbnail_cache_stats(&cache_root).expect("stats should be collected");
        assert_eq!(stats.file_count, 2);
        assert_eq!(stats.metadata_file_count, 1);
        assert!(stats.total_bytes > 0);

        let cleared = clear_thumbnail_cache(&cache_root).expect("cache should clear");
        assert_eq!(cleared.deleted_file_count, 2);
        assert!(cleared.deleted_dir_count >= 2);
        assert!(cleared.freed_bytes >= stats.total_bytes);
        assert!(!thumbnail.cache_path.exists());
        assert!(!metadata_path.exists());
    }

    fn write_png(path: &Path, width: u32, height: u32) {
        let image = RgbImage::from_pixel(width, height, Rgb([12, 34, 56]));
        image.save(path).expect("png fixture should be saved");
    }
}
