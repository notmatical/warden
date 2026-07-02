import { AlertTriangle, Check, ChevronRight, Circle } from "lucide-react"
import {
  type CSSProperties,
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useMemo,
  useState,
} from "react"

import { CodeView } from "@/components/ui/code-view"
import { DiffView, useHighlighted } from "@/components/ui/diff-view"
import {
  describeTool,
  pathRelativeTo,
  shortenPath,
  type ToolDetail,
  type ToolView,
} from "@/lib/tool-format"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/store/app-store"
import type { TranscriptView } from "@/store/types"
import type { EventRecord } from "@/types"

/** Session working directory, used to display tool-target paths relative to it
 *  in the diff/code panel headers. Set by `ToolActivity`. */
const WorkingDirContext = createContext<string | undefined>(undefined)

function useDisplayPath(path: string | undefined): string | undefined {
  const cwd = useContext(WorkingDirContext)
  return pathRelativeTo(path, cwd)
}

interface ToolStepData {
  kind: "tool"
  id: string
  name: string
  input: unknown
  result?: { content: string; isError: boolean }
  /** Subagent (Task/Agent) calls nest the tools they spawned here. */
  children?: ToolStepData[]
}

type Step = { kind: "thinking"; id: string; text: string } | ToolStepData

/** Collapse a run of thinking/tool_use/tool_result events into ordered steps,
 *  pairing each result to its call and nesting a subagent's tools (those with a
 *  `parent_tool_use_id`) under the Task/Agent step that spawned them. */
function buildSteps(items: EventRecord[]): Step[] {
  const steps: Step[] = []
  const byId = new Map<string, ToolStepData>()

  for (const item of items) {
    if (item.type === "thinking") {
      if (item.text.trim()) {
        steps.push({ kind: "thinking", id: item.id, text: item.text })
      }
    } else if (item.type === "tool_use") {
      const step: ToolStepData = {
        kind: "tool",
        id: item.id,
        name: item.name,
        input: item.input,
      }
      byId.set(item.id, step)
      const parent = item.parent_tool_use_id
        ? byId.get(item.parent_tool_use_id)
        : undefined
      if (parent) {
        ;(parent.children ??= []).push(step)
      } else {
        steps.push(step)
      }
    } else if (item.type === "tool_result") {
      // Pair to its call wherever it sits (top-level or nested under a Task).
      const target = byId.get(item.tool_use_id)
      if (target) {
        target.result = { content: item.content, isError: item.is_error }
      } else {
        steps.push({
          kind: "tool",
          id: item.id,
          name: "result",
          input: undefined,
          result: { content: item.content, isError: item.is_error },
        })
      }
    }
  }

  return steps
}

/** Transcript detail level, provided by `ToolActivity` from the persisted
 *  preference: "normal" collapses every step to its summary line; "verbose"
 *  opens detail panels and surfaces tool inputs. */
const ViewContext = createContext<TranscriptView>("normal")

function useVerbose(): boolean {
  return useContext(ViewContext) === "verbose"
}

/** Per-row open state. The default follows the current view mode; a manual
 *  chevron toggle overrides it until the mode switches again. No remount on
 *  mode change — panels that stay open keep their (highlighted) DOM. */
function useRowOpen(defaultOpen: boolean): [boolean, () => void] {
  const mode = useContext(ViewContext)
  const [override, setOverride] = useState<{
    mode: TranscriptView
    open: boolean
  } | null>(null)
  const open = override?.mode === mode ? override.open : defaultOpen
  return [open, () => setOverride({ mode, open: !open })]
}

/** Warm code surface (theme token) shared by code/terminal/text panels, matching
 *  the diff viewer so the activity log reads as one piece. */
const CODE_SURFACE = "bg-card text-foreground"

/** A Task/Agent call's short description, for the header. */
function agentDescription(input: unknown): string | undefined {
  if (input && typeof input === "object" && "description" in input) {
    const d = (input as { description?: unknown }).description
    if (typeof d === "string" && d.trim()) return d.trim()
  }
  return undefined
}

/** Shared bordered, height-capped, scrollable dark panel for code/text bodies. */
function Panel({
  header,
  headerTitle,
  children,
}: {
  header?: string
  headerTitle?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      {header ? (
        <div
          className="truncate border-b border-border/60 bg-muted/30 px-3 py-1.5 font-mono text-sm text-muted-foreground/80"
          title={headerTitle ?? header}
        >
          {header}
        </div>
      ) : null}
      <div
        className={cn(
          "max-h-72 overflow-auto [contain-intrinsic-size:auto_18rem] [content-visibility:auto]",
          CODE_SURFACE
        )}
      >
        {children}
      </div>
    </div>
  )
}

function CodePanel({ path, text }: { path?: string; text: string }) {
  const display = useDisplayPath(path)
  return <CodeView path={display} pathTitle={path} text={text} />
}

function TextPanel({ text }: { text: string }) {
  return (
    <Panel>
      <pre className="m-0 px-3 py-1.5 font-mono text-sm leading-[1.55] whitespace-pre-wrap text-muted-foreground">
        {text}
      </pre>
    </Panel>
  )
}

