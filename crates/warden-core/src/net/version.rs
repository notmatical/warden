//! Version-string extraction shared by status (`--version` output) and the
//! distributions (GitHub release tags).

/// Pull the first `digits.digits…` run out of a `--version` line such as
/// "claude 1.2.3 (Claude Code)", "codex-cli 0.116.0-alpha.12", or "gh version 2.62.0".
pub fn extract_version(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|tok| {
            let t = tok.trim_start_matches('v');
            t.contains('.') && t.chars().next().is_some_and(|c| c.is_ascii_digit())
        })
        .map(|tok| tok.trim_start_matches('v').to_string())
}

/// Strip a release tag down to its semver (`rust-v0.1.2` / `v0.1.2` → `0.1.2`).
/// Tags don't whitespace-split, so the version is isolated by splitting on `v`.
pub fn version_from_tag(tag: &str) -> String {
    for part in tag.split('v') {
        let trimmed = part.trim_end_matches('-');
        if trimmed.contains('.') && trimmed.chars().next().is_some_and(|c| c.is_ascii_digit()) {
            return trimmed.to_string();
        }
    }
    tag.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_version_from_cli_output() {
        assert_eq!(
            extract_version("claude 1.2.3 (Claude Code)").as_deref(),
            Some("1.2.3")
        );
        assert_eq!(
            extract_version("codex-cli 0.116.0-alpha.12").as_deref(),
            Some("0.116.0-alpha.12")
        );
        assert_eq!(
            extract_version("gh version 2.62.0 (2024-11-14)").as_deref(),
            Some("2.62.0")
        );
        assert_eq!(extract_version("no version here"), None);
    }

    #[test]
    fn strips_release_tags_to_semver() {
        assert_eq!(version_from_tag("v2.62.0"), "2.62.0");
        assert_eq!(
            version_from_tag("rust-v0.116.0-alpha.12"),
            "0.116.0-alpha.12"
        );
    }
}
