use crate::db::Profile;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    process::Stdio,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::AsyncWriteExt,
    net::UnixListener,
    process::{Child, Command},
};

#[derive(Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthentication {
    #[default]
    Key,
    Password,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    #[serde(default)]
    pub identity_file: String,
    #[serde(default)]
    pub authentication: SshAuthentication,
}

pub fn validate_host(host: &str) -> Result<(), String> {
    if host.is_empty()
        || host.len() > 253
        || host.starts_with('-')
        || !host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".-_:".contains(c))
    {
        return Err("Enter a hostname or IP address for SSH and the database.".into());
    }
    Ok(())
}

impl SshConfig {
    pub fn validate(&self) -> Result<(), String> {
        validate_host(&self.host)?;
        if self.port == 0
            || self.username.is_empty()
            || self.username.len() > 256
            || self.username.starts_with('-')
            || self
                .username
                .chars()
                .any(|c| c.is_whitespace() || c.is_control())
        {
            return Err("Enter an SSH port and username.".into());
        }
        if self.authentication == SshAuthentication::Key
            && !self.identity_file.is_empty()
            && (!Path::new(&self.identity_file).is_absolute()
                || !Path::new(&self.identity_file).is_file())
        {
            return Err("Choose an existing SSH private key using its absolute path.".into());
        }
        Ok(())
    }
}

// Arc ownership keeps forwarding alive for in-flight operations after disconnect.
// Child kill-on-drop also covers cancellation while the tunnel is starting.
pub struct Tunnel {
    child: Mutex<Child>,
    directory: tempfile::TempDir,
    stderr: std::fs::File,
}

impl Tunnel {
    pub fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.start_kill();
        }
    }

    pub fn directory(&self) -> &Path {
        self.directory.path()
    }

    pub fn check(&self) -> Result<(), String> {
        let mut child = self.child.lock().map_err(|_| "SSH tunnel busy")?;
        if child
            .try_wait()
            .map_err(|e| format!("Could not check SSH tunnel: {e}"))?
            .is_some()
        {
            return Err(self.failure());
        }
        Ok(())
    }

    fn failure(&self) -> String {
        use std::os::unix::fs::FileExt;
        let mut bytes = [0; 4096];
        let count = self.stderr.read_at(&mut bytes, 0).unwrap_or(0);
        let detail = String::from_utf8_lossy(&bytes[..count]);
        format!("SSH tunnel failed. Check the SSH username and authentication settings. Verify this host once with SSH in Terminal so it is in known_hosts. {}", detail.trim())
    }
}

impl Drop for Tunnel {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            let _ = child.start_kill();
        }
    }
}

