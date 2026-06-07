import { CircleDot } from "lucide-react"

import { DestinationEmpty } from "@/components/destination-empty"
import { GitHubIcon } from "@/components/icons/brand"
import { Button } from "@/components/ui/button"

/** Issues destination — placeholder until the GitHub issues integration lands. */
export function IssuesView() {
  return (
    <DestinationEmpty
      icon={CircleDot}
      title="Issues"
      description="Browse and open GitHub issues for your connected repositories."
      action={
        <Button size="sm" variant="outline" disabled>
          <GitHubIcon />
          Connect GitHub — coming soon
        </Button>
      }
    />
  )
}
