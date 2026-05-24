use crate::{
    db::repositories,
    errors::{AppError, AppResult},
    models::{
        DuplicateDetectionRequest, DuplicateDetectionResult, DuplicateGroupDto, ImageDto,
        ListImagesRequest, UpdateImageRequest,
    },
};
use image::imageops::FilterType;
use rusqlite::Connection;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::File,
    io::{BufReader, Read},
};

const DEFAULT_SIMILAR_DISTANCE: u32 = 8;

pub fn run_duplicate_detection(
    conn: &Connection,
    request: DuplicateDetectionRequest,
) -> AppResult<DuplicateDetectionResult> {
    let images = repositories::list_images(
        conn,
        ListImagesRequest {
            collection_id: request.collection_id,
            limit: Some(1000),
            offset: Some(0),
        },
    )?;
    let max_distance = request
        .max_hamming_distance
        .unwrap_or(DEFAULT_SIMILAR_DISTANCE)
        .min(64);
    let mut hashed_images = Vec::new();
    let mut failed_count = 0;

    for image in &images {
        match hash_image(image) {
            Ok((sha256, phash)) => {
                let updated = repositories::update_image(
                    conn,
                    UpdateImageRequest {
                        id: image.id.clone(),
                        file_name: None,
                        width: None,
                        height: None,
                        sha256: Some(sha256),
                        phash: Some(phash),
                        rating: None,
                        is_favorite: None,
                        is_missing: None,
                    },
                )?;
                hashed_images.push(updated);
            }
            Err(_) => failed_count += 1,
        }
    }

    Ok(DuplicateDetectionResult {
        scanned_count: i64::try_from(images.len()).unwrap_or(i64::MAX),
        hashed_count: i64::try_from(hashed_images.len()).unwrap_or(i64::MAX),
        failed_count,
        exact_groups: exact_duplicate_groups(&hashed_images),
        similar_groups: similar_duplicate_groups(&hashed_images, max_distance),
    })
}

fn hash_image(image: &ImageDto) -> AppResult<(String, String)> {
    Ok((
        compute_sha256(&image.path)?,
        compute_perceptual_hash(&image.path)?,
    ))
}

