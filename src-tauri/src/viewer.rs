use crate::errors::{AppError, AppResult};
use image::{DynamicImage, GenericImageView, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const VIEWER_METADATA_VERSION: u32 = 1;
const MAX_VIEWER_SOURCE_PIXELS: u64 = 150_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewerImageRequest {
    pub source_path: PathBuf,
    pub cache_root: PathBuf,
    pub image_id: String,
    pub source_size_bytes: u64,
    pub source_mtime: String,
    pub max_side: u32,
}

impl ViewerImageRequest {
    pub fn new(
        source_path: impl Into<PathBuf>,
        cache_root: impl Into<PathBuf>,
        image_id: impl Into<String>,
        source_size_bytes: u64,
        source_mtime: impl Into<String>,
        max_side: u32,
    ) -> Self {
        Self {
            source_path: source_path.into(),
            cache_root: cache_root.into(),
            image_id: image_id.into(),
            source_size_bytes,
            source_mtime: source_mtime.into(),
            max_side,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerImageKind {
    Source,
    PngPreview,
}

impl ViewerImageKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::PngPreview => "png_preview",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ViewerImageStatus {
    Source,
    Hit,
    Miss,
}

impl ViewerImageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Source => "source",
            Self::Hit => "hit",
            Self::Miss => "miss",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerImageAsset {
    pub asset_path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub kind: ViewerImageKind,
    pub status: ViewerImageStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ViewerCacheMetadata {
    version: u32,
    image_id: String,
    source_size_bytes: u64,
    source_mtime: String,
    max_side: u32,
    width: u32,
    height: u32,
}

impl ViewerCacheMetadata {
    fn matches_request(&self, request: &ViewerImageRequest) -> bool {
        self.version == VIEWER_METADATA_VERSION
            && self.image_id == request.image_id
            && self.source_size_bytes == request.source_size_bytes
            && self.source_mtime == request.source_mtime
            && self.max_side == request.max_side
            && self.width > 0
            && self.height > 0
    }
}

pub fn get_or_create_viewer_image(request: &ViewerImageRequest) -> AppResult<ViewerImageAsset> {
    validate_request(request)?;
    ensure_regular_source_file(&request.source_path)?;

    if should_use_source_asset(&request.source_path) {
        let (width, height) = source_dimensions(&request.source_path).unwrap_or((0, 0));
        return Ok(ViewerImageAsset {
            asset_path: request.source_path.clone(),
            width,
            height,
            format: source_format(&request.source_path),
            kind: ViewerImageKind::Source,
            status: ViewerImageStatus::Source,
        });
    }

    let (source_width, source_height) = image::image_dimensions(&request.source_path)
        .map_err(|error| AppError::new("viewer_decode_error", error.to_string()))?;
    ensure_reasonable_source_size(source_width, source_height)?;

    let cache_path = viewer_cache_path(&request.cache_root, &request.image_id, request.max_side)?;
    let metadata_path = viewer_metadata_path(&cache_path);

    if let Some(metadata) = read_matching_metadata(&cache_path, &metadata_path, request) {
        return Ok(ViewerImageAsset {
            asset_path: cache_path,
            width: metadata.width,
            height: metadata.height,
            format: "png".to_string(),
            kind: ViewerImageKind::PngPreview,
            status: ViewerImageStatus::Hit,
        });
    }

    let image = decode_image(&request.source_path)?;
    let preview = resize_to_fit(image, request.max_side);
    let (width, height) = preview.dimensions();
    write_png_preview(&cache_path, &preview)?;
    write_metadata(
        &metadata_path,
        &ViewerCacheMetadata {
            version: VIEWER_METADATA_VERSION,
            image_id: request.image_id.clone(),
            source_size_bytes: request.source_size_bytes,
            source_mtime: request.source_mtime.clone(),
            max_side: request.max_side,
            width,
            height,
        },
    )?;

    Ok(ViewerImageAsset {
        asset_path: cache_path,
        width,
        height,
        format: "png".to_string(),
        kind: ViewerImageKind::PngPreview,
        status: ViewerImageStatus::Miss,
    })
}

fn viewer_cache_path(
    cache_root: impl AsRef<Path>,
    image_id: &str,
    max_side: u32,
) -> AppResult<PathBuf> {
    validate_image_id(image_id)?;
    Ok(cache_root
        .as_ref()
        .join("viewer")
        .join(cache_bucket(image_id))
        .join(image_id)
        .join(format!("{max_side}.png")))
}

fn viewer_metadata_path(cache_path: impl AsRef<Path>) -> PathBuf {
    let mut path = cache_path.as_ref().as_os_str().to_os_string();
    path.push(".json");
    PathBuf::from(path)
}

fn validate_request(request: &ViewerImageRequest) -> AppResult<()> {
    if request.max_side == 0 {
        return Err(AppError::new(
            "validation_error",
            "查看器预览尺寸必须大于 0",
        ));
    }
    validate_image_id(&request.image_id)
}

fn validate_image_id(image_id: &str) -> AppResult<()> {
    if image_id.is_empty()
        || image_id.trim() != image_id
        || !image_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(AppError::new(
            "validation_error",
            "图片 ID 只能包含 ASCII 字母、数字、连字符和下划线",
        ));
    }

    Ok(())
}

fn should_use_source_asset(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| extension.to_ascii_lowercase())
            .as_deref(),
        Some("avif" | "gif" | "svg")
    )
}

fn source_format(path: &Path) -> String {
    path.extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("source")
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn source_dimensions(path: &Path) -> AppResult<(u32, u32)> {
    image::image_dimensions(path)
        .map_err(|error| AppError::new("viewer_decode_error", error.to_string()))
}

fn ensure_regular_source_file(source_path: &Path) -> AppResult<()> {
    let metadata = fs::symlink_metadata(source_path)?;
    if metadata.file_type().is_symlink() || !metadata.file_type().is_file() {
        return Err(AppError::new(
            "validation_error",
            "查看器只会读取普通图片文件",
        ));
    }

    Ok(())
}

fn ensure_reasonable_source_size(width: u32, height: u32) -> AppResult<()> {
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_VIEWER_SOURCE_PIXELS {
        return Err(AppError::new(
            "viewer_source_too_large",
            format!("图片像素数 {pixels} 超出查看器安全限制"),
        ));
    }

    Ok(())
}

fn read_matching_metadata(
    cache_path: &Path,
    metadata_path: &Path,
    request: &ViewerImageRequest,
) -> Option<ViewerCacheMetadata> {
    if !cache_path.is_file() || !metadata_path.is_file() {
        return None;
    }

    let bytes = fs::read(metadata_path).ok()?;
    let metadata = serde_json::from_slice::<ViewerCacheMetadata>(&bytes).ok()?;
    metadata.matches_request(request).then_some(metadata)
}

fn decode_image(source_path: &Path) -> AppResult<DynamicImage> {
    let reader = ImageReader::open(source_path)?;
    let reader = reader
        .with_guessed_format()
        .map_err(|error| AppError::new("viewer_decode_error", error.to_string()))?;
    reader
        .decode()
        .map_err(|error| AppError::new("viewer_decode_error", error.to_string()))
}

fn resize_to_fit(image: DynamicImage, max_side: u32) -> DynamicImage {
    let (width, height) = image.dimensions();
    let (target_width, target_height) = scaled_dimensions(width, height, max_side);

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

fn scaled_dimensions(width: u32, height: u32, max_side: u32) -> (u32, u32) {
    let longest_side = width.max(height);
    if longest_side <= max_side {
        return (width, height);
    }

    let scale = max_side as f64 / longest_side as f64;
    let target_width = ((width as f64 * scale).round() as u32).max(1);
    let target_height = ((height as f64 * scale).round() as u32).max(1);
    (target_width, target_height)
}

fn write_png_preview(cache_path: &Path, image: &DynamicImage) -> AppResult<()> {
    let parent = cache_path
        .parent()
        .ok_or_else(|| AppError::internal("viewer cache path has no parent"))?;
    fs::create_dir_all(parent)?;

    let temp_path = temporary_path_for(cache_path);
    let write_result = (|| {
        let file = fs::File::create(&temp_path)?;
        let mut writer = BufWriter::new(file);
        image
            .write_to(&mut writer, ImageFormat::Png)
            .map_err(|error| AppError::new("viewer_encode_error", error.to_string()))?;
        writer.flush()?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_file(&temp_path, cache_path)
}

fn write_metadata(metadata_path: &Path, metadata: &ViewerCacheMetadata) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(metadata)
        .map_err(|error| AppError::new("viewer_metadata_error", error.to_string()))?;
    let temp_path = temporary_path_for(metadata_path);
    let write_result = (|| {
        let mut file = fs::File::create(&temp_path)?;
        file.write_all(&bytes)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    replace_file(&temp_path, metadata_path)
}

fn replace_file(temp_path: &Path, target_path: &Path) -> AppResult<()> {
    if target_path.exists() {
        fs::remove_file(target_path)?;
    }

    fs::rename(temp_path, target_path)?;
    Ok(())
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

fn cache_bucket(image_id: &str) -> String {
    let mut bucket = image_id.chars().take(2).collect::<String>();
    while bucket.len() < 2 {
        bucket.push('_');
    }
    bucket
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgb, RgbImage, Rgba, RgbaImage};

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
                "photoview_viewer_{name}_{}_{}",
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
    fn generates_png_preview_for_raster_formats() {
        let cases = [
            ("sample.jpg", ImageFormat::Jpeg),
            ("sample.png", ImageFormat::Png),
            ("sample.bmp", ImageFormat::Bmp),
            ("sample.ico", ImageFormat::Ico),
            ("sample.tiff", ImageFormat::Tiff),
            ("sample.webp", ImageFormat::WebP),
        ];

        for (index, (file_name, format)) in cases.into_iter().enumerate() {
            let directory = TestDirectory::new(file_name);
            let source_path = directory.join(file_name);
            write_image(&source_path, format);
            let request = ViewerImageRequest::new(
                &source_path,
                directory.join("cache"),
                format!("image-{index}"),
                fs::metadata(&source_path)
                    .expect("source metadata should read")
                    .len(),
                "mtime",
                24,
            );

            let first =
                get_or_create_viewer_image(&request).expect("viewer preview should generate");
            let second = get_or_create_viewer_image(&request).expect("viewer preview should hit");

            assert_eq!(first.kind, ViewerImageKind::PngPreview);
            assert_eq!(first.status, ViewerImageStatus::Miss);
            assert_eq!(second.status, ViewerImageStatus::Hit);
            assert_eq!(first.asset_path, second.asset_path);
            assert!(first.asset_path.is_file());
            assert!(first.width <= 24 || first.height <= 24);
            assert_eq!(first.format, "png");
        }
    }

    #[test]
    fn keeps_avif_gif_and_svg_as_source_assets() {
        let directory = TestDirectory::new("source-assets");
        let avif_path = directory.join("source.avif");
        let gif_path = directory.join("animated.gif");
        let svg_path = directory.join("vector.svg");
        write_image(&avif_path, ImageFormat::Avif);
        write_image(&gif_path, ImageFormat::Gif);
        fs::write(
            &svg_path,
            r#"<svg width="10" height="20" xmlns="http://www.w3.org/2000/svg"></svg>"#,
        )
        .expect("svg fixture should be written");

        for (index, source_path) in [&avif_path, &gif_path, &svg_path].into_iter().enumerate() {
            let request = ViewerImageRequest::new(
                source_path,
                directory.join("cache"),
                format!("source-{index}"),
                fs::metadata(source_path)
                    .expect("source metadata should read")
                    .len(),
                "mtime",
                24,
            );
            let asset =
                get_or_create_viewer_image(&request).expect("source asset should be returned");

            assert_eq!(asset.kind, ViewerImageKind::Source);
            assert_eq!(asset.status, ViewerImageStatus::Source);
            assert_eq!(asset.asset_path, *source_path);
        }
    }

    fn write_image(path: &Path, format: ImageFormat) {
        if format == ImageFormat::Ico {
            let image = RgbaImage::from_pixel(32, 16, Rgba([12, 34, 56, 255]));
            image
                .save_with_format(path, format)
                .expect("image fixture should be saved");
            return;
        }

        let image = RgbImage::from_pixel(32, 16, Rgb([12, 34, 56]));
        image
            .save_with_format(path, format)
            .expect("image fixture should be saved");
    }
}
