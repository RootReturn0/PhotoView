use crate::{
    app::{AppState, AppStatus},
    errors::AppResult,
};
use tauri::State;

#[tauri::command]
pub fn get_app_status(state: State<'_, AppState>) -> AppResult<AppStatus> {
    state.status()
}
