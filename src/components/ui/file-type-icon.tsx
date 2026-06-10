import {
  createFileTreeIconResolver,
  getBuiltInFileIconColor,
  getBuiltInSpriteSheet,
} from "@pierre/trees"

import { cn } from "@/lib/utils"

/** One resolver for the whole app — same "complete, colored" set the Browse
 *  tree renders, so file glyphs match everywhere. */
const resolver = createFileTreeIconResolver({ set: "complete", colored: true })

// The icons are <symbol>s referenced by id; mount the sprite sheet once,
// hidden, at the document root.
let spriteMounted = false
function ensureSprite() {
  if (spriteMounted || typeof document === "undefined") return
  spriteMounted = true
  const host = document.createElement("div")
  host.setAttribute("data-file-type-icon-sprite", "")
  host.style.display = "none"
  host.innerHTML = getBuiltInSpriteSheet("complete")
  document.body.appendChild(host)
}

/** A per-language file icon (pierre's built-in colored set), usable outside
 *  the FileTree — diff headers, lists, menus. Falls back to the generic file
 *  glyph for unknown types. */
export function FileTypeIcon({
  path,
  className,
}: {
  path: string
  className?: string
}) {
  ensureSprite()
  // "file-tree-icon-file" is the file slot; with a path the resolver remaps
  // it to the per-language builtin symbol (or leaves the generic glyph).
  const icon = resolver.resolveIcon("file-tree-icon-file", path)
  const color = icon.token ? getBuiltInFileIconColor(icon.token) : undefined
  return (
    <svg
      aria-hidden="true"
      viewBox={icon.viewBox ?? "0 0 16 16"}
      className={cn("shrink-0", className)}
      style={color ? { color } : undefined}
      fill="currentColor"
    >
      <use href={`#${icon.name}`} />
    </svg>
  )
}
