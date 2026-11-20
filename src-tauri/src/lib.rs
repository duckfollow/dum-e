mod db;
mod editing;
mod execution;
mod metadata;
mod relations;
mod ssh;
mod updates;
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
    write_profiles(&saved_path(app)?, &profiles)
}
fn write_profiles(path: &std::path::Path, profiles: &[Profile]) -> Result<(), String> {
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
    f.write_all(&serde_json::to_vec_pretty(profiles).map_err(|e| e.to_string())?)
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
#[cfg(target_os = "macos")]
fn write_keychain_password(
    entry: &keyring::Entry,
    password: Option<&str>,
) -> Result<(), keyring::Error> {
    match password {
        Some(password) => entry.set_password(password),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error),
        },
    }
}
async fn save_passwords(updates: Vec<(String, Option<String>)>) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        // Keep the two credential updates together, including rollback if either fails.
        static WRITES: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
        let _guard = WRITES.lock().await;
        tauri::async_runtime::spawn_blocking(move || {
            let mut entries = Vec::new();
            for (id, _) in &updates {
                let entry = password_entry(id)?;
                let previous = match entry.get_password() {
                    Ok(password) => Some(password),
                    Err(keyring::Error::NoEntry) => None,
                    Err(error) => return Err(format!("Keychain: {error}")),
                };
                entries.push((entry, previous));
            }
            for (index, ((entry, _), (_, password))) in entries.iter().zip(&updates).enumerate() {
                if let Err(error) = write_keychain_password(entry, password.as_deref()) {
                    let mut message = format!("Keychain: {error}");
                    for (entry, previous) in entries[..=index].iter().rev() {
                        if let Err(restore_error) =
                            write_keychain_password(entry, previous.as_deref())
                        {
                            message.push_str(&format!(
                                ". Could not restore a previous credential: {restore_error}"
                            ));
                        }
                    }
                    return Err(message);
                }
            }
            Ok(())
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    {
        if updates.iter().any(|(_, password)| password.is_some()) {
            Err("Password storage is currently available on macOS only.".into())
        } else {
            Ok(())
        }
    }
}
fn ssh_password_id(id: &str) -> String {
    format!("{id}:ssh")
}
fn remembers_ssh_password(profile: &Profile) -> bool {
    profile.driver == "postgres"
        && profile.remember_password
        && profile
            .ssh
            .as_ref()
            .is_some_and(|ssh| ssh.authentication == ssh::SshAuthentication::Password)
}
async fn connection_passwords(
    profile: &Profile,
    password: Option<String>,
    ssh_password: Option<String>,
) -> Result<(String, Option<String>), String> {
    let password = match password {
        Some(password) => password,
        None if profile.driver == "postgres" && profile.remember_password => {
            stored_password(profile.id.clone()).await?
        }
        None => String::new(),
    };
    let ssh_password = match ssh_password {
        Some(password) => Some(password),
        None if remembers_ssh_password(profile) => {
            Some(stored_password(ssh_password_id(&profile.id)).await?)
        }
        None => None,
    };
    Ok((password, ssh_password))
}
async fn save_connection_passwords(
    profile: &Profile,
    password: Option<String>,
    ssh_password: Option<String>,
) -> Result<(), String> {
    let mut updates = Vec::new();
    let remember_database = profile.driver == "postgres" && profile.remember_password;
    if !remember_database || password.is_some() {
        updates.push((
            profile.id.clone(),
            if remember_database { password } else { None },
        ));
    }
    let remember_ssh = remembers_ssh_password(profile);
    if !remember_ssh || ssh_password.is_some() {
        updates.push((
            ssh_password_id(&profile.id),
            if remember_ssh { ssh_password } else { None },
        ));
    }
    save_passwords(updates).await
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
    ssh_password: Option<String>,
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
    }
    save_connection_passwords(&profile, password, ssh_password).await?;
    let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
    persist(&app, &profile)?;
    Ok(profile)
}
#[tauri::command]
async fn remove_connection(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
    id: String,
) -> Result<(), String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid connection identifier")?;
    if state
        .sessions
        .lock()
        .map_err(|_| "Workspace busy")?
        .contains_key(&id)
    {
        return Err("Disconnect before removing a saved connection.".into());
    }
    let exists = {
        let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
        read_profiles(&app)?.iter().any(|p| p.id == id)
    };
    if !exists {
        return Ok(());
    }
    save_passwords(vec![(id.clone(), None), (ssh_password_id(&id), None)]).await?;
    let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
    let mut profiles = read_profiles(&app)?;
    profiles.retain(|p| p.id != id);
    write_profiles(&saved_path(&app)?, &profiles)
}
fn reveal_password_id(profile: &Profile, kind: &str) -> Result<String, String> {
    match kind {
        "database" if profile.driver == "postgres" && profile.remember_password => {
            Ok(profile.id.clone())
        }
        "ssh" if remembers_ssh_password(profile) => Ok(ssh_password_id(&profile.id)),
        _ => Err("There is no saved password for this authentication method.".into()),
    }
}
#[tauri::command]
async fn reveal_connection_password(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
    id: String,
    kind: String,
) -> Result<String, String> {
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid connection identifier")?;
    let profile = {
        let _guard = state.storage.lock().map_err(|_| "Storage busy")?;
        read_profiles(&app)?
            .into_iter()
            .find(|profile| profile.id == id)
            .ok_or("Saved connection not found")?
    };
    let credential_id = reveal_password_id(&profile, &kind)?;
    stored_password(credential_id).await
}
#[tauri::command]
async fn test_connection(
    profile: Profile,
    password: Option<String>,
    ssh_password: Option<String>,
) -> Result<(), String> {
    profile.validate()?;
    let (password, ssh_password) = connection_passwords(&profile, password, ssh_password).await?;
    db::test_connection(&profile, &password, ssh_password.as_deref()).await
}
#[tauri::command]
async fn connect_database(
    app: tauri::AppHandle,
    state: tauri::State<'_, Workspace>,
    mut profile: Profile,
    password: Option<String>,
    ssh_password: Option<String>,
) -> Result<Connected, String> {
    profile.validate()?;
    let (password, ssh_password) = connection_passwords(&profile, password, ssh_password).await?;
    profile.tunnel = ssh::open(&profile, ssh_password.as_deref()).await?;
    let tables = db::tables(&profile, &password).await?;
    let schemas = db::schemas(&profile, &password).await?;
    save_connection_passwords(&profile, Some(password.clone()), ssh_password).await?;
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
async fn apply_cell_edits(
    state: tauri::State<'_, Workspace>,
    id: String,
    table: Table,
    edits: Vec<editing::RowEdit>,
) -> Result<u64, String> {
    let s = session(&state, &id)?;
    editing::apply(&s.profile, &s.password, &table, &edits).await
}
#[tauri::command]
async fn execute_sql(
    state: tauri::State<'_, Workspace>,
    id: String,
    request_id: String,
    sql: String,
    read_only: Option<bool>,
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
    let work = execution::execute_mode(
        &s.profile,
        &s.password,
        &sql,
        flag.clone(),
        read_only.unwrap_or(false),
    );
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
    preview: Option<db::Table>,
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
    let work = db::run_query(
        &s.profile,
        &s.password,
        &sql,
        flag.clone(),
        preview.as_ref(),
    );
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
        ssh: None,
        tunnel: None,
    };
    connect_database(app, state, profile, Some(String::new()), None).await
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
            updates::check_for_updates,
            updates::open_release_page,
            updates::open_companion_app,
            list_connections,
            save_connection,
            remove_connection,
            test_connection,
            reveal_connection_password,
            connect_database,
            disconnect_database,
            list_tables,
            list_schemas,
            table_details,
            database_relations,
            run_query,
            execute_sql,
            apply_cell_edits,
            cancel_query,
            open_sample,
            export_result
        ])
        .build(tauri::generate_context!())
        .expect("Unable to start Dum-E")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let workspace = app.state::<Workspace>();
                if let Ok(sessions) = workspace.sessions.lock() {
                    for session in sessions.values() {
                        if let Some(tunnel) = &session.profile.tunnel {
                            tunnel.stop();
                        }
                    }
                };
            }
        });
}

