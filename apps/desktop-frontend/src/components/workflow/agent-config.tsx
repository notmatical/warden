import { EffortMenu } from "@/components/controls/effort-menu"
import { ModeMenu } from "@/components/controls/mode-menu"
import { ModelMenu } from "@/components/controls/model-menu"
import { Callout } from "@/components/ui/callout"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { backendForModel } from "@/lib/models"
import { cn } from "@/lib/utils"
import { INTENT_META, INTENT_ORDER } from "@/lib/workflow-intents"
import type { AgentTaskConfig } from "@/types/workflow"

/** The intent-driven config for an agent node — rendered inline on the card. */
export function AgentConfig({
  config,
  patchConfig,
}: {
  config: AgentTaskConfig
  patchConfig: (patch: Partial<AgentTaskConfig>) => void
}) {
  const meta = INTENT_META[config.intent]
  const IntentIcon = meta.icon
  return (
    <>
      <div className="space-y-1">
        <span className="font-medium text-[11px] text-muted-foreground">
          Does
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="nodrag flex w-full items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-[13px] hover:bg-muted/40"
            >
              <IntentIcon className={cn("size-4", meta.accent)} />
              <span className="flex-1">{meta.label}</span>
              <span className="text-[10px] text-muted-foreground">
                {meta.description}
              </span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56">
            {INTENT_ORDER.map((intent) => {
              const m = INTENT_META[intent]
              const Icon = m.icon
              return (
                <DropdownMenuItem
                  key={intent}
                  // Clear the mode override: it's a Custom-only knob, and a
                  // stale bypassPermissions must not follow the node into a
                  // read-only intent like Review.
                  onSelect={() => patchConfig({ intent, permissionMode: null })}
                  className="gap-2"
                >
                  <Icon className={cn("size-4", m.accent)} />
                  {m.label}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Field-style controls (no composer shortcut tooltips), wrapped in a
          single nodrag region so the menus open cleanly on the canvas. */}
      <div className="nodrag space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <span className="font-medium text-[11px] text-muted-foreground">
              Model
            </span>
            <ModelMenu
              variant="form"
              value={config.model}
              onChange={(model) => patchConfig({ model })}
              backend={backendForModel(config.model)}
              started={false}
            />
          </div>
          <div className="space-y-1">
            <span className="font-medium text-[11px] text-muted-foreground">
              Effort
            </span>
            <EffortMenu
              variant="form"
              value={config.effort}
              onChange={(effort) => patchConfig({ effort })}
            />
          </div>
        </div>
        {config.intent === "custom" ? (
          <div className="space-y-1">
            <span className="font-medium text-[11px] text-muted-foreground">
              Mode
            </span>
            <ModeMenu
              variant="form"
              // Mirror the backend default for Custom (acceptEdits), so the menu
              // never shows a scarier mode than the one that actually runs.
              value={config.permissionMode ?? "acceptEdits"}
              onChange={(permissionMode) => patchConfig({ permissionMode })}
            />
          </div>
        ) : null}
      </div>

      <div className="space-y-1">
        <span className="font-medium text-[11px] text-muted-foreground">
          {meta.promptLabel}
        </span>
        <Textarea
          value={config.prompt}
          onChange={(e) => patchConfig({ prompt: e.target.value })}
          rows={meta.promptRequired ? 3 : 2}
          placeholder={meta.promptPlaceholder}
          spellCheck={false}
          className="nodrag min-h-14 text-[13px]"
        />
        {meta.promptRequired && !config.prompt.trim() ? (
          <p className="text-[11px] text-amber-500">
            Required before the workflow can run.
          </p>
        ) : null}
      </div>

      {meta.writesCode ? (
        <div className="space-y-1">
          <span className="font-medium text-[11px] text-muted-foreground">
            Branch (optional)
          </span>
          <Input
            value={config.branchHint ?? ""}
            onChange={(e) =>
              patchConfig({ branchHint: e.target.value || null })
            }
            placeholder="defaults to the run's branch"
            spellCheck={false}
            className="nodrag h-7 font-mono text-[12px]"
          />
        </div>
      ) : (
        <Callout>
          Read-only. Researches and hands its result to the next node.
        </Callout>
      )}
    </>
  )
}
