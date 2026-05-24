use std::error::Error;
use std::fmt;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use image::ImageReader;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SupportedImageFormat {
    Jpeg,
    Png,
    Gif,
    Bmp,
    Ico,
    Tiff,
    Webp,
    Avif,
    Svg,
}

impl SupportedImageFormat {
    pub fn from_extension(extension: &str) -> Option<Self> {
        match extension
            .trim_start_matches('.')
            .to_ascii_lowercase()
            .as_str()
        {
            "jpg" | "jpeg" => Some(Self::Jpeg),
            "png" => Some(Self::Png),
            "gif" => Some(Self::Gif),
            "bmp" => Some(Self::Bmp),
            "ico" => Some(Self::Ico),
            "tiff" | "tif" => Some(Self::Tiff),
            "webp" => Some(Self::Webp),
            "avif" => Some(Self::Avif),
            "svg" => Some(Self::Svg),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Jpeg => "jpeg",
            Self::Png => "png",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
            Self::Ico => "ico",
            Self::Tiff => "tiff",
            Self::Webp => "webp",
            Self::Avif => "avif",
            Self::Svg => "svg",
        }
    }

    pub fn is_svg(self) -> bool {
        matches!(self, Self::Svg)
    }

    pub fn skips_rust_dimension_decode(self) -> bool {
        matches!(self, Self::Avif | Self::Svg)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanCandidate {
    pub path: PathBuf,
    pub file_name: String,
    pub extension: String,
    pub format: SupportedImageFormat,
    pub size_bytes: u64,
    pub created_at: Option<SystemTime>,
    pub modified_at: Option<SystemTime>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanReport {
    pub root: PathBuf,
    pub candidates: Vec<ScanCandidate>,
    pub errors: Vec<ScanError>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanError {
    pub path: PathBuf,
    pub kind: ScanErrorKind,
    pub message: String,
}

impl ScanError {
    fn new(path: impl Into<PathBuf>, kind: ScanErrorKind, error: impl fmt::Display) -> Self {
        Self {
            path: path.into(),
            kind,
            message: error.to_string(),
        }
    }
}

impl fmt::Display for ScanError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "{} at {}: {}",
            self.kind,
            self.path.display(),
            self.message
        )
    }
}

impl Error for ScanError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScanErrorKind {
    RootMetadata,
    RootNotDirectory,
    ReadDirectory,
    ReadDirectoryEntry,
    EntryFileType,
    FileMetadata,
    DecodeDimensions,
}

impl fmt::Display for ScanErrorKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::RootMetadata => "root metadata error",
            Self::RootNotDirectory => "root is not a directory",
            Self::ReadDirectory => "read directory error",
            Self::ReadDirectoryEntry => "read directory entry error",
            Self::EntryFileType => "entry file type error",
            Self::FileMetadata => "file metadata error",
            Self::DecodeDimensions => "image dimension decode error",
        })
    }
}

pub fn supported_image_format(path: impl AsRef<Path>) -> Option<SupportedImageFormat> {
    path.as_ref()
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(SupportedImageFormat::from_extension)
}

pub fn is_supported_image_path(path: impl AsRef<Path>) -> bool {
    supported_image_format(path).is_some()
}

pub fn scan_directory(root: impl AsRef<Path>) -> Result<ScanReport, ScanError> {
    let root = root.as_ref();
    let root_metadata = fs::symlink_metadata(root)
        .map_err(|error| ScanError::new(root, ScanErrorKind::RootMetadata, error))?;

    if !root_metadata.file_type().is_dir() {
        return Err(ScanError::new(
            root,
            ScanErrorKind::RootNotDirectory,
            "expected a real directory and will not follow symlinks",
        ));
    }

    let mut report = ScanReport {
        root: root.to_path_buf(),
        candidates: Vec::new(),
        errors: Vec::new(),
    };

    scan_directory_into(root, &mut report);
    report
        .candidates
        .sort_by(|left, right| left.path.cmp(&right.path));
    report
        .errors
        .sort_by(|left, right| left.path.cmp(&right.path));

    Ok(report)
}

