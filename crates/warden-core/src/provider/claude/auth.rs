//! Claude auth: it has no status subcommand, so we infer login from its stored
//! credentials.

pub fn is_authed() -> bool {
    let home = crate::util::home_dir().unwrap_or_default();
    home.join(".claude").join(".credentials.json").exists() || home.join(".claude.json").exists()
}
