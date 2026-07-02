import "@xterm/xterm/css/xterm.css"

import { Channel } from "@tauri-apps/api/core"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { WebglAddon } from "@xterm/addon-webgl"
import { Terminal } from "@xterm/xterm"

import * as ipc from "@/lib/ipc"

// xterm instances live in a module map (not React state) so scrollback and the
// PTY survive tab switches: we move each terminal's element between containers
// rather than re-creating it.
interface Instance {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  opened: boolean
  started: boolean
  cols: number
  rows: number
}

const instances = new Map<string, Instance>()

// Sample the app's resolved `--background` so the terminal matches the surface
// it sits on — xterm needs a concrete color, not the oklch CSS var.
function theme() {
  const probe = document.createElement("div")
  probe.className = "bg-background"
  probe.style.display = "none"
  document.body.appendChild(probe)
  const background = getComputedStyle(probe).backgroundColor || "#1b1a17"
  probe.remove()
  return {
    background,
    foreground: "#e8e3d8",
    cursor: "#e8e3d8",
    cursorAccent: "#1b1a17",
    selectionBackground: "#3a3833",
  }
}

function create(id: string): Instance {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: theme(),
    allowProposedApi: true,
  })
  term.loadAddon(new WebLinksAddon())
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.onData((data) => void ipc.terminalWrite(id, data))

  const el = document.createElement("div")
  el.style.height = "100%"
  el.style.width = "100%"

  const inst: Instance = {
    term,
    fit,
    el,
    opened: false,
    started: false,
    cols: 0,
    rows: 0,
  }
  instances.set(id, inst)
  return inst
}

function startPty(id: string, workingDir: string, inst: Instance) {
  inst.started = true
  const channel = new Channel<ipc.TerminalEvent>()
  channel.onmessage = (msg) => {
    if (msg.event === "output" && msg.data) inst.term.write(msg.data)
    else if (msg.event === "exit")
      inst.term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")
  }
  void ipc.startTerminal(id, workingDir, inst.cols, inst.rows, channel)
}

// Repaint every row. Clears ghost glyphs the DOM renderer leaves behind after
// re-parenting, or after the webview's render loop was paused while hidden.
function repaint(inst: Instance) {
  try {
    inst.term.refresh(0, Math.max(0, inst.term.rows - 1))
  } catch {}
}

// Fit to the container, pushing the size to the PTY only when it changed. A
// detached or zero-size box yields degenerate dims that crash portable_pty, so
// skip it and floor at the minimum the PTY accepts.
function pushResize(id: string, inst: Instance) {
  const { el } = inst
  if (!el.isConnected || el.clientWidth === 0 || el.clientHeight === 0) return
  try {
    inst.fit.fit()
  } catch {
    return
  }
  const cols = Math.max(2, inst.term.cols)
  const rows = Math.max(2, inst.term.rows)
  if (cols === inst.cols && rows === inst.rows) return
  inst.cols = cols
  inst.rows = rows
  if (inst.started) void ipc.terminalResize(id, cols, rows)
}

export function attach(id: string, container: HTMLElement, workingDir: string) {
  const inst = instances.get(id) ?? create(id)
  container.appendChild(inst.el)
  // Open only once the element is live: xterm measures cell size from layout, so
  // opening while detached caches wrong metrics — a too-narrow grid and ghost
  // text that only correct on the next resize.
  if (!inst.opened) {
    inst.term.open(inst.el)
    inst.opened = true
    // GPU renderer; xterm keeps its DOM renderer if WebGL is unavailable or its
    // context is lost (disposing the addon reverts to DOM).
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      inst.term.loadAddon(webgl)
    } catch {}
  }
  requestAnimationFrame(() => {
    if (!inst.el.isConnected) return
    pushResize(id, inst)
    if (!inst.started) startPty(id, workingDir, inst)
    inst.term.focus()
    repaint(inst)
  })
  // Re-fit once fonts settle, in case the first measure used a fallback metric.
  void document.fonts?.ready.then(() => {
    if (instances.get(id) === inst) {
      pushResize(id, inst)
      repaint(inst)
    }
  })
}

export function detach(id: string) {
  instances.get(id)?.el.remove()
}

export function fit(id: string) {
  const inst = instances.get(id)
  if (inst) pushResize(id, inst)
}

export function dispose(id: string) {
  const inst = instances.get(id)
  if (!inst) return
  instances.delete(id)
  inst.term.dispose()
  void ipc.stopTerminal(id)
}

// Re-skin every live terminal when the app's theme class flips.
if (typeof MutationObserver !== "undefined") {
  new MutationObserver(() => {
    const next = theme()
    for (const inst of instances.values()) inst.term.options.theme = next
  }).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  })
}

// The webview pauses rAF rendering while hidden/minimized; repaint on resume so
// stale rows don't linger as ghost text.
if (typeof document !== "undefined") {
  const wake = () => {
    if (document.visibilityState !== "visible") return
    for (const inst of instances.values()) repaint(inst)
  }
  document.addEventListener("visibilitychange", wake)
  window.addEventListener("focus", wake)
}
