import { Channel } from "@tauri-apps/api/core"
import { FitAddon } from "@xterm/addon-fit"
import { WebLinksAddon } from "@xterm/addon-web-links"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"

import * as ipc from "@/lib/ipc"

/**
 * xterm instances live here — in a module-level map, not React state — so a
 * terminal's scrollback and PTY survive tab switches and component unmounts.
 * Each instance owns a persistent wrapper element that we move between
 * containers rather than re-`open()`-ing the terminal.
 */
interface Instance {
  term: Terminal
  fit: FitAddon
  el: HTMLDivElement
  started: boolean
  /** Last size pushed to the PTY, to skip redundant resize IPC. */
  cols: number
  rows: number
}

const instances = new Map<string, Instance>()

// Approximate the app's warm-black / cream palette (xterm needs hex).
const THEME = {
  background: "#1b1a17",
  foreground: "#e8e3d8",
  cursor: "#e8e3d8",
  cursorAccent: "#1b1a17",
  selectionBackground: "#3a3833",
}

function create(id: string, workingDir: string): Instance {
  const term = new Terminal({
    fontFamily: '"JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace',
    fontSize: 13,
    cursorBlink: true,
    theme: THEME,
    allowProposedApi: true,
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.loadAddon(new WebLinksAddon())

  const el = document.createElement("div")
  el.style.height = "100%"
  el.style.width = "100%"
  term.open(el)

  // Keystrokes → PTY.
  term.onData((data) => void ipc.terminalWrite(id, data))

  const inst: Instance = { term, fit, el, started: false, cols: 0, rows: 0 }
  instances.set(id, inst)

  // Spawn the PTY once, sized to the current terminal.
  startPty(id, workingDir, inst)
  return inst
}

function startPty(id: string, workingDir: string, inst: Instance) {
  inst.started = true
  const channel = new Channel<ipc.TerminalEvent>()
  channel.onmessage = (msg) => {
    if (msg.event === "output" && msg.data) {
      inst.term.write(msg.data)
    } else if (msg.event === "exit") {
      inst.term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n")
    }
  }
  const cols = inst.term.cols || 80
  const rows = inst.term.rows || 24
  void ipc.startTerminal(id, workingDir, cols, rows, channel)
}

/** Fit to the container, pushing the new size to the PTY only when it changed. */
function pushResize(id: string, inst: Instance) {
  inst.fit.fit()
  const { cols, rows } = inst.term
  if (cols === inst.cols && rows === inst.rows) return
  inst.cols = cols
  inst.rows = rows
  void ipc.terminalResize(id, cols, rows)
}

/** Mount the terminal into `container` (creating it on first use). */
export function attach(id: string, container: HTMLElement, workingDir: string) {
  const inst = instances.get(id) ?? create(id, workingDir)
  container.appendChild(inst.el)
  // Defer the fit until the element has laid out.
  requestAnimationFrame(() => {
    pushResize(id, inst)
    inst.term.focus()
  })
}

/** Whether a live instance exists for this session (its PTY is still alive). */
export function has(id: string): boolean {
  return instances.has(id)
}

/** Remove the terminal from the DOM but keep the instance (and PTY) alive. */
export function detach(id: string) {
  instances.get(id)?.el.remove()
}

/** Refit to the container and tell the PTY the new size. */
export function fit(id: string) {
  const inst = instances.get(id)
  if (!inst) return
  pushResize(id, inst)
}

/** Permanently destroy a terminal and kill its PTY (on session delete). */
export function dispose(id: string) {
  const inst = instances.get(id)
  if (!inst) return
  instances.delete(id)
  inst.term.dispose()
  void ipc.stopTerminal(id)
}
