use crate::{
    app::AppState,
    db::repositories,
    errors::AppResult,
    models::{
        CollectionDto, CreateCollectionRequest, CreateImageRequest, CreateTagRequest, ImageDto,
        ListImagesRequest, SettingDto, TagDto, UpdateCollectionRequest, UpdateImageRequest,
        UpdateSettingRequest, UpdateTagRequest,
    },
};
use tauri::State;

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
pub fn update_collection(
    state: State<'_, AppState>,
    request: UpdateCollectionRequest,
) -> AppResult<CollectionDto> {
    state.with_db(|db| repositories::update_collection(db, request))
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
