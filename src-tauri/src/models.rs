use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionDto {
    pub id: String,
    pub path: String,
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