/** A shell command, Shiki-tokenized with the bash grammar so flags, strings and
 *  operators read like a real terminal instead of one flat color. */
function ShellCommand({ command }: { command: string }) {
  const lines = useMemo(() => command.split("\n"), [command])
  const hl = useHighlighted(lines, "bash")
  if (!hl) return <>{command}</>
  return (
    <>
      {hl.lines.map((tokens, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: command lines are positional
        <Fragment key={i}>
          {i > 0 ? "\n" : null}
          {tokens.map((t, ti) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: tokens are positional
              key={ti}
              data-tok
              style={t.style as CSSProperties | undefined}
            >
              {t.content}
            </span>
          ))}
        </Fragment>
      ))}
    </>
  )
}

function TerminalPanel({
  command,
  output,
  isError,
}: {
  command: string
  output: string
  isError: boolean
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div
        className={cn(
          "px-3 py-1.5 font-mono text-[14px] whitespace-pre-wrap",
          CODE_SURFACE
        )}
      >
        <span className="select-none text-positive">$ </span>
        <ShellCommand command={command} />
      </div>
      {output ? (
        <div
          className={cn(
            "max-h-72 overflow-auto border-t border-border/60 [contain-intrinsic-size:auto_18rem] [content-visibility:auto]",
            CODE_SURFACE
          )}
        >
          <pre
            className={cn(
              "m-0 px-3 py-1.5 font-mono text-sm leading-[1.55] whitespace-pre-wrap",
              isError ? "text-destructive" : "text-muted-foreground"
            )}
          >
            {output}
          </pre>
        </div>
      ) : null}
    </div>
  )
}

function TodoPanel({
  todos,
}: {
  todos: { content: string; status: string }[]
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border/60 bg-card px-3 py-2">
      {todos.map((t, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: todos are positional
          key={i}
          className="flex items-center gap-2 text-[12px]"
        >
          {t.status === "completed" ? (
            <Check className="size-3 shrink-0 text-positive" />
          ) : t.status === "in_progress" ? (
            <Circle className="size-3 shrink-0 fill-primary/20 text-primary" />
          ) : (
            <Circle className="size-3 shrink-0 text-muted-foreground/40" />
          )}
          <span
            className={cn(
              t.status === "completed"
                ? "text-muted-foreground line-through"
                : t.status === "in_progress"
                  ? "text-foreground"
                  : "text-muted-foreground"
            )}
          >
            {t.content}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Verbose-only list of the call's input fields (a Grep's pattern/path/flags),
 *  mirroring what the developer would see in the raw tool call. */
function ParamsList({ params }: { params: { key: string; value: string }[] }) {
  return (
    <div className="flex flex-col gap-0.5 py-1 font-mono text-[12px] leading-relaxed">
      {params.map((p) => (
        <div key={p.key} className="flex min-w-0 gap-2">
          <span className="shrink-0 text-muted-foreground/70">{p.key}:</span>
          <span className="break-all whitespace-pre-wrap text-foreground/85">
            {p.value}
          </span>
        </div>
      ))}
    </div>
  )
}

function DiffDetail({ path, patch }: { path?: string; patch: string }) {
  const display = useDisplayPath(path)
  return <DiffView path={display} pathTitle={path} patch={patch} />
}

function ToolBody({
  detail,
  params,
}: {
  detail?: ToolDetail
  params?: ToolView["params"]
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {params?.length ? <ParamsList params={params} /> : null}
      {detail ? <DetailPanel detail={detail} /> : null}
    </div>
  )
}

function DetailPanel({ detail }: { detail: ToolDetail }) {
  switch (detail.kind) {
    case "diff":
      return <DiffDetail path={detail.path} patch={detail.patch} />
    case "code":
      return <CodePanel path={detail.path} text={detail.text} />
    case "terminal":
      return (
        <TerminalPanel
          command={detail.command}
          output={detail.output}
          isError={detail.isError}
        />
      )
    case "todos":
      return <TodoPanel todos={detail.todos} />
    case "text":
      return <TextPanel text={detail.text} />
  }
}

/** Shared row chrome: a card-surfaced accordion — summary line on a muted
 *  background, detail panels nesting inside its padding as cards-in-a-card. */
function Row({
  open,
  onToggle,
  expandable,
  error,
  children,
  body,
}: {
  open: boolean
  onToggle: () => void
  expandable: boolean
  error?: boolean
  children: ReactNode
  body?: ReactNode
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg bg-muted/30">
      <button
        type="button"
        disabled={!expandable}
        onClick={onToggle}
        aria-expanded={expandable ? open : undefined}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm",
          expandable ? "hover:bg-muted/40" : "cursor-default"
        )}
      >
        {children}
        {error ? (
          <AlertTriangle className="size-3.5 shrink-0 text-destructive" />
        ) : null}
        {expandable ? (
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground/50 transition-transform",
              open && "rotate-90"
            )}
          />
        ) : null}
      </button>
      {open && body ? <div className="min-w-0 px-2.5 pb-2">{body}</div> : null}
    </div>
  )
}