fn compute_sha256(path: &str) -> AppResult<String> {
    let file = File::open(path)?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];

    loop {
        let read_count = reader.read(&mut buffer)?;
        if read_count == 0 {
            break;
        }
        hasher.update(&buffer[..read_count]);
    }

    Ok(hasher
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn compute_perceptual_hash(path: &str) -> AppResult<String> {
    let image = image::open(path)
        .map_err(|value| AppError::new("decode_error", value.to_string()))?
        .resize_exact(8, 8, FilterType::Triangle)
        .to_luma8();
    let pixels = image.as_raw();
    let average = pixels.iter().map(|value| u64::from(*value)).sum::<u64>() / 64;
    let mut hash = 0_u64;

    for (index, pixel) in pixels.iter().enumerate() {
        if u64::from(*pixel) >= average {
            hash |= 1_u64 << index;
        }
    }

    Ok(format!("{hash:016x}"))
}

fn exact_duplicate_groups(images: &[ImageDto]) -> Vec<DuplicateGroupDto> {
    let mut groups: HashMap<String, Vec<ImageDto>> = HashMap::new();
    for image in images {
        if let Some(sha256) = &image.sha256 {
            groups
                .entry(sha256.clone())
                .or_default()
                .push(image.clone());
        }
    }

    groups
        .into_iter()
        .filter_map(|(sha256, images)| {
            duplicate_group(format!("exact-{sha256}"), "exact", 0, images)
        })
        .collect()
}

fn similar_duplicate_groups(images: &[ImageDto], max_distance: u32) -> Vec<DuplicateGroupDto> {
    let hashes = images
        .iter()
        .filter_map(|image| {
            image
                .phash
                .as_deref()
                .and_then(|phash| u64::from_str_radix(phash, 16).ok())
                .map(|hash| (image, hash))
        })
        .collect::<Vec<_>>();
    let mut union_find = UnionFind::new(hashes.len());
    let mut group_scores: HashMap<usize, u32> = HashMap::new();

    for left_index in 0..hashes.len() {
        for right_index in (left_index + 1)..hashes.len() {
            let distance = (hashes[left_index].1 ^ hashes[right_index].1).count_ones();
            if distance <= max_distance {
                union_find.union(left_index, right_index);
                let root = union_find.find(left_index);
                group_scores
                    .entry(root)
                    .and_modify(|score| *score = (*score).max(distance))
                    .or_insert(distance);
            }
        }
    }

    let mut groups: HashMap<usize, Vec<ImageDto>> = HashMap::new();
    for (index, (image, _)) in hashes.into_iter().enumerate() {
        groups
            .entry(union_find.find(index))
            .or_default()
            .push(image.clone());
    }

    groups
        .into_iter()
        .filter_map(|(root, images)| {
            duplicate_group(
                format!("similar-{root}"),
                "similar",
                *group_scores.get(&root).unwrap_or(&0),
                images,
            )
        })
        .collect()
}

fn duplicate_group(
    id: String,
    kind: &str,
    score: u32,
    mut images: Vec<ImageDto>,
) -> Option<DuplicateGroupDto> {
    if images.len() < 2 {
        return None;
    }

    images.sort_by(|left, right| left.file_name.cmp(&right.file_name));
    let total_size_bytes = images.iter().map(|image| image.size_bytes).sum();
    Some(DuplicateGroupDto {
        id,
        kind: kind.to_string(),
        score,
        total_size_bytes,
        images,
    })
}

struct UnionFind {
    parents: Vec<usize>,
}

impl UnionFind {
    fn new(length: usize) -> Self {
        Self {
            parents: (0..length).collect(),
        }
    }

    fn find(&mut self, index: usize) -> usize {
        let parent = self.parents[index];
        if parent != index {
            let root = self.find(parent);
            self.parents[index] = root;
        }
        self.parents[index]
    }

    fn union(&mut self, left: usize, right: usize) {
        let left_root = self.find(left);
        let right_root = self.find(right);
        if left_root != right_root {
            self.parents[right_root] = left_root;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{CreateCollectionRequest, CreateImageRequest},
    };
    use image::{Rgb, RgbImage};
    use std::{fs, path::Path};
    use uuid::Uuid;

    #[test]
    fn duplicate_detection_finds_exact_matches_and_updates_hashes() {
        let database_path =
            std::env::temp_dir().join(format!("photoview-duplicates-{}.sqlite", Uuid::new_v4()));
        let conn = db::open_database(&database_path).expect("database should initialize");
        let dir = std::env::temp_dir().join(format!("photoview-duplicates-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).expect("directory should be created");
        let first_path = dir.join("first.png");
        let second_path = dir.join("second.png");
        write_png(&first_path, [200, 10, 10]);
        fs::copy(&first_path, &second_path).expect("duplicate should copy");

        let collection = repositories::create_collection(
            &conn,
            CreateCollectionRequest {
                path: dir.to_string_lossy().into_owned(),
                name: Some("Duplicates".to_string()),
                description: None,
                rating: None,
            },
        )
        .expect("collection should be created");
        let first = create_test_image(&conn, &collection.id, &first_path);
        let second = create_test_image(&conn, &collection.id, &second_path);

        let result = run_duplicate_detection(
            &conn,
            DuplicateDetectionRequest {
                collection_id: Some(collection.id),
                max_hamming_distance: Some(8),
            },
        )
        .expect("duplicate detection should run");

        assert_eq!(result.scanned_count, 2);
        assert_eq!(result.hashed_count, 2);
        assert_eq!(result.failed_count, 0);
        assert_eq!(result.exact_groups.len(), 1);
        assert!(repositories::get_image(&conn, &first.id)
            .unwrap()
            .unwrap()
            .sha256
            .is_some());
        assert!(repositories::get_image(&conn, &second.id)
            .unwrap()
            .unwrap()
            .phash
            .is_some());

        drop(conn);
        let _ = fs::remove_file(database_path);
        let _ = fs::remove_dir_all(dir);
    }

    fn create_test_image(conn: &Connection, collection_id: &str, path: &Path) -> ImageDto {
        repositories::create_image(
            conn,
            CreateImageRequest {
                collection_id: collection_id.to_string(),
                path: path.to_string_lossy().into_owned(),
                file_name: None,
                extension: None,
                format: None,
                size_bytes: Some(i64::try_from(fs::metadata(path).unwrap().len()).unwrap()),
                width: Some(10),
                height: Some(10),
                created_at: None,
                modified_at: None,
                sha256: None,
            },
        )
        .expect("image should be created")
    }

    fn write_png(path: &Path, color: [u8; 3]) {
        let mut image = RgbImage::new(10, 10);
        for pixel in image.pixels_mut() {
            *pixel = Rgb(color);
        }
        image.save(path).expect("png should be saved");
    }
}
