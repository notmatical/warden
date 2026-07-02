//! Mapping a repo's `origin` remote to a browsable `https` URL: SSH/scp forms
//! normalized, `.git` stripped, and `~/.ssh/config` host aliases resolved.

use std::path::Path;
use std::process::Command;

use super::cli::run;

/// The repo's `origin` remote as a browsable `https` URL (SSH forms and a `.git`
/// suffix normalized away), or `None` if there's no origin or it isn't a URL we
/// recognize.
pub fn remote_browse_url(repo: &Path) -> Option<String> {
    let raw = run(repo, &["remote", "get-url", "origin"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    normalize_remote_url(&raw)
}

/// Map a git remote URL to an `https` browser URL. Resolves `~/.ssh/config`
/// host aliases (so `git@gh-alias:owner/repo` lands on the real host):
///   `git@host:owner/repo(.git)`     → `https://host/owner/repo`
///   `ssh://git@host/owner/repo.git` → `https://host/owner/repo`
///   `https://host/owner/repo.git`   → `https://host/owner/repo`
pub fn normalize_remote_url(raw: &str) -> Option<String> {
    let url = raw.trim();
    let strip_git = |s: &str| s.strip_suffix(".git").unwrap_or(s).to_string();

    if let Some(rest) = url.strip_prefix("ssh://") {
        let rest = rest.strip_prefix("git@").unwrap_or(rest);
        if let Some((host, path)) = rest.split_once('/') {
            let host = host.split(':').next().unwrap_or(host); // drop any :port
            return Some(format!(
                "https://{}/{}",
                resolve_ssh_host(host),
                strip_git(path)
            ));
        }
        return Some(format!("https://{}", strip_git(rest)));
    }

    if url.starts_with("http://") || url.starts_with("https://") {
        return Some(strip_git(url));
    }

    // scp-like syntax: [git@]host:owner/repo — `host` is often an ssh alias.
    if let Some((before, path)) = url.split_once(':') {
        if !before.contains('/') && !path.is_empty() {
            let host = before.strip_prefix("git@").unwrap_or(before);
            return Some(format!(
                "https://{}/{}",
                resolve_ssh_host(host),
                strip_git(path)
            ));
        }
    }
    None
}

/// Resolve an ssh host that may be a `~/.ssh/config` alias to its real hostname
/// (via `ssh -G`); a host already containing a dot is assumed real. Strips a
/// leading `ssh.` (GitHub's port-443 alias host) when that leaves a domain.
pub fn resolve_ssh_host(host: &str) -> String {
    let real = if host.contains('.') {
        host.to_string()
    } else {
        let mut cmd = Command::new("ssh");
        cmd.args(["-G", host]);
        crate::platform::silent_command(&mut cmd);
        cmd.output()
            .ok()
            .and_then(|out| {
                String::from_utf8_lossy(&out.stdout)
                    .lines()
                    .find_map(|l| l.strip_prefix("hostname ").map(|h| h.trim().to_string()))
                    .filter(|h| !h.is_empty())
            })
            .unwrap_or_else(|| host.to_string())
    };
    match real.strip_prefix("ssh.") {
        Some(rest) if rest.contains('.') => rest.to_string(),
        _ => real,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Hosts carrying a dot skip the `ssh -G` shell-out, so these are hermetic.

    #[test]
    fn https_url_strips_dot_git() {
        assert_eq!(
            normalize_remote_url("https://github.com/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn https_url_without_suffix_passes_through() {
        assert_eq!(
            normalize_remote_url("https://github.com/owner/repo").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn scp_form_becomes_https() {
        assert_eq!(
            normalize_remote_url("git@github.com:owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn scp_form_without_user_prefix() {
        assert_eq!(
            normalize_remote_url("github.com:owner/repo").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn ssh_scheme_becomes_https() {
        assert_eq!(
            normalize_remote_url("ssh://git@github.com/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn ssh_scheme_drops_port() {
        assert_eq!(
            normalize_remote_url("ssh://git@github.com:22/owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn ssh_alias_host_prefix_stripped_to_real_domain() {
        // GitHub's port-443 alias host `ssh.github.com` browses as `github.com`.
        assert_eq!(resolve_ssh_host("ssh.github.com"), "github.com");
        assert_eq!(
            normalize_remote_url("git@ssh.github.com:owner/repo.git").as_deref(),
            Some("https://github.com/owner/repo")
        );
    }

    #[test]
    fn dotted_host_is_assumed_real() {
        assert_eq!(resolve_ssh_host("gitlab.example.com"), "gitlab.example.com");
    }

    #[test]
    fn unrecognized_form_is_none() {
        assert_eq!(normalize_remote_url("not a url"), None);
        assert_eq!(normalize_remote_url(""), None);
    }
}
