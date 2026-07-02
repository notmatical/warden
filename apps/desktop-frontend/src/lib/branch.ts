/** Branch name for an issue in GitHub's "create a branch" convention:
 *  `42-fix-empty-config-crash`. No semantic prefix — the issue source
 *  doesn't say whether it's a feature, fix, or refactor. */
export function issueBranchName(id: string | number, title: string): string {
  const full = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  // Truncate on a word boundary so we don't end in a chopped word.
  const slug =
    full.length > 40 ? full.slice(0, 41).replace(/-[^-]*$/, "") : full
  return slug ? `${id}-${slug}` : String(id)
}
