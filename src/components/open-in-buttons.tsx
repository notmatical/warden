import {
  ChevronDown,
  Code,
  FolderOpen,
  SquareCode,
  SquareTerminal,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { openIn, type OpenTarget } from "@/lib/ipc"

const MENU: { target: OpenTarget; label: string; icon: typeof Code }[] = [
  { target: "zed", label: "Zed", icon: SquareCode },
  { target: "vscode", label: "VS Code", icon: Code },
  { target: "terminal", label: "Terminal", icon: SquareTerminal },
  { target: "folder", label: "File explorer", icon: FolderOpen },
]

/** Split button: the primary action opens the directory in Zed; the chevron
 *  reveals the other targets (VS Code, terminal, file explorer). */
export function OpenInButtons({ path }: { path: string | null | undefined }) {
  if (!path) {
    return null
  }

  const run = async (target: OpenTarget) => {
    try {
      await openIn(target, path)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <ButtonGroup>
      <Button variant="secondary" size="sm" onClick={() => void run("zed")}>
        <SquareCode />
        Open in Zed
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="secondary"
            size="icon-sm"
            aria-label="More open options"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          {MENU.map(({ target, label, icon: Icon }) => (
            <DropdownMenuItem key={target} onSelect={() => void run(target)}>
              <Icon />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </ButtonGroup>
  )
}
