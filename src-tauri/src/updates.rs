use semver::Version;
use serde::{Deserialize, Serialize};
use std::time::Duration;

const RELEASES_API: &str = "https://api.github.com/repos/duckfollow/dum-e/releases?per_page=100";
const RELEASE_PREFIX: &str = "https://github.com/duckfollow/dum-e/releases/tag/";

#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    #[serde(default)]
    body: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailableUpdate {
    version: String,
    url: String,
    notes: String,
}
fn newest_release(current: &Version, releases: Vec<Release>) -> Option<AvailableUpdate> {
    releases
        .into_iter()
        .filter_map(|release| {
            if release.draft {
                return None;
            }
            let version = Version::parse(
                release
                    .tag_name
                    .strip_prefix('v')
                    .unwrap_or(&release.tag_name),
            )
            .ok()?;
            if (current.pre.is_empty() && (release.prerelease || !version.pre.is_empty()))
                || version.cmp_precedence(current).is_le()
            {
                return None;
            }
            Some((version, release.tag_name, release.body.unwrap_or_default()))
        })
        .max_by(|a, b| a.0.cmp_precedence(&b.0))
        .map(|(version, tag, notes)| AvailableUpdate {
            version: version.to_string(),
            url: format!("{RELEASE_PREFIX}{tag}"),
            notes,
        })
}
#[tauri::command]
pub async fn check_for_updates(app: tauri::AppHandle) -> Result<Option<AvailableUpdate>, String> {
    let client = reqwest::Client::builder()
        .user_agent(format!("Dum-E/{}", app.package_info().version))
        .https_only(true)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| "Could not prepare update check.")?;
    let mut response = client
        .get(RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|_| {
            "Could not check for updates. Check your internet connection and try again."
        })?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Releases are unavailable. The repository must be public to check without a GitHub token.".into());
    }
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err("GitHub is limiting update checks. Please try again later.".into());
    }
    if !response.status().is_success() {
        return Err("GitHub could not provide release information. Please try again later.".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Update response was interrupted.")?
    {
        if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
            return Err("Release information is too large.".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let releases: Vec<Release> = serde_json::from_slice(&bytes)
        .map_err(|_| "GitHub returned invalid release information.")?;
    Ok(newest_release(&app.package_info().version, releases))
}
#[tauri::command]
pub async fn open_release_page(url: String) -> Result<(), String> {
    let tag = url
        .strip_prefix(RELEASE_PREFIX)
        .ok_or("Invalid release URL.")?;
    if Version::parse(tag.strip_prefix('v').unwrap_or(tag)).is_err() {
        return Err("Invalid release version.".into());
    }
    open_browser(url).await
}
#[tauri::command]
pub async fn open_companion_app(app: String) -> Result<(), String> {
    let repository = match app.as_str() {
        "edith" => "edith",
        "ultron" => "ultron",
        "u" => "u",
        _ => return Err("Unknown application.".into()),
    };
    open_browser(format!("https://github.com/duckfollow/{repository}")).await
}
async fn open_browser(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(target_os = "macos")]
        let status = std::process::Command::new("open").arg(&url).status();
        #[cfg(target_os = "windows")]
        let status = std::process::Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(&url)
            .status();
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let status = std::process::Command::new("xdg-open").arg(&url).status();
        match status {
            Ok(status) if status.success() => Ok(()),
            _ => Err("Could not open the release page in your browser.".into()),
        }
    })
    .await
    .map_err(|_| "Could not open browser.")?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn release(tag: &str, prerelease: bool, draft: bool) -> Release {
        Release {
            tag_name: tag.into(),
            body: None,
            prerelease,
            draft,
        }
    }
    #[test]
    fn stable_skips_previews_drafts_invalid_and_build_metadata() {
        let current = Version::parse("1.0.0").unwrap();
        let result = newest_release(
            &current,
            vec![
                release("v1.0.0+build2", false, false),
                release("v2.0.0-alpha.1", true, false),
                release("v3.0.0", false, true),
                release("bad", false, false),
            ],
        );
        assert!(result.is_none());
        let result = newest_release(
            &current,
            vec![
                release("v1.2.0", false, false),
                release("v1.10.0", false, false),
            ],
        )
        .unwrap();
        assert_eq!(result.version, "1.10.0");
        assert_eq!(result.url, format!("{RELEASE_PREFIX}v1.10.0"));
    }
    #[test]
    fn release_notes_are_preserved_and_optional_in_github_response() {
        let release: Release = serde_json::from_str(
            r###"{"tag_name":"v1.1.0","draft":false,"prerelease":false,"body":"## New features\n- Updates UI"}"###,
        ).unwrap();
        let update = newest_release(&Version::parse("1.0.0").unwrap(), vec![release]).unwrap();
        assert_eq!(update.notes, "## New features\n- Updates UI");
        let without_notes: Release =
            serde_json::from_str(r###"{"tag_name":"v1.1.0","draft":false,"prerelease":false}"###)
                .unwrap();
        assert!(without_notes.body.is_none());
        let null_notes: Release = serde_json::from_str(
            r#"{"tag_name":"v1.1.0","draft":false,"prerelease":false,"body":null}"#,
        )
        .unwrap();
        assert!(null_notes.body.is_none());
    }
    #[test]
    fn preview_builds_receive_newer_previews_and_stable() {
        let current = Version::parse("0.1.0-alpha.2").unwrap();
        let result = newest_release(
            &current,
            vec![
                release("v0.1.0-alpha.1", true, false),
                release("v0.1.0-alpha.10", true, false),
            ],
        )
        .unwrap();
        assert_eq!(result.version, "0.1.0-alpha.10");
        assert_eq!(
            newest_release(&current, vec![release("v0.1.0", false, false)])
                .unwrap()
                .version,
            "0.1.0"
        );
    }
}
