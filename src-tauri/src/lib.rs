mod db;
mod execution;
mod metadata;
mod relations;
use db::{Profile, QueryResult, Table};
use serde::Serialize;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::Manager;
#[derive(Clone)]
struct Session {
    profile: Profile,
    password: String,
}
#[derive(Default)]
struct Workspace {
    sessions: Mutex<HashMap<String, Session>>,
    running: Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
    storage: Mutex<()>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Connected {
    profile: Profile,
    tables: Vec<Table>,
    schemas: Vec<String>,
}
fn saved_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}
fn read_profiles(app: &tauri::AppHandle) -> Result<Vec<Profile>, String> {
    let p = saved_path(app)?;
    if !p.exists() {
        return Ok(vec![]);
    }
    serde_json::from_slice(&std::fs::read(p).map_err(|e| e.to_string())?)
        .map_err(|_| "Saved connections could not be read. The file has not been changed.".into())
}
fn persist(app: &tauri::AppHandle, profile: &Profile) -> Result<(), String> {
    let mut profiles = read_profiles(app)?;
    profiles.retain(|p| p.id != profile.id);
    profiles.push(profile.clone());
    let path = saved_path(app)?;
    let temp = path.with_extension("json.next");
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    use std::io::Write;
    let mut f = options.open(&temp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec_pretty(&profiles).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    std::fs::rename(temp, path).map_err(|e| e.to_string())
}
#[cfg(target_os = "macos")]
fn password_entry(id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("com.duckfollow.dum-e", id).map_err(|e| format!("Keychain: {e}"))
}
async fn stored_password(id: String) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || match password_entry(&id)?.get_password() {
            Ok(p) => Ok(p),
            Err(keyring::Error::NoEntry) => Ok(String::new()),
            Err(e) => Err(format!("Keychain: {e}")),
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = id;
        Err("Password storage is currently available on macOS only.".into())
    }
}
async fn save_password(id: String, password: String, remember: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            let e = password_entry(&id)?;
            if remember {
                e.set_password(&password)
                    .map_err(|e| format!("Keychain: {e}"))
            } else {
                match e.delete_credential() {
                    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                    Err(e) => Err(format!("Keychain: {e}")),
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (id, password);
        if remember {
            Err("Password storage is currently available on macOS only.".into())
        } else {
            Ok(())
        }
    }
}
#[tauri::command]
fn list_connections(
    app: tauri::AppHandle,
    state: tauri::State<Workspace>,
) -> Result<Vec<Profile>, String> {
    let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
    read_profiles(&app)
}
#[tauri::command]
async fn save_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
    mut profile: Profile,
    password: Option<String>,
) -> Result<Profile, String> {
    profile.validate()?;
    if state
        .sessions
        .lock()
        .map_err(|_| "Workspace busy")?
        .contains_key(&profile.id)
    {
        return Err("Disconnect before changing a saved connection.".into());
    }
    if profile.driver == "sqlite" {
        profile.remember_password = false;
        let previously_postgres = {
            let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
            read_profiles(&app)?
                .iter()
                .any(|p| p.id == profile.id && p.driver == "postgres")
        };
        if previously_postgres {
            save_password(profile.id.clone(), String::new(), false).await?;
        }
    }
    if profile.driver == "postgres" {
        if !profile.remember_password {
            save_password(profile.id.clone(), String::new(), false).await?;
        } else if let Some(password) = password {
            save_password(profile.id.clone(), password, true).await?;
        }
        // None preserves an existing Keychain entry; saving does not contact the server.
    }
    let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
    persist(&app, &profile)?;
    Ok(profile)
}
#[tauri::command]
async fn test_connection(profile: Profile, password: String) -> Result<(), String> {
    db::test_connection(&profile, &password).await
}
#[tauri::command]
async fn connect_database(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
    profile: Profile,
    password: Option<String>,
) -> Result<Connected, String> {
    profile.validate()?;
    let password = match password {
        Some(p) => p,
        None => {
            if profile.driver == "postgres" && profile.remember_password {
                stored_password(profile.id.clone()).await?
            } else {
                String::new()
            }
        }
    };
    let tables = db::tables(&profile, &password).await?;
    let schemas = db::schemas(&profile, &password).await?;
    if profile.driver == "postgres" {
        save_password(
            profile.id.clone(),
            password.clone(),
            profile.remember_password,
        )
        .await?;
    }
    {
        let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
        persist(&app, &profile)?;
    }
    state.sessions.lock().map_err(|_| "Workspace busy")?.insert(
        profile.id.clone(),
        Session {
            profile: profile.clone(),
            password,
        },
    );
    Ok(Connected {
        profile,
        tables,
        schemas,
    })
}
fn session(state: &Workspace, id: &str) -> Result<Session, String> {
    state
        .sessions
        .lock()
        .map_err(|_| "Workspace busy")?
        .get(id)
        .cloned()
        .ok_or_else(|| "Connect to this database first.".into())
}
#[tauri::command]
fn disconnect_database(state: tauri::State<Workspace>, id: String) -> Result<(), String> {
    for (profile, flag) in state.running.lock().map_err(|_| "Workspace busy")?.values() {
        if profile == &id {
            flag.store(true, Ordering::Relaxed);
        }
    }
    state
        .sessions
        .lock()
        .map_err(|_| "Workspace busy")?
        .remove(&id);
    Ok(())
}
#[tauri::command]
async fn list_tables(state: tauri::State<'_, Workspace>, id: String) -> Result<Vec<Table>, String> {
    let s = session(&state, &id)?;
    db::tables(&s.profile, &s.password).await
}
#[tauri::command]
async fn list_schemas(
    state: tauri::State<'_, Workspace>,
    id: String,
) -> Result<Vec<String>, String> {
    let s = session(&state, &id)?;
    db::schemas(&s.profile, &s.password).await
}
#[tauri::command]
async fn database_relations(
    state: tauri::State<'_, Workspace>,
    id: String,
) -> Result<relations::DatabaseRelations, String> {
    let s = session(&state, &id)?;
    relations::inspect(&s.profile, &s.password).await
}
#[tauri::command]
async fn table_details(
    state: tauri::State<'_, Workspace>,
    id: String,
    table: Table,
) -> Result<metadata::TableDetails, String> {
    let session = session(&state, &id)?;
    metadata::inspect(&session.profile, &session.password, &table).await
}
#[tauri::command]
async fn execute_sql(
    state: tauri::State<'_, Workspace>,
    id: String,
    request_id: String,
    sql: String,
) -> Result<execution::ExecutionResult, String> {
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid query ID")?;
    let flag = Arc::new(AtomicBool::new(false));
    let s;
    {
        let mut map = state.running.lock().map_err(|_| "Workspace busy")?;
        s = session(&state, &id)?;
        if map.values().any(|(connection, _)| connection == &id)
            || map.contains_key(&request_id)
            || map.len() >= 4
        {
            return Err("Another query is still running.".into());
        }
        map.insert(request_id.clone(), (id, flag.clone()));
    }
    let _guard = QueryGuard {
        running: &state.running,
        id: request_id,
        flag: flag.clone(),
    };
    let work = execution::execute(&s.profile, &s.password, &sql, flag.clone());
    tokio::pin!(work);
    let mut ticks = tokio::time::interval(Duration::from_millis(50));
    let deadline = tokio::time::sleep(Duration::from_secs(20));
    tokio::pin!(deadline);
    loop {
        tokio::select! {result=&mut work=>return result, _=&mut deadline=>return Err("Execution exceeded 20 seconds. Some changes may already be committed; inspect the database before retrying.".into()), _=ticks.tick()=>{if flag.load(Ordering::Relaxed){return Err("Execution cancelled. Some changes may already be committed; inspect the database before retrying.".into());}}}
    }
}
struct QueryGuard<'a> {
    running: &'a Mutex<HashMap<String, (String, Arc<AtomicBool>)>>,
    id: String,
    flag: Arc<AtomicBool>,
}
impl Drop for QueryGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(true, Ordering::Relaxed);
        if let Ok(mut map) = self.running.lock() {
            map.remove(&self.id);
        }
    }
}
#[tauri::command]
async fn run_query(
    state: tauri::State<'_, Workspace>,
    id: String,
    request_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    uuid::Uuid::parse_str(&request_id).map_err(|_| "Invalid query ID")?;
    let s = session(&state, &id)?;
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.running.lock().map_err(|_| "Workspace busy")?;
        if map.contains_key(&request_id) || map.len() >= 4 {
            return Err("Another query is still running. Try again shortly.".into());
        }
        map.insert(request_id.clone(), (id, flag.clone()));
    }
    let _guard = QueryGuard {
        running: &state.running,
        id: request_id,
        flag: flag.clone(),
    };
    let work = db::query(&s.profile, &s.password, &sql, flag.clone());
    tokio::pin!(work);
    let mut ticks = tokio::time::interval(Duration::from_millis(50));
    let deadline = tokio::time::sleep(Duration::from_secs(20));
    tokio::pin!(deadline);
    loop {
        tokio::select! {result=&mut work=>return result,_=&mut deadline=>return Err("Query exceeded the time limit (20 seconds).".into()),_ = ticks.tick()=>{if flag.load(Ordering::Relaxed){return Err("Query cancelled".into());}}}
    }
}
#[tauri::command]
fn cancel_query(state: tauri::State<Workspace>, request_id: String) -> Result<(), String> {
    if let Some((_, flag)) = state
        .running
        .lock()
        .map_err(|_| "Workspace busy")?
        .get(&request_id)
    {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}
#[tauri::command]
async fn open_sample(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
) -> Result<Connected, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("workshop-sample-v2.sqlite");
    std::fs::create_dir_all(path.parent().ok_or("Invalid data folder")?)
        .map_err(|e| e.to_string())?;
    db::demo_file(&path).await?;
    let profile = Profile {
        id: "d00e0000-0000-4000-8000-000000000002".into(),
        name: "Workshop relations · sample".into(),
        driver: "sqlite".into(),
        host: String::new(),
        port: 5432,
        database: String::new(),
        username: String::new(),
        path: path.to_string_lossy().into_owned(),
        tls: true,
        remember_password: false,
    };
    connect_database(app, state, profile, Some(String::new())).await
}
#[tauri::command]
async fn export_result(
    app: tauri::AppHandle,
    content: String,
    format: String,
) -> Result<bool, String> {
    if content.len() > 8 * 1024 * 1024 || !["csv", "json"].contains(&format.as_str()) {
        return Err("Unsupported export or result too large.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::DialogExt;
        let selected = app
            .dialog()
            .file()
            .set_file_name(format!("dum-e-result.{format}"))
            .add_filter("Query result", &[&format])
            .blocking_save_file();
        if let Some(path) = selected {
            let path = path.into_path().map_err(|e| e.to_string())?;
            std::fs::write(path, content).map_err(|e| e.to_string())?;
            Ok(true)
        } else {
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn run() {
    #[cfg(target_os = "macos")]
    objc2_foundation::NSProcessInfo::processInfo()
        .setProcessName(objc2_foundation::ns_string!("Dum-E"));
    tauri::Builder::default()
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                use objc2::{AnyThread, MainThreadMarker};
                use objc2_app_kit::{NSApplication, NSImage};
                use objc2_foundation::NSData;
                let marker =
                    MainThreadMarker::new().ok_or("App branding requires the main thread")?;
                let data = NSData::with_bytes(include_bytes!("../icons/icon.icns"));
                let image = NSImage::initWithData(NSImage::alloc(), &data)
                    .ok_or("Unable to load application icon")?;
                // SAFETY: AppKit is called on its main thread and retains the image.
                unsafe {
                    NSApplication::sharedApplication(marker).setApplicationIconImage(Some(&image));
                }
            }
            Ok(())
        })
        .manage(Workspace::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            list_connections,
            save_connection,
            test_connection,
            connect_database,
            disconnect_database,
            list_tables,
            list_schemas,
            table_details,
            database_relations,
            run_query,
            execute_sql,
            cancel_query,
            open_sample,
            export_result
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start Dum-E");
}