pub fn scan_file(path: impl AsRef<Path>) -> Result<Option<ScanCandidate>, ScanError> {
    let path = path.as_ref();
    let Some(format) = supported_image_format(path) else {
        return Ok(None);
    };

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| ScanError::new(path, ScanErrorKind::FileMetadata, error))?;
    let file_type = metadata.file_type();

    if file_type.is_symlink() || !file_type.is_file() {
        return Ok(None);
    }

    let (width, height) = if format.skips_rust_dimension_decode() {
        (None, None)
    } else {
        let (width, height) = read_raster_dimensions(path)?;
        (Some(width), Some(height))
    };

    Ok(Some(ScanCandidate {
        path: path.to_path_buf(),
        file_name: path
            .file_name()
            .map(|file_name| file_name.to_string_lossy().into_owned())
            .unwrap_or_default(),
        extension: path
            .extension()
            .map(|extension| extension.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default(),
        format,
        size_bytes: metadata.len(),
        created_at: metadata.created().ok(),
        modified_at: metadata.modified().ok(),
        width,
        height,
    }))
}

fn scan_directory_into(directory: &Path, report: &mut ScanReport) {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) => {
            report.errors.push(ScanError::new(
                directory,
                ScanErrorKind::ReadDirectory,
                error,
            ));
            return;
        }
    };

    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                report.errors.push(ScanError::new(
                    directory,
                    ScanErrorKind::ReadDirectoryEntry,
                    error,
                ));
                continue;
            }
        };

        let path = entry.path();
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                report
                    .errors
                    .push(ScanError::new(&path, ScanErrorKind::EntryFileType, error));
                continue;
            }
        };

        if file_type.is_symlink() {
            continue;
        }

        if file_type.is_dir() {
            scan_directory_into(&path, report);
            continue;
        }

        if !file_type.is_file() || !is_supported_image_path(&path) {
            continue;
        }

        match scan_file(&path) {
            Ok(Some(candidate)) => report.candidates.push(candidate),
            Ok(None) => {}
            Err(error) => report.errors.push(error),
        }
    }
}

