import {
  Bell,
  Bot,
  GitPullRequest,
  Inbox,
  MessageCircleQuestion,
  Workflow,
  X,
} from "lucide-react"
import type { ComponentType } from "react"
import type { NotifyEvent, ToastPayload } from "@/lib/notify"
import { cn } from "@/lib/utils"

export type Toast = ToastPayload & { shownAt: number; leaving: boolean }

const EVENT_ICONS: Record<
  NotifyEvent,
  ComponentType<{ className?: string }>
> = {
  sessionDone: Bot,
  needsInput: MessageCircleQuestion,
  workflowDone: Workflow,
  prChecks: GitPullRequest,
  linearAssigned: Inbox,
}

export function ToastCard({
  toast,
  onActivate,
  onDismiss,
}: {
  toast: Toast
  onActivate: (toast: Toast) => void
  onDismiss: (id: string) => void
}) {
  const Icon = toast.event ? EVENT_ICONS[toast.event] : Bell
  const errored = toast.tone === "error"
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the popup window never holds keyboard focus
    // biome-ignore lint/a11y/useSemanticElements: the nested dismiss <button> forbids a real <button> card
    <div
      role="button"
      tabIndex={-1}
      onClick={() => onActivate(toast)}
      className={cn(
        "group flex cursor-pointer items-start gap-3 rounded-xl bg-popover p-3.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 transition-all duration-150",
        toast.leaving
          ? "translate-x-4 opacity-0"
          : "animate-in fade-in slide-in-from-right-4"
      )}
    >
      <div
        className={cn(
          "mt-px flex size-7 shrink-0 items-center justify-center rounded-lg",
          errored
            ? "bg-destructive/10 text-destructive"
            : "bg-primary/10 text-primary"
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-sm">{toast.title}</p>
        {toast.body && (
          <p className="mt-0.5 line-clamp-2 text-muted-foreground text-xs">
            {toast.body}
          </p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss(toast.id)
        }}
        className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
