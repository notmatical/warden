---
"warden": minor
---

CLI sourcing is now a clear two-way choice per tool — **Managed** (warden installs and keeps it updated, the default) or **System** (use your PATH install; you manage updates) — replacing the ambiguous three-way Auto/System/Managed. The confusing "Auto" mode (which preferred the un-updatable PATH binary and silently undermined updates) is gone. Existing setups are migrated once: a working system-only install is kept on "System", everything else defaults to "Managed". The settings toggle now explains what each choice means, and Managed is always selectable so picking it offers an install.
