import { ListTodo } from "lucide-react"

import { DestinationEmpty } from "@/components/destination-empty"
import { Button } from "@/components/ui/button"

/** Tasks destination — placeholder until the Linear integration lands. */
export function TasksView() {
  return (
    <DestinationEmpty
      icon={ListTodo}
      title="Tasks"
      description="Connect Linear to triage and work issues without leaving warden."
      action={
        <Button size="sm" variant="outline" disabled>
          Connect Linear — coming soon
        </Button>
      }
    />
  )
}
