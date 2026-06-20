//! Lifecycle of the shared `opencode serve` HTTP server. One server process is
//! shared across every OpenCode session; requests are scoped to a session's
//! working dir via the `?directory=` query parameter. The server is killed on
//! app shutdown — OpenCode persists conversation state on disk, so the next
//! launch simply starts a fresh server and resumes sessions by id.

use std::process::Stdio;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::process::Child;
use tokio::sync::Mutex as AsyncMutex;

use crate::error::{AppError, Result};

/// How long to wait for a freshly spawned server to answer its health check.
/// Cold starts can be slow (the CLI boots a JS runtime).
const STARTUP_TIMEOUT: Duration = Duration::from_secs(30);
const HEALTH_POLL_INTERVAL: Duration = Duration::from_millis(250);

struct Server {
    base_url: String,
    child: Child,
}

static SERVER: Mutex<Option<Server>> = Mutex::new(None);
/// Serializes spawn + health-wait so racing first turns can't double-spawn.
static INIT: AsyncMutex<()> = AsyncMutex::const_new(());

/// A reqwest client for the local server: quick connects, no overall timeout
/// (turn POSTs stream for as long as the turn runs).
pub(super) fn client() -> reqwest::Client {
    static CLIENT: std::sync::OnceLock<reqwest::Client> = std::sync::OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .build()
                .expect("failed to build OpenCode HTTP client")
        })
        .clone()
}

fn lock() -> std::sync::MutexGuard<'static, Option<Server>> {
    SERVER.lock().unwrap_or_else(|p| p.into_inner())
}

/// The running server's base URL, if its process is still alive.
fn alive_url() -> Option<String> {
    let mut guard = lock();
    let server = guard.as_mut()?;
    match server.child.try_wait() {
        Ok(None) => Some(server.base_url.clone()),
        _ => {
            *guard = None;
            None
        }
    }
}

/// The base URL of the shared OpenCode server, spawning one if there is none —
/// or if the previous one died. Returns once the server answers its health
/// check.
pub async fn ensure() -> Result<String> {
    if let Some(url) = alive_url() {
        return Ok(url);
    }
    let _guard = INIT.lock().await;
    if let Some(url) = alive_url() {
        return Ok(url);
    }

    // Let the OS pick a free port: bind-and-release, then hand it to the CLI.
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .map_err(|e| AppError::Agent(format!("no free port for opencode server: {e}")))?;
    let base_url = format!("http://127.0.0.1:{port}");

    let bin = crate::cli::resolve(crate::cli::Tool::Opencode);
    let mut cmd = tokio::process::Command::new(&bin);
    cmd.args([
        "serve",
        "--hostname",
        "127.0.0.1",
        "--port",
        &port.to_string(),
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .kill_on_drop(true);
    crate::platform::detach_command(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| AppError::Agent(format!("failed to spawn {bin:?} serve: {e}")))?;

    let started = Instant::now();
    loop {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(AppError::Agent(format!(
                "opencode server exited during startup ({status})"
            )));
        }
        let healthy = client()
            .get(format!("{base_url}/global/health"))
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if healthy {
            break;
        }
        if started.elapsed() > STARTUP_TIMEOUT {
            let _ = child.start_kill();
            return Err(AppError::Agent(
                "opencode server did not become healthy in time".to_string(),
            ));
        }
        tokio::time::sleep(HEALTH_POLL_INTERVAL).await;
    }

    *lock() = Some(Server {
        base_url: base_url.clone(),
        child,
    });
    Ok(base_url)
}

/// Kill the shared server (app shutdown). Idempotent.
pub fn kill_all() {
    if let Some(mut server) = lock().take() {
        let _ = server.child.start_kill();
    }
}
