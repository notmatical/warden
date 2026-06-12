import {
  ChevronDown,
  Code,
  Copy,
  FolderOpen,
  SquareTerminal,
} from "lucide-react"
import { useEffect, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"
import { listOpenApps, type OpenApp, openIn } from "@/lib/ipc"

interface Target {
  id: string
  label: string
  icon: typeof Code
}

const TERMINAL: Target = {
  id: "terminal",
  label: "Terminal",
  icon: SquareTerminal,
}
const FOLDER: Target = { id: "folder", label: "File explorer", icon: FolderOpen }

/** Editors installed on this machine. Probed once for the initial paint and
 *  re-probed each time the menu opens (cheap PATH lookups), so an editor
 *  installed mid-run shows up without a restart. */
let appsCache: Promise<OpenApp[]> | null = null
function detectedApps(refresh = false): Promise<OpenApp[]> {
  if (refresh || !appsCache) {
    appsCache = listOpenApps().catch(() => [])
  }
  return appsCache
}

const LAST_KEY = "warden:open-in-target"

function readLastId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/** Open the active directory in an external app. The icon runs your last-used
 *  target in one click; the chevron lists the editors installed on this
 *  machine, the terminal and file manager, and copy-path. */
export function OpenInButtons({ path }: { path: string | null | undefined }) {
  const [editors, setEditors] = useState<OpenApp[]>([])
  const [lastId, setLastId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void detectedApps().then((apps) => {
      if (live) setEditors(apps)
    })
    return () => {
      live = false
    }
  }, [])

  if (!path) {
    return null
  }

  const editorTargets: Target[] = editors.map((app) => ({
    id: app.id,
    label: app.name,
    icon: Code,
  }))
  const targets: Target[] = [...editorTargets, TERMINAL, FOLDER]
  // Last-used target if it's still available; else the first detected editor,
  // else the file manager.
  const last =
    targets.find((t) => t.id === (lastId ?? readLastId())) ??
    editorTargets[0] ??
    FOLDER
  const LastIcon = last.icon

  const run = async (target: Target) => {
    setLastId(target.id)
    try {
      localStorage.setItem(LAST_KEY, target.id)
    } catch {
      // ignore storage failures
    }
    try {
      await openIn(target.id, path)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  const copyPath = async () => {
    if (await copyText(path)) toast.success("Path copied")
  }

  return (
    <ButtonGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void run(last)}
            aria-label={`Open in ${last.label}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <LastIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in {last.label}</TooltipContent>
      </Tooltip>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) void detectedApps(true).then(setEditors)
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Open in…"
            className="text-muted-foreground hover:text-foreground"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {editorTargets.map((target) => (
            <DropdownMenuItem key={target.id} onSelect={() => void run(target)}>
              <Code />
              {target.label}
            </DropdownMenuItem>
          ))}
          {editorTargets.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => void run(TERMINAL)}>
            <SquareTerminal />
            Terminal
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run(FOLDER)}>
            <FolderOpen />
            File explorer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void copyPath()}>
            <Copy />
            Copy path
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
