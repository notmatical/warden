//! Generic JSON-RPC 2.0 client over a child process's stdio, speaking
//! newline-delimited JSON. Owns the plumbing every app-server-style backend
//! needs — request/response correlation by id, notification routing by a
//! caller-supplied key, reader/writer loops, stderr capture — leaving the
//! provider adapter to do protocol translation only.

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{mpsc, oneshot, Mutex as AsyncMutex};

use crate::error::{AppError, Result};

/// A control RPC always responds promptly; the real work streams as
/// notifications. A missing response means something is wrong — time out
/// rather than hang the caller forever.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// How much captured stderr is kept for mid-turn death messages.
const STDERR_TAIL_CHARS: usize = 2_000;

/// A server notification routed to a subscriber.
pub struct Notification {
    pub method: String,
    pub params: Value,
}

/// Extracts a notification's routing key (e.g. its thread id) from
/// `(method, params)`; `None` drops the notification.
pub type RouteFn = fn(&str, &Value) -> Option<String>;

/// One spawned server process and its JSON-RPC plumbing. Cheap to share via
/// `Arc`; all methods take `&self`.
pub struct Client {
    /// Short human name for log/error messages, e.g. "codex app-server".
    name: &'static str,
    /// Writer half of the process stdin; serialized messages are written here.
    stdin: AsyncMutex<ChildStdin>,
    /// The child handle, kept so the process can be killed on shutdown.
    child: Mutex<Child>,
    /// Flipped when the server's stdout closes; the process is unusable after.
    closed: AtomicBool,
    /// Monotonic JSON-RPC request id.
    next_id: AtomicU64,
    /// In-flight requests awaiting a response, keyed by id.
    pending: Mutex<HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>,
    /// Notification subscribers, keyed by the value `route` extracts.
    routes: Mutex<HashMap<String, mpsc::UnboundedSender<Notification>>>,
    route: RouteFn,
    /// Tail of the process's stderr, surfaced when it dies unexpectedly.
    stderr_tail: Mutex<String>,
}