function ToolRow({ step }: { step: ToolStepData }) {
  const verbose = useVerbose()
  // Steps are rebuilt on every event append, but their fields are stable —
  // memo on those so Edit diffs (diffLines) don't recompute per append.
  const hasResult = step.result !== undefined
  const resultContent = step.result?.content
  const error = step.result?.isError ?? false
  const view = useMemo(
    () =>
      describeTool(
        step.name,
        step.input,
        hasResult ? { content: resultContent ?? "", isError: error } : undefined
      ),
    [step.name, step.input, hasResult, resultContent, error]
  )
  const showParams = verbose && !!view.params?.length
  const expandable = !!view.detail || showParams
  // Errors always open and verbose opens anything expandable — computed live so
  // a row that mounts mid-stream still opens when its result arrives.
  const [open, toggle] = useRowOpen(error || (verbose && expandable))
  const hasCounts = !!(view.added || view.removed)
  // File targets display relative to the session cwd, then shorten — a file in
  // the worktree root reads "biome.json", not "<worktree>/biome.json".
  const displayPath = useDisplayPath(view.path)
  const label = view.path
    ? shortenPath(displayPath)
    : (view.label ?? view.target)

  return (
    <Row
      open={open}
      onToggle={toggle}
      expandable={expandable}
      error={error}
      body={
        expandable ? (
          <ToolBody
            detail={view.detail}
            params={showParams ? view.params : undefined}
          />
        ) : null
      }
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {/* Muted verb, emphasized target — the file/command is what the eye
            scans for, the action is secondary. */}
        <span className="shrink-0 text-muted-foreground">{view.verb}</span>
        {view.target ? (
          <span
            className="truncate font-mono text-[13px] font-medium text-foreground/90"
            title={view.target}
          >
            {label}
          </span>
        ) : null}
      </span>
      {hasCounts ? (
        <span className="shrink-0 text-[12px] tabular-nums">
          {view.added ? (
            <span className="text-positive">+{view.added}</span>
          ) : null}
          {view.added && view.removed ? " " : null}
          {view.removed ? (
            <span className="text-destructive">−{view.removed}</span>
          ) : null}
        </span>
      ) : null}
    </Row>
  )
}

function AgentRow({ step }: { step: ToolStepData }) {
  const verbose = useVerbose()
  const children = step.children ?? []
  const desc = agentDescription(step.input)
  const error = step.result?.isError ?? false
  const [open, toggle] = useRowOpen(verbose && children.length > 0)

  return (
    <Row
      open={open}
      onToggle={toggle}
      expandable={children.length > 0}
      error={error}
      body={
        <div className="flex flex-col gap-1 border-l border-border/40 pl-2.5">
          {children.map((c) => (
            <StepNode key={c.id} step={c} />
          ))}
        </div>
      }
    >
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="shrink-0 text-muted-foreground">{step.name}</span>
        {desc ? (
          <span
            className="truncate font-medium text-foreground/90"
            title={desc}
          >
            {desc}
          </span>
        ) : null}
      </span>
      {children.length > 0 ? (
        <span className="shrink-0 text-[11px] text-muted-foreground/70">
          {children.length} step{children.length > 1 ? "s" : ""}
        </span>
      ) : null}
    </Row>
  )
}

function ThinkingRow({ text }: { text: string }) {
  const verbose = useVerbose()
  const [open, toggle] = useRowOpen(verbose)
  const preview = text.trim().split("\n", 1)[0]

  return (
    <Row
      open={open}
      onToggle={toggle}
      expandable
      body={
        <div className="py-1 text-[13px] leading-[1.6] whitespace-pre-wrap text-muted-foreground italic">
          {text}
        </div>
      }
    >
      <span className="shrink-0 text-muted-foreground">Thought</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground/70 italic">
        {preview}
      </span>
    </Row>
  )
}

function StepNode({ step }: { step: Step }) {
  if (step.kind === "thinking") return <ThinkingRow text={step.text} />
  if (step.children && step.children.length > 0) return <AgentRow step={step} />
  return <ToolRow step={step} />
}

/** A contiguous block of agent tool use and thinking, rendered as Claude-style
 *  text-forward summary lines that each expand into a single detail card (diff,
 *  code, terminal output, …). Subagent (Task) calls nest their own rows.
 *  `workingDir` lets path headers in the body render relative to the session's
 *  working directory instead of as long absolute paths. */
export function ToolActivity({
  items,
  workingDir,
}: {
  items: EventRecord[]
  workingDir?: string
}) {
  const view = useAppStore((s) => s.transcriptView)
  const steps = useMemo(() => buildSteps(items), [items])
  if (steps.length === 0) return null

  return (
    <WorkingDirContext.Provider value={workingDir}>
      <ViewContext.Provider value={view}>
        <div className="flex min-w-0 flex-col gap-1.5">
          {steps.map((step) => (
            <StepNode key={step.id} step={step} />
          ))}
        </div>
      </ViewContext.Provider>
    </WorkingDirContext.Provider>
  )
}
