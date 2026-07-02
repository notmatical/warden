import { openUrl } from "@tauri-apps/plugin-opener"
import { useEffect, useState } from "react"

import { GitHubIcon } from "@/components/icons/brand"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { repoBrowseUrl } from "@/lib/ipc"

/** Opens the active repo's `origin` remote in the browser. Hidden when the
 *  current path has no recognizable remote. */
export function GithubButton({ path }: { path: string | null | undefined }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const resolve = async () => {
      if (!path) return null
      try {
        return await repoBrowseUrl(path)
      } catch {
        return null
      }
    }
    void resolve().then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [path])

  if (!url) {
    return null
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => void openUrl(url)}
          aria-label="View on GitHub"
          className="text-muted-foreground hover:text-foreground"
        >
          <GitHubIcon className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>View on GitHub</TooltipContent>
    </Tooltip>
  )
}
