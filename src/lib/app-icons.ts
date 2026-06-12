import antigravity from "@/assets/app-icons/antigravity.svg"
import clion from "@/assets/app-icons/clion.svg"
import cursor from "@/assets/app-icons/cursor.svg"
import fleet from "@/assets/app-icons/fleet.svg"
import ghostty from "@/assets/app-icons/ghostty.svg"
import goland from "@/assets/app-icons/goland.svg"
import intellij from "@/assets/app-icons/intellij.svg"
import powershell from "@/assets/app-icons/powershell.svg"
import pycharm from "@/assets/app-icons/pycharm.svg"
import rider from "@/assets/app-icons/rider.svg"
import rustrover from "@/assets/app-icons/rustrover.svg"
import sublime from "@/assets/app-icons/sublime.svg"
import vscode from "@/assets/app-icons/vscode.svg"
import vscodeInsiders from "@/assets/app-icons/vscode-insiders.svg"
import warp from "@/assets/app-icons/warp.png"
import webstorm from "@/assets/app-icons/webstorm.svg"
import zed from "@/assets/app-icons/zed.png"

/** Brand icon for each app the open-in menu can offer, keyed by the backend's
 *  app ids (see EDITORS and TERMINALS in src-tauri/src/core/external.rs).
 *  Apps without an entry fall back to a lucide glyph. */
export const APP_ICON_URL: Record<string, string> = {
  vscode,
  "vscode-insiders": vscodeInsiders,
  cursor,
  zed,
  sublime,
  idea: intellij,
  webstorm,
  pycharm,
  rider,
  goland,
  clion,
  rustrover,
  fleet,
  antigravity,
  warp,
  ghostty,
  powershell,
  // Windows Terminal hosts PowerShell by default; the PowerShell mark reads
  // better than a generic glyph (and the two are never shown together).
  wt: powershell,
}
