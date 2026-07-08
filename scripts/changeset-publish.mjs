// The changesets GitHub Action runs this as its "publish" step once a Version
// Packages PR is merged. We don't publish to npm — we just tell the action a
// release is needed (the `New tag:` line it scans for), but only once per
// version: if the tag already exists, stay silent so unrelated pushes to main
// don't re-trigger a release.
import { execSync } from "node:child_process"
import { readFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("apps/desktop/package.json", "utf8"))
const tag = `warden-v${version}`

try {
  execSync(`git rev-parse -q --verify "refs/tags/${tag}"`, { stdio: "ignore" })
  console.log(`Tag ${tag} already exists — nothing to release.`)
} catch {
  // No tag yet → signal the action (and thus the build job) to cut a release.
  // Must name a real workspace package (@warden/desktop) — the action looks it
  // up to mark it "published"; the bare root name "warden" isn't a package.
  console.log(`New tag: @warden/desktop@${version}`)
}
