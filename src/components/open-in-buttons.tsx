import {
  ChevronDown,
  Code,
  FolderOpen,
  SquareCode,
  SquareTerminal,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { type OpenTarget, openIn } from "@/lib/ipc"

const TARGETS: { target: OpenTarget; label: string; icon: typeof Code }[] = [
  { target: "zed", label: "Zed", icon: SquareCode },
  { target: "vscode", label: "VS Code", icon: Code },
  { target: "terminal", label: "Terminal", icon: SquareTerminal },
  { target: "folder", label: "File explorer", icon: FolderOpen },
]

const LAST_KEY = "warden:open-in-target"

function readLast(): OpenTarget {
  try {
    const value = localStorage.getItem(LAST_KEY)
    return TARGETS.some((t) => t.target === value)
      ? (value as OpenTarget)
      : "zed"
  } catch {
    return "zed"
  }
}

/** Open the active directory in an external app. The icon runs your last-used
 *  target in one click; the chevron picks another (and remembers it). */
export function OpenInButtons({ path }: { path: string | null | undefined }) {
  const [last, setLast] = useState<OpenTarget>(readLast)

  if (!path) {
    return null
  }

  const lastMeta = TARGETS.find((t) => t.target === last) ?? TARGETS[0]
  const LastIcon = lastMeta.icon

  const run = async (target: OpenTarget) => {
    setLast(target)
    try {
      localStorage.setItem(LAST_KEY, target)
    } catch {
      // ignore storage failures
    }
    try {
      await openIn(target, path)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <ButtonGroup>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void run(last)}
            aria-label={`Open in ${lastMeta.label}`}
            className="text-muted-foreground hover:text-foreground"
          >
            <LastIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in {lastMeta.label}</TooltipContent>
      </Tooltip>
      <DropdownMenu>
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
        <DropdownMenuContent align="end" className="w-44">
          {TARGETS.map(({ target, label, icon: Icon }) => (
            <DropdownMenuItem key={target} onSelect={() => void run(target)}>
              <Icon />
              Open in {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
