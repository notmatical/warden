/** The viewport engine: the pure (render-free) half. Components that need the
 *  per-kind renderer/icon/title import `describe`/`PaneContent` from
 *  `./content-registry` instead — kept separate so the store stays React-free. */
export * from "./content-kinds"
export * from "./pane-tree"
export * from "./view"
