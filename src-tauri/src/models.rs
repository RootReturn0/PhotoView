use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    pub id: String,
    pub path: String,
    pub display_path: String,
    pub name: String,
    pub cover_image_id: Option<String>,
    pub description: String,
    pub rating: i64,
    pub is_favorite: bool,
    pub image_count: i64,
    pub total_size_bytes: i64,
    pub created_at: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
    pub last_viewed_at: Option<String>,
    pub view_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCollectionRequest {
    pub path: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub rating: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCollectionRequest {
    pub path: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportCollectionResult {
    pub collection: CollectionDto,
    pub scanned_count: i64,
    pub inserted_count: i64,
    pub updated_count: i64,
    pub error_count: i64,
    pub errors: Vec<ImportErrorDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportFolderResult {
    pub root_path: String,
    pub collection_count: i64,
    pub scanned_count: i64,
    pub inserted_count: i64,
    pub updated_count: i64,
    pub error_count: i64,
    pub skipped_dir_count: i64,
    pub results: Vec<ImportCollectionResult>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportErrorDto {
    pub path: String,
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCollectionRequest {
    pub id: String,
    pub name: Option<String>,
    pub description: Option<String>,
    pub rating: Option<i64>,
    pub is_favorite: Option<bool>,
    pub cover_image_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageDto {
    pub id: String,
    pub collection_id: String,
    pub path: String,
    pub display_path: String,
    pub file_name: String,
    pub extension: String,
    pub format: String,
    pub size_bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub imported_at: String,
    pub updated_at: String,
    pub sha256: Option<String>,
    pub phash: Option<String>,
    pub rating: i64,
    pub is_favorite: bool,
    pub is_missing: bool,
    pub last_viewed_at: Option<String>,
    pub view_count: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListImagesRequest {
    pub collection_id: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateImageRequest {
    pub collection_id: String,
    pub path: String,
    pub file_name: Option<String>,
    pub extension: Option<String>,
    pub format: Option<String>,
    pub size_bytes: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub created_at: Option<String>,
    pub modified_at: Option<String>,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateImageRequest {
    pub id: String,
    pub file_name: Option<String>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub sha256: Option<String>,
    pub phash: Option<String>,
    pub rating: Option<i64>,
    pub is_favorite: Option<bool>,
    pub is_missing: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameImageFileRequest {
    pub id: String,
    pub file_name: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveImageFileRequest {
    pub id: String,
    pub target_collection_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyImageFileRequest {
    pub id: String,
    pub target_collection_id: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteImageFileRequest {
    pub id: String,
    pub use_trash: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagDto {
    pub id: String,
    pub name: String,
    pub color: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagRequest {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateTagRequest {
    pub id: String,
    pub name: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagAssignmentDto {
    pub target_id: String,
    pub tag: TagDto,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListCollectionTagAssignmentsRequest {
    pub collection_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListImageTagAssignmentsRequest {
    pub collection_id: Option<String>,
    pub image_id: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetTagAssignmentsRequest {
    pub target_id: String,
    pub tag_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchLibraryRequest {
    pub query: Option<String>,
    pub formats: Option<Vec<String>>,
    pub min_width: Option<i64>,
    pub max_width: Option<i64>,
    pub min_height: Option<i64>,
    pub max_height: Option<i64>,
    pub min_size_bytes: Option<i64>,
    pub max_size_bytes: Option<i64>,
    pub tag_ids: Option<Vec<String>>,
    pub min_rating: Option<i64>,
    pub max_rating: Option<i64>,
    pub date_from: Option<String>,
    pub date_to: Option<String>,
    pub is_favorite: Option<bool>,
    pub limit: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResultsDto {
    pub collections: Vec<CollectionDto>,
    pub images: Vec<ImageDto>,
    pub tags: Vec<TagDto>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateDetectionRequest {
    pub collection_id: Option<String>,
    pub max_hamming_distance: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateGroupDto {
    pub id: String,
    pub kind: String,
    pub score: u32,
    pub total_size_bytes: i64,
    pub images: Vec<ImageDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DuplicateDetectionResult {
    pub scanned_count: i64,
    pub hashed_count: i64,
    pub failed_count: i64,
    pub exact_groups: Vec<DuplicateGroupDto>,
    pub similar_groups: Vec<DuplicateGroupDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataFileResult {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingDto {
    pub key: String,
    pub value: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettingRequest {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailDto {
    pub image_id: String,
    pub cache_path: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailTaskRequest {
    pub collection_id: Option<String>,
    pub target_size: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskDto {
    pub id: String,
    pub kind: String,
    pub status: String,
    pub total_count: i64,
    pub completed_count: i64,
    pub failed_count: i64,
    pub current_item: Option<String>,
    pub error_message: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailCacheStatsDto {
    pub root_path: String,
    pub file_count: u64,
    pub metadata_file_count: u64,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClearThumbnailCacheResult {
    pub deleted_file_count: u64,
    pub deleted_dir_count: u64,
    pub freed_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerImageDto {
    pub image_id: String,
    pub asset_path: String,
    pub url: String,
    pub width: u32,
    pub height: u32,
    pub format: String,
    pub kind: String,
    pub status: String,
}