#[cfg(test)]
mod connection_storage_tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "Uses isolated temporary macOS Keychain entries"]
    async fn keychain_remembers_database_and_ssh_passwords() {
        struct Cleanup(String);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                for id in [self.0.clone(), ssh_password_id(&self.0)] {
                    if let Ok(entry) = password_entry(&id) {
                        let _ = entry.delete_credential();
                    }
                }
            }
        }
        let id = uuid::Uuid::new_v4().to_string();
        let _cleanup = Cleanup(id.clone());
        let mut profile: Profile = serde_json::from_value(serde_json::json!({
            "id": id, "name": "Temporary Keychain test", "driver": "postgres",
            "host": "127.0.0.1", "database": "fixture", "username": "fixture", "rememberPassword": true,
            "ssh": { "host": "127.0.0.1", "port": 22, "username": "fixture", "authentication": "password" }
        })).unwrap();
        save_connection_passwords(
            &profile,
            Some("fixture-db-password".into()),
            Some("fixture-ssh-password".into()),
        )
        .await
        .unwrap();
        assert_eq!(
            stored_password(reveal_password_id(&profile, "database").unwrap())
                .await
                .unwrap(),
            "fixture-db-password"
        );
        assert_eq!(
            stored_password(reveal_password_id(&profile, "ssh").unwrap())
                .await
                .unwrap(),
            "fixture-ssh-password"
        );
        assert!(reveal_password_id(&profile, "unknown").is_err());
        let (database, ssh) = connection_passwords(&profile, None, None).await.unwrap();
        assert_eq!(database, "fixture-db-password");
        assert_eq!(ssh.as_deref(), Some("fixture-ssh-password"));
        save_connection_passwords(&profile, None, None)
            .await
            .unwrap();
        assert_eq!(
            connection_passwords(&profile, None, None).await.unwrap(),
            (database, ssh)
        );
        let override_values =
            connection_passwords(&profile, Some("typed-db".into()), Some("typed-ssh".into()))
                .await
                .unwrap();
        assert_eq!(
            override_values,
            ("typed-db".into(), Some("typed-ssh".into()))
        );
        assert_eq!(
            stored_password(profile.id.clone()).await.unwrap(),
            "fixture-db-password"
        );
        let json = serde_json::to_string(&profile).unwrap();
        assert!(!json.contains("fixture-db-password"));
        assert!(!json.contains("fixture-ssh-password"));
        profile.ssh.as_mut().unwrap().authentication = ssh::SshAuthentication::Key;
        save_connection_passwords(&profile, None, None)
            .await
            .unwrap();
        assert_eq!(
            stored_password(ssh_password_id(&profile.id)).await.unwrap(),
            ""
        );
        assert_eq!(
            stored_password(profile.id.clone()).await.unwrap(),
            "fixture-db-password"
        );
        profile.ssh.as_mut().unwrap().authentication = ssh::SshAuthentication::Password;
        save_connection_passwords(&profile, None, Some("updated-ssh".into()))
            .await
            .unwrap();
        profile.remember_password = false;
        assert!(reveal_password_id(&profile, "database").is_err());
        assert!(reveal_password_id(&profile, "ssh").is_err());
        save_connection_passwords(&profile, None, None)
            .await
            .unwrap();
        assert_eq!(stored_password(profile.id.clone()).await.unwrap(), "");
        assert_eq!(
            stored_password(ssh_password_id(&profile.id)).await.unwrap(),
            ""
        );
        assert_eq!(
            connection_passwords(&profile, None, None).await.unwrap(),
            (String::new(), None)
        );
    }
    #[test]
    fn removing_profile_preserves_other_settings_and_writes_empty_list() {
        let dir = std::env::temp_dir().join(format!("dum-e-storage-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("connections.json");
        let make = |name: &str| Profile {
            id: uuid::Uuid::new_v4().to_string(),
            name: name.into(),
            driver: "sqlite".into(),
            host: String::new(),
            port: 5432,
            database: String::new(),
            username: String::new(),
            path: "/unused-test.sqlite".into(),
            tls: false,
            remember_password: false,
            ssh: None,
            tunnel: None,
        };
        let first = make("first");
        let second = make("second");
        write_profiles(&path, &[first.clone(), second.clone()]).unwrap();
        let mut profiles: Vec<Profile> =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        profiles.retain(|p| p.id != first.id);
        write_profiles(&path, &profiles).unwrap();
        let remaining: Vec<Profile> =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, second.id);
        assert_eq!(remaining[0].path, second.path);
        write_profiles(&path, &[]).unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "[]");
        assert!(!path.with_extension("json.next").exists());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
