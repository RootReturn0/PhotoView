use crate::{app::AppState, db::repositories};
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, Runtime};

const SYNC_DEBOUNCE_MS: u64 = 500;
const WATCH_REFRESH_SECONDS: u64 = 5;

pub fn start_file_watcher<R: Runtime>(app: AppHandle<R>) {
    thread::spawn(move || {
        let (tx, rx) = mpsc::channel();
        let Ok(mut watcher) = notify::recommended_watcher(move |event| {
            let _ = tx.send(event);
        }) else {
            return;
        };
        let mut watched_paths = HashSet::new();

        loop {
            refresh_watches(&app, &mut watcher, &mut watched_paths);
            match rx.recv_timeout(Duration::from_secs(WATCH_REFRESH_SECONDS)) {
                Ok(Ok(event)) => sync_event_paths(&app, &event),
                Ok(Err(_)) => {}
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break,
            }
        }
    });
}

fn refresh_watches<R: Runtime>(
    app: &AppHandle<R>,
    watcher: &mut RecommendedWatcher,
    watched_paths: &mut HashSet<PathBuf>,
) {
    let state = app.state::<AppState>();
    let collections = state
        .with_db(repositories::list_collections)
        .unwrap_or_default();
    let next_paths = collections
        .into_iter()
        .map(|collection| PathBuf::from(collection.path))
        .filter(|path| path.is_dir())
        .collect::<HashSet<_>>();

    for path in next_paths.difference(watched_paths) {
        let _ = watcher.watch(path, RecursiveMode::Recursive);
    }
    for path in watched_paths.difference(&next_paths) {
        let _ = watcher.unwatch(path);
    }

    *watched_paths = next_paths;
}

fn sync_event_paths<R: Runtime>(app: &AppHandle<R>, event: &Event) {
    if event.paths.is_empty() {
        return;
    }

    thread::sleep(Duration::from_millis(SYNC_DEBOUNCE_MS));
    let state = app.state::<AppState>();
    let collections = state
        .with_db(repositories::list_collections)
        .unwrap_or_default();

    for collection in collections {
        let collection_path = PathBuf::from(&collection.path);
        if !event
            .paths
            .iter()
            .any(|path| path_starts_with(path, &collection_path))
        {
            continue;
        }

        let synced = state
            .with_db_mut(|db| repositories::sync_collection(db, &collection.id))
            .is_ok();
        if synced {
            let _ = app.emit("library-synced", &collection.id);
        }
    }
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}
