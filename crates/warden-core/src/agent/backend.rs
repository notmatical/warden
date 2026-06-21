use serde::{Deserialize, Serialize};
use specta::Type;
use strum::{EnumString, IntoStaticStr, VariantArray};

/// Which agent backend powers a session — the serializable *identity* of a
/// provider. Provider *behavior* (run, auth, install, model resolution) lives
/// behind the `Provider` trait + registry (in `crate::provider`) and
/// is keyed by this enum. Adding a backend is: a variant here + an adapter that
/// implements `Provider` + one registration — nothing else dispatches on it.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    Type,
    EnumString,
    IntoStaticStr,
    VariantArray,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Backend {
    Claude,
    Codex,
    Opencode,
}

impl Backend {
    /// The canonical string — identical to the serde, DB, and CLI token form
    /// (`"claude"`, `"codex"`, `"opencode"`).
    pub fn as_str(self) -> &'static str {
        self.into()
    }

    /// Parse the canonical string; `None` if unrecognized.
    pub fn parse(s: &str) -> Option<Self> {
        s.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The serde representation and the strum-derived `as_str` must stay in
    /// lockstep — they are the same string used for IPC, the DB, and CLI flags.
    #[test]
    fn serde_and_strum_strings_agree() {
        for &b in Backend::VARIANTS {
            assert_eq!(
                serde_json::to_value(b).unwrap(),
                serde_json::Value::String(b.as_str().to_owned()),
                "serde repr must match as_str for {b:?}",
            );
            assert_eq!(Backend::parse(b.as_str()), Some(b));
        }
    }
}