impl Client {
    /// Spawn `cmd` with piped stdio and start the reader/stderr tasks. The
    /// process is killed if the handle drops (a JSON-RPC server is useless
    /// without its client — see the codex adapter for why survival doesn't
    /// apply here).
    pub fn spawn(name: &'static str, mut cmd: Command, route: RouteFn) -> Result<Arc<Self>> {
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        let mut child = cmd.spawn()?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| AppError::Agent(format!("failed to capture {name} stdin")))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| AppError::Agent(format!("failed to capture {name} stdout")))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| AppError::Agent(format!("failed to capture {name} stderr")))?;

        let client = Arc::new(Client {
            name,
            stdin: AsyncMutex::new(stdin),
            child: Mutex::new(child),
            closed: AtomicBool::new(false),
            next_id: AtomicU64::new(1),
            pending: Mutex::new(HashMap::new()),
            routes: Mutex::new(HashMap::new()),
            route,
            stderr_tail: Mutex::new(String::new()),
        });

        tauri::async_runtime::spawn(reader_loop(client.clone(), stdout));
        tauri::async_runtime::spawn(drain_stderr(client.clone(), stderr));
        Ok(client)
    }

    /// Whether the process is still usable (stdout open, not exited).
    pub fn is_alive(&self) -> bool {
        if self.closed.load(Ordering::SeqCst) {
            return false;
        }
        match self.child.lock() {
            Ok(mut child) => matches!(child.try_wait(), Ok(None)),
            Err(_) => false,
        }
    }

    /// Send a request and await its response. Errors carry the server's error
    /// message when the response is an error object.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending_map().insert(id, tx);

        let request = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.write(&request).await {
            self.pending_map().remove(&id);
            return Err(e);
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(Ok(value))) => Ok(value),
            Ok(Ok(Err(message))) => Err(AppError::Agent(message)),
            Ok(Err(_)) => Err(AppError::Agent(format!(
                "{} dropped the response to {method}",
                self.name
            ))),
            Err(_) => {
                self.pending_map().remove(&id);
                Err(AppError::Agent(format!(
                    "{} timed out responding to {method}",
                    self.name
                )))
            }
        }
    }

    /// Send a notification (no id, no response expected).
    pub async fn notify(&self, method: &str, params: Value) -> Result<()> {
        self.write(&json!({ "jsonrpc": "2.0", "method": method, "params": params }))
            .await
    }

    /// Receive the notifications whose routing key is `key`. The channel
    /// closes when the server exits or `unsubscribe` is called.
    pub fn subscribe(&self, key: &str) -> mpsc::UnboundedReceiver<Notification> {
        let (tx, rx) = mpsc::unbounded_channel();
        self.routes_map().insert(key.to_string(), tx);
        rx
    }

    pub fn unsubscribe(&self, key: &str) {
        self.routes_map().remove(key);
    }

    /// Kill the server process. Idempotent.
    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.start_kill();
        }
    }

    /// The captured tail of the process's stderr, for error surfacing.
    pub fn stderr_tail(&self) -> String {
        self.stderr_tail
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    async fn write(&self, msg: &Value) -> Result<()> {
        let line = serde_json::to_string(msg)?;
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(line.as_bytes()).await?;
        stdin.write_all(b"\n").await?;
        stdin.flush().await?;
        Ok(())
    }

    fn pending_map(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<u64, oneshot::Sender<std::result::Result<Value, String>>>>
    {
        self.pending.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn routes_map(
        &self,
    ) -> std::sync::MutexGuard<'_, HashMap<String, mpsc::UnboundedSender<Notification>>> {
        self.routes.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn dispatch_response(&self, msg: &Value) {
        let Some(id) = msg.get("id").and_then(Value::as_u64) else {
            return;
        };
        let Some(tx) = self.pending_map().remove(&id) else {
            return;
        };
        let result = if let Some(err) = msg.get("error") {
            let message = err
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("unknown error")
                .to_string();
            Err(message)
        } else {
            Ok(msg.get("result").cloned().unwrap_or(Value::Null))
        };
        let _ = tx.send(result);
    }

    fn dispatch_notification(&self, method: &str, msg: &Value) {
        let params = msg.get("params").cloned().unwrap_or(Value::Null);
        let Some(key) = (self.route)(method, &params) else {
            return;
        };
        if let Some(tx) = self.routes_map().get(&key) {
            let _ = tx.send(Notification {
                method: method.to_string(),
                params,
            });
        }
    }
}

/// Read the server's stdout line by line: responses resolve pending requests,
/// notifications route to their subscriber. On EOF the server is gone — fail
/// every pending request and close every subscription channel.
async fn reader_loop(client: Arc<Client>, stdout: tokio::process::ChildStdout) {
    let mut lines = BufReader::new(stdout).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(msg) = serde_json::from_str::<Value>(line) else {
            log::warn!("{}: unparseable line: {line}", client.name);
            continue;
        };

        let has_id = msg.get("id").is_some();
        let method = msg.get("method").and_then(Value::as_str);

        match (method, has_id) {
            // Response to one of our requests.
            (None, true) => client.dispatch_response(&msg),
            // Notification (no id) — route to its subscriber.
            (Some(method), false) => client.dispatch_notification(method, &msg),
            // Server-initiated request (e.g. an approval prompt). None of the
            // current adapters expect these; log rather than drop silently.
            (Some(method), true) => {
                log::debug!("{}: ignoring server request {method}", client.name);
            }
            (None, false) => {}
        }
    }

    client.closed.store(true, Ordering::SeqCst);
    for (_, tx) in client.pending_map().drain() {
        let _ = tx.send(Err(format!("{} exited", client.name)));
    }
    client.routes_map().clear();
    log::warn!("{} stdout closed", client.name);
}

async fn drain_stderr(client: Arc<Client>, mut stderr: tokio::process::ChildStderr) {
    let mut buf = String::new();
    let _ = stderr.read_to_string(&mut buf).await;
    let trimmed = buf.trim();
    if trimmed.is_empty() {
        return;
    }
    log::debug!("{} stderr: {trimmed}", client.name);
    let tail = match trimmed.char_indices().nth_back(STDERR_TAIL_CHARS) {
        Some((idx, _)) => &trimmed[idx..],
        None => trimmed,
    };
    if let Ok(mut slot) = client.stderr_tail.lock() {
        *slot = tail.to_string();
    }
}