fn read_raster_dimensions(path: &Path) -> Result<(u32, u32), ScanError> {
    let reader = ImageReader::open(path)
        .map_err(|error| ScanError::new(path, ScanErrorKind::DecodeDimensions, error))?;

    reader
        .into_dimensions()
        .map_err(|error| ScanError::new(path, ScanErrorKind::DecodeDimensions, error))
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageFormat, Rgb, RgbImage};
    use std::io::Write;
    use std::time::{SystemTime, UNIX_EPOCH};

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
                "photoview_scanner_{name}_{}_{}",
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
    fn recognizes_supported_extensions_case_insensitively() {
        let cases = [
            ("sample.JPG", SupportedImageFormat::Jpeg),
            ("sample.jpeg", SupportedImageFormat::Jpeg),
            ("sample.PNG", SupportedImageFormat::Png),
            ("sample.gif", SupportedImageFormat::Gif),
            ("sample.bmp", SupportedImageFormat::Bmp),
            ("sample.ico", SupportedImageFormat::Ico),
            ("sample.tiff", SupportedImageFormat::Tiff),
            ("sample.TIF", SupportedImageFormat::Tiff),
            ("sample.webp", SupportedImageFormat::Webp),
            ("sample.avif", SupportedImageFormat::Avif),
            ("sample.svg", SupportedImageFormat::Svg),
        ];

        for (file_name, expected) in cases {
            assert_eq!(supported_image_format(file_name), Some(expected));
            assert!(is_supported_image_path(file_name));
        }

        assert_eq!(supported_image_format("sample.txt"), None);
        assert!(!is_supported_image_path("sample"));
    }

    #[test]
    fn scan_file_extracts_png_metadata() {
        let directory = TestDirectory::new("single_file");
        let image_path = directory.join("Nested Name.PNG");
        write_png(&image_path, 3, 2);

        let candidate = scan_file(&image_path)
            .expect("valid png should scan")
            .expect("supported image should produce a candidate");

        assert_eq!(candidate.path, image_path);
        assert_eq!(candidate.file_name, "Nested Name.PNG");
        assert_eq!(candidate.extension, "png");
        assert_eq!(candidate.format, SupportedImageFormat::Png);
        assert!(candidate.size_bytes > 0);
        assert!(candidate.modified_at.is_some());
        assert_eq!(candidate.width, Some(3));
        assert_eq!(candidate.height, Some(2));
    }

    #[test]
    fn scan_file_recognizes_svg_without_decoding_dimensions() {
        let directory = TestDirectory::new("svg_file");
        let svg_path = directory.join("vector.svg");
        fs::write(
            &svg_path,
            r#"<svg width="10" height="20" xmlns="http://www.w3.org/2000/svg"></svg>"#,
        )
        .expect("svg fixture should be written");

        let candidate = scan_file(&svg_path)
            .expect("svg should scan")
            .expect("supported svg should produce a candidate");

        assert_eq!(candidate.format, SupportedImageFormat::Svg);
        assert_eq!(candidate.width, None);
        assert_eq!(candidate.height, None);
    }

    #[test]
    fn scan_file_recognizes_avif_without_decoding_dimensions() {
        let directory = TestDirectory::new("avif_file");
        let avif_path = directory.join("square.avif");
        write_image(&avif_path, ImageFormat::Avif, 16, 16);

        let candidate = scan_file(&avif_path)
            .expect("avif should scan")
            .expect("supported avif should produce a candidate");

        assert_eq!(candidate.format, SupportedImageFormat::Avif);
        assert_eq!(candidate.width, None);
        assert_eq!(candidate.height, None);
    }

    #[test]
    fn scan_directory_collects_candidates_and_decode_errors() {
        let directory = TestDirectory::new("directory");
        let nested = directory.join("nested");
        fs::create_dir_all(&nested).expect("nested fixture directory should be created");

        let good_path = nested.join("good.png");
        let bad_path = directory.join("broken.jpg");
        let ignored_path = directory.join("note.txt");

        write_png(&good_path, 8, 6);
        fs::File::create(&bad_path)
            .expect("bad image fixture should be created")
            .write_all(b"not really a jpeg")
            .expect("bad image fixture should be written");
        fs::write(ignored_path, "ignore me").expect("ignored fixture should be written");

        let report = scan_directory(&directory.path).expect("directory should scan");

        assert_eq!(report.candidates.len(), 1);
        assert_eq!(report.candidates[0].path, good_path);
        assert_eq!(report.candidates[0].width, Some(8));
        assert_eq!(report.candidates[0].height, Some(6));
        assert_eq!(report.errors.len(), 1);
        assert_eq!(report.errors[0].path, bad_path);
        assert_eq!(report.errors[0].kind, ScanErrorKind::DecodeDimensions);
    }

    #[cfg(unix)]
    #[test]
    fn scan_directory_does_not_follow_symbolic_links() {
        use std::os::unix::fs::symlink;

        let directory = TestDirectory::new("symlink");
        let real_path = directory.join("real.png");
        let linked_path = directory.join("linked.png");

        write_png(&real_path, 4, 4);
        symlink(&real_path, &linked_path).expect("symlink fixture should be created");

        let report = scan_directory(&directory.path).expect("directory should scan");

        assert_eq!(report.candidates.len(), 1);
        assert_eq!(report.candidates[0].path, real_path);
    }

    fn write_png(path: &Path, width: u32, height: u32) {
        write_image(path, ImageFormat::Png, width, height);
    }

    fn write_image(path: &Path, format: ImageFormat, width: u32, height: u32) {
        let image = RgbImage::from_pixel(width, height, Rgb([12, 34, 56]));
        image
            .save_with_format(path, format)
            .expect("image fixture should be saved");
    }
}
