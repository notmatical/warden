import {
  Bot,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Loader2,
} from "lucide-react"
import { type ComponentType, useMemo, useState } from "react"

import { ToolActivity } from "@/components/tool-activity"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/ui/markdown"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  collectSubagents,
  type Subagent,
  type SubagentStatus,
} from "@/lib/subagents"
import { formatDuration } from "@/lib/time"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"

const STATUS_ICON: Record<
  SubagentStatus,
  { icon: ComponentType<{ className?: string }>; className: string }
> = {
  running: { icon: Loader2, className: "animate-spin text-primary" },
  done: { icon: CircleCheck, className: "text-emerald-500" },
  error: { icon: CircleAlert, className: "text-destructive" },
}

function StatusIcon({ status }: { status: SubagentStatus }) {
  const { icon: Icon, className } = STATUS_ICON[status]
  return <Icon className={cn("size-3.5 shrink-0", className)} />
}

function stepCount(sub: Subagent): number {
  return sub.activity.reduce((n, e) => n + (e.type === "tool_use" ? 1 : 0), 0)
}

function durationLabel(sub: Subagent): string | null {
  if (sub.status === "running") return "running…"
  return sub.endedAt ? formatDuration(sub.startedAt, sub.endedAt) : null
}

/** A subagent's meta line: step count and elapsed/running time. */
function MetaLine({ sub, className }: { sub: Subagent; className?: string }) {
  const steps = stepCount(sub)
  const duration = durationLabel(sub)
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-[10px] text-muted-foreground/70 tabular-nums",
        className
      )}
    >
      <span>
        {steps} step{steps === 1 ? "" : "s"}
      </span>
      {duration ? (
        <>
          <span className="text-muted-foreground/40">·</span>
          <span>{duration}</span>
        </>
      ) : null}
    </div>
  )
}

/** The drill-in view for one subagent: its prompt, the activity it produced, and
 *  its final report. */
function SubagentDetail({
  sub,
  workingDir,
}: {
  sub: Subagent
  workingDir?: string
}) {
  return (
    <>
      <SheetHeader className="gap-2 border-b border-border/60">
        <SheetTitle className="flex items-center gap-2">
          <StatusIcon status={sub.status} />
          <span className="truncate">{sub.label}</span>
        </SheetTitle>
        <div className="flex items-center gap-2">
          {sub.subagentType ? (
            <SheetDescription className="font-mono text-[11px]">
              {sub.subagentType}
            </SheetDescription>
          ) : null}
          <MetaLine sub={sub} className="text-[11px]" />
        </div>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-4">
        {sub.prompt ? (
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
              Prompt
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2 text-[13px] whitespace-pre-wrap text-foreground/90">
              {sub.prompt}
            </div>
          </div>
        ) : null}

        {sub.activity.length > 0 ? (
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
              Activity
            </div>
            <ToolActivity items={sub.activity} workingDir={workingDir} />
          </div>
        ) : null}

        {sub.result ? (
          <div>
            <div className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/80 uppercase">
              Report
            </div>
            <div className="rounded-lg border border-border/50 bg-muted/20 px-3.5 py-2 text-sm">
              <Markdown>{sub.result}</Markdown>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}

/** Composer-toolbar control for a session's subagents: a compact icon+count
 *  button that opens a popover overview (status, steps, duration). Selecting one
 *  opens a side sheet replaying its activity. Hidden when none were spawned. */
export function AgentToolbar({ sessionId }: { sessionId: string }) {
  const events = useAppStore((s) => s.eventsBySession[sessionId])
  const workingDir = useAppStore((s) => s.sessions[sessionId]?.workingDir)
  const subagents = useMemo(
    () => (events ? collectSubagents(events) : []),
    [events]
  )
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  if (subagents.length === 0) return null

  const running = subagents.filter((s) => s.status === "running").length
  const done = subagents.filter((s) => s.status === "done").length
  const active = subagents.find((s) => s.id === activeId) ?? null

  return (
    <>
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            title="Sub-agents"
            className={cn(
              "gap-1.5 px-2 text-muted-foreground hover:text-foreground",
              running > 0 && "text-primary"
            )}
          >
            {running > 0 ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Bot className="size-3.5" />
            )}
            <span className="text-xs tabular-nums">{subagents.length}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80 p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-xs font-medium text-foreground">
              Sub-agents
            </span>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {done} done{running > 0 ? ` · ${running} running` : ""}
            </span>
          </div>
          <ul className="max-h-80 overflow-auto p-1">
            {subagents.map((sub) => (
              <li key={sub.id}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveId(sub.id)
                    setPopoverOpen(false)
                  }}
                  className="flex w-full flex-col gap-1 rounded-lg px-2 py-2 text-left hover:bg-muted/60"
                >
                  <div className="flex items-center gap-2">
                    <StatusIcon status={sub.status} />
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground/90">
                      {sub.label}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/40" />
                  </div>
                  {sub.prompt ? (
                    <span className="line-clamp-2 pl-5 text-[11px] text-muted-foreground/70">
                      {sub.prompt}
                    </span>
                  ) : null}
                  <MetaLine sub={sub} className="pl-5" />
                </button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>

      <Sheet
        open={active !== null}
        onOpenChange={(open) => {
          if (!open) setActiveId(null)
        }}
      >
        <SheetContent className="w-full gap-0 p-0 data-[side=right]:sm:max-w-2xl">
          {active ? (
            <SubagentDetail sub={active} workingDir={workingDir} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  )
}
