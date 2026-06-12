import { SquareChevronRight } from "lucide-react"

import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import { NATIVE_PROVIDER_ICON, PROVIDER_ORDER } from "@/lib/provider-icons"
import { useAppStore } from "@/store/app-store"
import { NATIVE_TITLE } from "@/store/shared"

/** "Native CLI" entry for the new-session menus: a submenu with one item per
 *  signed-in provider, opening that provider's own TUI in a terminal session.
 *  Renders nothing (separator included) when no provider is signed in. */
export function NativeCliSub({ projectId }: { projectId: string }) {
  const createNativeSession = useAppStore((s) => s.createNativeSession)
  const providers = useAppStore((s) => s.providers)
  const native = PROVIDER_ORDER.filter((id) =>
    providers.some((p) => p.id === id && p.authed)
  )
  if (native.length === 0) return null

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <SquareChevronRight className="text-muted-foreground" />
          Native CLI
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {native.map((id) => {
            const Icon = NATIVE_PROVIDER_ICON[id]
            return (
              <DropdownMenuItem
                key={id}
                onSelect={() => void createNativeSession(projectId, id)}
              >
                <Icon />
                {NATIVE_TITLE[id]}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