pub async fn open(
    profile: &Profile,
    password: Option<&str>,
) -> Result<Option<Arc<Tunnel>>, String> {
    if profile.driver != "postgres" {
        return Ok(None);
    }
    let Some(ssh) = &profile.ssh else {
        return Ok(None);
    };
    ssh.validate()?;
    validate_host(&profile.host)?;
    // A short private path avoids macOS's Unix socket pathname limit.
    let directory = tempfile::Builder::new()
        .prefix("dum-e-")
        .tempdir_in("/tmp")
        .map_err(|e| format!("Could not create SSH tunnel directory: {e}"))?;
    let socket = directory.path().join(format!(".s.PGSQL.{}", profile.port));
    let target = if profile.host.contains(':') {
        format!("[{}]", profile.host)
    } else {
        profile.host.clone()
    };
    let password = if ssh.authentication == SshAuthentication::Password {
        let password = password
            .filter(|p| !p.is_empty())
            .ok_or("Enter the SSH password.")?;
        if password.len() > 8192 || password.contains(['\n', '\r', '\0']) {
            return Err("SSH passwords must be a single line up to 8 KB.".into());
        }
        Some(password)
    } else {
        None
    };
    let askpass_socket = directory.path().join("askpass.sock");
    let askpass = directory.path().join("askpass");
    let listener = if password.is_some() {
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        // The helper contains no credential. OpenSSH reads the password once
        // over a socket inside this owner-only temporary directory.
        let mut helper = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o700)
            .open(&askpass)
            .map_err(|e| e.to_string())?;
        helper
            .write_all(b"#!/bin/sh\nexec /usr/bin/nc -U \"$DUM_E_SSH_ASKPASS_SOCKET\"\n")
            .map_err(|e| e.to_string())?;
        Some(UnixListener::bind(&askpass_socket).map_err(|e| e.to_string())?)
    } else {
        None
    };
    let stderr = tempfile::tempfile().map_err(|e| e.to_string())?;
    let mut command = Command::new("/usr/bin/ssh");
    #[cfg(test)]
    if let Ok(path) = std::env::var("DUM_E_TEST_SSH_KNOWN_HOSTS") {
        command.arg("-o").arg(format!("UserKnownHostsFile={path}"));
    }
    command
        .args(["-F", "/dev/null", "-n", "-N", "-T", "-S", "none"])
        .args([
            "-o",
            "StrictHostKeyChecking=yes",
            "-o",
            "ExitOnForwardFailure=yes",
            "-o",
            "ConnectTimeout=10",
            "-o",
            "ServerAliveInterval=15",
            "-o",
            "ServerAliveCountMax=3",
        ])
        .arg("-p")
        .arg(ssh.port.to_string())
        .arg("-l")
        .arg(&ssh.username)
        .arg("-L")
        .arg(format!("{}:{target}:{}", socket.display(), profile.port));
    if password.is_some() {
        command
            .args([
                "-o",
                "BatchMode=no",
                "-o",
                "PreferredAuthentications=password",
                "-o",
                "NumberOfPasswordPrompts=1",
                "-o",
                "KbdInteractiveAuthentication=no",
            ])
            .env("SSH_ASKPASS", &askpass)
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("DISPLAY", "dum-e:0")
            .env("DUM_E_SSH_ASKPASS_SOCKET", &askpass_socket);
    } else {
        command.args(["-o", "BatchMode=yes"]);
    }
    if ssh.authentication == SshAuthentication::Key && !ssh.identity_file.is_empty() {
        command
            .arg("-i")
            .arg(&ssh.identity_file)
            .args(["-o", "IdentitiesOnly=yes"]);
    }
    let child = command
        .arg("--")
        .arg(&ssh.host)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::from(stderr.try_clone().map_err(|e| e.to_string())?))
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Could not start OpenSSH: {e}"))?;
    let tunnel = Arc::new(Tunnel {
        child: Mutex::new(child),
        directory,
        stderr,
    });
    let mut password_sent = false;
    for _ in 0..120 {
        tunnel.check()?;
        if socket.exists() {
            return Ok(Some(tunnel));
        }
        tokio::select! {
            accepted = async { listener.as_ref().unwrap().accept().await }, if listener.is_some() && !password_sent => {
                let (mut stream, _) = accepted.map_err(|e| format!("SSH password prompt failed: {e}"))?;
                tokio::time::timeout(Duration::from_secs(1), async {
                    stream.write_all(password.unwrap().as_bytes()).await?;
                    stream.write_all(b"\n").await?;
                    stream.shutdown().await
                }).await.map_err(|_| "SSH password prompt timed out")?
                    .map_err(|e| format!("SSH password prompt failed: {e}"))?;
                password_sent = true;
            }
            _ = tokio::time::sleep(Duration::from_millis(100)) => {}
        }
    }
    Err("SSH tunnel timed out after 12 seconds.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_forwarding_addresses() {
        for host in ["localhost", "db.internal", "10.0.0.4", "::1"] {
            assert!(validate_host(host).is_ok());
        }
        for host in [
            "",
            "-oProxyCommand=x",
            "host:5432/db",
            "host name",
            "host\n",
        ] {
            assert!(validate_host(host).is_err());
        }
    }

    #[test]
    fn old_profiles_and_ssh_profiles_round_trip_without_runtime_state() {
        let old = serde_json::json!({
            "id": "a0000000-0000-4000-8000-000000000001", "name": "Test",
            "driver": "postgres", "host": "db.internal", "database": "test", "username": "test"
        });
        let mut profile: Profile = serde_json::from_value(old).unwrap();
        assert!(profile.ssh.is_none());
        assert!(profile.tunnel.is_none());
        profile.ssh = Some(SshConfig {
            host: "bastion.internal".into(),
            port: 22,
            username: "test".into(),
            identity_file: String::new(),
            authentication: SshAuthentication::Key,
        });
        profile.tls = false;
        profile.validate().unwrap();
        let stored = serde_json::to_value(&profile).unwrap();
        assert!(stored.get("tunnel").is_none());
        let restored: Profile = serde_json::from_value(stored).unwrap();
        assert_eq!(restored.ssh.unwrap().host, "bastion.internal");
        profile.ssh = None;
        assert!(profile.validate().is_err());
    }

    #[tokio::test]
    #[ignore = "Requires an isolated PostgreSQL + SSH fixture"]
    async fn ssh_real_postgres_session_and_cleanup() {
        use sqlx::{Connection, Executor};
        let mut profile: Profile = serde_json::from_value(serde_json::json!({
            "id": "a0000000-0000-4000-8000-000000000001", "name": "SSH integration",
            "driver": "postgres", "host": "127.0.0.1", "port": 5432,
            "database": "postgres", "username": "postgres", "tls": false,
            "ssh": { "host": "127.0.0.1", "port": std::env::var("DUM_E_TEST_SSH_PORT").unwrap().parse::<u16>().unwrap(),
                "username": "root", "identityFile": std::env::var("DUM_E_TEST_SSH_KEY").unwrap() }
        })).unwrap();
        crate::db::test_connection(&profile, "dum-e-local-test-only", None)
            .await
            .unwrap();
        profile.tunnel = open(&profile, None).await.unwrap();
        let directory = profile.tunnel.as_ref().unwrap().directory().to_path_buf();
        let mut connection = crate::db::postgres_mode(&profile, "dum-e-local-test-only", true)
            .await
            .unwrap();
        connection
            .execute("CREATE TABLE ssh_fixture (id integer PRIMARY KEY)")
            .await
            .unwrap();
        connection
            .execute("INSERT INTO ssh_fixture VALUES (1)")
            .await
            .unwrap();
        connection.close().await.unwrap();
        assert!(crate::db::tables(&profile, "dum-e-local-test-only")
            .await
            .unwrap()
            .iter()
            .any(|t| t.name == "ssh_fixture"));
        let mut tls_profile = profile.clone();
        tls_profile.tls = true;
        let error = crate::db::postgres(&tls_profile, "dum-e-local-test-only")
            .await
            .err()
            .expect("TLS must still be required through the socket");
        assert!(error.contains("TLS"), "{error}");
        drop(tls_profile);
        let cloned = profile.clone();
        let serialized = serde_json::to_value(&profile).unwrap();
        assert!(serialized.get("tunnel").is_none());
        drop(profile);
        assert!(directory.exists());
        let mut connection = crate::db::postgres(&cloned, "dum-e-local-test-only")
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM ssh_fixture")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(count, 1);
        connection.close().await.unwrap();
        cloned.tunnel.as_ref().unwrap().stop();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(crate::db::postgres(&cloned, "dum-e-local-test-only")
            .await
            .is_err());
        drop(cloned);
        assert!(!directory.exists());
        let mut restored: Profile = serde_json::from_value(serialized).unwrap();
        restored.ssh.as_mut().unwrap().host = "localhost".into();
        let error = open(&restored, None)
            .await
            .err()
            .expect("Unknown SSH hosts must be rejected");
        assert!(error.contains("Host key verification failed"), "{error}");
    }

    #[tokio::test]
    #[ignore = "Requires an isolated PostgreSQL + SSH fixture"]
    async fn ssh_real_postgres_password_authentication() {
        use sqlx::Connection;
        let mut profile: Profile = serde_json::from_value(serde_json::json!({
            "id": "a0000000-0000-4000-8000-000000000002", "name": "SSH password integration",
            "driver": "postgres", "host": "127.0.0.1", "port": 5432,
            "database": "postgres", "username": "postgres", "tls": false,
            "ssh": { "host": "127.0.0.1", "port": std::env::var("DUM_E_TEST_SSH_PORT").unwrap().parse::<u16>().unwrap(),
                "username": "root", "authentication": "password" }
        })).unwrap();
        let password = std::env::var("DUM_E_TEST_SSH_PASSWORD").unwrap();
        assert!(open(&profile, None).await.is_err());
        let error = open(&profile, Some("incorrect-fixture-password"))
            .await
            .err()
            .expect("Incorrect SSH password must fail");
        assert!(error.contains("Permission denied"), "{error}");
        assert!(!error.contains("incorrect-fixture-password"));
        crate::db::test_connection(&profile, "dum-e-local-test-only", Some(&password))
            .await
            .unwrap();
        profile.tunnel = open(&profile, Some(&password)).await.unwrap();
        let tunnel = profile.tunnel.as_ref().unwrap();
        for entry in std::fs::read_dir(tunnel.directory()).unwrap() {
            let path = entry.unwrap().path();
            if path.is_file() {
                let contents = std::fs::read_to_string(path).unwrap();
                assert!(!contents.contains(&password));
            }
        }
        assert!(!serde_json::to_string(&profile).unwrap().contains(&password));
        let pid = tunnel.child.lock().unwrap().id().unwrap();
        let args = std::process::Command::new("/bin/ps")
            .args(["-p", &pid.to_string(), "-o", "command="])
            .output()
            .unwrap();
        assert!(!String::from_utf8_lossy(&args.stdout).contains(&password));
        let mut connection = crate::db::postgres(&profile, "dum-e-local-test-only")
            .await
            .unwrap();
        let value: i32 = sqlx::query_scalar("SELECT 42")
            .fetch_one(&mut connection)
            .await
            .unwrap();
        assert_eq!(value, 42);
        connection.close().await.unwrap();
        let directory = tunnel.directory().to_path_buf();
        drop(profile);
        assert!(!directory.exists());
    }
}
